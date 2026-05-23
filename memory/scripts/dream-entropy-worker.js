#!/usr/bin/env node
/**
 * dream-entropy-worker.js — M5 Detached Stateful Worker
 *
 * Architecture: spawn + SQLite WAL checkpoint pattern
 * Each task = one subject cluster with all atom pairs
 * On crash/restart, resumes from PENDING tasks (idempotent)
 *
 * Run modes:
 *   enqueue  — scan clusters, write evolution_tasks, exit
 *   loop     — process PENDING tasks one-by-one until all done
 *
 * Usage:
 *   node memory/scripts/dream-entropy-worker.js enqueue
 *   node memory/scripts/dream-entropy-worker.js loop
 */

'use strict';
process.chdir('C:/Users/Administrator/.openclaw/workspace');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', '..', 'storage', 'atoms.db');
const LOG_DIR = path.join(__dirname, '..', '.dreams', 'logs');

try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) {}

const LOG_FILE = path.join(LOG_DIR, 'dream-entropy-worker.log');
const ERR_FILE = path.join(LOG_DIR, 'dream-entropy-worker.err');

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

function logErr(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ERR: ${msg}`;
  console.error(line);
  fs.appendFileSync(ERR_FILE, line + '\n', 'utf8');
}

// ─── Database ───────────────────────────────────────────────────────────
const db = require(path.join(__dirname, 'node_modules', 'better-sqlite3'))(DB_PATH);
db.pragma('journal_mode = WAL');

function now() { return new Date().toISOString(); }

// ─── Schema ─────────────────────────────────────────────────────────────
function ensureSchema() {
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
    );
  `);
}

// ─── LLM Clients ────────────────────────────────────────────────────────
const {
  judgeContradictionWithLLM,
  generateParadigmShift,
} = require(path.join(__dirname, 'minimax-client.js'));

// ─── Process one subject cluster task ──────────────────────────────────
async function processTask(task) {
  const { id, subject, pair_data } = task;
  const pairs = JSON.parse(pair_data);
  if (pairs.length < 2) {
    throw new Error('Need at least 2 pairs for contradiction analysis');
  }

  log(`[${id.slice(0, 8)}] Processing "${subject}" with ${pairs.length} pairs`);

  let evolved = 0;
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const [a1, a2] = pair;

    log(`[${id.slice(0, 8)}] Pair ${i + 1}/${pairs.length}: judge`);

    const isReal = await judgeContradictionWithLLM(a1.content, a2.content);
    if (!isReal) {
      log(`[${id.slice(0, 8)}]   pair ${i + 1}: FALSE POSITIVE skip`);
      continue;
    }

    log(`[${id.slice(0, 8)}]   pair ${i + 1}: TRUE CONTRADICTION → paradigm shift`);

    const principle = await generateParadigmShift({
      subject,
      atoms: [
        { content: a1.content, predicate: a1.predicate || '正' },
        { content: a2.content, predicate: a2.predicate || '反' },
      ],
      conflictDescription: `Two approaches for "${subject}"`,
    });

    if (!principle || !principle.trim()) {
      log(`[${id.slice(0, 8)}]   pair ${i + 1}: empty shift, skip`);
      continue;
    }

    log(`[${id.slice(0, 8)}]   SHIFT: "${principle.slice(0, 80)}"`);

    const atomId = crypto.randomUUID();
    const ts = now();

    db.prepare(`
      INSERT INTO memory_atom
        (id, content, confidence, importance, human_pin, namespace, embedding, created_at, updated_at, tier, last_recalled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'L0', ?)
    `).run(atomId, principle, 0.55, 0.88, 1, 'paradigm-shift', null, ts, ts, ts);

    try {
      db.prepare(`INSERT OR IGNORE INTO relations (source_id, target_id, relation_type, weight, created_at)
        VALUES (?, ?, 'RESOLVES', 0.95, ?)`).run(atomId, a1.id, ts);
      db.prepare(`INSERT OR IGNORE INTO relations (source_id, target_id, relation_type, weight, created_at)
        VALUES (?, ?, 'RESOLVES', 0.95, ?)`).run(atomId, a2.id, ts);
    } catch (e) {
      logErr(`[${id.slice(0, 8)}] link error: ${e.message}`);
    }

    evolved++;
  }

  return { subject, evolved, pairs: pairs.length };
}

// ─── Main Worker Loop ────────────────────────────────────────────────────
async function run() {
  ensureSchema();
  log('═══ dream-entropy-worker started ═══');

  let totalEvolved = 0;
  let idleCycles = 0;
  const MAX_IDLE = 3;

  while (idleCycles < MAX_IDLE) {
    const task = db.transaction(() => {
      const row = db.prepare(`
        SELECT id, subject, pair_data
        FROM evolution_tasks
        WHERE status = 'PENDING'
        ORDER BY created_at ASC
        LIMIT 1
      `).get();
      if (row) {
        db.prepare(`UPDATE evolution_tasks SET status = 'PROCESSING', updated_at = ? WHERE id = ?`)
          .run(now(), row.id);
      }
      return row;
    })();

    if (!task) {
      idleCycles++;
      log(`No PENDING tasks (cycle ${idleCycles}/${MAX_IDLE}), sleeping 10s...`);
      await new Promise(r => setTimeout(r, 10000));
      continue;
    }

    idleCycles = 0;

    try {
      const result = await processTask(task);
      db.prepare(`UPDATE evolution_tasks SET status = 'COMPLETED', result_data = ?, updated_at = ? WHERE id = ?`)
        .run(JSON.stringify(result), now(), task.id);
      totalEvolved += result.evolved;
      log(`[${task.id.slice(0, 8)}] COMPLETED — ${result.evolved} shifts created`);
    } catch (err) {
      logErr(`[${task.id.slice(0, 8)}] FAILED: ${err.message}`);
      db.prepare(`UPDATE evolution_tasks SET status = 'FAILED', error_msg = ?, updated_at = ? WHERE id = ?`)
        .run(err.message, now(), task.id);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  log(`═══ dream-entropy-worker finished: ${totalEvolved} paradigm shifts ═══`);
  db.close();
  process.exit(0);
}

// ─── Enqueue Mode ───────────────────────────────────────────────────────
function enqueue() {
  ensureSchema();

  const clusters = db.prepare(`
    SELECT subject, COUNT(DISTINCT atom_id) as atom_count
    FROM claims
    GROUP BY subject
    HAVING atom_count >= 2
    ORDER BY atom_count DESC
  `).all();

  log(`Enqueue mode: found ${clusters.length} clusters`);

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

    const existing = db.prepare(`
      SELECT id FROM evolution_tasks
      WHERE subject = ? AND status IN ('PENDING', 'PROCESSING')
    `).get(cluster.subject);

    if (!existing) {
      const taskId = crypto.randomUUID();
      db.prepare(`INSERT INTO evolution_tasks (id, subject, pair_data, status) VALUES (?, ?, ?, 'PENDING')`)
        .run(taskId, cluster.subject, JSON.stringify(pairs));
      enqueued++;
    }
  }

  log(`Enqueued ${enqueued} tasks`);
  db.close();
  process.exit(0);
}

// ─── Entry ───────────────────────────────────────────────────────────────
const RUN_MODE = process.argv[2] || 'loop';

if (RUN_MODE === 'loop') {
  run().catch(e => {
    logErr(`Fatal: ${e.message}\n${e.stack}`);
    db.close();
    process.exit(1);
  });
} else if (RUN_MODE === 'enqueue') {
  enqueue();
} else {
  console.error('Usage: dream-entropy-worker.js [enqueue|loop]');
  process.exit(1);
}