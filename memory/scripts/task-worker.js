/**
 * Task Worker — Memory Planet Background Job Processor
 * Run: node memory/scripts/task-worker.js
 * 
 * Lifecycle:
 *   - Spawned by OpenClaw cron or gateway on startup
 *   - Continuously polls task_queue for PENDING tasks
 *   - Crash → exit (parent cron respawns)
 *   - Orphan recovery: fetchTask() auto-resets stale RUNNING tasks
 */
'use strict';

const sqliteVec = require('sqlite-vec');
const Database = require('better-sqlite3');
const path = require('path');

// ─── paths ──────────────────────────────────────────────────────────────────
const ATOMS_DB  = 'C:/Users/Administrator/.openclaw/workspace/storage/atoms.db';
const CLAIM_EXTRACTOR = path.join(__dirname, 'claim-extractor.js');

// ─── helpers ─────────────────────────────────────────────────────────────────

function generateUniverseVariants(text) {
  const isChinese = /[\u4e00-\ufdff]/.test(text);
  if (isChinese) {
    return [
      text,
      `[极速优化视角] ${text} — 如果追求极致性能和响应速度，这个表述意味着什么？本质是什么？`,
      `[绝对安全视角] ${text} — 如果追求绝对可靠性和容错能力，这个表述意味着什么？边界在哪里？`,
      `[宏观抽象视角] ${text} — 将这个表述提炼为跨领域的通用原则/规律是什么？`,
    ];
  }
  return [
    text,
    `[Extreme Performance View] ${text} — What does this mean if we pursue maximum speed and efficiency? What's the core?`,
    `[Zero-Downtime Safety View] ${text} — What does this mean if we need absolute reliability and no failure? What are the limits?`,
    `[Grand Unified Pattern View] ${text} — What is the underlying universal principle that generalizes across domains?`,
  ];
}

async function ollamaEmbedBatch(texts) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const body = JSON.stringify({ model: 'mxbai-embed-large', input: texts });
    const req = http.request(
      {
        hostname: 'localhost',
        port: 11434,
        path: '/api/embed',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 30000,
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(d).embeddings);
          } catch (e) {
            reject(new Error(d.slice(0, 200)));
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Ollama embed timeout'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── per-task DB connection ───────────────────────────────────────────────────

function openDb() {
  const db = new Database(ATOMS_DB);
  sqliteVec.load(db, sqliteVec.getLoadablePath());
  return db;
}

// ─── claim extractor loader (lazy, cached) ────────────────────────────────────

let _claimExtractor = null;
function loadClaimExtractor() {
  if (!_claimExtractor) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _claimExtractor = require(CLAIM_EXTRACTOR);
  }
  return _claimExtractor;
}

// ─── processTask ──────────────────────────────────────────────────────────────

async function processTask(task) {
  const { task_type, payload } = task;

  if (task_type === 'embed_atom') {
    return processEmbedAtom(task.id, payload);
  }

  if (task_type === 'extract_claims') {
    return processExtractClaims(task.id, payload);
  }

  // Unknown task type — fail it
  throw new Error(`Unknown task type: ${task_type}`);
}

async function processEmbedAtom(taskId, payload) {
  const { atomId, content } = payload;
  const start = Date.now();

  const variants = generateUniverseVariants(content || '');
  const embeddings = await ollamaEmbedBatch(variants);

  if (!embeddings || embeddings.length === 0) {
    throw new Error('Ollama returned no embeddings');
  }

  // Average across views
  const dim = embeddings[0].length;
  const fused = new Float32Array(dim);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) fused[i] += emb[i];
  }
  for (let i = 0; i < dim; i++) fused[i] /= embeddings.length;

  const buf = Buffer.from(fused.buffer, fused.byteOffset, fused.byteLength);

  const db = openDb();
  try {
    // Update the embedding column in memory_atom
    db
      .prepare(
        `UPDATE memory_atom
         SET embedding = ?
         WHERE id = ?`
      )
      .run(buf, atomId);

    // Index into sqlite-vec
    db
      .prepare(
        `INSERT OR REPLACE INTO vec_atoms_knn (atom_id, embedding)
         VALUES (?, ?)`
      )
      .run(atomId, buf);
  } finally {
    db.close();
  }

  const elapsedMs = Date.now() - start;
  console.log(`[worker] embed_atom ${atomId.slice(0, 8)} completed in ${elapsedMs}ms`);
}

async function processExtractClaims(taskId, payload) {
  const { atomId, content } = payload;
  const extractor = loadClaimExtractor();

  const [claims, causalTriplets] = await Promise.all([
    extractor.extractClaims(content),
    extractor.extractCausalTriplets(content),
  ]);

  const db = openDb();
  try {
    // Store claims
    for (const claim of claims) {
      db
        .prepare(
          `INSERT INTO claims (id, atom_id, subject, predicate, object, conceptual_depth, contextual_weight, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        )
        .run(claim.id, atomId, claim.subject || '', claim.predicate || '', claim.object || '', 1, 1.0);
    }


    // Store causal relations
    for (const triplet of causalTriplets) {
      db
        .prepare(
          `INSERT INTO relations (id, source_id, target_id, relation_type, weight, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`
        )
        .run(triplet.id || require('uuid').v4(), triplet.cause, triplet.effect, triplet.relation || 'causal', 1.0);
    }
  } finally {
    db.close();
  }

  console.log(
    `[worker] extract_claims ${atomId.slice(0, 8)} — ${claims.length} claims, ${causalTriplets.length} triplets`
  );
}

// ─── main loop ────────────────────────────────────────────────────────────────

async function run() {
  console.log(`[worker] Starting task worker (pid=${process.pid})`);

  const atomsDb = openDb();

  while (true) {
    // fetchTask auto-resets stale RUNNING tasks (orphan recovery)
    const row = atomsDb
      .prepare(
        `SELECT id, task_type, payload, created_at
         FROM task_queue
         WHERE status = 'PENDING'
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get();

    if (!row) {
      console.log('[worker] No tasks in queue, sleeping 2s');
      await sleep(2000);
      continue;
    }

    // Re-open per-task to avoid cross-contamination
    const taskDb = openDb();
    const task = row;

    try {
      // Mark RUNNING
      taskDb
        .prepare(
          `UPDATE task_queue
           SET status = 'RUNNING', started_at = datetime('now')
           WHERE id = ? AND status = 'PENDING'`
        )
        .run(task.id);

      const start = Date.now();

      await processTask(task);

      const elapsedMs = Date.now() - start;

      taskDb
        .prepare(
          `UPDATE task_queue
           SET status = 'COMPLETED', completed_at = datetime('now')
           WHERE id = ?`
        )
        .run(task.id);

      console.log(`[worker] Processed task ${task.id} in ${elapsedMs}ms`);
    } catch (err) {
      console.error(`[worker] ERROR: ${err.message}`);

      taskDb
        .prepare(
          `UPDATE task_queue
           SET status = 'FAILED', error = ?, completed_at = datetime('now')
           WHERE id = ?`
        )
        .run(err.message, task.id);
    } finally {
      taskDb.close();
    }
  }
}

// ─── entry point ──────────────────────────────────────────────────────────────

// If required as a module, export nothing (worker runs forever)
// If run directly, start the loop
if (require.main === module) {
  run().catch((err) => {
    console.error(`[worker] Fatal: ${err.message}`);
    process.exit(1);
  });
}