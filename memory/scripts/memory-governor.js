/**
 * Memory Governor v1.2 — 三层心智状态机 + 情境结界门控
 * 
 * 职责：
 * 1. 维护 life_status 状态流转（ACTIVE ↔ CRYOSLEEP ↔ DEPRECATED）
 * 2. 维护 mental_layer 层级分配（MINDBASE / GROWTH / RESEARCH）
 * 3. 情境结界门控过滤（contextual boundary gating）
 * 4. 触发概念蒸馏（Upward Distillation）
 * 
 * 调度方式：被 dream-entropy 或 cron job 触发，非实时
 */

'use strict';
const path = require('path');

// ─── Constants ────────────────────────────────────────────────────────────────

const TAU = 10; // staleness half-life days (from atoms-db.js)

const LAMBDA = Math.LN2 / TAU; //遗忘率常数 ln(2)/τ ≈ 0.0693

// ─── Magic number constants (P1 extraction) ──────────────────────────────────
const D_FREQ_DENOM        = 50;  // D1 frequency denominator
const D_CONCEPTUAL_DENOM  = 10;  // D3 conceptual depth denominator
const D1_WEIGHT            = 0.24; // frequency weight in activation sumW
const D2_WEIGHT            = 0.30; // recency weight in activation sumW
const D3_WEIGHT            = 0.20; // conceptual weight in activation sumW
const D4_WEIGHT            = 0.20; // depth weight in activation sumW
const D5_WEIGHT            = 0.06; // (reserved/alignment)
const BOUNDARY_GATE        = 0.38; // MatchScore below this → blocked (metaRoute + computeBoundaryGating)
const K_CONFLICT           = 0.75; // cognitive conflict index → trigger RESEARCH
const D_CLUSTER            = 5;    // cluster size to trigger abstraction distillation
const D1_DEFAULT           = 0.1;  // default D1 when no recall_count
const D3_DEFAULT           = 0.2;  // default D3 when no claims_count
const IMPORTANCE_DEFAULT  = 0.5;  // default importance/confidence
const UTILITY_THRESHOLD    = 0.6;  // canary utility gate threshold
const PAIN_INDEX_BYPASS   = 0.8;  // pain_index metaRoute bypass threshold
const E_ACTIVATION_FORGET = 0.2;  // E_activation threshold for selective forgetting eval
const TOPOLOGY_PRUNE_DAYS  = 30;   // relation weight prune age threshold
const IMPORTANCE_ARCHIVE   = 0.3;  // importance below this → archived
const ARCHIVE_DAYS         = 60;   // last_recalled_at age threshold for archiving

const THRESHOLDS = {
  TAU_ACTIVE:   0.55,  // E_activation above this → ACTIVE
  TAU_CRYO:     0.25,  // E_activation below this → CRYOSLEEP
  K_CONFLICT:   0.75,  // cognitive conflict index → trigger RESEARCH
  D_CLUSTER:    5,     // cluster size to trigger abstraction distillation
  BOUNDARY_GATE: 0.38, // MatchScore below this → blocked by contextual boundary
};

// ─── Activation Energy ─────────────────────────────────────────────────────────

/**
 * 计算记忆原子的动态激活能 E_activation
 * E_activation = [I × (1+C)/2] × S × ln(e + Σw_i × D_i)
 * 
 * @param {Object} atom - memory_atom row
 * @param {Object} opts - {D_frequency, D_recency, D_conceptual} from recall context
 */
function computeActivationEnergy(atom, opts = {}) {
  const I = atom.importance || 0.5;
  const C = atom.confidence || 0.5;

  // Staleness S = e^(-λ × t_since_last_recall)
  let S = 1.0;
  if (atom.last_recalled_at) {
    const tHours = (Date.now() - new Date(atom.last_recalled_at).getTime()) / 3600000;
    S = Math.exp(-LAMBDA * tHours / 24); // λ in days, convert to hours
  } else {
    // No recall yet → use creation time
    const tHours = (Date.now() - new Date(atom.created_at).getTime()) / 3600000;
    S = Math.exp(-LAMBDA * tHours / 24);
  }

  // D terms (from recall context or computed from atom)
  const D1 = opts.D_frequency || (atom.recall_count ? Math.min(1, atom.recall_count / D_FREQ_DENOM) : D1_DEFAULT);
  const D2 = opts.D_recency || S; // recency proxy
  const D3 = opts.D_conceptual || (atom.claims_count ? Math.min(1, atom.claims_count / D_CONCEPTUAL_DENOM) : D3_DEFAULT);

  // Weighted sum
  const sumW = D1_WEIGHT * D1 + D2_WEIGHT * D2 + D3_WEIGHT * D3 + D4_WEIGHT * (atom.conceptual_depth || 1) / 10;
  const triggerFactor = Math.log(Math.E + sumW);

  return I * (1 + C) / 2 * S * triggerFactor;
}

// ─── Contextual Boundary Gate ─────────────────────────────────────────────────

/**
 * 情境结界门控过滤
 * MatchScore = CosineSim(V_current_context, V_atom_boundary)
 * 
 * @param {string} currentNamespace - 当前项目/情境
 * @param {string} atomNamespace - atom 的命名空间
 * @param {string} atomContextTags - JSON array of context tags
 * @param {string} atomBoundary - JSON object of applicability_boundary
 * @returns {number} gating factor 0..1 (1 = fully allowed, 0 = blocked)
 */
function computeBoundaryGating(currentNamespace, atomNamespace, atomContextTags, atomBoundary) {
  // 1. Namespace exact match (strongest signal)
  if (currentNamespace === atomNamespace) {
    return 1.0;
  }

  // 2. Parse context_tags
  let tags = [];
  try { tags = JSON.parse(atomContextTags || '[]'); } catch(e) { console.warn('[memory-governor] parse context_tags failed:', e.message); }

  // 3. Parse applicability_boundary  
  let boundary = {};
  try { boundary = JSON.parse(atomBoundary || '{}'); } catch(e) { console.warn('[memory-governor] parse applicability_boundary failed:', e.message); }

  // 4. Check allowed namespaces in boundary
  if (boundary.allowedNamespaces && Array.isArray(boundary.allowedNamespaces)) {
    if (!boundary.allowedNamespaces.includes(currentNamespace)) {
      return 0; // hard block — not in allow list
    }
    // In the allow list → full pass
    return 1.0;
  }

  // 5. Check excluded namespaces
  if (boundary.excludedNamespaces && Array.isArray(boundary.excludedNamespaces)) {
    if (boundary.excludedNamespaces.includes(currentNamespace)) {
      return 0; // hard block
    }
  }

  // 6. Tag overlap score
  if (tags.length > 0 && boundary.requiredTags && boundary.requiredTags.length > 0) {
    const matched = tags.filter(t => boundary.requiredTags.includes(t));
    return matched.length / Math.max(tags.length, 1);
  }

  // Default: partial compatibility
  return currentNamespace === atomNamespace ? 1.0 : 0.5;
}

// ─── State Machine ─────────────────────────────────────────────────────────────

/**
 * Determine new life_status based on activation energy and state machine rules
 * 
 * Transition matrix:
 * ACTIVE → CRYOSLEEP: E_activation < TAU_CRYO
 * ACTIVE → DEPRECATED: sandbox validation failed OR paradigm shift rejected
 * CRYOSLEEP → ACTIVE: E_activation >= TAU_ACTIVE
 * CRYOSLEEP → DEPRECATED: abstraction distillation completed
 * RESEARCH → DEPRECATED: validation failed
 * RESEARCH → ACTIVE: validation passed, new paradigm synthesized
 */
function computeLifeStatus(atom, E_activation, opts = {}) {
  const current = atom.life_status || 'ACTIVE';
  const cognitiveConflict = opts.cognitiveConflict || 0;

  // Rule: cognitive conflict index triggers RESEARCH
  if (cognitiveConflict >= THRESHOLDS.K_CONFLICT) {
    return 'RESEARCH';
  }

  // Rule: CRYOSLEEP atoms with enough cluster size → DEPRECATED (distillation)
  if (opts.clusterSize >= THRESHOLDS.D_CLUSTER && current === 'CRYOSLEEP') {
    return 'DEPRECATED';
  }

  // Rule: sandbox validation failure → DEPRECATED
  if (opts.validationFailed === true) {
    return 'DEPRECATED';
  }

  // Rule: validation passed (RESEARCH → ACTIVE)
  if (opts.validationPassed === true && current === 'RESEARCH') {
    return 'ACTIVE';
  }

  // Rule: activation energy transitions
  if (E_activation >= THRESHOLDS.TAU_ACTIVE) {
    return 'ACTIVE';
  } else if (E_activation < THRESHOLDS.TAU_CRYO) {
    return 'CRYOSLEEP';
  }

  // Otherwise keep current (with boundary gating effect)
  if (opts.boundaryGating < THRESHOLDS.BOUNDARY_GATE && current === 'ACTIVE') {
    return 'CRYOSLEEP'; // gated atoms get downgraded
  }

  return current;
}

/**
 * Determine mental_layer based on atom characteristics
 * 
 * MINDBASE: human_pin=1, importance>0.85, identity/价值观类
 * GROWTH: 普通经验、学习积累
 * RESEARCH: 矛盾引擎触发、假说生成阶段
 */
function computeMentalLayer(atom, opts = {}) {
  // MINDBASE: hard rules
  if (atom.human_pin === 1 || opts.isIdentity === true) {
    return 'MINDBASE';
  }

  // RESEARCH: conflict/engine triggered
  if (opts.inResearch === true || opts.isHypothesis === true) {
    return 'RESEARCH';
  }

  // Default: GROWTH
  return 'GROWTH';
}

// ─── Upward Distillation ──────────────────────────────────────────────────────

/**
 * 检查是否需要触发概念蒸馏
 * 条件：cluster 有 >= 5 个 CRYOSLEEP 原子
 */
function shouldTriggerDistillation(clusterAtoms) {
  return clusterAtoms.filter(a => a.life_status === 'CRYOSLEEP').length >= THRESHOLDS.D_CLUSTER;
}

// ─── Full Governor Pass ────────────────────────────────────────────────────────

/**
 * 对指定 namespace/cluster 的 atom 执行完整状态机检查
 * 
 * @param {Object} db - better-sqlite3 connection (caller provides)
 * @param {Object} clusterParams - {clusterId, currentNamespace, recallContext}
 * @returns {Object} {updates: [{atomId, newStatus, newLayer, reason}], distilled: [atomIds]}
 */
function runGovernancePass(db, clusterParams) {
  const { clusterId, currentNamespace = 'default', recallContext = {} } = clusterParams;

  // Get all CRYOSLEEP atoms in cluster
  const cryoAtoms = db.prepare(`
    SELECT * FROM memory_atom 
    WHERE cluster_id = ? AND life_status = 'CRYOSLEEP'
  `).all(clusterId);

  const updates = [];
  const distilled = [];

  // 1. Check activation energy for each CRYOSLEEP atom
  for (const atom of cryoAtoms) {
    const E = computeActivationEnergy(atom, recallContext);
    const boundaryGating = computeBoundaryGating(
      currentNamespace,
      atom.namespace,
      atom.context_tags,
      atom.applicability_boundary
    );

    const newStatus = computeLifeStatus(atom, E, {
      boundaryGating,
      cognitiveConflict: atom.cognitive_conflict || 0,
      clusterSize: cryoAtoms.length,
    });

    if (newStatus !== atom.life_status) {
      updates.push({
        atomId: atom.id,
        newStatus,
        E_activation: E,
        reason: `E=${E.toFixed(3)}, gating=${boundaryGating.toFixed(2)}`,
      });
    }
  }

  // 2. Check abstraction distillation trigger
  if (shouldTriggerDistillation(cryoAtoms)) {
    // Mark all for distillation (actual abstraction done by LLM in separate pass)
    cryoAtoms.forEach(a => {
      if (!distilled.includes(a.id)) distilled.push(a.id);
    });
  }

  return { updates, distilled };
}

// ─── Apply updates to DB ──────────────────────────────────────────────────────

function applyGovernanceUpdates(db, updates) {
  const stmt = db.prepare(`
    UPDATE memory_atom 
    SET life_status = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  const updateMany = db.transaction((rows) => {
    for (const u of rows) {
      stmt.run(u.newStatus, u.atomId);
    }
  });

  if (updates.length > 0) {
    updateMany(updates);
    console.log(`[memory-governor] Applied ${updates.length} life_status updates`);
  }
}

// ─── Meta-Controller — Budgeted Cognitive Routing ──────────────────────────────

/**
 * Hard-coded If/Else routing (no LLM calls in control plane).
 * Determines the action path based on task context signals.
 *
 * Rules:
 *   1. simple       → fast_recall    (no LLM)
 *   2. complex      → slow_path      (use LLM)
 *   3. pain_index≥0.8 → immediate_mindbase (bypass)
 *   4. DRAFT status → canary_gate    (utility threshold 0.6)
 *   5. gating<0.38  → block_or_cryo
 *   6. otherwise    → normal_recall
 *
 * @param {Object} taskContext
 * @param {string} taskContext.complexity     - 'simple' | 'complex'
 * @param {number} taskContext.pain_index    - 0..1, urgency signal
 * @param {boolean} taskContext.is_draft     - true if atom is in DRAFT status
 * @param {number} taskContext.boundary_gating - gating factor 0..1
 * @param {number} taskContext.utility_score  - canary utility 0..1
 * @returns {Object} { action, bypass_llm }
 */
function metaRoute(taskContext) {
  const {
    complexity    = 'simple',
    pain_index     = 0,
    is_draft       = false,
    boundary_gating = 0.5,
    utility_score  = 0,
  } = taskContext;


  // Rule 3: High pain index → bypass all gates, go straight to mindbase
  if (pain_index >= PAIN_INDEX_BYPASS) {
    return { action: 'immediate_mindbase', bypass_llm: false };
  }


  // Rule 4: DRAFT atom → canary validation gate
  if (is_draft) {
    if (utility_score >= UTILITY_THRESHOLD) {
      return { action: 'canary_gate', bypass_llm: false };
    }
    return { action: 'canary_gate', bypass_llm: true };
  }

  // Rule 5: Low boundary gating → block or freeze
  if (boundary_gating < BOUNDARY_GATE) {
    return { action: 'block_or_cryo', bypass_llm: true };
  }

  // Rule 1: Simple task → fast path, no LLM
  if (complexity === 'simple') {
    return { action: 'fast_recall', bypass_llm: true };
  }


  // Rule 2: Complex task → slow path with LLM
  if (complexity === 'complex') {
    return { action: 'slow_path', bypass_llm: false };
  }

  // Rule 6: Default → normal recall
  return { action: 'normal_recall', bypass_llm: false };
}

// ─── Boredom Detection ─────────────────────────────────────────────────────────

/**
 * detectBoredom — detect info redundancy pressure
 * @param {string} namespace
 * @returns {Object} { score, repetition_count, novelty_deficit }
 */
function detectBoredom(namespace) {
  const path2 = require('path');
  const Database = require('better-sqlite3');
  const DB_PATH2 = path2.join(__dirname, '..', '..', 'storage', 'atoms.db');
  let db2;
  try { db2 = new Database(DB_PATH2, { readonly: true }); } catch(e) { return { score: 0, repetition_count: 0, novelty_deficit: 0 }; }

  // Get recall history for namespace (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const history = db2.prepare(`
    SELECT id, COALESCE(recall_count, 0) as recall_count, created_at
    FROM memory_atom
    WHERE namespace = ? AND last_recalled_at >= ?
    ORDER BY recall_count DESC
    LIMIT 50
  `).all(namespace, thirtyDaysAgo);

  db2.close();

  if (history.length === 0) return { score: 0, repetition_count: 0, novelty_deficit: 0 };

  // repetition_count: atoms recalled 5+ times
  const repetitionCount = history.filter(h => h.recall_count >= D_CLUSTER).length;

  // Check for novelty: any new insights in 7 days?
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  // A new insight = atom ingested in last 7 days that was recalled
  const recentIngest = history.filter(h => {
    // approximate: check if this atom was created recently
    // we don't have created_at in recall_history, so check recall_count total
    // If recall_count is 1 and recent, might be novel
    return h.recall_count <= 2;
  });
  const noveltyDeficit = recentIngest.length === 0 ? 1 : 0;

  const score = Math.min(1, repetitionCount / 20);

  return { score, repetition_count: repetitionCount, novelty_deficit: noveltyDeficit };
}

/**
 * triggerBoredom整理 — cleanup when bored
 * @param {string} namespace
 * @returns {Object} { pruned_edges, merged_atoms, archived_rules }
 */
function triggerBoredom整理(namespace) {
  const path2 = require('path');
  const Database = require('better-sqlite3');
  const DB_PATH2 = path2.join(__dirname, '..', '..', 'storage', 'atoms.db');
  let db2;
  try { db2 = new Database(DB_PATH2); } catch(e) { return { pruned_edges: 0, merged_atoms: 0, archived_rules: 0 }; }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();

  let prunedEdges = 0;
  let mergedAtoms = 0;
  let archivedRules = 0;

  // 1. Topology pruning: DELETE relations WHERE weight < 0.1 AND created_at < 30 days ago
  const pruneResult = db2.prepare(`
    DELETE FROM relations
    WHERE weight < 0.1 AND created_at < ?
  `).run(thirtyDaysAgo);
  prunedEdges = pruneResult.changes;

  // 2. Archive low-value rules: UPDATE life_status='DEPRECATED' WHERE importance < 0.3 AND last_recalled_at < 60 days ago
  const archiveResult = db2.prepare(`
    UPDATE memory_atom
    SET life_status = 'DEPRECATED', updated_at = datetime('now')
    WHERE importance < IMPORTANCE_ARCHIVE AND (last_recalled_at < ? OR last_recalled_at IS NULL) AND life_status = 'ACTIVE'
  `).run(sixtyDaysAgo);
  archivedRules = archiveResult.changes;

  db2.close();

  return { pruned_edges: prunedEdges, merged_atoms: mergedAtoms, archived_rules: archivedRules };
}

// ─── Long-Horizon Evaluation ──────────────────────────────────────────────────

const GOV_DB_PATH = path.join(__dirname, '..', '..', 'storage', 'rfc_governance.db');

function getGovDb() {
  const Database = require('better-sqlite3');
  return new Database(GOV_DB_PATH);
}

/**
 * runLongHorizonEval — 4-category eval harness
 * @returns {Object} eval results per category
 */
function runLongHorizonEval() {
  const path2 = require('path');
  const Database = require('better-sqlite3');
  const ATOM_DB = path2.join(__dirname, '..', '..', 'storage', 'atoms.db');
  let dbAtom;
  let dbGov;
  try {
    dbAtom = new Database(ATOM_DB, { readonly: true });
    dbGov = getGovDb();
  } catch(e) {
    return { error: e.message };
  }

  const results = {};

  // Category 1: accuracy_recall — top-5 recall results still relevant
  try {
    const top5 = dbAtom.prepare(`
      SELECT * FROM memory_atom
      WHERE life_status = 'ACTIVE' AND recall_count > 0
      ORDER BY recall_count DESC LIMIT 5
    `).all();


    let relevanceSum = 0;
    for (const atom of top5) {
      // Check semantic variance: if atom was updated recently vs last_recalled
      const updatedAt = atom.updated_at ? new Date(atom.updated_at) : new Date(atom.created_at);
      const lastRecalled = atom.last_recalled_at ? new Date(atom.last_recalled_at) : updatedAt;
      const daysSinceRecall = (Date.now() - lastRecalled.getTime()) / 86400000;
      // If not recalled in a while but still has high recall_count, potential staleness
      const relevance = Math.max(0, 1 - daysSinceRecall / 30);
      relevanceSum += relevance;
    }
    const accuracyScore = top5.length > 0 ? relevanceSum / top5.length : 1;
    results.accuracy_recall = {
      pass: accuracyScore >= 0.6,
      score: parseFloat(accuracyScore.toFixed(3)),
      details: { top5_count: top5.length, sampled: top5.length },
    };
  } catch(e) {
    results.accuracy_recall = { pass: false, score: 0, details: { error: e.message } };
  }

  // Category 2: test_time_learning — recently ingested atoms improved recall
  try {
    const recentAtoms = dbAtom.prepare(`
      SELECT * FROM memory_atom
      WHERE created_at >= datetime('now', '-7 days') AND recall_count > 0
      ORDER BY created_at DESC LIMIT 20
    `).all();

    let learningSum = 0;
    for (const atom of recentAtoms) {
      // If recently ingested and already recalled, that's learning signal
      const recallRate = Math.min(1, atom.recall_count / 10);
      learningSum += recallRate;
    }
    const learningScore = recentAtoms.length > 0 ? learningSum / recentAtoms.length : 0;
    results.test_time_learning = {
      pass: learningScore >= 0.6,
      score: parseFloat(learningScore.toFixed(3)),
      details: { recent_count: recentAtoms.length },
    };
  } catch(e) {
    results.test_time_learning = { pass: false, score: 0, details: { error: e.message } };
  }

  // Category 3: long_range_understanding — causal chain depth > 2
  try {
    const deepClaims = dbAtom.prepare(`
      SELECT COUNT(*) as cnt FROM claims
      WHERE conceptual_depth > 2
    `).get();
    const totalClaims = dbAtom.prepare(`SELECT COUNT(*) as cnt FROM claims`).get();
    const ratio = totalClaims.cnt > 0 ? deepClaims.cnt / totalClaims.cnt : 0;
    const understandingScore = ratio * 2; // scale up
    results.long_range_understanding = {
      pass: understandingScore >= 0.6,
      score: parseFloat(Math.min(1, understandingScore).toFixed(3)),
      details: { deep_claims: deepClaims.cnt, total_claims: totalClaims.cnt },
    };
  } catch(e) {
    results.long_range_understanding = { pass: false, score: 0, details: { error: e.message } };
  }

  // Category 4: selective_forgetting — CRYOSLEEP atoms have E_activation < 0.2
  try {
    const cryoAtoms = dbAtom.prepare(`
      SELECT * FROM memory_atom WHERE life_status = 'CRYOSLEEP' LIMIT 50
    `).all();

    let forgetScore = 0;
    if (cryoAtoms.length > 0) {
      let goodCount = 0;
      for (const atom of cryoAtoms) {
        const E = computeActivationEnergy(atom, {});
        if (E < E_ACTIVATION_FORGET) goodCount++;
      }
      forgetScore = goodCount / cryoAtoms.length;
    } else {
      forgetScore = 1; // no cryo atoms = vacuously pass
    }
    results.selective_forgetting = {
      pass: forgetScore >= 0.6,
      score: parseFloat(forgetScore.toFixed(3)),
      details: { cryo_count: cryoAtoms.length },
    };
  } catch(e) {
    results.selective_forgetting = { pass: false, score: 0, details: { error: e.message } };
  }

  dbAtom.close();

  // Compute overall pass
  const cats = ['accuracy_recall', 'test_time_learning', 'long_range_understanding', 'selective_forgetting'];
  const overallPass = cats.every(c => results[c] && results[c].pass === true);

  // Persist to DB
  try {
    const govDb = getGovDb();
    const evalId = require('crypto').randomUUID();
    const evalDate = new Date().toISOString();
    govDb.prepare(`
      INSERT INTO long_horizon_evals
        (id, eval_date, accuracy_recall, test_time_learning, long_range_understanding, selective_forgetting, overall_pass)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      evalId,
      evalDate,
      results.accuracy_recall ? results.accuracy_recall.score : null,
      results.test_time_learning ? results.test_time_learning.score : null,
      results.long_range_understanding ? results.long_range_understanding.score : null,
      results.selective_forgetting ? results.selective_forgetting.score : null,
      overallPass ? 1 : 0
    );
    govDb.close();
  } catch(e) { console.warn('[memory-governor] long-horizon eval persistence error:', e.message); }

  return results;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  computeActivationEnergy,
  computeBoundaryGating,
  computeLifeStatus,
  computeMentalLayer,
  shouldTriggerDistillation,
  runGovernancePass,
  applyGovernanceUpdates,
  metaRoute,
  THRESHOLDS,
  detectBoredom,
  triggerBoredom整理,
  runLongHorizonEval,
};