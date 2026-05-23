/**
 * Governance Plane — Human-in-the-Loop CLI
 *
 * RFC Proposal workflow for shared knowledge governance:
 *   1. proposeSharedUpdate  → creates RFC record
 *   2. evaluateRFC         → runs regression tests (placeholder)
 *   3. conflictDetection  → detects merge conflicts between two RFCs
 *   4. humanArbitration    → CLI blocks for human decision if needed
 *
 * DB table: rfc_proposals
 */

'use strict';
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

// ─── Magic number constants (P1 extraction) ────────────────────────────────────
const PRIOR_APPROVED_CONFLICT  = 0.6; // conflictScore prior approval + federatedPreCheck
const CONFLICT_THRESHOLD       = 0.5; // evaluateRFC auto-approve threshold
const MINDBASE_CONFLICT        = 0.35; // testRFC mindbase atom conflict
const PENDING_DELETE_CONFLICT  = 0.8; // testRFC pending DELETE RFC conflict
const REJECT_THRESHOLD         = 0.3; // testRFC status transition threshold
const PAIN_INDEX_BYPASS        = 0.8; // pain_index metaRoute bypass threshold
const RFC_LIMIT                = 50;  // testRFC mindbase atom query limit (unused, kept for reference)

const DB_PATH = path.join(__dirname, '..', '..', 'storage', 'rfc_governance.db');

let _db = null;

function uuid() { return crypto.randomUUID(); }
function now()  { return new Date().toISOString(); }

function getDb() {
  let retries = 0;
  while (retries < 3) {
    if (!_db) {
      const Database = require('better-sqlite3');
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      _db = new Database(DB_PATH);
      _db.pragma('journal_mode = WAL');
      _db.pragma('foreign_keys = ON');

      _db.exec(`
      CREATE TABLE IF NOT EXISTS rfc_proposals (
        id              TEXT PRIMARY KEY,
        atom_id         TEXT NOT NULL,
        change_type     TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'PENDING',
        conflict_score  REAL,
        proposed_at     TEXT NOT NULL,
        reviewed_by     TEXT,
        decision        TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_rfc_atom    ON rfc_proposals(atom_id);
      CREATE INDEX IF NOT EXISTS idx_rfc_status  ON rfc_proposals(status);

      CREATE TABLE IF NOT EXISTS cognitive_branches (
        id              TEXT PRIMARY KEY,
        name            TEXT UNIQUE NOT NULL,
        status          TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at      TEXT NOT NULL,
        merged_at       TEXT,
        parent_branch   TEXT
      );

      CREATE TABLE IF NOT EXISTS long_horizon_evals (
        id                       TEXT PRIMARY KEY,
        eval_date                TEXT NOT NULL,
        accuracy_recall          REAL,
        test_time_learning       REAL,
        long_range_understanding REAL,
        selective_forgetting     REAL,
        overall_pass             INTEGER
      );
    `);
    }
    try { _db.prepare('SELECT 1').all(); return _db; } catch(e) {
      _db = null;
      retries++;
      if (retries >= 3) throw e;
    }
  }
}

// ─── RFC Proposal ──────────────────────────────────────────────────────────────

/**
 * Stage 1: Create an RFC proposal for a shared knowledge update.
 *
 * @param {string} atomId     - The atom ID being proposed for update
 * @param {Object} proposal  - { change_type, new_content?, proposed_by? }
 * @returns {Object} RFC record
 */
function proposeSharedUpdate(atomId, proposal) {
  const db = getDb();
  const id = uuid();
  const ts = now();
  const changeType = proposal.change_type || 'UPDATE';

  if (!['UPDATE', 'DELETE', 'MERGE', 'BRANCH'].includes(changeType)) {
    throw new Error(`[governance] Unknown change_type: ${changeType}`);
  }

  db.prepare(`
    INSERT INTO rfc_proposals (id, atom_id, change_type, status, proposed_at)
    VALUES (?, ?, ?, 'PENDING', ?)
  `).run(id, atomId, changeType, ts);

  return { id, atom_id: atomId, change_type: changeType, status: 'PENDING', proposed_at: ts };
}

/**
 * Stage 2: Evaluate an RFC — run regression tests against the proposed change.
 * Returns updated RFC with status and conflict_score.
 *
 * @param {string} rfcId - RFC ID
 * @returns {Object} updated RFC record
 */
function evaluateRFC(rfcId) {
  const db = getDb();
  const rfc = db.prepare('SELECT * FROM rfc_proposals WHERE id = ?').get(rfcId);
  if (!rfc) return { error: 'RFC not found' };

  // Regression placeholder: simple heuristic scoring
  // In production this would run actual recall tests against memory_atom
  let conflictScore = 0;
  let newStatus = 'TESTING';

  // Check if there's an APPROVED RFC targeting the same atom
  const priorApproved = db.prepare(`
    SELECT id FROM rfc_proposals
    WHERE atom_id = ? AND status = 'APPROVED' AND id != ?
    ORDER BY proposed_at DESC LIMIT 1
  `).get(rfc.atom_id, rfcId);

  if (priorApproved) {
    conflictScore = PRIOR_APPROVED_CONFLICT; // heuristic: prior approval creates mild conflict
    newStatus = 'CONFLICT';
  }

  // If no conflict detected → approve automatically (simple governance)
  if (conflictScore < CONFLICT_THRESHOLD) {
    newStatus = 'APPROVED';
    conflictScore = 0;
  }

  db.prepare(`
    UPDATE rfc_proposals
    SET status = ?, conflict_score = ?, reviewed_by = 'system'
    WHERE id = ?
  `).run(newStatus, conflictScore, rfcId);

  return db.prepare('SELECT * FROM rfc_proposals WHERE id = ?').get(rfcId);
}

/**
 * Stage 3: Detect merge conflicts between two RFCs targeting overlapping atoms.
 *
 * @param {string} rfcId1 - First RFC ID
 * @param {string} rfcId2 - Second RFC ID
 * @returns {Object} { has_conflict: bool, score: number, reason: string }
 */
function conflictDetection(rfcId1, rfcId2) {
  const db = getDb();
  const rfc1 = db.prepare('SELECT * FROM rfc_proposals WHERE id = ?').get(rfcId1);
  const rfc2 = db.prepare('SELECT * FROM rfc_proposals WHERE id = ?').get(rfcId2);

  if (!rfc1 || !rfc2) return { error: 'RFC not found', has_conflict: false, score: 0 };

  // Same atom → high conflict potential
  if (rfc1.atom_id === rfc2.atom_id) {
    // DELETE + anything → high conflict
    if (rfc1.change_type === 'DELETE' || rfc2.change_type === 'DELETE') {
      return { has_conflict: true, score: 1.0, reason: 'DELETE conflicts with any change on same atom' };
    }
    // Both UPDATE same atom → medium conflict
    if (rfc1.change_type === 'UPDATE' && rfc2.change_type === 'UPDATE') {
      return { has_conflict: true, score: 0.7, reason: 'Concurrent UPDATE on same atom' };
    }
    // MERGE + anything → medium conflict
    if (rfc1.change_type === 'MERGE' || rfc2.change_type === 'MERGE') {
      return { has_conflict: true, score: 0.6, reason: 'MERGE may conflict with other changes' };
    }
  }

  // Different atoms → no conflict
  return { has_conflict: false, score: 0, reason: 'No overlap detected' };
}

/**
 * Stage 4: Human arbitration — escalate CONFLICT RFCs to human review.
 * In CLI mode, blocks and prompts. Returns updated RFC with human decision.
 *
 * @param {string} rfcId   - RFC ID in CONFLICT status
 * @param {string} decision - 'APPROVED' | 'REJECTED'
 * @returns {Object} updated RFC record
 */
function humanArbitration(rfcId, decision) {
  const db = getDb();
  const rfc = db.prepare('SELECT * FROM rfc_proposals WHERE id = ?').get(rfcId);
  if (!rfc) return { error: 'RFC not found' };

  if (!['APPROVED', 'REJECTED'].includes(decision)) {
    throw new Error(`[governance] Invalid decision: ${decision}. Must be APPROVED or REJECTED.`);
  }

  db.prepare(`
    UPDATE rfc_proposals
    SET status = ?, decision = ?, reviewed_by = 'human'
    WHERE id = ?
  `).run(decision, decision, rfcId);

  return db.prepare('SELECT * FROM rfc_proposals WHERE id = ?').get(rfcId);
}

/**
 * List all RFCs, optionally filtered by status.
 * @param {string} status - Optional filter
 * @returns {Array} RFC records
 */
function listRFCs(status) {
  const db = getDb();
  if (status) {
    return db.prepare('SELECT * FROM rfc_proposals WHERE status = ? ORDER BY proposed_at DESC').all(status);
  }
  return db.prepare('SELECT * FROM rfc_proposals ORDER BY proposed_at DESC').all();
}

// ─── P2: Additional Governance Functions ───────────────────────────────────────

/**
 * createRFC — create a new RFC proposal
 * @param {string} atomId       - atom to target
 * @param {string} changeType   - UPDATE | DELETE | MERGE | BRANCH
 * @param {string} proposalText - proposal description (stored in decision field)
 * @returns {Object} new RFC record
 */
function createRFC(atomId, changeType, proposalText) {
  const db = getDb();
  const id = uuid();
  const ts = now();

  if (!['UPDATE', 'DELETE', 'MERGE', 'BRANCH'].includes(changeType)) {
    throw new Error(`[governance] Unknown change_type: ${changeType}`);
  }

  db.prepare(`
    INSERT INTO rfc_proposals (id, atom_id, change_type, status, proposed_at, reviewed_by, decision)
    VALUES (?, ?, ?, 'PENDING', ?, 'system', ?)
  `).run(id, atomId, changeType, ts, proposalText || '');

  return db.prepare('SELECT * FROM rfc_proposals WHERE id = ?').get(id);
}

/**
 * testRFC — run regression test on RFC
 * Returns: { status, conflict_score, blockers }
 */
function testRFC(rfcId) {
  const db = getDb();
  const rfc = db.prepare('SELECT * FROM rfc_proposals WHERE id = ?').get(rfcId);
  if (!rfc) return { status: 'ERROR', conflict_score: 0, blockers: ['RFC not found'] };

  // Get any MINDBASE atoms that might conflict
  const mindbaseAtoms = db.prepare(`
    SELECT * FROM memory_atom WHERE mental_layer = 'MINDBASE' LIMIT 100
  `).all();

  let conflictScore = 0;
  const blockers = [];

  // Simple heuristic: if atom is MINDBASE-level, any RFC is higher-risk
  const targetAtom = db.prepare('SELECT * FROM memory_atom WHERE id = ?').get(rfc.atom_id);
  if (targetAtom && targetAtom.mental_layer === 'MINDBASE') {
    conflictScore = MINDBASE_CONFLICT;
    blockers.push('Target atom is in MINDBASE layer — high-value rule');
  }

  // Check for prior APPROVED RFCs on the same atom
  const priorApproved = db.prepare(`
    SELECT * FROM rfc_proposals
    WHERE atom_id = ? AND status = 'APPROVED' AND id != ?
    ORDER BY proposed_at DESC LIMIT 1
  `).get(rfc.atom_id, rfcId);

  if (priorApproved) {
    conflictScore = Math.max(conflictScore, PRIOR_APPROVED_CONFLICT);
    blockers.push('Prior APPROVED RFC exists for this atom');
  }

  // Check for pending DELETE if this is an UPDATE
  if (rfc.change_type === 'UPDATE' || rfc.change_type === 'MERGE') {
    const pendingDelete = db.prepare(`
      SELECT id FROM rfc_proposals
      WHERE atom_id = ? AND change_type = 'DELETE' AND status IN ('PENDING','TESTING')
    `).get(rfc.atom_id);
    if (pendingDelete) {
      conflictScore = Math.max(conflictScore, PENDING_DELETE_CONFLICT);
      blockers.push('Pending DELETE RFC exists for this atom');
    }
  }

  const newStatus = conflictScore > REJECT_THRESHOLD ? 'CONFLICT' : 'APPROVED';

  db.prepare(`
    UPDATE rfc_proposals
    SET status = ?, conflict_score = ?, reviewed_by = 'system'
    WHERE id = ?
  `).run(newStatus, conflictScore, rfcId);

  return {
    status: newStatus,
    conflict_score: conflictScore,
    blockers,
  };
}

/**
 * approveRFC — system approval
 * @param {string} rfcId
 * @returns {Object} updated RFC
 */
function approveRFC(rfcId) {
  const db = getDb();
  db.prepare(`
    UPDATE rfc_proposals
    SET status = 'APPROVED', decision = 'system_approved', reviewed_by = 'system'
    WHERE id = ?
  `).run(rfcId);
  return db.prepare('SELECT * FROM rfc_proposals WHERE id = ?').get(rfcId);
}

/**
 * rejectRFC — rejection with reason
 * @param {string} rfcId
 * @param {string} reason
 * @returns {Object} updated RFC
 */
function rejectRFC(rfcId, reason) {
  const db = getDb();
  db.prepare(`
    UPDATE rfc_proposals
    SET status = 'REJECTED', decision = ?, reviewed_by = 'system'
    WHERE id = ?
  `).run(reason, rfcId);
  return db.prepare('SELECT * FROM rfc_proposals WHERE id = ?').get(rfcId);
}

/**
 * getRFCConflicts — detect conflicts with other RFCs
 * @param {string} rfcId
 * @returns {Array} [{ otherRfcId, conflictScore }]
 */
function getRFCConflicts(rfcId) {
  const db = getDb();
  const rfc = db.prepare('SELECT * FROM rfc_proposals WHERE id = ?').get(rfcId);
  if (!rfc) return [];

  const others = db.prepare(`
    SELECT * FROM rfc_proposals
    WHERE status IN ('PENDING','TESTING') AND id != ?
  `).all(rfcId);

  const conflicts = [];
  for (const other of others) {
    const result = conflictDetection(rfcId, other.id);
    if (result.has_conflict) {
      conflicts.push({ otherRfcId: other.id, conflictScore: result.score });
    }
  }
  return conflicts;
}

/**
 * shouldEscalateToHuman — returns true if needs human review
 * @param {string} rfcId
 * @returns {boolean}
 */
function shouldEscalateToHuman(rfcId) {
  const db = getDb();
  const rfc = db.prepare('SELECT * FROM rfc_proposals WHERE id = ?').get(rfcId);
  if (!rfc) return false;
  return rfc.status === 'CONFLICT' || (rfc.conflict_score !== null && rfc.conflict_score > 0.3);
}

/**
 * requestHumanDecision — print HITL alert
 * @param {string} rfcId
 */
function requestHumanDecision(rfcId) {
  const db = getDb();
  const rfc = db.prepare('SELECT * FROM rfc_proposals WHERE id = ?').get(rfcId);
  if (!rfc) { console.error('[GOVERNANCE] RFC not found:', rfcId); return; }

  console.log('');
  console.log('[GOVERNANCE ALERT] 认知冲突：Agent 提议修改 Shared Rule "' + rfc.atom_id + '"');
  console.log('变更类型：' + rfc.change_type);
  console.log('冲突得分：' + (rfc.conflict_score || 0).toFixed(2));
  console.log('操作：[批准合并 / 拒绝合并 / 开启沙盒模拟 / 重新发起 RFC]');
  console.log('> 等待架构师确认...');
  console.log('');
}

/**
 * recordHumanDecision — record human's choice
 * @param {string} rfcId
 * @param {string} decision - approve | reject | retry | sandbox
 * @returns {Object} updated RFC
 */
function recordHumanDecision(rfcId, decision) {
  const db = getDb();
  const validDecisions = ['approve', 'reject', 'retry', 'sandbox'];
  if (!validDecisions.includes(decision)) {
    throw new Error(`[governance] Invalid decision: ${decision}`);
  }

  let newStatus = 'REJECTED';
  let decisionText = decision;

  if (decision === 'approve') {
    newStatus = 'APPROVED';
  } else if (decision === 'retry') {
    newStatus = 'PENDING';
    decisionText = 'human_retry';
  } else if (decision === 'sandbox') {
    decisionText = 'human_sandbox_requested';
  }

  db.prepare(`
    UPDATE rfc_proposals
    SET reviewed_by = 'human', decision = ?, status = ?
    WHERE id = ?
  `).run(decisionText, newStatus, rfcId);

  return db.prepare('SELECT * FROM rfc_proposals WHERE id = ?').get(rfcId);
}

/**
 * createBranch — create a mental branch
 * @param {string} name - branch name
 * @returns {Object} branch record
 */
function createBranch(name) {
  const db = getDb();
  const id = uuid();
  const ts = now();

  db.prepare(`
    INSERT INTO cognitive_branches (id, name, status, created_at)
    VALUES (?, ?, 'ACTIVE', ?)
  `).run(id, name, ts);

  return db.prepare('SELECT * FROM cognitive_branches WHERE id = ?').get(id);
}

/**
 * listBranches — show active branches
 * @returns {Array} branch records
 */
function listBranches() {
  const db = getDb();
  return db.prepare('SELECT * FROM cognitive_branches ORDER BY created_at DESC').all();
}

/**
 * mergeBranch — merge check
 * @param {string} branchName
 * @returns {Object} { success, blockers }
 */
function mergeBranch(branchName) {
  const db = getDb();
  const branch = db.prepare('SELECT * FROM cognitive_branches WHERE name = ?').get(branchName);
  if (!branch) return { success: false, blockers: ['Branch not found'] };

  // Check for conflicts with main branch MINDBASE atoms
  const blockers = [];
  const mainAtoms = db.prepare(`
    SELECT id FROM memory_atom WHERE mental_layer = 'MINDBASE' LIMIT 50
  `).all();

  if (mainAtoms.length > 0) {
    blockers.push('MINDBASE layer exists — manual review recommended');
  }

  if (blockers.length > 0) {
    db.prepare(`UPDATE cognitive_branches SET status = 'CONFLICT' WHERE id = ?`).run(branch.id);
    return { success: false, blockers };
  }

  db.prepare(`
    UPDATE cognitive_branches SET status = 'MERGED', merged_at = ? WHERE id = ?
  `).run(now(), branch.id);

  return { success: true, blockers: [] };
}

/**
 * federatedPreCheck — before promoting to Shared
 * @param {string} atomId
 * @returns {Object} { canPromote, blockers }
 */
function federatedPreCheck(atomId) {
  const db = getDb();
  const blockers = [];

  // Check for conflicting branches
  const conflictingBranches = db.prepare(`
    SELECT name FROM cognitive_branches WHERE status = 'CONFLICT'
  `).all();
  if (conflictingBranches.length > 0) {
    blockers.push('Conflicting branches exist: ' + conflictingBranches.map(b => b.name).join(', '));
  }

  // Check for pending RFCs for this atom
  const pendingRFCs = db.prepare(`
    SELECT id FROM rfc_proposals
    WHERE atom_id = ? AND status IN ('PENDING','TESTING','CONFLICT')
  `).all(atomId);
  if (pendingRFCs.length > 0) {
    blockers.push('PENDING RFCs exist for this atom (' + pendingRFCs.length + ')');
  }

  return {
    canPromote: blockers.length === 0,
    blockers,
  };
}

/**
 * runLongHorizonEval — wrapper
 */
function runLongHorizonEval() {
  const gov = require('./memory-governor');
  return gov.runLongHorizonEval();
}

// ─── CLI entry point ────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd  = args[0];

  function printRFCs(rfcs) {
    if (rfcs.length === 0) { console.log('(no RFCs)'); return; }
    console.table(rfcs.map(r => ({
      id: r.id.slice(0, 8),
      atom: r.atom_id.slice(0, 8),
      type: r.change_type,
      status: r.status,
      score: r.conflict_score,
      decision: r.decision || '-',
      reviewed_by: r.reviewed_by || '-',
      proposed_at: r.proposed_at,
    })));
  }

  if (cmd === 'list') {
    printRFCs(listRFCs(args[1]));
  } else if (cmd === 'propose') {
    if (!args[1]) { console.error('Usage: node governance-plane.js propose <atom_id> [UPDATE|DELETE|MERGE|BRANCH]'); process.exit(1); }
    const rfc = proposeSharedUpdate(args[1], { change_type: args[2] || 'UPDATE' });
    console.log('RFC created:', rfc);
  } else if (cmd === 'evaluate') {
    if (!args[1]) { console.error('Usage: node governance-plane.js evaluate <rfc_id>'); process.exit(1); }
    const result = evaluateRFC(args[1]);
    console.log('RFC after evaluation:', result);
  } else if (cmd === 'conflict') {
    if (!args[1] || !args[2]) { console.error('Usage: node governance-plane.js conflict <rfc_id1> <rfc_id2>'); process.exit(1); }
    console.log('Conflict detection:', conflictDetection(args[1], args[2]));
  } else if (cmd === 'arbitrate') {
    if (!args[1] || !args[2]) { console.error('Usage: node governance-plane.js arbitrate <rfc_id> APPROVED|REJECTED'); process.exit(1); }
    console.log('Arbitration result:', humanArbitration(args[1], args[2]));
  } else {
    console.log(`Memory Planet Governance Plane CLI\nUsage: node governance-plane.js <command> [args]\n\nCommands:\n  list [status]              List RFCs (optional: filter by status PENDING/TESTING/CONFLICT/APPROVED/REJECTED)\n  propose <atom_id> [type]  Create RFC (type: UPDATE|DELETE|MERGE|BRANCH)\n  evaluate <rfc_id>         Evaluate RFC (run regression)\n  conflict <id1> <id2>       Detect conflict between two RFCs\n  arbitrate <rfc_id> <dec>   Human arbitration (dec: APPROVED|REJECTED)\n`);
  }

  process.exit(0);
}

module.exports = {
  proposeSharedUpdate,
  evaluateRFC,
  conflictDetection,
  humanArbitration,
  listRFCs,
  getDb,
  // P2 new functions
  createRFC,
  testRFC,
  approveRFC,
  rejectRFC,
  getRFCConflicts,
  shouldEscalateToHuman,
  requestHumanDecision,
  recordHumanDecision,
  createBranch,
  listBranches,
  mergeBranch,
  federatedPreCheck,
  runLongHorizonEval,
};