/**
 * Hybrid recall: keyword (RRF+MMR) + Ollama embedding cosine similarity, RRF fused
 *
 * Pipeline:
 *   1. Keyword pipeline (RRF over query variants → MMR diversify)
 *   2. Embedding pipeline (batch Ollama embed → cosine similarity → RRF)
 *   3. Hybrid fusion: normalize each signal globally, weighted sum
 *      - Chinese queries: embed-only (no expansion noise)
 *      - English queries: 40% keyword + 60% embedding
 */

'use strict';

const path   = require('path');
const crypto  = require('crypto');
const fs      = require('fs');
const http    = require('http');

// ─── SequenceMatcher (Scrapling-inspired lightweight similarity) ──────────────
// Ported from Python's difflib.SequenceMatcher — no embedding required

function sequenceMatcherRatio(a, b) {
  if (!a || !b) return 0;
  const aWords = a.toLowerCase().split(/\s+/).filter(Boolean);
  const bWords = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (aWords.length === 0 || bWords.length === 0) return 0;

  let matches = 0;
  const bSet = new Set(bWords);
  for (const w of aWords) {
    if (bSet.has(w)) matches++;
  }

  const aLen = aWords.length;
  const bLen = bWords.length;
  const containment = Math.max(matches / aLen, matches / bLen);
  const orderedRatio = orderedWordOverlap(aWords, bWords);
  return containment * 0.5 + orderedRatio * 0.5;
}

function orderedWordOverlap(aWords, bWords) {
  if (aWords.length === 0 || bWords.length === 0) return 0;
  let orderedHits = 0;
  const bSeen = new Set();
  for (const w of aWords) {
    for (let i = 0; i < bWords.length; i++) {
      if (!bSeen.has(i) && bWords[i] === w) {
        orderedHits++;
        bSeen.add(i);
        break;
      }
    }
  }
  return orderedHits / Math.max(aWords.length, bWords.length);
}

/**
 * Structural similarity between two atoms — no embedding required.
 * Combines: keyword overlap (SequenceMatcher) + namespace match + importance proximity + length proximity
 *
 * @param {Object} a - atom object
 * @param {Object} b - atom object
 * @returns {number} 0..1 similarity score
 */
function structuralSim(a, b) {
  // 1. Keyword overlap via SequenceMatcher (40%)
  const seqSim = sequenceMatcherRatio(a.content, b.content);

  // 2. Namespace match (20%)
  const nsSim = (a.namespace && b.namespace && a.namespace === b.namespace) ? 1 : 0;

  // 3. Importance proximity (20%) — Gaussian-like decay
  const impDiff = Math.abs(a.importance - b.importance);
  const impSim = Math.max(0, 1 - impDiff / 0.5); // 0.5 is half-score window

  // 4. Length proximity (20%)
  const lenA = a.content.length;
  const lenB = b.content.length;
  const lenRatio = lenA > 0 ? Math.min(lenA, lenB) / Math.max(lenA, lenB) : 0;

  return seqSim * 0.4 + nsSim * 0.2 + impSim * 0.2 + lenRatio * 0.2;
}

/**
 * Find structurally similar atoms to a given atom — O(n) scan, no embedding needed.
 * Used for: deduplication, related memory discovery, recall boost.
 *
 * @param {Object} refAtom - reference atom to compare against
 * @param {Array} candidates - array of atom rows
 * @param {number} threshold - minimum similarity to include (default 0.3)
 * @param {number} limit - max results (default 5)
 * @returns {Array} [{ atom, struct_sim }, ...] sorted by similarity desc
 */
function findSimilarAtoms(refAtom, candidates, { threshold = 0.3, limit = 5 } = {}) {
  const scored = [];
  for (const candidate of candidates) {
    if (candidate.id === refAtom.id) continue; // exclude self
    const sim = structuralSim(refAtom, candidate);
    if (sim >= threshold) {
      scored.push({ atom: candidate, struct_sim: sim });
    }
  }
  return scored.sort((a, b) => b.struct_sim - a.struct_sim).slice(0, limit);
}

// ─── Config ───────────────────────────────────────────────────────────────────

const ATOMS_DB_PATH = path.join(__dirname, '..', '..', 'storage', 'atoms.db');
const OLLAMA_HOST   = 'localhost';
const OLLAMA_PORT   = 11434;
const EMBED_MODEL   = 'mxbai-embed-large';
const TAU           = 10;   // staleness half-life parameter (days)
const KEYWORD_K     = 60;   // RRF k for keyword pipeline
const EMBED_K       = 60;   // RRF k for embedding pipeline
const MMR_LAMBDA    = 0.6;  // MMR diversity weight
const MMR_MULT      = 3;    // topK multiplier for MMR candidate pool

// ─── Ollama Embedding Client ──────────────────────────────────────────────────

function ollamaEmbed(texts) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: EMBED_MODEL, input: texts });
    const options = {
      hostname: OLLAMA_HOST, port: OLLAMA_PORT, path: '/api/embed',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = http.request(options, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { resolve(JSON.parse(d).embeddings); }
        catch(e) { reject(new Error(d.slice(0, 200))); }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]; }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-10);
}

function vecToBase64(vec)  { return JSON.stringify(vec); }
function vecFromBase64(str){ return JSON.parse(str); }

// ─── DB 懒初始化 ──────────────────────────────────────────────────────────────

let _db = null;

function getDb() {
  if (!_db) {
    const Database = require('better-sqlite3');
    const dir = path.dirname(ATOMS_DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    _db = new Database(ATOMS_DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');

    _db.exec(`
CREATE TABLE IF NOT EXISTS memory_atom (
  id          TEXT PRIMARY KEY,
  content     TEXT NOT NULL,
  confidence  REAL NOT NULL DEFAULT 0.5,
  importance  REAL NOT NULL DEFAULT 0.5,
  human_pin   INTEGER NOT NULL DEFAULT 0,
  namespace   TEXT NOT NULL DEFAULT 'default',
  embedding   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_atom_confidence ON memory_atom(confidence);
CREATE INDEX IF NOT EXISTS idx_atom_importance ON memory_atom(importance);
CREATE INDEX IF NOT EXISTS idx_atom_created   ON memory_atom(created_at);
CREATE INDEX IF NOT EXISTS idx_atom_namespace ON memory_atom(namespace);
    `);

    // Migration
    const tinfo = _db.prepare('PRAGMA table_info(memory_atom)').all();
    const colNames = tinfo.map(c => c.name);
    if (!colNames.includes('namespace')) {
      _db.exec('ALTER TABLE memory_atom ADD COLUMN namespace TEXT NOT NULL DEFAULT default');
      _db.exec('CREATE INDEX IF NOT EXISTS idx_atom_namespace ON memory_atom(namespace)');
    }
    if (!colNames.includes('embedding')) {
      _db.exec('ALTER TABLE memory_atom ADD COLUMN embedding TEXT');
    }
  }

  // Guard: if _db was closed by a previous call, re-initialize lazily
  try { _db.prepare('SELECT 1').all(); } catch(e) {
    if (e.message.includes('closed') || e.message.includes('not open')) {
      _db = null;
      return getDb();
    }
    throw e;
  }

  return _db;
}

function uuid() { return crypto.randomUUID(); }
function now()  { return new Date().toISOString(); }

// ─── Staleness ────────────────────────────────────────────────────────────────

function stalenessDecay(createdAt) {
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86400000;
  return Math.exp(-ageDays / TAU);
}

function computeM0Importance(humanPin, staleness, baseImportance = 0.5) {
  return Math.min(1.0, 0.3 * humanPin + 0.2 * staleness + baseImportance);
}

function computeFinalImportance(m0Importance, confidence) {
  return m0Importance * (0.5 + 0.5 * confidence);
}

// ─── Ingest ───────────────────────────────────────────────────────────────────

function ingestAtom(opts = {}) {
  if (!opts.content) throw new Error('[atoms-db] ingest: content is required');
  const db         = getDb();
  const id         = uuid();
  const confidence = opts.confidence ?? 0.5;
  const human_pin  = opts.human_pin  ?? 0;
  const namespace  = opts.namespace  ?? 'default';
  const created_at = now();

  const staleness  = stalenessDecay(created_at);
  const baseImp    = opts.baseImportance ?? 0.5;
  const m0Imp       = computeM0Importance(human_pin, staleness, baseImp);
  const importance = computeFinalImportance(m0Imp, confidence);

  db.prepare(`
    INSERT INTO memory_atom (id, content, confidence, importance, human_pin, namespace, embedding, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, opts.content, confidence, importance, human_pin, namespace, null, created_at, created_at);

  syncToSessionCorpus(id, opts.content, opts.atom_type || 'fact');
  return { id, content: opts.content, confidence, importance, human_pin, namespace, created_at };
}

/**
 * Ingest atom with Ollama embedding (async)
 */
async function ingestAtomWithEmbedding(opts = {}) {
  if (!opts.content) throw new Error('[atoms-db] ingest: content is required');
  const db         = getDb();
  const id         = uuid();
  const confidence = opts.confidence ?? 0.5;
  const human_pin  = opts.human_pin  ?? 0;
  const namespace  = opts.namespace  ?? 'default';
  const created_at = now();

  const staleness  = stalenessDecay(created_at);
  const baseImp    = opts.baseImportance ?? 0.5;
  const m0Imp       = computeM0Importance(human_pin, staleness, baseImp);
  const importance = computeFinalImportance(m0Imp, confidence);

  let embStr = null;
  try {
    const emb = await ollamaEmbed(opts.content);
    if (emb && emb[0]) embStr = vecToBase64(emb[0]);
  } catch(e) {
    console.warn('[atoms-db] embedding failed for atom', id.slice(0,8) + ':', e.message);
  }

  db.prepare(`
    INSERT INTO memory_atom (id, content, confidence, importance, human_pin, namespace, embedding, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, opts.content, confidence, importance, human_pin, namespace, embStr, created_at, created_at);

  syncToSessionCorpus(id, opts.content, opts.atom_type || 'fact');
  return { id, content: opts.content, confidence, importance, human_pin, namespace, embedding: embStr, created_at };
}

function syncToSessionCorpus(atomId, content, atomType) {
  try {
    const cfg     = require(path.join(__dirname, '..', 'config.json'));
    const today   = new Date().toISOString().slice(0, 10);
    const logFile = path.join(cfg.dailyLogsDir, today + '.md');
    const entry   = '\n\n<!-- atom:' + atomId + ' type:' + atomType + ' -->' + content;
    fs.appendFileSync(logFile, entry, 'utf8');
  } catch (e) { /* non-fatal */ }
}

// ─── Query expansion ─────────────────────────────────────────────────────────

function expandQuery(query) {
  const q = query.trim();
  const isChinese = /[\u4e00-\ufdff]/.test(q);
  if (isChinese) {
    // For Chinese, single-concept queries: don't expand (expansion adds noise)
    return [q];
  }
  // English: standard expansion
  const variants = [
    q,
    q.replace(/^(what|how|why|when|where|who)\s+/i, ''),
    (q.includes('?') ? q : q + ' is what'),
    'about ' + q,
    q + ' related',
  ];
  return variants.filter((v, i, a) => v.length > 1 && a.indexOf(v) === i);
}

// ─── Keyword scoring ──────────────────────────────────────────────────────────

function scoreKeyword(query, rows) {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  return rows.map(row => {
    const cl = row.content.toLowerCase();
    const matched = words.length > 0 ? words.filter(w => cl.includes(w)).length : 0;
    const sim = words.length > 0 ? matched / words.length : 0;
    const salience = words.length > 0
      ? matched / Math.max(1, cl.split(/\s+/).length) * matched
      : 0;
    const recency = stalenessDecay(row.created_at);
    // Pin boost: pinned atoms get 0.15 extra on kw_score, making them rank higher
    const pinBoost = row.human_pin ? 0.15 : 0;
    const kw_score = 0.3 * sim + 0.15 * recency + 0.15 * row.importance + 0.1 * Math.min(salience, 1) + pinBoost;
    return { ...row, kw_score, sim, recency };
  });
}

// ─── MMR ─────────────────────────────────────────────────────────────────────

function tokenizeForMMR(text) {
  const parts = text.split(/\s+/).filter(p => p.length > 0);
  const tokens = new Set();
  for (const part of parts) {
    if (/[\u4e00-\ufdff]/.test(part)) { for (const char of part) tokens.add(char); }
    else { tokens.add(part); }
  }
  return tokens;
}

function mmrDiversify(items, topK, lambda = 0.6) {
  if (items.length <= topK) return items;
  const selected = []; const remaining = [...items];
  selected.push(remaining.shift());
  while (selected.length < topK && remaining.length > 0) {
    const lastTokens = tokenizeForMMR(selected[selected.length - 1].content);
    let bestIdx = -1, bestScore = -Infinity;
    remaining.forEach((item, idx) => {
      const tokens = tokenizeForMMR(item.content);
      let intersection = 0;
      for (const t of lastTokens) { if (tokens.has(t)) intersection++; }
      const union = lastTokens.size + tokens.size - intersection;
      const jaccard = union > 0 ? intersection / union : 0;
      const score = (item.kw_score || 0) * lambda - (1 - lambda) * jaccard;
      if (score > bestScore) { bestScore = score; bestIdx = idx; }
    });
    if (bestIdx >= 0) selected.push(remaining.splice(bestIdx, 1)[0]);
    else break;
  }
  return selected;
}

// ─── RRF ──────────────────────────────────────────────────────────────────────

function rrfScore(items, k = 60) {
  const scored = new Map();
  items.forEach((item, rank) => {
    if (!scored.has(item.id)) scored.set(item.id, { ...item, _rrf: 0 });
    scored.get(item.id)._rrf += 1 / (k + rank + 1);
  });
  return [...scored.values()];
}

// ─── Hybrid recall ────────────────────────────────────────────────────────────

/**
 * Hybrid recall: keyword RRF+MMR + Ollama embedding cosine similarity, fused
 * @param {string} query - Search query
 * @param {number} topK - Number of results to return
 * @param {Object} opts
 * @returns {Promise<Array>} [{ id, content, kwN, embN, cos_sim, hybrid_rrf, phase, rank, ... }]
 */
async function hybridRecall(query, topK = 5, opts = {}) {
  const db = getDb();

  const rows = db.prepare(
    'SELECT id, content, confidence, importance, human_pin, namespace, created_at, embedding FROM memory_atom' +
    (opts.namespace ? ' WHERE namespace = ?' : '') + ' ORDER BY importance DESC'
  ).all(...(opts.namespace ? [opts.namespace] : []));
  if (rows.length === 0) { db.close(); return []; }

  const isChinese = /[\u4e00-\ufdff]/.test(query);

  // ── Keyword pipeline (skip for pure Chinese queries — expansion noise) ─────
  let kwAll = [];
  if (!isChinese || query.length > 4) {
    // For English or Chinese multi-word queries, use keyword pipeline
    const variants = expandQuery(query);
    const perVariant = variants.map(v => {
      const scored = scoreKeyword(v, rows);
      return scored.sort((a, b) => b.kw_score - a.kw_score);
    });

    // RRF across variants
    const kwScored = [];
    perVariant.forEach(list => {
      list.forEach((item, rank) => {
        if (!kwScored.find(x => x.id === item.id)) kwScored.push({ ...item, kw_rrf: 0 });
        const entry = kwScored.find(x => x.id === item.id);
        entry.kw_rrf += 1 / (KEYWORD_K + rank + 1);
      });
    });
    kwAll = kwScored.sort((a, b) => b.kw_rrf - a.kw_rrf);
  } else {
    // Pure Chinese short query: use importance as proxy (no keyword matching possible)
    kwAll = rows.map(row => ({ ...row, kw_rrf: 0 }));
  }

  // ── Embedding pipeline ─────────────────────────────────────────────────────
  let queryEmb;
  try {
    const emb = await ollamaEmbed(query);
    queryEmb = emb[0];
  } catch(e) {
    // Fallback to keyword-only
    const result = mmrDiversify(kwAll, topK, MMR_LAMBDA).slice(0, topK).map((item, idx) => ({
      ...item, phase: 'keyword', rank: idx + 1, rrf_score: item.kw_rrf
    }));
    db.close();
    return result;
  }
  if (!queryEmb) { db.close(); return []; }

  const rowsWithEmb = rows.filter(r => r.embedding);
  if (rowsWithEmb.length === 0) {
    const result = mmrDiversify(kwAll, topK, MMR_LAMBDA).slice(0, topK).map((item, idx) => ({
      ...item, phase: 'keyword', rank: idx + 1, rrf_score: item.kw_rrf
    }));
    db.close();
    return result;
  }

  let atomEmbeds;
  try {
    atomEmbeds = await ollamaEmbed(rowsWithEmb.map(r => r.content));
  } catch(e) {
    const result = mmrDiversify(kwAll, topK, MMR_LAMBDA).slice(0, topK).map((item, idx) => ({
      ...item, phase: 'keyword', rank: idx + 1, rrf_score: item.kw_rrf
    }));
    db.close();
    return result;
  }

  // Compute embedding scores and RRF
  const embItemMap = {};
  rowsWithEmb.forEach((row, idx) => {
    const cos = cosineSim(queryEmb, atomEmbeds[idx]);
    const recency = stalenessDecay(row.created_at);
    // Pin boost for embedding pipeline too
    const pinBoost = row.human_pin ? 0.12 : 0;
    const emb_score = 0.3 * cos + 0.15 * recency * 0.5 + 0.15 * row.importance * 0.3 + pinBoost;
    embItemMap[row.id] = { ...row, emb_score, cos_sim: cos, recency };
  });

  const embSorted = rowsWithEmb.map(r => embItemMap[r.id]).sort((a, b) => b.emb_score - a.emb_score);
  const embRRFMap = new Map();
  embSorted.forEach((item, rank) => {
    if (!embRRFMap.has(item.id)) embRRFMap.set(item.id, { ...item, emb_rrf: 0 });
    embRRFMap.get(item.id).emb_rrf += 1 / (EMBED_K + rank + 1);
  });

  // ── Hybrid fusion ─────────────────────────────────────────────────────────
  const maxKwAll = Math.max(...kwAll.map(x => x.kw_rrf), 0.001);
  const maxEmbAll = Math.max(...embSorted.map(x => x.emb_score), 0.001);

  const allIds = new Set([...kwAll.map(x => x.id), ...embSorted.map(x => x.id)]);
  const fused = [];
  allIds.forEach(id => {
    const kwItem = kwAll.find(x => x.id === id) || null;
    const embItem = embRRFMap.get(id) || null;
    const kwN = kwItem ? kwItem.kw_rrf / maxKwAll : 0;
    const embN = embItem ? embItem.emb_score / maxEmbAll : 0;
    // For Chinese queries: reduce keyword weight (it's noise for short queries)
    const kwWeight = isChinese ? 0.1 : 0.4;

    // ── Structural similarity signal (Scrapling-inspired, no embedding needed) ──
    // Uses the query itself as a "reference atom" — lightweight alternative when Ollama is down
    const refStruct = { content: query, namespace: 'query', importance: 1.0 };
    const rowData = kwItem || embItem || {};
    const structN = structuralSim(refStruct, rowData) * 0.3; // 30% weight of struct signal

    const hybrid = kwN * kwWeight + embN * (1 - kwWeight);
    const hybrid_with_struct = hybrid + structN * 0.15; // struct adds 15% bonus on top

    fused.push({
      id,
      content: (kwItem || embItem || {}).content || '',
      namespace: (kwItem || embItem || {}).namespace || 'default',
      importance: (kwItem || embItem || {}).importance || 0.5,
      kw_rrf: kwItem ? kwItem.kw_rrf : 0,
      emb_rrf: embItem ? embItem.emb_rrf : 0,
      cos_sim: embItem ? embItem.cos_sim : 0,
      kwN, embN,
      struct_sim: structuralSim(refStruct, rowData),
      hybrid_rrf: hybrid_with_struct,
      recency: (kwItem || embItem || {}).recency || 0,
    });
  });

  const sorted = fused.sort((a, b) => b.hybrid_rrf - a.hybrid_rrf);
  db.close();
  return sorted.slice(0, topK).map((item, idx) => ({
    ...item, phase: 'hybrid', rank: idx + 1, rrf_score: item.hybrid_rrf
  }));
}

// ─── Sync-only embed search for CLI ─────────────────────────────────────────

async function embedSearch(query, topK = 5, opts = {}) {
  return hybridRecall(query, topK, { ...opts, embedOnly: true });
}

// ─── Importance update ────────────────────────────────────────────────────────

function updateAllImportance() {
  const db = getDb();
  const rows = db.prepare('SELECT id, confidence, human_pin, created_at FROM memory_atom').all();
  const updated = [];
  for (const row of rows) {
    const staleness  = stalenessDecay(row.created_at);
    const m0Imp      = computeM0Importance(row.human_pin, staleness);
    const importance = computeFinalImportance(m0Imp, row.confidence);
    db.prepare('UPDATE memory_atom SET importance = ?, updated_at = ? WHERE id = ?')
      .run(importance, now(), row.id);
    updated.push({ id: row.id, importance });
  }
  return updated;
}

// ─── Pin ──────────────────────────────────────────────────────────────────────

function pinAtom(atomId, pinValue = 1) {
  getDb().prepare('UPDATE memory_atom SET human_pin = ?, updated_at = ? WHERE id = ?')
    .run(pinValue, now(), atomId);
}

// ─── Query ─────────────────────────────────────────────────────────────────────

function getAtom(atomId) {
  return getDb().prepare('SELECT * FROM memory_atom WHERE id = ?').get(atomId);
}

function listAtoms(limit = 50) {
  return getDb().prepare(`
    SELECT id, content, confidence, importance, human_pin, namespace, created_at, updated_at
    FROM memory_atom ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

// ─── Module lazy re-export (for CLI compatibility) ────────────────────────────
// Keep the old recall() as a sync wrapper for memory.js CLI
function recall(query, topK = 5, opts = {}) {
  // Synchronous stub — CLI should use hybridRecall directly or we wrap it
  return hybridRecall(query, topK, opts);
}

// ─── Export ───────────────────────────────────────────────────────────────────

module.exports = {
  ingestAtom,
  ingestAtomWithEmbedding,
  recall: hybridRecall,
  embedSearch,
  embedSearchSync: hybridRecall,
  hybridRecall,
  updateAllImportance,
  pinAtom,
  getAtom,
  listAtoms,
  stalenessDecay,
  computeM0Importance,
  computeFinalImportance,
  sequenceMatcherRatio,
  structuralSim,
  findSimilarAtoms,
  cosineSim,
  TAU,
  OLLAMA_HOST,
  OLLAMA_PORT,
  EMBED_MODEL,
};