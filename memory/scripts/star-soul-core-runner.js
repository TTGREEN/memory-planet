'use strict';

const path   = require('path');
const os     = require('os');
const crypto = require('crypto');
const https  = require('https');
const fs     = require('fs');
const { spawn } = require('child_process');

process.chdir(path.join(os.homedir(), '.openclaw', 'workspace'));

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';

// ─── MiniMax LLM Client (Anthropic-compatible) ───────────────────────────
function callMiniMax({ system, user, messages = [], max_tokens = 1024, thinking = false }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'MiniMax-M2.7',
      max_tokens,
      thinking_enabled: thinking,
      system: system || '',
      messages: [...messages.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: user }],
    });
    const options = {
      hostname: 'api.minimaxi.com',
      path: '/anthropic/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': MINIMAX_API_KEY,
        'anthropic-version': '2023-06-01',
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'error' || parsed.error) { reject(new Error(parsed.error?.message || JSON.stringify(parsed))); return; }
          const textBlock = parsed.content?.find(b => b.type === 'text');
          resolve(textBlock?.text || '');
        } catch(e) { reject(new Error(`JSON parse error: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

let db;
try {
  const Database = require(path.join(__dirname, 'node_modules', 'better-sqlite3'));
  db = new Database(path.join(__dirname, '..', '..', 'storage', 'atoms.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
} catch(e) {
  console.error('[SSC-runner] Failed to open atoms.db:', e.message);
  process.exit(1);
}

const TAU = 10;
const ENTROPY_THRESHOLD = 0.7; // Node 3: entropy-driven evolution trigger threshold

function now() { return new Date().toISOString(); }
function stalenessDecay(createdAt) {
  return Math.exp(-((Date.now() - new Date(createdAt).getTime()) / 86400000) / TAU);
}
function computeFinalImportance(m0Imp, confidence) {
  return m0Imp * (0.5 + 0.5 * confidence);
}
function computeM0Importance(humanPin, staleness, baseImportance = 0.5) {
  return Math.min(1.0, 0.3 * humanPin + 0.2 * staleness + baseImportance);
}

// ─── Dream Micro ─────────────────────────────────────────────────────────

function dreamMicro() {
  const rows = db.prepare('SELECT id, confidence, human_pin, created_at FROM memory_atom').all();
  let updated = 0;
  for (const row of rows) {
    const staleness = stalenessDecay(row.created_at);
    const m0Imp = computeM0Importance(row.human_pin, staleness);
    const importance = computeFinalImportance(m0Imp, row.confidence);
    db.prepare('UPDATE memory_atom SET importance = ?, updated_at = ? WHERE id = ?')
      .run(importance, now(), row.id);
    updated++;
  }
  return updated;
}

// ─── Dream Deep ─────────────────────────────────────────────────────────

function dreamDeep() {
  const rows = db.prepare(`
    SELECT id, importance, human_pin, tier, created_at,
           (julianday('now') - julianday(created_at)) as age_days
    FROM memory_atom ORDER BY created_at DESC
  `).all();
  let erupted = 0, subducted = 0;
  for (const row of rows) {
    let newTier = row.tier || 'L2';
    if (row.tier !== 'L0' && row.importance >= 0.95 && row.human_pin === 1 && row.age_days >= 7) {
      newTier = 'L0'; erupted++;
    } else if (row.tier === 'L2' && row.importance >= 0.9 && row.age_days >= 14) {
      newTier = 'L1'; erupted++;
    } else if (row.tier !== 'L3' && row.importance < 0.3 && row.age_days > 60 && row.human_pin === 0) {
      newTier = 'L3'; subducted++;
    } else if (row.tier === 'L1' && row.importance < 0.6 && row.age_days > 30) {
      newTier = 'L2'; subducted++;
    }
    if (newTier !== row.tier) {
      db.prepare('UPDATE memory_atom SET tier = ?, updated_at = ? WHERE id = ?')
        .run(newTier, now(), row.id);
    }
  }
  return { erupted, subducted };
}

// ─── Phase 1: Entropy-Driven Evolution Engine ─────────────────────────────
// Reference: Memory Planet v2 — 耗散结构理论 + Shannon熵 + 黑格尔辩证法
//
// Key insight: 废除"每2h强制跑"，改为熵驱动。
// 只有当局部认知熵 > ENTROPY_THRESHOLD 时，才触发真正的进化。

/**
 * 计算全局认知熵（Shannon 熵 across relation types）
 * H(X) = -Σ p(x) log2 p(x)
 * 返回 [0, log2(n)] — 0=完全有序，最高=所有类型均匀分布
 */
function computeGlobalCognitiveEntropy() {
  const relTypeStats = db.prepare(`
    SELECT relation_type, COUNT(*) as cnt
    FROM relations
    WHERE relation_type IN ('CAUSES','CONTRADICTS','REFUTES','SUPPORTS',
                            'ENHANCES','MITIGATES','PREVENTS','RESOLVED_BY','SIMILAR_TO')
    GROUP BY relation_type
  `).all();

  const total = relTypeStats.reduce((s, r) => s + r.cnt, 0);
  if (total === 0) return 0;

  let H = 0;
  for (const r of relTypeStats) {
    const p = r.cnt / total;
    if (p > 0) H -= p * Math.log2(p);
  }
  return H; // max = log2(n_types)
}

/**
 * 计算局部认知熵（per subject cluster）
 * 局部熵 = 0.6 × conflict_rate + 0.3 × H(shannon) + 0.1 × staleness_proxy
 * staleness_proxy = min(1, days_since_last_recall / 30)
 */
function computeLocalCognitiveEntropy() {
  const subjects = db.prepare(`
    SELECT DISTINCT subject FROM claims
    WHERE subject IS NOT NULL AND subject != ''
  `).all().map(r => r.subject);

  const clusters = [];
  for (const subject of subjects) {
    const atomRows = db.prepare(
      'SELECT DISTINCT atom_id FROM claims WHERE subject = ?'
    ).all(subject);
    const atomIds = atomRows.map(r => r.atom_id);

    if (atomIds.length < 2) continue;

    const placeholders = atomIds.map(() => '?').join(',');
    let relStats;
    try {
      relStats = db.prepare(`
        SELECT relation_type, COUNT(*) as cnt
        FROM relations
        WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})
        GROUP BY relation_type
      `).all(...atomIds, ...atomIds);
    } catch(e) {
      continue; // skip on error
    }

    const total = relStats.reduce((s, r) => s + r.cnt, 0);
    if (total === 0) continue;

    const conflictTypes = ['CONTRADICTS', 'REFUTES'];
    const conflictCnt = relStats
      .filter(r => conflictTypes.includes(r.relation_type))
      .reduce((s, r) => s + r.cnt, 0);
    const conflictRate = conflictCnt / total;

    // staleness proxy
    const lrRow = db.prepare(`
      SELECT MAX(last_recalled_at) as lr FROM memory_atom
      WHERE id IN (${placeholders})
    `).all(...atomIds).map(r => r.lr)[0];

    let stalenessProxy = 0.5;
    if (lrRow) {
      const daysUnused = (Date.now() - new Date(lrRow).getTime()) / 86400000;
      stalenessProxy = Math.min(1, daysUnused / 30);
    }

    // Shannon entropy for this cluster
    let H = 0;
    for (const r of relStats) {
      const p = r.cnt / total;
      if (p > 0) H -= p * Math.log2(p);
    }

    const localEntropy = 0.6 * conflictRate + 0.3 * H + 0.1 * stalenessProxy;

    clusters.push({
      subject,
      atomCount: atomIds.length,
      total,
      conflictCnt,
      conflictRate: +conflictRate.toFixed(4),
      stalenessProxy: +stalenessProxy.toFixed(4),
      H: +H.toFixed(4),
      localEntropy: +localEntropy.toFixed(4),
    });
  }

  clusters.sort((a, b) => b.localEntropy - a.localEntropy);
  clusters.forEach((c, i) => c.entropyRank = i + 1);
  return clusters;
}

/**
 * LLM-as-a-Judge (Phase 1 — real MiniMax-M2.7)
 * Uses MiniMax M2.7 as LLM-as-a-Judge for true/false contradiction classification.
 */
async function judgeContradiction(contentA, contentB) {
  try {
    const system = `You are a logical contradiction detector.
Given two knowledge statements, judge whether they genuinely contradict each other
when considered in the same context (same project/domain).
Output ONLY one word: TRUE or FALSE
- TRUE: genuinely contradictory in the same context
- FALSE: unrelated, or concern different domains/projects
Do not explain. Only output TRUE or FALSE.`;
    const response = await callMiniMax({
      system,
      user: `Statement A: ${contentA}\n\nStatement B: ${contentB}`,
      max_tokens: 10,
      thinking: false,
    });
    const result = response.trim().toUpperCase();
    return result === 'TRUE';
  } catch(e) {
    console.error('[SSC] judgeContradiction LLM error:', e.message);
    return false; // fail safe
  }
}

/**
 * 熵减驱动进化（Phase 1 核心）
 * 1. 计算局部认知熵
 * 2. 如果 max_entropy <= THRESHOLD → 不触发进化
 * 3. 如果 > THRESHOLD → 矛盾发现 + 范式转移 + RESOLVED_BY 标签
 */
async function entropyTriggeredEvolve() {
  const globalEntropy = computeGlobalCognitiveEntropy();
  const clusters = computeLocalCognitiveEntropy();

  if (clusters.length === 0) {
    return { evolved: false, reason: 'no_subject_clusters', globalEntropy: +globalEntropy.toFixed(4), threshold: ENTROPY_THRESHOLD };
  }

  const topCluster = clusters[0];

  if (topCluster.localEntropy <= ENTROPY_THRESHOLD) {
    return {
      evolved: false,
      reason: 'entropy_below_threshold',
      globalEntropy: +globalEntropy.toFixed(4),
      maxLocalEntropy: +topCluster.localEntropy.toFixed(4),
      threshold: ENTROPY_THRESHOLD,
      topClusters: clusters.slice(0, 3).map(c => ({ subject: c.subject, localEntropy: c.localEntropy, conflictRate: c.conflictRate, atomCount: c.atomCount })),
    };
  }

  // ── 熵超阈值：执行真正进化 ───────────────────────────────────────────────
  const atomRows = db.prepare('SELECT DISTINCT atom_id FROM claims WHERE subject = ?').all(topCluster.subject);
  const atomIds = atomRows.map(r => r.atom_id);
  const placeholders = atomIds.map(() => '?').join(',');

  let contradictAtoms;
  try {
    contradictAtoms = db.prepare(`
      SELECT DISTINCT a.id, a.content, a.namespace, r.relation_type
      FROM relations r
      JOIN memory_atom a ON r.source_id = a.id
      WHERE r.relation_type IN ('CONTRADICTS','REFUTES')
        AND (r.target_id IN (${placeholders}) OR r.source_id IN (${placeholders}))
    `).all(...atomIds, ...atomIds);
  } catch(e) { contradictAtoms = []; }

  // ── LLM-as-a-Judge: 过滤伪矛盾 ───────────────────────────────────────
  const realConflicts = [];
  for (let i = 0; i < contradictAtoms.length; i++) {
    for (let j = i + 1; j < contradictAtoms.length; j++) {
      try {
        const isReal = await judgeContradiction(contradictAtoms[i].content, contradictAtoms[j].content);
        if (isReal) realConflicts.push([contradictAtoms[i], contradictAtoms[j]]);
      } catch(e) {
        console.error('[SSC] judgeContradiction error:', e.message);
      }
    }
  }

  if (realConflicts.length === 0) {
    return { evolved: false, reason: 'false_positive_conflicts_filtered', globalEntropy: +globalEntropy.toFixed(4), maxLocalEntropy: +topCluster.localEntropy.toFixed(4), topClusters: clusters.slice(0, 3) };
  }

  // ── LLM 生成范式转移结论 ──────────────────────────────────────────────
  const conflictDescription = realConflicts.map(([a1, a2], idx) =>
    `Claim ${idx + 1}: ${a1.content}\nClaim ${idx + 2}: ${a2.content}`
  ).join('\n');

  let llmPrinciple = null;
  try {
    llmPrinciple = await callMiniMax({
      system: `You are a cognitive architecture AI embedded in a Memory Planet system.
You have detected high local cognitive entropy — conflicting knowledge atoms in the same subject domain.
Your task: perform Hegelian dialectical synthesis (正反合).
Given contradictory positions (正 and 反), derive a higher-order principle (合) that transcends and unifies them.
Output ONE concise principle (max 100 characters). The principle should be actionable and architecturally meaningful.
Do not explain. Only output the principle.`,
      user: `Subject Domain: ${topCluster.subject}\n\nConflicting Claims:\n${conflictDescription}\n\nDerive the unifying principle (合):`,
      max_tokens: 150,
      thinking: true,
    });
  } catch(e) {
    console.error('[SSC] LLM paradigm shift generation failed:', e.message);
  }

  const fallbackConclusions = [
    'Paradigm shift: unify contradictory atoms via higher-level abstraction principle that transcends local conflict',
    'Cognitive restructure: conflicting atoms reveal a deeper conceptual gap requiring meta-level synthesis',
    'Entropy resolution: divergent solutions suggest hidden variables that unify when viewed holistically',
  ];
  const conclusion = llmPrinciple?.trim() || fallbackConclusions[Math.floor(Math.random() * fallbackConclusions.length)];

  const resolvedAtomIds = [];
  let evolved = 0;

  for (const [a1, a2] of realConflicts) {
    const id = crypto.randomUUID();
    const created_at = now();
    db.prepare(`
      INSERT INTO memory_atom (id, content, confidence, importance, human_pin, namespace,
        embedding, created_at, updated_at, tier, last_recalled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'L0', ?)
    `).run(id, `[RESOLVED: ${topCluster.subject}] ${conclusion}`, 0.65, 0.88, 1, 'paradigm-shift', null, created_at, created_at, created_at);

    for (const a of [a1, a2]) {
      db.prepare(`INSERT OR IGNORE INTO relations (source_id, target_id, relation_type, weight, created_at) VALUES (?, ?, 'RESOLVED_BY', 1.0, ?)`).run(id, a.id, created_at);
      const old = db.prepare('SELECT confidence FROM memory_atom WHERE id = ?').get(a.id);
      if (old) db.prepare('UPDATE memory_atom SET confidence = ? WHERE id = ?').run(Math.min(0.95, old.confidence + 0.15), a.id);
      resolvedAtomIds.push(a.id);
    }
    evolved++;
  }

  return {
    evolved: true,
    reason: 'entropy_exceeded_threshold',
    globalEntropy: +globalEntropy.toFixed(4),
    maxLocalEntropy: +topCluster.localEntropy.toFixed(4),
    topCluster: { subject: topCluster.subject, atomCount: topCluster.atomCount, conflictCnt: topCluster.conflictCnt },
    realConflictsFound: realConflicts.length,
    paradigmShiftsCreated: evolved,
    paradigmShiftPrinciple: conclusion,
    resolvedAtomIds,
  };
}

/**
 * 查询当前认知熵状态（诊断用）
 */
function entropyStatus() {
  const globalEntropy = computeGlobalCognitiveEntropy();
  const clusters = computeLocalCognitiveEntropy();
  const topClusters = clusters.slice(0, 5);

  return {
    globalEntropy: +globalEntropy.toFixed(4),
    maxLocalEntropy: topClusters.length > 0 ? +topClusters[0].localEntropy.toFixed(4) : 0,
    threshold: ENTROPY_THRESHOLD,
    clusterCount: clusters.length,
    wouldTriggerEvolve: topClusters.length > 0 && topClusters[0].localEntropy > ENTROPY_THRESHOLD,
    topClusters,
  };
}

// ─── Legacy evolve (deprecated — kept for backwards compat via CLI) ──────

function evolveLegacy() {
  const subjectConflicts = db.prepare(`
    SELECT c1.subject, c1.predicate as p1, c2.predicate as p2,
           c1.object as o1, c2.object as o2,
           a1.content as c1, a2.content as c2
    FROM claims c1
    JOIN claims c2 ON c1.subject = c2.subject AND c1.id < c2.id
    JOIN memory_atom a1 ON c1.atom_id = a1.id
    JOIN memory_atom a2 ON c2.atom_id = a2.id
    WHERE (c1.predicate = 'CAUSES' AND c2.predicate = 'CONTRADICTS')
       OR (c1.predicate = 'SUPPORTS' AND c2.predicate = 'REFUTES')
       OR (c1.predicate = 'EXTENDS' AND c2.predicate = 'CONTRADICTS')
    LIMIT 10
  `).all();

  const totalConflicts = subjectConflicts.length;
  if (totalConflicts === 0) return { evolved: false, conflicts: 0 };

  const conclusions = [
    'Paradigm shift: unify contradictory atoms via higher-level abstraction',
    'Cognitive restructure: conflicting atoms reveal need for meta-level synthesis',
    'Architecture innovation: reconcile constraints into a new inclusive pattern',
  ];

  let evolved = 0;
  for (const conflict of subjectConflicts) {
    const conclusion = conclusions[Math.floor(Math.random() * conclusions.length)];
    const id = crypto.randomUUID();
    const created_at = now();
    db.prepare(`
      INSERT INTO memory_atom (id, content, confidence, importance, human_pin, namespace,
        embedding, created_at, updated_at, tier, last_recalled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'L0', ?)
    `).run(id, conclusion, 0.6, 0.85, 1, 'paradigm-shift', null, created_at, created_at, created_at);
    evolved++;
  }
  return { evolved, conflicts: totalConflicts };
}

// ─── Phase 4: Trans-dimensional Skill Projection (Static Contracts) ────────
// 降维平替: 双智体思想实验 + 静态契约化
// 放弃 Docker 沙盒，改用"认知内审"+"规则注入"

const BEHAVIORAL_CONTRACT_RULES = {
  defensive_db_access: {
    description: '防御式数据库访问约束',
    trigger_keywords: ['sql', '数据库', 'query', 'insert', 'update', 'delete', 'transaction', 'db.', 'sqlite'],
    enforcement_rules: [
      '必须包含 try-catch 块',
      '事务操作必须在 error 时调用 rollback()',
      '禁止在循环体内执行 await db.query()',
      '参数必须用 ? 占位符预绑定',
    ],
    fail_keywords: ['直接字符串拼接 SQL', '未捕获的 promise rejection', '缺少 rollback'],
  },
  memory_consistency: {
    description: '记忆一致性保护约束',
    trigger_keywords: ['记忆', 'atom', 'ingest', 'claim', 'relation', 'memory_atom'],
    enforcement_rules: [
      '写入前必须检查 schema 字段是否存在',
      '事务必须原子性提交',
      '删除前必须确认外键约束',
    ],
    fail_keywords: ['未校验 schema', '单点写入无事务'],
  },
  entropy_evolution: {
    description: '熵减进化安全约束',
    trigger_keywords: ['evolve', '熵减', 'paradigm', 'RESOLVED_BY', '矛盾'],
    enforcement_rules: [
      '进化前必须验证局部熵确实超过阈值',
      '结论必须同时满足冲突双方的核心需求',
      '标记 RESOLVED_BY 前必须确认置信度上升',
    ],
    fail_keywords: ['无条件触发进化', '单边结论'],
  },
};

function getMatchingContracts(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return Object.entries(BEHAVIORAL_CONTRACT_RULES)
    .filter(([_, c]) => c.trigger_keywords.some(kw => lower.includes(kw)))
    .map(([name]) => name);
}

function enforceContract(contractName, content) {
  const contract = BEHAVIORAL_CONTRACT_RULES[contractName];
  if (!contract) return { passed: false, violations: ['unknown contract'] };
  const violations = [];
  for (const rule of contract.enforcement_rules) {
    if (rule.includes('try-catch') && (!content.includes('try') || !content.includes('catch'))) {
      violations.push('Missing try-catch block');
    }
    if (rule.includes('rollback') && !content.toLowerCase().includes('rollback')) {
      violations.push('Transaction missing rollback()');
    }
    if (rule.includes('循环') && content.includes('for') && content.includes('await')) {
      const lines = content.split('\n');
      let inLoop = false;
      for (const line of lines) {
        if (line.match(/^\s*(for|while)/)) inLoop = /for|while/.test(line);
        if (inLoop && line.includes('await') && !line.trim().startsWith('//')) {
          violations.push('await inside loop — potential N+1 query');
          break;
        }
      }
    }
    if (rule.includes('? 占位符') && content.match(/['"][^'"]*\+\s*['"][^'"]*sql|sql\s*\+/i)) {
      violations.push('SQL string concatenation — use parameterized queries');
    }
  }
  return { passed: violations.length === 0, violations, contractName, description: contract.description };
}

async function dualAgentValidation(subject, conflictingClaims, historicalFailures = '') {
  const [creatorRes, chaosRes] = await Promise.all([
    callMiniMax({
      system: 'You are "The Creator" — a meticulous contract architect. Output ONLY valid JSON with contract_name, trigger_condition, enforcement_rules[].',
      user: `Subject: ${subject}\nConflicting claims: ${conflictingClaims}\n\nDraft the contract as JSON:`,
      max_tokens: 300, thinking: true,
    }).catch(() => null),
    callMiniMax({
      system: 'You are "The Chaos Monkey" — brutal code disaster analyst. Attack the contract using historical failures. List at least 2 concrete objections or say "CONTRACT IS SOLID".',
      user: `Contract to attack: ${subject}\nClaims: ${conflictingClaims}\n\nHistorical failures: ${historicalFailures || 'none recorded'}\n\nYour objections:`,
      max_tokens: 200, thinking: false,
    }).catch(() => null),
  ]);

  const hasObjections = chaosRes && !chaosRes.includes('CONTRACT IS SOLID') && chaosRes.trim().length > 20;
  return {
    passed: !hasObjections,
    creatorContract: creatorRes,
    chaosObjections: chaosRes,
    finalVerdict: hasObjections ? 'REJECTED — needs revision' : 'APPROVED — 思想实验通过',
  };
} // (断点续传队列) ───────────────────────────────────────
// Used by detached dream-entropy worker pattern

/**
 * Enqueue all high-entropy clusters as evolution tasks.
 * Called by triggerDreamEntropy() before spawning the worker.
 */
function enqueueEvolutionTasks() {
  const clusters = db.prepare(`
    SELECT subject,
           COUNT(DISTINCT atom_id) as atom_count
    FROM claims
    GROUP BY subject
    HAVING atom_count >= 2
    ORDER BY atom_count DESC
  `).all();

  let enqueued = 0;
  for (const cluster of clusters) {
    const atomRows = db.prepare(`
      SELECT DISTINCT c.atom_id, a.content, c.predicate
      FROM claims c
      JOIN memory_atom a ON c.atom_id = a.id
      WHERE c.subject = ?
    `).all(cluster.subject);

    if (atomRows.length < 2) continue;

    const pairs = [];
    for (let i = 0; i < atomRows.length; i++) {
      for (let j = i + 1; j < Math.min(atomRows.length, 8); j++) {
        pairs.push([
          { id: atomRows[i].atom_id, content: atomRows[i].content, predicate: atomRows[i].predicate || 'A' },
          { id: atomRows[j].atom_id, content: atomRows[j].content, predicate: atomRows[j].predicate || 'B' },
        ]);
      }
    }


    if (pairs.length === 0) continue;

    // Skip if already PENDING or PROCESSING for this subject
    const existing = db.prepare(`
      SELECT id FROM evolution_tasks
      WHERE subject = ? AND status IN ('PENDING', 'PROCESSING')
    `).get(cluster.subject);

    if (existing) continue;

    const taskId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO evolution_tasks (id, subject, pair_data, status)
      VALUES (?, ?, ?, 'PENDING')
    `).run(taskId, cluster.subject, JSON.stringify(pairs));

    enqueued++;
  }

  return enqueued;
}

/**
 * Trigger detached dream-entropy worker.
 * 1. Enqueue PENDING tasks from high-entropy clusters
 * 2. Spawn worker as detached orphan process (.unref())
 * 3. Worker processes tasks one-by-one, checkpointing to DB
 */
function triggerDreamEntropy() {
  // 1. Ensure evolution_tasks table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS evolution_tasks (
      id          TEXT PRIMARY KEY,
      subject     TEXT NOT NULL,
      pair_data   TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'PENDING',
      result_data TEXT,
      error_msg   TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // 2. Enqueue new tasks
  const enqueued = enqueueEvolutionTasks();
  console.log(`[SSC] Enqueued ${enqueued} evolution tasks`);

  if (enqueued === 0) {
    console.log('[SSC] No new tasks to process');
    return { enqueued: 0, spawned: false };
  }

  // 3. Spawn detached worker
  const LOG_DIR = path.join(__dirname, '..', '.dreams', 'logs');
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) {}

  let outFd, errFd;
  try {
    outFd = fs.openSync(path.join(LOG_DIR, 'dream-entropy-worker.log'), 'a');
    errFd = fs.openSync(path.join(LOG_DIR, 'dream-entropy-worker.err'), 'a');
  } catch (e) {
    outFd = 1; // stdout
    errFd = 2;  // stderr
  }

  const child = spawn(process.execPath, [path.join(__dirname, 'dream-entropy-worker.js'), 'loop'], {
    detached: true,       // Create new process group — survives parent exit
    stdio: ['pipe', outFd, errFd],
    cwd: __dirname,
    env: {
      ...process.env,
      MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
    },
  });

  child.unref(); // Parent won't wait for this child


  const pid = child.pid;
  console.log(`[SSC] Dream-entropy worker spawned as detached PID=${pid}`);
  return { enqueued, spawned: true, pid };
}

// ─── Status ──────────────────────────────────────────────────────────────

function status() {
  const tiers = db.prepare('SELECT tier, COUNT(*) as cnt FROM memory_atom GROUP BY tier').all();
  const tierMap = { L0: 0, L1: 0, L2: 0, L3: 0 };
  tiers.forEach(t => { if (t.tier in tierMap) tierMap[t.tier] = t.cnt; });

  const total   = db.prepare('SELECT COUNT(*) as cnt FROM memory_atom').get();
  const claims  = db.prepare('SELECT COUNT(*) as cnt FROM claims').get();
  const rels    = db.prepare('SELECT COUNT(*) as cnt FROM relations').get();
  const impStats = db.prepare(`
    SELECT SUM(importance > 0.8) as high,
           SUM(importance > 0.5 AND importance <= 0.8) as medium,
           SUM(importance <= 0.5) as low
    FROM memory_atom
  `).get();

  const paradigm = db.prepare(
    "SELECT substr(content,1,70) as c, created_at FROM memory_atom WHERE namespace='paradigm-shift' ORDER BY created_at DESC LIMIT 3"
  ).all();

  const entropySnap = entropyStatus();

  return {
    tiers: tierMap,
    total: total.cnt,
    claims: claims.cnt,
    relations: rels.cnt,
    importance: { high: impStats.high || 0, medium: impStats.medium || 0, low: impStats.low || 0 },
    paradigmShifts: paradigm.map(p => ({ content: p.c, created_at: p.created_at })),
    entropy: entropySnap,
  };
}

// ─── CLI ────────────────────────────────────────────────────────────────

// Export functions for use as module
module.exports = {
  dreamMicro, dreamDeep, entropyTriggeredEvolve, evolveLegacy,
  entropyStatus, status, getMatchingContracts, enforceContract,
  dualAgentValidation, computeGlobalCognitiveEntropy, computeLocalCognitiveEntropy,
  triggerDreamEntropy, enqueueEvolutionTasks,
};

// ─── CLI ─────────────────────────────────────────────────────────────────────
// Only run when executed directly (not when required as module)

if (require.main && require.main.filename === __filename) {

const cmd = process.argv[2];
const cmdMap = {
  'dream-micro':     () => dreamMicro(),
  'dream-deep':      () => dreamDeep(),
  'dream-entropy':   async () => {
    // Detached worker mode: enqueue + spawn (non-blocking)
    const result = triggerDreamEntropy();
    return result;
  },
  'evolve':          () => entropyTriggeredEvolve(),
  'evolve-legacy':   () => evolveLegacy(),
  'entropy-status':  () => entropyStatus(),
  'status':          () => status(),
  'trigger-dream':   () => triggerDreamEntropy(),
};

if (!cmd) {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.cmd && cmdMap[msg.cmd]) {
          Promise.resolve(cmdMap[msg.cmd]()).then(r => process.stdout.write(JSON.stringify({ ok: true, cmd: msg.cmd, result: r }) + '\n'))
                          .catch(e => process.stdout.write(JSON.stringify({ ok: false, cmd: msg.cmd, error: e.message }) + '\n'));
        } else {
          process.stdout.write(JSON.stringify({ ok: false, error: 'unknown cmd' }) + '\n');
        }
      } catch(e) {
        process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + '\n');
      }
    }
  });
  process.stdin.on('end', () => db.close());
} else {
  if (!cmdMap[cmd]) {
    console.error('[SSC] Unknown command:', cmd);
    console.error('Usage: star-soul-core-runner.js [dream-micro|dream-deep|evolve|evolve-legacy|entropy-status|status]');
    process.exit(1);
  }
  Promise.resolve(cmdMap[cmd]()).then(r => { console.log(JSON.stringify({ ok: true, cmd, result: r, ts: now() })); db.close(); })
               .catch(e => { console.error('[SSC] Error:', e.message); process.exit(1); });
}

}
