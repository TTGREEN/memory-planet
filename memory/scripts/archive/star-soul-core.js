// DEPRECATED: Functionality moved to star-soul-core-runner.js
// star-soul-core.js �?Star Soul Core M2: Self-Evolution Engine
// Implements: dream-micro, dream-deep, dream-entropy, evolve, status commands
// Run: node memory/scripts/star-soul-core.js <command> [opts]

process.chdir('C:/Users/Administrator/.openclaw/workspace');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const db = require(path.join(__dirname, 'node_modules', 'better-sqlite3'))(
  path.join(__dirname, '..', '..', 'storage', 'atoms.db')
);

const { judgeContradictionWithLLM, generateParadigmShift } = require(path.join(__dirname, 'minimax-client.js'));
const { generateTestMatrix, generateCodeFromParadigm, runInSandbox } = require(path.join(__dirname, 'skill-sandbox.js'));

// ─── Constants ────────────────────────────────────────────────────────────
const TAU = 10;
const ENTROPY_THRESHOLD = 0.7; // H > this �?trigger evolve
const EVOLVE_COOLDOWN_FILE = path.join(__dirname, '..', '.dreams', 'evolve-cooldown.json');

// ─── Helpers ─────────────────────────────────────────────────────────────
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

// ─── Dream Micro ──────────────────────────────────────────────────────────
function dreamMicro() {
  console.log('[SSC] dream-micro: updating recall counters...');
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
  console.log(`[SSC] dream-micro: updated ${updated} atoms`);
  return updated;
}

// ─── Dream Deep ───────────────────────────────────────────────────────────
function dreamDeep() {
  console.log('[SSC] dream-deep: running tier lifecycle...');
  const rows = db.prepare(`
    SELECT id, content, importance, human_pin, created_at, tier,
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
  console.log(`[SSC] dream-deep: ${erupted} erupted, ${subducted} subducted`);
  return { erupted, subducted };
}

// ─── Cluster Claims by Subject ──────────────────────────────────────────
function clusterClaims() {
  return db.prepare(`
    SELECT subject,
           GROUP_CONCAT(predicate, '|') as predicates,
           COUNT(*) as claim_count,
           GROUP_CONCAT(object, '||') as objects
    FROM claims
    GROUP BY subject
    HAVING claim_count >= 2
  `).all().map(c => ({
    subject: c.subject,
    predicates: c.predicates.split('|'),
    objects: c.objects.split('||'),
    claim_count: c.claim_count,
  }));
}

// ─── Compute Cognitive Entropy ──────────────────────────────────────────
function computeCognitiveEntropy(cluster) {
  const { predicates } = cluster;
  const total = predicates.length;
  if (total < 2) return 0;
  const counts = {};
  for (const p of predicates) counts[p] = (counts[p] || 0) + 1;
  let entropy = 0;
  for (const count of Object.values(counts)) {
    const p = count / total;
    entropy -= p * Math.log2(p + 1e-10);
  }
  const maxEntropy = Math.log2(Object.values(counts).length);
  return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

// ─── Find ALL Candidate Atom Pairs for a Subject ────────────────────────
function findAtomPairsForCluster(subject) {
  return db.prepare(`
    SELECT c1.id as atomId1, c2.id as atomId2,
           c1.predicate as p1, c2.predicate as p2,
           c1.object as o1, c2.object as o2,
           a1.content as c1, a2.content as c2
    FROM claims c1
    JOIN claims c2 ON c1.subject = c2.subject AND c1.id < c2.id
    JOIN memory_atom a1 ON c1.atom_id = a1.id
    JOIN memory_atom a2 ON c2.atom_id = a2.id
    WHERE c1.subject = ?
    LIMIT 6
  `).all(subject);
}

// ─── Entropy-Triggered Evolve (Node 3 Core) ─────────────────────────────
async function entropyTriggeredEvolve() {
  console.log('[SSC] dream-entropy: scanning for entropy clusters...');

  let cooldownData = { lastEvolvedAt: null };
  try {
    if (fs.existsSync(EVOLVE_COOLDOWN_FILE)) {
      cooldownData = JSON.parse(fs.readFileSync(EVOLVE_COOLDOWN_FILE, 'utf8'));
    }
  } catch (e) {}

  if (cooldownData.lastEvolvedAt) {
    const hoursSince = (Date.now() - new Date(cooldownData.lastEvolvedAt).getTime()) / 3600000;
    if (hoursSince < 6) {
      console.log(`[SSC] dream-entropy: cooldown active (${hoursSince.toFixed(1)}h since last evolve) �?skip`);
      return { entropy_scanned: 0, triggered: false };
    }
  }

  const clusters = clusterClaims();
  if (clusters.length === 0) {
    console.log('[SSC] dream-entropy: no multi-claim clusters found');
    return { entropy_scanned: 0, triggered: false };
  }

  console.log(`[SSC] dream-entropy: scanning ${clusters.length} subject clusters...`);

  let triggered = false;
  let evolved = 0;
  const results = [];

  for (const cluster of clusters) {
    const H = computeCognitiveEntropy(cluster);

    if (H < ENTROPY_THRESHOLD) continue;

    console.log(`  [HIGH ENTROPY] "${cluster.subject}" �?H=${H.toFixed(3)} (${cluster.claim_count} claims)`);

    // Find ANY two different atoms on the same subject �?LLM judges if contradictory
    const candidatePairs = findAtomPairsForCluster(cluster.subject);
    if (candidatePairs.length < 2) continue;

    console.log(`    [EVALUATE] ${candidatePairs.length} candidate pairs for "${cluster.subject}"...`);

    for (const pair of candidatePairs) {
      try {
        console.log(`    [LLM] pair: "${pair.c1.slice(0, 35)}..." vs "${pair.c2.slice(0, 35)}..."`);

        const isReal = await judgeContradictionWithLLM(pair.c1, pair.c2);
        if (!isReal) { console.log(`      �?FALSE POSITIVE skip`); continue; }

        console.log(`      �?TRUE CONTRADICTION confirmed`);

        const principle = await generateParadigmShift({
          subject: cluster.subject,
          atoms: [
            { content: pair.c1, predicate: pair.p1 },
            { content: pair.c2, predicate: pair.p2 },
          ],
          conflictDescription: `Two perspectives on "${cluster.subject}"`,
        });

        if (!principle) { console.log(`      �?paradigm shift failed, skip`); continue; }

        console.log(`      �?SHIFT: "${principle.slice(0, 65)}..."`);

        const id = crypto.randomUUID();
        const ts = now();
        db.prepare(`
          INSERT INTO memory_atom (id, content, confidence, importance, human_pin, namespace, embedding, created_at, updated_at, tier, last_recalled_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'L0', ?)
        `).run(id, principle, 0.55, 0.88, 1, 'paradigm-shift', null, ts, ts, ts);

        // Link the new paradigm shift to the two source atoms
        try {
          db.prepare(`INSERT OR IGNORE INTO relations (source_id, target_id, relation_type, weight, created_at) VALUES (?, ?, 'RESOLVES', 0.95, ?)`)
            .run(id, pair.atomId1, ts);
          db.prepare(`INSERT OR IGNORE INTO relations (source_id, target_id, relation_type, weight, created_at) VALUES (?, ?, 'RESOLVES', 0.95, ?)`)
            .run(id, pair.atomId2, ts);
        } catch (e) { console.warn('[SSC] link failed:', e.message); }

        evolved++;
        triggered = true;
        results.push({ subject: cluster.subject, principle, H: H.toFixed(3), paradigmId: id });

        // ── Node 4: Skill Projection ──────────────────────────────────────────
        // For each new paradigm shift, generate a validation skill via Generative TDD
        try {
          const matrix = await generateTestMatrix(principle);
          if (matrix && matrix.test_cases && matrix.test_cases.length > 0) {
            console.log(`    [SKILL-PROJECT] generating validation code for "${principle.slice(0, 40)}..."`);
            let code = await generateCodeFromParadigm(principle, matrix);
            if (code) {
              let passed = false, attempt = 1, feedback = '';
              for (attempt = 1; attempt <= 3; attempt++) {
                const tcResults = [];
                for (const tc of matrix.test_cases) {
                  const exec = await runInSandbox(code, tc.input);
                  const status = !exec.ok ? 'error' : exec.result === tc.expected ? 'pass' : 'fail';
                  tcResults.push({ expected: tc.expected, got: exec.result, status });
                }
                const passCount = tcResults.filter(t => t.status === 'pass').length;
                passed = passCount === matrix.test_cases.length;
                if (passed) break;
                feedback = `${passCount}/${matrix.test_cases.length} passed`;
                const newCode = await generateCodeFromParadigm(principle, matrix, feedback);
                if (newCode) code = newCode;
                else break;
              }
              const skillId = crypto.randomUUID();
              const ts2 = now();
              db.prepare(`INSERT OR IGNORE INTO projected_skills (id, paradigm_id, skill_code, test_matrix, validation_pass, attempt_count, rlaif_feedback, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(skillId, id, code, JSON.stringify(matrix), passed ? 1 : 0, attempt, feedback, ts2, ts2);
              console.log(`    [SKILL-PROJECT] skill ${skillId.slice(0,8)} created: ${passed ? 'PASS' : 'FAIL'} (${attempt} attempts)`);
            }
          }
        } catch(e) { console.warn('[SKILL-PROJECT] error:', e.message); }
      } catch (err) {
        console.error(`      �?ERROR: ${err.message}`);
      }
    }
  }

  if (triggered) {
    fs.writeFileSync(EVOLVE_COOLDOWN_FILE, JSON.stringify({ lastEvolvedAt: now() }), 'utf8');
  }

  console.log(`[SSC] dream-entropy complete: ${evolved} paradigm shifts evolved${triggered ? ' �? : ' (none above threshold)'}`);
  return { entropy_scanned: clusters.length, triggered, evolved, results };
}

// ─── Status ──────────────────────────────────────────────────────────────
function status() {
  console.log('=== Star Soul Core Status ===\n');
  const tiers = db.prepare('SELECT tier, COUNT(*) as cnt FROM memory_atom GROUP BY tier').all();
  const tmap = { L0: 0, L1: 0, L2: 0, L3: 0 };
  tiers.forEach(t => { if (t.tier in tmap) tmap[t.tier] = t.cnt; });
  console.log('【L0-L3�?);
  Object.entries(tmap).forEach(([t, c]) => console.log(`  ${t}: ${c}`));

  const clusters = clusterClaims();
  const entropies = clusters.map(c => ({ subject: c.subject, H: computeCognitiveEntropy(c), count: c.claim_count }));
  entropies.sort((a, b) => b.H - a.H);
  console.log('\n【Top Entropy Clusters�?);
  entropies.slice(0, 5).forEach(c => console.log(`  H=${c.H.toFixed(3)} [${c.count} claims] "${c.subject}"`));

  const rels = db.prepare('SELECT COUNT(*) as cnt FROM relations').get();
  const claims = db.prepare('SELECT COUNT(*) as cnt FROM claims').get();
  console.log(`\n【Graph�?${claims.cnt} claims | ${rels.cnt} relations`);

  const para = db.prepare(`SELECT substr(content,1,65) as c, created_at FROM memory_atom WHERE namespace='paradigm-shift' ORDER BY created_at DESC LIMIT 3`).all();
  console.log('\n【Paradigm Shifts�?);
  para.length === 0 ? console.log('  (none yet)') : para.forEach(p => console.log(`  [${p.created_at.slice(0,10)}] ${p.c}...`));

  const total = db.prepare('SELECT COUNT(*) as cnt FROM memory_atom').get();
  console.log(`\n【Total Atoms�?${total.cnt}`);
  console.log('\n=== Status Complete ===');
}

// ─── CLI ─────────────────────────────────────────────────────────────────
const cmd = process.argv[2] || 'status';

async function main() {
  const cmds = {
    'dream-micro': () => dreamMicro(),
    'dream-deep': () => dreamDeep(),
    'dream-entropy': entropyTriggeredEvolve,
    status,
  };

  if (!cmds[cmd]) {
    console.log('Usage: node star-soul-core.js <command>');
    console.log('Commands: dream-micro | dream-deep | dream-entropy | status');
    process.exit(1);
  }

  try {
    let result = cmds[cmd]();
    if (result && typeof result.then === 'function') result = await result;
    if (cmd !== 'status') console.log(`[SSC] ${cmd} result:`, JSON.stringify(result));
  } catch (e) {
    console.error('[SSC] error:', e.message);
    process.exit(1);
  }

  db.close();
}

main();