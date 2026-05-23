/**
 * M3 Contradiction Detection Engine — 框架
 *
 * Phase 1: LLM-as-Judge 二分类（已实现）
 * Phase 2: 矛盾图谱 + 因果链分析（框架）
 * Phase 3: 自进化触发（当矛盾积累到阈值时）
 *
 * 使用方法：
 *   node contradiction-engine.js scan      — 扫描所有 subject cluster，找潜在矛盾
 *   node contradiction-engine.js verify    — 对候选矛盾对做 LLM-as-Judge 验证
 *   node contradiction-engine.js evolve   — 生成范式转移（需要真实矛盾）
 */

'use strict';

const path   = require('path');
const crypto  = require('crypto');
const https   = require('https');

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';

let db;
try {
  const Database = require('better-sqlite3');
  db = new Database(path.join(__dirname, '..', '..', 'storage', 'atoms.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
} catch(e) {
  console.error('[ContradictionEngine] Failed to open atoms.db:', e.message);
  process.exit(1);
}

function now() { return new Date().toISOString(); }

function callMiniMax({ system, user, max_tokens = 512, thinking = false }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'MiniMax-M2.7',
      max_tokens,
      thinking_enabled: thinking,
      system,
      messages: [{ role: 'user', content: user }],
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

// ─── Phase 1: 候选矛盾对扫描 ─────────────────────────────────────────────

/**
 * 扫描所有 subject cluster，返回候选矛盾对列表。
 * 条件：同一 subject 下，两个 atom 存在 CONTRADICTS 或 REFUTES 关系。
 */
function scanContradictionCandidates() {
  const clusters = db.prepare(`
    SELECT DISTINCT subject FROM claims WHERE subject IS NOT NULL AND subject != ''
  `).all().map(r => r.subject);

  const candidates = [];
  const conflictTypes = ['CONTRADICTS', 'REFUTES'];

  for (const subject of clusters) {
    // 找同一 subject 下有矛盾关系的 atom 对
    const atomRows = db.prepare('SELECT DISTINCT atom_id FROM claims WHERE subject = ?').all(subject);
    const atomIds = atomRows.map(r => r.atom_id);
    if (atomIds.length < 2) continue;

    const placeholders = atomIds.map(() => '?').join(',');
    let relPairs;
    try {
      relPairs = db.prepare(`
        SELECT a1.id as id1, a1.content as c1, a2.id as id2, a2.content as c2,
               r.relation_type, a1.namespace
        FROM relations r
        JOIN memory_atom a1 ON r.source_id = a1.id
        JOIN memory_atom a2 ON r.target_id = a2.id
        WHERE r.relation_type IN ('CONTRADICTS','REFUTES')
          AND a1.id IN (${placeholders}) AND a2.id IN (${placeholders})
      `).all(...atomIds, ...atomIds);
    } catch(e) { continue; }

    for (const pair of relPairs) {
      candidates.push({
        id1: pair.id1, content1: pair.c1,
        id2: pair.id2, content2: pair.c2,
        relation_type: pair.relation_type,
        subject,
        namespace: pair.namespace,
      });
    }
  }
  return candidates;
}

// ─── Phase 2: LLM-as-Judge 验证 ─────────────────────────────────────────

async function judgeContradiction(contentA, contentB) {
  const system = `You are a logical contradiction detector.
Given two knowledge statements, judge whether they genuinely contradict each other
when considered in the same context (same project/domain).
Output ONLY one word: TRUE or FALSE
- TRUE: genuinely contradictory in the same context
- FALSE: unrelated, or concern different domains/projects
Do not explain. Only output TRUE or FALSE.`;

  try {
    const response = await callMiniMax({
      system,
      user: `Statement A: ${contentA}\n\nStatement B: ${contentB}`,
      max_tokens: 10,
      thinking: false,
    });
    const result = response.trim().toUpperCase();
    return result === 'TRUE';
  } catch(e) {
    console.error('[Judge] LLM error:', e.message);
    return false;
  }
}

// ─── Phase 3: 范式转移生成 ──────────────────────────────────────────────

async function generateParadigmShift(conflictDescription, subject) {
  const system = `You are a cognitive architecture AI embedded in a Memory Planet system.
You have detected genuine contradictory atoms in the same subject domain.
Your task: perform Hegelian dialectical synthesis (正反合).
Given contradictory positions (正 and 反), derive a higher-order principle (合) that transcends and unifies them.
Output ONE concise principle (max 100 characters). The principle should be actionable and architecturally meaningful.`;

  try {
    const response = await callMiniMax({
      system,
      user: `Subject: ${subject}\nConflicting atoms:\n${conflictDescription}\n\nDerive the dialectical synthesis (合):`,
      max_tokens: 150,
      thinking: true,
    });
    return response.trim();
  } catch(e) {
    console.error('[ParadigmShift] LLM error:', e.message);
    return null;
  }
}

// ─── CLI Commands ─────────────────────────────────────────────────────────

async function cmdScan() {
  const candidates = scanContradictionCandidates();
  console.log(`[Scan] Found ${candidates.length} candidate contradiction pairs`);
  candidates.forEach((c, i) => {
    console.log(`  [${i+1}] ${c.subject}: ${c.relation_type}`);
    console.log(`      A: ${c.content1.slice(0, 60)}`);
    console.log(`      B: ${c.content2.slice(0, 60)}`);
  });
  return candidates;
}

async function cmdVerify() {
  const candidates = scanContradictionCandidates();
  if (candidates.length === 0) {
    console.log('[Verify] No candidates found');
    return { verified: [], false_positives: 0, real_conflicts: 0 };
  }

  console.log(`[Verify] Checking ${candidates.length} candidates with LLM-as-Judge...`);
  const realConflicts = [];
  const falsePositives = [];

  for (const c of candidates) {
    process.stdout.write(`[Verify] ${c.subject}...`);
    const isReal = await judgeContradiction(c.content1, c.content2);
    if (isReal) {
      realConflicts.push(c);
      console.log(' TRUE');
    } else {
      falsePositives.push(c);
      console.log(' FALSE');
    }
    // 限速：500ms delay between calls
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n[Verify] Results: ${realConflicts.length} real conflicts, ${falsePositives.length} false positives`);
  return { realConflicts, falsePositives, total: candidates.length };
}

async function cmdEvolve() {
  const verified = await cmdVerify();
  if (verified.realConflicts.length === 0) {
    console.log('[Evolve] No real conflicts to resolve — evolution not triggered');
    return { evolved: false, reason: 'no_real_conflicts' };
  }

  console.log(`[Evolve] Generating paradigm shifts for ${verified.realConflicts.length} real conflicts...`);
  const conclusions = [];
  let idx = 0;

  for (const c of verified.realConflicts) {
    idx++;
    console.log(`[Evolve] Conflict ${idx}/${verified.realConflicts.length}...`);
    const principle = await generateParadigmShift(
      `A: ${c.content1}\nB: ${c.content2}`,
      c.subject
    );

    if (!principle) {
      console.log(`[Evolve]   Failed to generate for ${c.subject}`);
      continue;
    }

    // Ingest paradigm shift atom
    const id = crypto.randomUUID();
    const created_at = now();
    try {
      db.prepare(`
        INSERT INTO memory_atom (id, content, confidence, importance, human_pin, namespace,
          created_at, updated_at, tier, last_recalled_at, semantic_variance, activation_entropy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'L0', ?, 1.0, 0.5)
      `).run(
        id, `[ParadigmShift] ${principle}`,
        0.6, 0.85, 1, 'paradigm-shift',
        created_at, created_at, created_at
      );

      // Mark original atoms as RESOLVED_BY the new paradigm
      db.prepare(`
        INSERT OR IGNORE INTO relations (source_id, target_id, relation_type, weight, created_at)
        VALUES (?, ?, 'RESOLVED_BY', 1.0, ?)
      `).run(c.id1, id, now());
      db.prepare(`
        INSERT OR IGNORE INTO relations (source_id, target_id, relation_type, weight, created_at)
        VALUES (?, ?, 'RESOLVED_BY', 1.0, ?)
      `).run(c.id2, id, now());

      console.log(`[Evolve]   ✓ ${principle}`);
      conclusions.push({ id, principle, subject: c.subject });
    } catch(e) {
      console.error(`[Evolve]   DB error:`, e.message);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  return {
    evolved: conclusions.length > 0,
    conclusions,
    total_conflicts: verified.realConflicts.length,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

const cmd = process.argv[2];

const cmdMap = {
  scan:   cmdScan,
  verify: cmdVerify,
  evolve: cmdEvolve,
};

if (!cmd || !cmdMap[cmd]) {
  console.error('Usage: node contradiction-engine.js [scan|verify|evolve]');
  process.exit(1);
}

(async () => {
  try {
    const result = await cmdMap[cmd]();
    console.log('\n' + JSON.stringify({ ok: true, cmd, result }, null, 2));
    db.close();
    process.exit(0);
  } catch(e) {
    console.error('[ContradictionEngine] Error:', e.message);
    process.exit(1);
  }
})();