/**
 * Backfill embeddings for atoms with NULL embedding
 * Run: node memory/scripts/backfill-embeddings.js
 */
'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const http = require('http');

const DB_PATH = 'C:/Users/Administrator/.openclaw/workspace/storage/atoms.db';
const OLLAMA_HOST = 'localhost';
const OLLAMA_PORT = 11434;
const EMBED_MODEL = 'mxbai-embed-large';

// Load sqlite-vec
const sqliteVec = require('sqlite-vec');
const db = new Database(DB_PATH);
sqliteVec.load(db, sqliteVec.getLoadablePath());

// ─── Ollama Batch Embed ────────────────────────────────────────────────────────
function ollamaEmbedBatch(texts) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: EMBED_MODEL, input: texts });
    const options = {
      hostname: OLLAMA_HOST, port: OLLAMA_PORT, path: '/api/embed',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 30000,
    };
    const req = http.request(options, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { resolve(JSON.parse(d).embeddings); }
        catch(e) { reject(new Error(d.slice(0, 200))); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Ollama embed timeout')); });
    req.on('error', reject); req.write(body); req.end();
  });
}

// ─── Multi-View Perturbation ───────────────────────────────────────────────────
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

function meanVector(vectors) {
  if (!vectors.length) return null;
  const d = vectors[0].length;
  const mu = new Array(d).fill(0);
  for (const v of vectors) for (let i = 0; i < d; i++) mu[i] += v[i];
  for (let i = 0; i < d; i++) mu[i] /= vectors.length;
  return mu;
}

function diagonalVariance(vectors, mu) {
  if (!vectors.length || !mu) return null;
  const d = mu.length;
  const sigma2 = new Array(d).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < d; i++) { const diff = v[i] - mu[i]; sigma2[i] += diff * diff; }
  }
  for (let i = 0; i < d; i++) sigma2[i] /= vectors.length;
  return sigma2;
}

function computeGaussianParams(vectors) {
  if (!vectors || vectors.length === 0) return { mu: null, sigma2: null };
  const mu = meanVector(vectors);
  const sigma2 = vectors.length > 1 ? diagonalVariance(vectors, mu) : new Array(vectors[0].length).fill(0.0001);
  return { mu, sigma2 };
}

function vecToBase64(vec) { return JSON.stringify(vec); }

// ─── Embed single atom (used by backfill + future promoteCanaryToVerified) ─────
async function embedAtom(id, content) {
  const variants = generateUniverseVariants(content);
  let vectors = [];

  try {
    const embs = await ollamaEmbedBatch(variants);
    if (embs && embs.length === 4) {
      for (let i = 0; i < 4; i++) {
        if (embs[i] && embs[i].length > 0) vectors.push(embs[i]);
      }
    }
  } catch(e) {
    console.warn(`[backfill] embed failed for ${id.slice(0,8)}: ${e.message}`);
  }

  if (vectors.length === 0) return false; // give up

  const gp = computeGaussianParams(vectors);
  const embStr = gp.mu ? vecToBase64(gp.mu) : vecToBase64(vectors[0]);

  // UPDATE memory_atom + index vec_atoms_knn
  const updateDb = new Database(DB_PATH);
  sqliteVec.load(updateDb, sqliteVec.getLoadablePath());
  
  try {
    updateDb.prepare('UPDATE memory_atom SET embedding=? WHERE id=?').run(embStr, id);
    // Also insert into vec_atoms_knn if not exists
    try {
      const info = updateDb.prepare('INSERT INTO vec_atoms_knn (embedding) VALUES (?)').run(embStr);
      const rid = info.lastInsertRowid;
      updateDb.prepare('INSERT OR REPLACE INTO vec_atoms_id (atom_id, vec_rowid) VALUES (?, ?)').run(id, rid);
    } catch(e) {
      console.warn('[backfill] vec indexing failed:', e.message);
    }
    console.log(`  ✅ ${id.slice(0,8)} embedded (${vectors.length} views, ${gp.mu ? 'mu' : 'raw'})`);
  } finally {
    updateDb.close();
  }

  return true;
}

// ─── Main: backfill all NULL embedding atoms ───────────────────────────────────
async function main() {
  const nullAtoms = db.prepare('SELECT id, content FROM memory_atom WHERE embedding IS NULL').all();
  console.log(`\n🔍 Found ${nullAtoms.length} atoms with NULL embedding\n`);

  if (nullAtoms.length === 0) {
    console.log('Nothing to backfill. ✅');
    db.close();
    return;
  }

  // Batch them: Ollama handles batch natively, but we do one atom at a time
  // to keep memory manageable and show progress
  let success = 0;
  for (const atom of nullAtoms) {
    process.stdout.write(`Embedding ${atom.id.slice(0,8)}... `);
    const ok = await embedAtom(atom.id, atom.content);
    if (ok) success++;
  }

  console.log(`\n✅ Backfill complete: ${success}/${nullAtoms.length} atoms embedded`);

  // Verify
  const remaining = db.prepare('SELECT COUNT(*) n FROM memory_atom WHERE embedding IS NULL').get();
  console.log(`   Remaining NULL: ${remaining.n}`);

  db.close();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });