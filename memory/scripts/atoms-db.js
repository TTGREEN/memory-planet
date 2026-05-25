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
  return containment * CONTAINMENT_WEIGHT + orderedRatio * ORDER_WEIGHT;
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
  const impDiff = Math.abs((a.importance || 0) - (b.importance || 0));
  const impSim = Math.max(0, 1 - impDiff / IMP_WINDOW);

  // 4. Length proximity (20%)
  const lenA = a.content.length;
  const lenB = b.content.length;
  const lenRatio = lenA > 0 ? Math.min(lenA, lenB) / Math.max(lenA, lenB) : 0;

  return seqSim * SEQ_WEIGHT + nsSim * NS_WEIGHT + impSim * IMP_WEIGHT + lenRatio * LEN_WEIGHT;
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

// CLEANUP: Extracted magic numbers to named constants
const TAU           = 10;   // staleness half-life parameter (days)
const KEYWORD_K     = 60;   // RRF k for keyword pipeline
const EMBED_K       = 60;   // RRF k for embedding pipeline
const MMR_LAMBDA    = 0.6;  // MMR diversity weight
const MMR_MULT      = 3;    // topK multiplier for MMR candidate pool
const STALENESS_SIGMA = 0.1; // ECV Gaussian perturbation std-dev
const ECV_GAMMA     = 0.15; // ECV perturbation cap (15% of score)
const PIN_BOOST_KW  = 0.15; // pin boost for keyword score
const PIN_BOOST_EMB = 0.12; // pin boost for embedding score
const IMP_WEIGHT    = 0.2;  // importance weight in structural sim
const NS_WEIGHT     = 0.2;  // namespace match weight in structural sim
const LEN_WEIGHT    = 0.2;  // length proximity weight in structural sim
const SEQ_WEIGHT    = 0.4;  // sequence match weight in structural sim
const STRUCT_WEIGHT = 0.3;  // struct similarity weight in hybrid recall
const STRUCT_BONUS  = 0.15; // struct similarity bonus in hybrid recall
const SEM_VAR_HALF_LIFE = 0.5; // measurement collapse: sem_variance multiplier
const MAX_ATOMS_RECALL = 50; // default limit for listAtoms
const SCRATCHPAD_MAX_HOT = 20; // default max hot pages per session
const MIND_ACCESS_THRESH = 3; // min access count to promote to draft
const MIND_ACCESS_BONUS = 0.05; // importance bonus per access count
const CLAIM_DEPTH_DEFAULT = 1; // default conceptual depth for claims
const CAUSAL_DEPTH_DEFAULT = 2; // default conceptual depth for causal claims
const IMP_WINDOW = 0.5; // half-score window for importance proximity in structuralSim
const CONTAINMENT_WEIGHT = 0.5; // weight of containment in sequenceMatcherRatio
const ORDER_WEIGHT = 0.5; // weight of ordered overlap in sequenceMatcherRatio
const M0_HUMAN_PIN_WEIGHT = 0.3; // weight of human_pin in M0 importance
const M0_STALENESS_WEIGHT = 0.2; // weight of staleness in M0 importance
const CONF_INFLATION = 0.5; // confidence multiplier on base importance in final importance

// ─── kw_score / emb_score weights (P1 magic number extraction) ────────────────
const KW_SIM_WEIGHT    = 0.3;
const KW_RECENCY_WEIGHT = 0.15;
const KW_IMP_WEIGHT    = 0.15;
const KW_SAL_WEIGHT    = 0.1;
const EMB_COS_WEIGHT   = 0.75;  // cosine similarity weight in emb_score
const EMB_REC_WEIGHT   = 0.05;  // recency weight in emb_score
const EMB_IMP_WEIGHT   = 0.10;  // importance weight in emb_score

// ─── Ollama Embedding Client ──────────────────────────────────────────────────

function ollamaEmbed(texts) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: EMBED_MODEL, input: texts });
    const options = {
      hostname: OLLAMA_HOST, port: OLLAMA_PORT, path: '/api/embed',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 30000, // 30s for batch embed (4 variants)
    };
    const req = http.request(options, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { resolve(JSON.parse(d).embeddings); }
        catch(e) { reject(new Error(d.slice(0, 200))); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('ollama embed timeout (5s) — Ollama unavailable')); });
    req.on('error', reject); req.write(body); req.end();
  });
}

function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]; }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-10);
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

// ─── Multi-View Perturbation (Node 1 - M5) ─────────────────────────────────────
// Generate 3 universe variants of a text for probabilistic embedding

function generateUniverseVariants(text) {
  const isChinese = /[\u4e00-\ufdff]/.test(text);
  if (isChinese) {
    return [
      text,  // raw
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

function computeGaussianParams(vectors) {
  if (!vectors || vectors.length === 0) return { mu: null, sigma2: null };
  const mu = meanVector(vectors);
  const sigma2 = vectors.length > 1 ? diagonalVariance(vectors, mu) : new Array(vectors[0].length).fill(0.0001);
  return { mu, sigma2 };
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

    // Load sqlite-vec (pure C, pre-built DLL, no VS Build Tools needed)
    try {
      const sqliteVec = require('sqlite-vec');
      sqliteVec.load(_db, sqliteVec.getLoadablePath());
    } catch(e) {
      console.warn('[atoms-db] sqlite-vec load failed:', e.message);
    }

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

    // ── Ephemeral Pages (L0.5 Scratchpad) ───────────────────────────────
    _db.exec(`
CREATE TABLE IF NOT EXISTS ephemeral_pages (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  page_key        TEXT NOT NULL,
  content         TEXT NOT NULL,
  summary         TEXT,
  is_hot          INTEGER NOT NULL DEFAULT 0,
  task_ref        TEXT,
  access_count    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT,
  last_accessed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ep_session ON ephemeral_pages(session_id);
CREATE INDEX IF NOT EXISTS idx_ep_hot    ON ephemeral_pages(session_id, is_hot);
    `);


    // ── Draft Atoms (Canary Pipeline) ─────────────────────────────────
    _db.exec(`
CREATE TABLE IF NOT EXISTS draft_atoms (
  id                 TEXT PRIMARY KEY,
  content            TEXT NOT NULL,
  namespace          TEXT NOT NULL DEFAULT 'default',
  importance         REAL NOT NULL DEFAULT 0.5,
  confidence         REAL NOT NULL DEFAULT 0.5,
  status             TEXT NOT NULL DEFAULT 'DRAFT',
  canary_utility     REAL NOT NULL DEFAULT 0,
  error_count        INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT,
  shadow_compiled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_da_status    ON draft_atoms(status);
CREATE INDEX IF NOT EXISTS idx_da_namespace ON draft_atoms(namespace);
    `);

    // ── Deprecated Lessons (Rollback Archive) ───────────────────────────
    _db.exec(`
CREATE TABLE IF NOT EXISTS deprecated_lessons (
  id          TEXT PRIMARY KEY,
  atom_id     TEXT NOT NULL,
  content     TEXT NOT NULL,
  namespace   TEXT NOT NULL DEFAULT 'default',
  deprecation_reason TEXT,
  deprecated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dl_atom ON deprecated_lessons(atom_id);
    `);

    // Migration
    runMigrations(_db);

    // sqlite-vec vec0 exact KNN (1024-dim, mxbai-embed-large actual output)
    // vec1 HNSW not available in sqlite-vec v0.1.9; vec0 is fast for <1000 atoms
    try {
      _db.exec(`
CREATE TABLE IF NOT EXISTS vec_atoms_id (atom_id TEXT PRIMARY KEY, vec_rowid INTEGER UNIQUE);
CREATE VIRTUAL TABLE IF NOT EXISTS vec_atoms_knn USING vec0(embedding float[1024]);
      `);
    } catch(e) {
      console.warn('[atoms-db] vec_atoms_knn setup failed:', e.message);
    }
  }

  // Guard: if _db was closed by a previous call, re-initialize lazily
  try { _db.prepare('SELECT 1').all(); } catch(e) {
    _db = null;
    return getDb();
  }

  return _db;
}

function uuid() { return crypto.randomUUID(); }
function now()  { return new Date().toISOString(); }

// ─── Schema Migrations ──────────────────────────────────────────────────────

function runMigrations(db) {
  const tinfo = db.prepare('PRAGMA table_info(memory_atom)').all();
  const colNames = tinfo.map(c => c.name);

  // namespace
  if (!colNames.includes('namespace')) {
    db.exec('ALTER TABLE memory_atom ADD COLUMN namespace TEXT NOT NULL DEFAULT \'default\'');
    db.exec('CREATE INDEX IF NOT EXISTS idx_atom_namespace ON memory_atom(namespace)');
  }
  // embedding
  if (!colNames.includes('embedding')) {
    db.exec('ALTER TABLE memory_atom ADD COLUMN embedding TEXT');
  }
  // tier
  if (!colNames.includes('tier')) {
    db.exec('ALTER TABLE memory_atom ADD COLUMN tier TEXT NOT NULL DEFAULT \'L2\'');
  }
  // last_recalled_at
  if (!colNames.includes('last_recalled_at')) {
    db.exec('ALTER TABLE memory_atom ADD COLUMN last_recalled_at TEXT');
  }
  // semantic_variance (ECV — Node 1)
  if (!colNames.includes('semantic_variance')) {
    db.exec('ALTER TABLE memory_atom ADD COLUMN semantic_variance REAL NOT NULL DEFAULT 1.0');
  }
  // activation_entropy (ECV — Node 1)
  if (!colNames.includes('activation_entropy')) {
    db.exec('ALTER TABLE memory_atom ADD COLUMN activation_entropy REAL NOT NULL DEFAULT 0.5');
  }
  // Multi-view perturbation columns (Node 1 - M5)
  if (!colNames.includes('emb_raw')) {
    db.exec("ALTER TABLE memory_atom ADD COLUMN emb_raw TEXT");
  }
  if (!colNames.includes('emb_speed')) {
    db.exec("ALTER TABLE memory_atom ADD COLUMN emb_speed TEXT");
  }
  if (!colNames.includes('emb_safe')) {
    db.exec("ALTER TABLE memory_atom ADD COLUMN emb_safe TEXT");
  }
  if (!colNames.includes('emb_macro')) {
    db.exec("ALTER TABLE memory_atom ADD COLUMN emb_macro TEXT");
  }
  if (!colNames.includes('emb_mu')) {
    db.exec("ALTER TABLE memory_atom ADD COLUMN emb_mu TEXT");
  }
  if (!colNames.includes('emb_sigma2')) {
    db.exec("ALTER TABLE memory_atom ADD COLUMN emb_sigma2 TEXT");
  }
  // projected_skills (Node 4 — Skill Projection)
  const skillsTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projected_skills'").get();
  if (!skillsTableExists) {
    db.exec(`
      CREATE TABLE projected_skills (
        id              TEXT PRIMARY KEY,
        paradigm_id     TEXT REFERENCES memory_atom(id) ON DELETE CASCADE,
        skill_code      TEXT NOT NULL,
        test_matrix     TEXT NOT NULL,   -- JSON
        validation_pass INTEGER NOT NULL DEFAULT 0,
        attempt_count   INTEGER NOT NULL DEFAULT 1,
        rlaif_feedback  TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );
      CREATE INDEX idx_ps_paradigm ON projected_skills(paradigm_id);
      CREATE INDEX idx_ps_pass ON projected_skills(validation_pass);
    `);
  }
  // Migration marker
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (id INTEGER)');

    // ── user_profile table (P0: MINDBASE — 永久置顶画像) ───────────────────────
    _db.exec(`
CREATE TABLE IF NOT EXISTS user_profile (
  id          TEXT PRIMARY KEY,
  tag         TEXT NOT NULL,
  content     TEXT NOT NULL,
  importance  REAL NOT NULL DEFAULT 0.9,
  namespace   TEXT NOT NULL DEFAULT 'user',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_up_active ON user_profile(active);
    `);

    // ── wiki_blocks table (P0: L1 — 夜间 Shadow Compiler 产物) ──────────────
    _db.exec(`
CREATE TABLE IF NOT EXISTS wiki_blocks (
  id              TEXT PRIMARY KEY,
  content         TEXT NOT NULL,
  source_ids      TEXT,
  topic           TEXT,
  importance      REAL NOT NULL DEFAULT 0.6,
  confidence      REAL NOT NULL DEFAULT 0.7,
  embedding       TEXT,
  human_pin       INTEGER NOT NULL DEFAULT 0,
  namespace       TEXT NOT NULL DEFAULT 'default',
  version         INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wb_topic     ON wiki_blocks(topic);
CREATE INDEX IF NOT EXISTS idx_wb_status   ON wiki_blocks(status);
CREATE INDEX IF NOT EXISTS idx_wb_importance ON wiki_blocks(importance);
    `);

    // ── Mark legacy raw atoms (no embedding) as tier='raw' ─────────────────
    try {
      const rawCheck = db.prepare("SELECT COUNT(*) as cnt FROM memory_atom WHERE tier='raw'").get();
      if (rawCheck.cnt === 0) {
        db.prepare("UPDATE memory_atom SET tier='raw' WHERE embedding IS NULL AND tier='L2'").run();
      }
    } catch(e) { /* non-fatal */ }
}

// ─── Staleness ────────────────────────────────────────────────────────────────

function stalenessDecay(createdAt) {
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86400000;
  return Math.exp(-ageDays / TAU);
}

function computeM0Importance(humanPin, staleness, baseImportance = 0.5) {
  // CLEANUP: replaced magic numbers with named constants
  return Math.min(1.0, M0_HUMAN_PIN_WEIGHT * humanPin + M0_STALENESS_WEIGHT * staleness + baseImportance);
}

function computeFinalImportance(m0Importance, confidence) {
  // CLEANUP: replaced magic numbers with CONF_INFLATION constant
  return m0Importance * (CONF_INFLATION + CONF_INFLATION * confidence);
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
 * Ingest atom with Multi-View Perturbation (Node 1 - M5)
 *
 * For each new atom, generate 3 universe variants (Speed/Safety/Macro) and batch
 * embed all 4 views (raw + 3 variants) in a single Ollama API call.
 * Then compute μ and σ² (diagonal covariance) in JS.
 *
 * This gives every atom a native probabilistic cloud from birth,
 * not a post-hoc statistical approximation.
 *
 * Fallback: if Ollama unavailable, use single raw embedding (backward compatible).
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
  const m0Imp      = computeM0Importance(human_pin, staleness, baseImp);
  const importance = computeFinalImportance(m0Imp, confidence);

  let embStr = null, embRaw = null, embSpeed = null, embSafe = null, embMacro = null;
  let embMu = null, embSigma2 = null;

  // Step 1: Multi-View Perturbation — generate 4 universe variants
  const variants = generateUniverseVariants(opts.content);

  // Step 2: Batch embed all 4 views in one API call (Ollama supports batch)
  let vectors = [];
  try {
    const embs = await ollamaEmbed(variants);
    if (embs && embs.length === 4) {
      for (let i = 0; i < 4; i++) {
        if (embs[i] && embs[i].length > 0) {
          vectors.push(embs[i]);
        }
      }
    }
  } catch(e) {
    console.warn('[atoms-db] multi-view embed failed, falling back to single embed:', e.message);
  }

  if (vectors.length === 4) {
    // All 4 views embedded successfully — compute Gaussian params
    embRaw   = vecToBase64(vectors[0]);
    embSpeed = vecToBase64(vectors[1]);
    embSafe  = vecToBase64(vectors[2]);
    embMacro = vecToBase64(vectors[3]);

    const gp = computeGaussianParams(vectors);
    embMu    = gp.mu    ? vecToBase64(gp.mu)    : null;
    embSigma2 = gp.sigma2 ? vecToBase64(gp.sigma2) : null;
    embStr   = embMu; // use mu as the primary embedding for backward compatibility
  } else if (vectors.length === 1) {
    // Ollama returned only 1 embedding (backward compat or partial failure)
    embStr   = vecToBase64(vectors[0]);
    embRaw   = embStr;
  } else {
    // Ollama unavailable or error — no embedding
    console.warn('[atoms-db] ingest: no embeddings available for atom', id.slice(0,8));
  }

  db.prepare(`
    INSERT INTO memory_atom (id, content, confidence, importance, human_pin, namespace,
      embedding, emb_raw, emb_speed, emb_safe, emb_macro, emb_mu, emb_sigma2, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, opts.content, confidence, importance, human_pin, namespace,
    embStr, embRaw, embSpeed, embSafe, embMacro,
    embMu, embSigma2, created_at, created_at
  );

  // Index in sqlite-vec for KNN search
  if (embStr) {
    try {
      // vec0 uses rowid as primary key; INSERT into vec_atoms_knn and capture rowid
      const insertSql = 'INSERT INTO vec_atoms_knn (embedding) VALUES (?)';
      const info = db.prepare('SELECT last_insert_rowid() as rid').get();
      const rid = info.rid;

      // Store mapping
      db.prepare('INSERT OR REPLACE INTO vec_atoms_id (atom_id, vec_rowid) VALUES (?, ?)').run(id, rid);
    } catch(e) { console.warn('[atoms-db] vec indexing failed:', e.message); }
  }

  syncToSessionCorpus(id, opts.content, opts.atom_type || 'fact');
  return { id, content: opts.content, confidence, importance, human_pin, namespace,
           embedding: embStr, emb_raw: embRaw, emb_speed: embSpeed,
           emb_safe: embSafe, emb_macro: embMacro, emb_mu: embMu, emb_sigma2: embSigma2, created_at };
}

function syncToSessionCorpus(atomId, content, atomType) {
  try {
    const cfg     = require(path.join(__dirname, '..', 'config.json'));
    const today   = new Date().toISOString().slice(0, 10);
    const logFile = path.join(cfg.dailyLogsDir, today + '.md');
    const entry   = '\n\n<!-- atom:' + atomId + ' type:' + atomType + ' -->' + content;
    fs.appendFileSync(logFile, entry, 'utf8');
  } catch (e) { console.warn('[atoms-db] syncToSessionCorpus non-fatal:', e.message); }
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
    // CLEANUP: replaced magic 0.15 with PIN_BOOST_KW constant
    const pinBoost = row.human_pin ? PIN_BOOST_KW : 0;
    const kw_score = KW_SIM_WEIGHT * sim + KW_RECENCY_WEIGHT * recency + KW_IMP_WEIGHT * row.importance + KW_SAL_WEIGHT * Math.min(salience, 1) + pinBoost;
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
  try {
    const rows = db.prepare(
      'SELECT id, content, confidence, importance, human_pin, namespace, created_at, embedding, semantic_variance, activation_entropy FROM memory_atom' +
      (opts.namespace ? ' WHERE namespace = ?' : '') + ' ORDER BY importance DESC'
    ).all(...(opts.namespace ? [opts.namespace] : []));
    if (rows.length === 0) return [];

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
    return result;
  }
  if (!queryEmb) return [];

  const rowsWithEmb = rows.filter(r => r.embedding);
  if (rowsWithEmb.length === 0) {
    const result = mmrDiversify(kwAll, topK, MMR_LAMBDA).slice(0, topK).map((item, idx) => ({
      ...item, phase: 'keyword', rank: idx + 1, rrf_score: item.kw_rrf
    }));
    return result;
  }

  let atomEmbeds;
  try {
    atomEmbeds = await ollamaEmbed(rowsWithEmb.map(r => r.content));
  } catch(e) {
    const result = mmrDiversify(kwAll, topK, MMR_LAMBDA).slice(0, topK).map((item, idx) => ({
      ...item, phase: 'keyword', rank: idx + 1, rrf_score: item.kw_rrf
    }));
    return result;
  }

  // Compute embedding scores and RRF
  const embItemMap = {};
  rowsWithEmb.forEach((row, idx) => {
    const cos = cosineSim(queryEmb, atomEmbeds[idx]);
    const recency = stalenessDecay(row.created_at);
    // CLEANUP: replaced magic 0.12 with PIN_BOOST_EMB constant
    const pinBoost = row.human_pin ? PIN_BOOST_EMB : 0;

    // ── ECV Quantum Probability Perturbation (Node 1) ────────────────────
    // Low-confidence atoms get a Gaussian jitter in their score — simulates quantum probability cloud
    // High-confidence atoms are "collapsed" and behave like deterministic vectors
    const sv = row.semantic_variance != null ? row.semantic_variance : 1.0;
    const ae = row.activation_entropy != null ? row.activation_entropy : 0.5;
    const conf = row.confidence;
    // Sigmoid gate: uncertainty drives perturbation, capped at 15% of cos score
    const uncertainty = (1.0 - conf) * sv; // ECV uncertainty factor
    const u1 = Math.random() + 1e-10;
    const u2 = Math.random() + 1e-10;
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    // CLEANUP: replaced magic 0.15 with ECV_GAMMA constant
    const maxPerturb = Math.abs(cos) * ECV_GAMMA;
    const perturb = 0.15 * uncertainty * z * 0.1 * ae;
    const clampedPerturb = Math.max(-maxPerturb, Math.min(maxPerturb, perturb));
    const perturbedCos = cos + clampedPerturb;
    // ────────────────────────────────────────────────────────────────────
    const emb_score = EMB_COS_WEIGHT * perturbedCos + EMB_REC_WEIGHT * recency + EMB_IMP_WEIGHT * row.importance + pinBoost;
    embItemMap[row.id] = { ...row, emb_score, cos_sim: perturbedCos, rawCos: cos, recency };
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
  return sorted.slice(0, topK).map((item, idx) => ({
    ...item, phase: 'hybrid', rank: idx + 1, rrf_score: item.hybrid_rrf
  }));
  } finally {
    db.close();
  }
}

// ─── M1.5: sqlite-vec Vector Search (pure C, pre-built, no VS needed) ────────
// Uses vec0 exact KNN (vec1 HNSW not available in sqlite-vec v0.1.9)
// vec0 schema: integer rowid + float[1024] embedding, JOIN via vec_atoms_id

async function vecSearch(query, topK = 10) {
  const db = getDb();

  let queryEmb;
  try {
    const emb = await ollamaEmbed(query);
    queryEmb = emb[0];
  } catch(e) {
    console.warn('[vecSearch] embed failed:', e.message);
    return [];
  }

  try {
    const queryJson = JSON.stringify(queryEmb);
    // vec0 KNN syntax (sqlite-vec v0.1.9): MATCH + ORDER BY distance + LIMIT
    // k must NOT be a parameter; use literal interpolation (safe: parseInt topK)
    const k = Math.max(1, parseInt(topK));
    const sql = `SELECT v.rowid, v.distance, a.id, a.content, a.namespace, a.embedding
      FROM vec_atoms_knn v
      JOIN vec_atoms_id vid ON v.rowid = vid.vec_rowid
      JOIN memory_atom a ON vid.atom_id = a.id
      WHERE v.embedding MATCH ? AND k = ${k}
      ORDER BY v.distance`;
    const results = db.prepare(sql).all(queryJson);

    // vec0 returns L2 distance (0=identical for unit vectors)
    // For 1024-dim unit vectors: max possible L2 ≈ 64; normalize to similarity
    return results.map(r => ({
      id: r.id,
      content: r.content || '',
      namespace: r.namespace || 'unknown',
      embedding: r.embedding || null,
      vec_score: Math.max(0, 1 - r.distance / 64),
    }));
  } catch(e) {
    console.warn('[vecSearch] sqlite-vec error, falling back to JS:', e.message);
    return vecSearchJS(queryEmb, topK);
  }
}

function vecSearchJS(queryEmb, topK) {
  const db = getDb();
  const rows = db.prepare('SELECT id, content, namespace, embedding FROM memory_atom WHERE embedding IS NOT NULL').all();
  const scored = rows.map(row => {
    try {
      const atomEmb = JSON.parse(row.embedding);
      return { id: row.id, content: row.content, namespace: row.namespace, vec_score: cosineSim(queryEmb, atomEmb) };
    } catch(e) { return null; }
  }).filter(Boolean);
  return scored.sort((a, b) => b.vec_score - a.vec_score).slice(0, topK);
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

// ─── Claims & Relations (M1.5 GraphRAG) ─────────────────────────────────

function ingestClaim({ atom_id, subject, predicate, object, conceptual_depth = 1 }) {
  const db = getDb();
  const id = uuid();
  const created_at = now();
  db.prepare(`
    INSERT INTO claims (id, atom_id, subject, predicate, object, conceptual_depth, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, atom_id, subject, predicate, object, conceptual_depth, created_at);
  return { id, atom_id, subject, predicate, object };
}

function getClaimsForAtom(atomId) {
  return getDb().prepare('SELECT * FROM claims WHERE atom_id = ? ORDER BY created_at').all(atomId);
}

function ingestRelation({ source_id, target_id, relation_type, weight = 1.0 }) {
  const db = getDb();
  const created_at = now();
  db.prepare(`
    INSERT OR IGNORE INTO relations (source_id, target_id, relation_type, weight, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(source_id, target_id, relation_type, weight, created_at);
  return { source_id, target_id, relation_type, weight };
}

function getRelationsForAtom(atomId) {
  const db = getDb();
  return {
    outgoing: db.prepare('SELECT * FROM relations WHERE source_id = ?').all(atomId),
    incoming: db.prepare('SELECT * FROM relations WHERE target_id = ?').all(atomId),
  };
}

// ─── Ingest with LLM Claim Extraction (M1.5) ─────────────────────────────────

const { extractClaims, extractCausalTriplets } = require('./claim-extractor');

async function ingestAtomWithClaims({ content, namespace = 'default', confidence = 0.7, human_pin = 0 }) {
  const db = getDb();
  const id = uuid();
  const created_at = now();


  // 1. Compute importance
  const staleness = stalenessDecay(created_at);
  const m0Imp = computeM0Importance(human_pin, staleness);
  const importance = computeFinalImportance(m0Imp, confidence);

  // 2. Insert atom
  db.prepare(`
    INSERT INTO memory_atom (id, content, confidence, importance, human_pin, namespace, embedding, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, content, confidence, importance, human_pin, namespace, null, created_at, created_at);

  // 3. LLM extract claims
  const claims = await extractClaims(content, { maxClaims: 3 });
  const causalTriplets = await extractCausalTriplets(content, { maxClaims: 2 });

  const ingestedClaims = [];
  for (const c of claims) {
    const claim = ingestClaim({ atom_id: id, subject: c.subject, predicate: c.predicate, object: c.object });
    ingestedClaims.push(claim);
    // Also link the atom to its own claims via a SELF relation
    ingestRelation({ source_id: id, target_id: id, relation_type: 'SELF_' + c.predicate, weight: 0.9 });
  }

  for (const t of causalTriplets) {
    const claim = ingestClaim({ atom_id: id, subject: t.subject, predicate: t.predicate, object: t.object, conceptual_depth: 2 });
    ingestedClaims.push(claim);
  }

  return { id, content, claims: ingestedClaims, namespace, confidence, importance, created_at };
}

// ─── Fractal Drill-Down (Node 2) ───────────────────────────────────────────

/**
 * Drill-down: given a paradigm-shift atom (L0 principle), fetch its causal neighborhood.
 * Uses BOTH relations table AND claims table for rich causal traversal.
 * Returns: { principle, resolvedBy, causedBy, supportedBy, causalChain }
 */
function drillDown(atomId) {
  const db = getDb();
  const principle = db.prepare('SELECT * FROM memory_atom WHERE id = ?').get(atomId);
  if (!principle) return { error: 'atom not found' };

  const outgoing = db.prepare('SELECT r.*, a.content, a.namespace FROM relations r JOIN memory_atom a ON r.target_id = a.id WHERE r.source_id = ?').all(atomId);
  const incoming = db.prepare('SELECT r.*, a.content, a.namespace FROM relations r JOIN memory_atom a ON r.source_id = a.id WHERE r.target_id = ?').all(atomId);

  const resolvedBy = [...outgoing.filter(r => r.relation_type === 'RESOLVES'), ...incoming.filter(r => r.relation_type === 'RESOLVED_BY')].map(r => ({ id: r.source_id === atomId ? r.target_id : r.source_id, content: r.content, namespace: r.namespace }));
  const causedBy = outgoing.filter(r => ['CAUSES', 'FOLLOWS', 'PRECEDES'].includes(r.relation_type)).map(r => ({ id: r.target_id, content: r.content, namespace: r.namespace }));
  const supportedBy = outgoing.filter(r => ['SUPPORTS', 'ENHANCES', 'IMPLEMENTS'].includes(r.relation_type)).map(r => ({ id: r.target_id, content: r.content, namespace: r.namespace }));

  // ── Fractal causal chain from claims table ───────────────────────────────
  // Find causal claims where this atom is the source
  const causalClaims = db.prepare(`
    SELECT c.predicate, c.object,
           (SELECT id FROM memory_atom WHERE content LIKE '%' || c.object || '%' ORDER BY importance DESC LIMIT 1) as target_id,
           (SELECT content FROM memory_atom WHERE content LIKE '%' || c.object || '%' ORDER BY importance DESC LIMIT 1) as target_content
    FROM claims c
    WHERE c.atom_id = ? AND c.predicate IN ('CAUSES','FOLLOWS','PRECEDES','MITIGATES','ENHANCES')
  `).all(atomId);

  // For fractal traversal: from each effect/object, find what it CAUSES (depth-2)
  const fractalChain = [];
  for (const claim of causalClaims) {
    if (!claim.target_id || claim.target_id === atomId) continue;
    const depth2Claims = db.prepare(`
      SELECT c.predicate, c.object, a.id as target_id, a.content as target_content
      FROM claims c
      LEFT JOIN memory_atom a ON a.content LIKE '%' || c.object || '%'
      WHERE c.atom_id = ? AND c.predicate IN ('CAUSES','FOLLOWS','PRECEDES')
      LIMIT 3
    `).all(claim.target_id);
    fractalChain.push({ from: claim.object, predicate: claim.predicate, depth2: depth2Claims.filter(c => c.target_id) });
  }

  return { principle, resolvedBy, causedBy, supportedBy, causalClaims, fractalChain };
}

// ─── ECV: Quantum-Probabilistic Recall (Node 1) ─────────────────────────────

/**
 * Gaussian perturbation for low-confidence atoms.
 * S_prob = S_det + gamma * (1 - C) * N(0, sigma^2) * D_query
 * Capped at 15% max perturbation to prevent hallucinations.
 */
function ecvGaussianPerturbation(detScore, confidence, queryDiversity = 0.5, gamma = 0.15) {
  if (confidence >= 1.0) return detScore; // fully collapsed — no perturbation
  const sigma = 0.1; // fixed std-dev for the perturbation
  // Box-Muller transform for normal distribution
  const u1 = Math.random() + 1e-10;
  const u2 = Math.random() + 1e-10;
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

  const uncertainty = (1.0 - confidence);
  // CLEANUP: replaced magic 0.15 with ECV_GAMMA constant
  const maxPerturb = Math.abs(detScore) * ECV_GAMMA; // sigmoid gate: cap at 15%
  const perturb = gamma * uncertainty * z * sigma * queryDiversity;
  const clampedPerturb = Math.max(-maxPerturb, Math.min(maxPerturb, perturb));
  return detScore + clampedPerturb;
}

/**
 * Measurement collapse: when a high-variance atom is recalled AND helps solve the task,
 * collapse it: semantic_variance -= 50%, confidence += delta.
 */
function measurementCollapse(atomId, confidenceDelta = 0.1) {
  const db = getDb();
  const atom = db.prepare('SELECT * FROM memory_atom WHERE id = ?').get(atomId);
  if (!atom) return null;

  // CLEANUP: replaced magic 0.5 with SEM_VAR_HALF_LIFE constant
  const newVariance = (atom.semantic_variance || 1.0) * SEM_VAR_HALF_LIFE;
  const newConfidence = Math.min(1.0, (atom.confidence || 0.5) + confidenceDelta);

  db.prepare('UPDATE memory_atom SET semantic_variance = ?, confidence = ?, updated_at = ? WHERE id = ?')
    .run(newVariance, newConfidence, now(), atomId);

  return { id: atomId, semantic_variance: newVariance, confidence: newConfidence };
}

// ─── Tier Maintenance ───────────────────────────────────────────────────────

function runTierMaintenance() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, content, importance, human_pin, tier, created_at,
           (julianday('now') - julianday(created_at)) as age_days
    FROM memory_atom ORDER BY created_at DESC
  `).all();

  const promoted = [], subsided = [];
  for (const row of rows) {
    let newTier = row.tier || 'L2';
    if (row.tier !== 'L0' && row.importance >= 0.95 && row.human_pin === 1 && row.age_days >= 7) {
      newTier = 'L0'; promoted.push({ id: row.id, from: row.tier, to: newTier, staleness: stalenessDecay(row.created_at) });
    } else if (row.tier === 'L2' && row.importance >= 0.9 && row.age_days >= 14) {
      newTier = 'L1'; promoted.push({ id: row.id, from: row.tier, to: newTier, staleness: stalenessDecay(row.created_at) });
    } else if (row.tier !== 'L3' && row.importance < 0.3 && row.age_days > 60 && row.human_pin === 0) {
      newTier = 'L3'; subsided.push({ id: row.id, from: row.tier, to: newTier, ageMs: Math.round((Date.now() - new Date(row.created_at).getTime()) / 86400000) });
    } else if (row.tier === 'L1' && row.importance < 0.6 && row.age_days > 30) {
      newTier = 'L2'; subsided.push({ id: row.id, from: row.tier, to: newTier, ageMs: Math.round((Date.now() - new Date(row.created_at).getTime()) / 86400000) });
    }
    if (newTier !== row.tier) {
      db.prepare('UPDATE memory_atom SET tier = ?, updated_at = ? WHERE id = ?').run(newTier, now(), row.id);
    }
  }
  return { promoted, subsided };
}

// ─── Projected Skills (Node 4 — Skill Projection) ───────────────────────────

/**
 * getSkillForParadigm: retrieve projected skill for a paradigm atom
 */
function getSkillForParadigm(paradigmId) {
  const db = getDb();
  return db.prepare('SELECT * FROM projected_skills WHERE paradigm_id = ?').get(paradigmId);
}

/**
 * listProjectedSkills: return all projected skills
 */
function listProjectedSkills() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT ps.*, substr(ma.content,1,60) as paradigm_preview
    FROM projected_skills ps
    JOIN memory_atom ma ON ma.id = ps.paradigm_id
    ORDER BY ps.created_at DESC
  `).all();
  return rows;
}

// ─── Scratchpad / Ephemeral Pages (L0.5 Working Memory) ───────────────────────

/**
 * Returns cold page IDs for a session ordered by last_accessed_at (oldest first).
 * These are candidates for eviction when scratchpad budget is exceeded.
 *
 * @param {string} sessionId - Session ID
 * @returns {Array} cold page rows ordered oldest-first
 */
function getScratchpadLRU(sessionId) {
  const db = getDb();
  return db.prepare(`
    SELECT id, session_id, page_key, content, summary, is_hot, task_ref, access_count, created_at, last_accessed_at
    FROM ephemeral_pages
    WHERE session_id = ? AND is_hot = 0
    ORDER BY last_accessed_at ASC
  `).all(sessionId);
}

/**
 * Enforce scratchpad budget for a session — evict oldest hot pages when budget exceeded.
 * Hot pages are swapped to cold (is_hot=0) rather than deleted, preserving them for
 * potential page-fault re-access.
 *
 * @param {string} sessionId - Session ID
 * @param {number} maxPages  - Max hot pages allowed (default 20)
 * @returns {Object} { evicted: pageIds, remaining_hot: count }
 */
function enforceScratchpadBudget(sessionId, maxPages = 20) {
  const db = getDb();

  const hotCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM ephemeral_pages WHERE session_id = ? AND is_hot = 1
  `).get(sessionId).cnt;

  if (hotCount <= maxPages) {
    return { evicted: [], remaining_hot: hotCount };
  }

  const excess = hotCount - maxPages;

  const toEvict = db.prepare(`
    SELECT id FROM ephemeral_pages
    WHERE session_id = ? AND is_hot = 1
    ORDER BY last_accessed_at ASC
    LIMIT ?
  `).all(sessionId, excess);

  if (toEvict.length === 0) {
    return { evicted: [], remaining_hot: hotCount };
  }

  const evictedIds = toEvict.map(r => r.id);
  const placeholders = evictedIds.map(() => '?').join(',');
  db.prepare(`
    UPDATE ephemeral_pages
    SET is_hot = 0
    WHERE session_id = ? AND id IN (${placeholders})
  `).run(sessionId, ...evictedIds);

  const newHotCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM ephemeral_pages WHERE session_id = ? AND is_hot = 1
  `).get(sessionId).cnt;

  return { evicted: evictedIds, remaining_hot: newHotCount };
}

/**
 * Page fault: on-demand swap-in of a cold page.
 * Restores a specific cold page by pageKey back to hot status.
 *
 * @param {string} sessionId - Session ID
 * @param {string} pageKey   - Page key to swap in
 * @returns {Object|null} swapped-in page record or null if not found
 */
function pageFaultSwapIn(sessionId, pageKey) {
  const db = getDb();
  const ts = now();

  const page = db.prepare(`
    SELECT * FROM ephemeral_pages WHERE session_id = ? AND page_key = ? AND is_hot = 0
  `).get(sessionId, pageKey);

  if (!page) {
    const any = db.prepare(`
      SELECT * FROM ephemeral_pages WHERE session_id = ? AND page_key = ?
    `).get(sessionId, pageKey);
    return any;
  }

  db.prepare(`
    UPDATE ephemeral_pages
    SET is_hot = 1, last_accessed_at = ?, access_count = access_count + 1
    WHERE id = ?
  `).run(ts, page.id);

  return { ...page, is_hot: 1, last_accessed_at: ts, access_count: page.access_count + 1 };
}

/**
 * Touch a scratchpad page — update last_accessed_at and increment access_count.
 * Called on every access to keep LRU ordering fresh.
 *
 * @param {string} pageId - Ephemeral page ID
 */
function touchScratchpadPage(pageId) {
  const db = getDb();
  const ts = now();
  db.prepare(`
    UPDATE ephemeral_pages
    SET last_accessed_at = ?, access_count = access_count + 1
    WHERE id = ?
  `).run(ts, pageId);
}

/**
 * Write a scratchpad page for a session.
 * Scratchpad pages are short-lived working memory notes that don't warrant a full atom.
 *
 * @param {string} sessionId - Session ID
 * @param {string} pageKey   - Unique key for this page within session (e.g. '推理链第3步', 'temp假设A')
 * @param {string} content   - Raw page content
 * @param {string} taskRef   - Optional task reference tag
 * @returns {Object} created page record
 */
function writeScratchpadPage(sessionId, pageKey, content, taskRef) {
  const db = getDb();
  const id = uuid();
  const ts = now();

  // Upsert: replace if same session+key combo exists
  const existing = db.prepare(
    'SELECT id FROM ephemeral_pages WHERE session_id = ? AND page_key = ?'
  ).get(sessionId, pageKey);

  if (existing) {
    db.prepare(`
      UPDATE ephemeral_pages
      SET content = ?, summary = NULL, is_hot = 1, task_ref = ?, access_count = access_count + 1, last_accessed_at = ?
      WHERE id = ?
    `).run(content, taskRef || null, ts, existing.id);
    return { id: existing.id, session_id: sessionId, page_key: pageKey, is_hot: 1 };
  }

  db.prepare(`
    INSERT INTO ephemeral_pages (id, session_id, page_key, content, is_hot, task_ref, access_count, created_at, last_accessed_at)
    VALUES (?, ?, ?, ?, 1, ?, 1, ?, ?)
  `).run(id, sessionId, pageKey, content, taskRef || null, ts, ts);
  return { id, session_id: sessionId, page_key: pageKey, is_hot: 1 };
}

/**
 * Get hot (in-context) scratchpad pages for a session, ordered by recency.
 *
 * @param {string} sessionId - Session ID
 * @param {number} limit     - Max pages to return (default 20)
 * @returns {Array} page rows sorted by last_accessed_at DESC
 */
function getScratchpadPages(sessionId, limit = 20) {
  const db = getDb();
  return db.prepare(`
    SELECT id, session_id, page_key, content, summary, is_hot, task_ref, access_count, created_at, last_accessed_at
    FROM ephemeral_pages
    WHERE session_id = ? AND is_hot = 1
    ORDER BY last_accessed_at DESC
    LIMIT ?
  `).all(sessionId, limit);
}

/**
 * Swap out (mark cold) specific scratchpad pages — used when context window overflows.
 *
 * @param {string}   sessionId - Session ID
 * @param {string[]} pageIds   - Array of page IDs to mark cold
 */
function swapOutScratchpad(sessionId, pageIds) {
  if (!pageIds || pageIds.length === 0) return;
  const db = getDb();
  const placeholders = pageIds.map(() => '?').join(',');
  db.prepare(`
    UPDATE ephemeral_pages
    SET is_hot = 0
    WHERE session_id = ? AND id IN (${placeholders})
  `).run(sessionId, ...pageIds);
}

/**
 * Swap in (mark hot) specific scratchpad pages — used on page fault / context reload.
 *
 * @param {string[]} pageIds - Array of page IDs to mark hot
 */
function swapInScratchpad(pageIds) {
  if (!pageIds || pageIds.length === 0) return;
  const db = getDb();
  const ts = now();
  const placeholders = pageIds.map(() => '?').join(',');
  db.prepare(`
    UPDATE ephemeral_pages
    SET is_hot = 1, last_accessed_at = ?
    WHERE id IN (${placeholders})
  `).run(ts, ...pageIds);
}

/**
 * Session Termination Compression: summarize pages and promote key insights.
 * Called when a session ends.
 *
 * Enhanced P1:
 * - Keeps MINDBASE-relevant pages marked hot
 * - Summarizes remaining pages (first 100 chars + key as summary)
 * - Runs lightweight claim extraction on high-value pages (access_count >= 3)
 *   to promote insights as draft_atoms
 *
 * @param {string} sessionId - Session ID to compress
 * @returns {Object} { pages, summaries, promotedDrafts }
 */
function compressSessionScratchpad(sessionId) {
  const db = getDb();
  const pages = db.prepare(`
    SELECT id, page_key, content, task_ref, access_count, created_at
    FROM ephemeral_pages
    WHERE session_id = ?
    ORDER BY access_count DESC, created_at DESC
  `).all(sessionId);

  if (pages.length === 0) return { pages: [], summaries: [], promotedDrafts: [] };

  // Split: MINDBASE-relevant (high access, identity/原则 keywords) vs. compressible
  const MIND_KEYWORDS = ['原则', '价值观', 'identity', 'rule', 'always', 'never', '记住', '重要', '必须', '应该'];
  const summaries = [];
  const promotedDrafts = [];

  for (const p of pages) {
    const isMind = MIND_KEYWORDS.some(k => p.content.includes(k));
    // Keep high-access MINDBASE pages hot; compress everything else
    if (isMind && p.access_count >= 3) {
      // Promote as draft atom (high-value insight)
      const summaryText = p.content.slice(0, 200);
      const draft = ingestDraft(
        `[Session记录] ${p.page_key}: ${summaryText}`,
        'session-compression',
        Math.min(0.9, 0.3 + p.access_count * 0.05)
      );
      promotedDrafts.push({ pageId: p.id, pageKey: p.page_key, draftId: draft.id });
      // Keep this page hot — MINDBASE relevance
      db.prepare('UPDATE ephemeral_pages SET is_hot = 1 WHERE id = ?').run(p.id);
    } else {
      // Compress: extractive summary
      const sentences = p.content.split(/[。！？.!?\n]+/).filter(s => s.trim().length > 5);
      const first = sentences[0] || p.content;
      const keyTerms = p.content.match(/[^\s]{4,}/g) || [];
      const uniqTerms = [...new Set(keyTerms)].slice(0, 10);
      summaries.push({
        id: p.id,
        page_key: p.page_key,
        summary: first.trim().slice(0, 200),
        key_terms: uniqTerms,
        access_count: p.access_count,
      });
      db.prepare('UPDATE ephemeral_pages SET is_hot = 0, summary = ? WHERE id = ?')
        .run(JSON.stringify(summaries[summaries.length - 1]), p.id);
    }
  }

  return { pages, summaries, promotedDrafts };
}

// ─── Canary Knowledge Pipeline ────────────────────────────────────────────────

/**
 * Stage 1 — Instant Draft Write
 * Immediately write a raw draft to draft_atoms (fast path, no LLM).
 * Use for any new knowledge that needs validation before committing.
 *
 * @param {string} content     - Raw content
 * @param {string} namespace   - Optional namespace (default 'default')
 * @param {number} importance  - Optional importance 0-1 (default 0.5)
 * @returns {Object} draft atom record
 */
function ingestDraft(content, namespace = 'default', importance = 0.5) {
  const db = getDb();
  const id = uuid();
  const ts = now();
  db.prepare(`
    INSERT INTO draft_atoms (id, content, namespace, importance, status, canary_utility, error_count, created_at)
    VALUES (?, ?, ?, ?, 'DRAFT', 0, 0, ?)
  `).run(id, content, namespace, importance, ts);
  return { id, content, namespace, importance, status: 'DRAFT', created_at: ts };
}

/**
 * Stage 2 — Shadow Compiler (async)
 * Compile a DRAFT → CANARY. Runs in background — marks atom as CANARY status.
 * The actual shadow compilation (re-embedding + regression) is done by the caller
 * which may be a background worker. This function just transitions the status.
 *
 * @param {string} draftId   - Draft atom ID
 * @param {Object} metadata  - Optional metadata { canary_utility, error_count }
 * @returns {Object} updated draft atom
 */
function compileDraftToCanary(draftId, metadata = {}) {
  const db = getDb();
  const ts = now();
  const utility = metadata.canary_utility ?? 0;
  const errors  = metadata.error_count ?? 0;

  db.prepare(`
    UPDATE draft_atoms
    SET status = 'CANARY', canary_utility = ?, error_count = ?, shadow_compiled_at = ?
    WHERE id = ? AND status = 'DRAFT'
  `).run(utility, errors, ts, draftId);


  return db.prepare('SELECT * FROM draft_atoms WHERE id = ?').get(draftId);
}

/**
 * Stage 3 — Promote CANARY → VERIFIED
 * Called after passing regression tests. The atom graduates to verified status
 * and is ready for full commit to memory_atom.
 *
 * @param {string} canaryId - Canary atom ID
 * @returns {Object} updated atom
 */
function promoteCanaryToVerified(canaryId) {
  const db = getDb();
  const ts = now();

  db.prepare(`
    UPDATE draft_atoms
    SET status = 'VERIFIED'
    WHERE id = ? AND status = 'CANARY'
  `).run(canaryId);

  return db.prepare('SELECT * FROM draft_atoms WHERE id = ?').get(canaryId);
}

/**
 * Rollback: demote any atom (DRAFT/CANARY/VERIFIED) → DEPRECATED
 * Archives to deprecated_lessons for audit trail.
 *
 * @param {string} atomId - Draft atom ID
 * @param {string} reason - Deprecation reason
 * @returns {Object} deprecated record
 */
function demoteToDeprecated(atomId, reason) {
  const db = getDb();
  const atom = db.prepare('SELECT * FROM draft_atoms WHERE id = ?').get(atomId);
  if (!atom) return null;

  const depId = uuid();
  const ts = now();

  db.prepare(`
    INSERT INTO deprecated_lessons (id, atom_id, content, namespace, deprecation_reason, deprecated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(depId, atomId, atom.content, atom.namespace, reason, ts);

  db.prepare('DELETE FROM draft_atoms WHERE id = ?').run(atomId);

  return { id: depId, atom_id: atomId, reason, deprecated_at: ts };
}


// ─── P0: Tiered Session Injection ───────────────────────────────────────────────
//
// Tiered Timeline Retrieval for new Session:
//   Layer 1 (user_profile): 全量注入，System Prompt 最顶部
//   Layer 2 (raw_atoms L0):  24-48h 时间窗口，Top-K 相似度
//   Layer 3 (wiki_blocks L1): 全局向量召回，Top-K 语义匹配
//
// 返回组装好的 System Prompt 片段。

/**
 * 获取所有活跃的 user_profile 标签（全量注入）
 * @returns {Array} [{ id, tag, content, importance }]
 */
function getUserProfileTags() {
  const db = getDb();
  return db.prepare(`
    SELECT id, tag, content, importance, namespace
    FROM user_profile
    WHERE active = 1
    ORDER BY importance DESC
  `).all();
}

/**
 * 添加或更新 user_profile 标签
 * @param {Object} opts { tag, content, importance, namespace }
 * @returns {Object} { id, tag, content }
 */
function upsertUserProfileTag(opts = {}) {
  if (!opts.tag || !opts.content) throw new Error('[user_profile] tag and content required');
  const db = getDb();
  const id = opts.id || uuid();
  const ts = now();
  const namespace = opts.namespace || 'user';
  const importance = opts.importance ?? 0.9;

  const existing = db.prepare('SELECT id FROM user_profile WHERE tag = ?').get(opts.tag);
  if (existing) {
    db.prepare(`
      UPDATE user_profile SET content=?, importance=?, namespace=?, updated_at=?
      WHERE tag = ?
    `).run(opts.content, importance, namespace, ts, opts.tag);
    return { id: existing.id, tag: opts.tag, content: opts.content, importance };
  }
  db.prepare(`
    INSERT INTO user_profile (id, tag, content, importance, namespace, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, opts.tag, opts.content, importance, namespace, ts, ts);
  return { id, tag: opts.tag, content: opts.content, importance };
}

/**
 * 获取最近 24-48 小时的 raw atoms（L0）
 * @param {number} windowHours 默认 48
 * @param {number} topK 默认 5
 * @returns {Array} atom rows
 */
function getRecentRawAtoms(windowHours = 48, topK = 5) {
  const db = getDb();
  const cutoff = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();
  return db.prepare(`
    SELECT id, content, confidence, importance, namespace, created_at,
           human_pin, tier
    FROM memory_atom
    WHERE created_at >= ?
    ORDER BY importance DESC
    LIMIT ?
  `).all(cutoff, topK);
}

/**
 * 获取 wiki_blocks（L1）全局向量召回
 * @param {string} query 检索词
 * @param {number} topK 默认 5
 * @returns {Promise<Array>} wiki_blocks rows
 */
async function getWikiBlocksForSession(query, topK = 5) {
  // 如果有 embedding 就用向量搜索，否则用重要性排序兜底
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, content, topic, importance, namespace, source_ids, created_at
    FROM wiki_blocks
    WHERE status = 'active'
    ORDER BY importance DESC
    LIMIT ?
  `).all(topK * 3); // 先多取一些，后面 filter

  if (rows.length === 0) return [];

  // 向量相似度（如果 query embedding 可用）
  let queryEmb = null;
  try {
    const embs = await ollamaEmbed(query);
    queryEmb = embs[0];
  } catch(e) {
    // Ollama 不可用，降级为重要性排序
  }

  let scored = rows;
  if (queryEmb) {
    scored = rows.map(row => {
      if (!row.embedding) return { ...row, cos_sim: 0 };
      try {
        const atomEmb = JSON.parse(row.embedding);
        return { ...row, cos_sim: cosineSim(queryEmb, atomEmb) };
      } catch { return { ...row, cos_sim: 0 }; }
    }).sort((a, b) => b.cos_sim - a.cos_sim);
  }

  return scored.slice(0, topK);
}

/**
 * Tiered Session Injection — 组装 System Prompt 片段
 *
 * @param {string} query 用户第一句话
 * @param {Object} opts { rawWindowHours, rawTopK, wikiTopK, includeProfile }
 * @returns {Promise<Object>} { profile, raw_atoms, wiki_blocks, assembled_prompt }
 */
async function sessionInject(query, opts = {}) {
  const {
    rawWindowHours = 48,
    rawTopK = 5,
    wikiTopK = 5,
    includeProfile = true,
  } = opts;

  const profile = includeProfile ? getUserProfileTags() : [];
  const rawAtoms = getRecentRawAtoms(rawWindowHours, rawTopK);
  const wikiBlocks = await getWikiBlocksForSession(query, wikiTopK);

  // 组装 System Prompt 片段
  const parts = [];

  if (profile.length > 0) {
    const profileLines = profile.map(p =>
      `- [${p.tag}] ${p.content}`
    ).join('\n');
    parts.push(`[最高指令：用户画像与协作偏好 (User Profile)]\n${profileLines}`);
  }

  if (rawAtoms.length > 0) {
    const rawLines = rawAtoms.map(a =>
      `- ${a.content} ${a.namespace !== 'default' ? `((${a.namespace}))` : ''}`
    ).join('\n');
    parts.push(`[📌 近期上下文 (过去 ${rawWindowHours}h 的未归档碎片)]\n${rawLines}`);
  }

  if (wikiBlocks.length > 0) {
    const wikiLines = wikiBlocks.map(b =>
      `- ${b.content}${b.topic ? ` [主题: ${b.topic}]` : ''}`
    ).join('\n');
    parts.push(`[📚 底层知识库 (已验证的过往经验)]\n${wikiLines}`);
  }

  const assembled_prompt = parts.length > 0
    ? '[系统提示：为了更好地回答本次问题，系统提取了以下历史记忆]\n\n' + parts.join('\n\n')
    : '';

  return {
    profile,
    raw_atoms: rawAtoms,
    wiki_blocks: wikiBlocks,
    assembled_prompt,
  };
}

/**
 * 将对话摘要写入 raw_atoms（L0）
 * 用于对话结束时的 summarizer
 *
 * @param {string} summary 对话摘要文本
 * @param {Object} opts { namespace, confidence, tags }
 * @returns {Object} 新增的 atom
 */
function writeDialogSummary(summary, opts = {}) {
  if (!summary || summary.trim().length < 5) return null;
  const namespace = opts.namespace || 'dialog';
  const tags = opts.tags || [];
  const content = tags.length > 0
    ? `[${tags.join(', ')}] ${summary}`
    : summary;
  return ingestAtom({
    content,
    namespace,
    confidence: opts.confidence ?? 0.6,
    human_pin: 0,
    atom_type: 'dialog-summary',
  });
}

// ─── Export ───────────────────────────────────────────────────────────────────

module.exports = {
  ingestAtom,
  ingestAtomWithEmbedding,
  ingestAtomWithClaims,
  ingestClaim,
  ingestRelation,
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
  vecSearch,
  getDb,
  getClaimsForAtom,
  getRelationsForAtom,
  drillDown,
  runTierMaintenance,
  ecvGaussianPerturbation,
  measurementCollapse,
  extractClaims,
  extractCausalTriplets,
  projected_skills: {
    projectSkill: null, // defined in star-soul-core.js pipeline
    getSkillForParadigm,
    listProjectedSkills,
  },
  // Scratchpad / Ephemeral Pages
  writeScratchpadPage,
  getScratchpadPages,
  getScratchpadLRU,
  enforceScratchpadBudget,
  pageFaultSwapIn,
  touchScratchpadPage,
  swapOutScratchpad,
  swapInScratchpad,
  compressSessionScratchpad,
  // Canary Knowledge Pipeline
  ingestDraft,
  compileDraftToCanary,
  promoteCanaryToVerified,
  demoteToDeprecated,
  // P0: Tiered Session Injection
  getUserProfileTags,
  upsertUserProfileTag,
  getRecentRawAtoms,
  getWikiBlocksForSession,
  sessionInject,
  writeDialogSummary,
};