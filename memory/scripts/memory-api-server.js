/**
 * Memory Planet REST API Server — M4 Implementation
 * 
 * PM2-managed HTTP API server for star-soul-core and atoms-db.
 * Exposes: recall, ingest, claims, relations, dream-micro, dream-deep, evolve, status.
 * 
 * Usage:
 *   node memory-api-server.js [--port 3000]
 *   pm2 start ecosystem.config.js --env production
 */

'use strict';

const http = require('http');
const path = require('path');

// ─── Args ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1'; // localhost-only by default

// ─── Dynamic requires (lazy) ────────────────────────────────────────────────

let atomsDb, sscRunner;

try {
  atomsDb = require('./atoms-db.js');
} catch(e) {
  console.error('[API] Failed to load atoms-db.js:', e.message);
  process.exit(1);
}

try {
  sscRunner = require('./star-soul-core-runner.js');
} catch(e) {
  console.warn('[API] star-soul-core-runner.js not available:', e.message);
  sscRunner = null;
}

// ─── JSON helpers ────────────────────────────────────────────────────────────

function json(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'X-Powered-By': 'MemoryPlanet-M4' });
  res.end(JSON.stringify(data, null, 2));
}

function ok(res, data) { json(res, 200, { ok: true, ts: new Date().toISOString(), ...data }); }
function created(res, data) { json(res, 201, { ok: true, created: true, ts: new Date().toISOString(), ...data }); }
function err(res, statusCode, message, code) {
  json(res, statusCode, { ok: false, error: message, code: code || 'INTERNAL_ERROR', ts: new Date().toISOString() });
}

// ─── body parser ────────────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.headers['content-type'] !== 'application/json') {
      reject(new Error('Content-Type must be application/json'));
      return;
    }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch(e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// ─── Route: / ───────────────────────────────────────────────────────────────

function handleRoot(req, res) {
  ok(res, {
    service: 'Memory Planet API',
    version: '1.0.0',
    endpoints: [
      'GET  /api/health              — health check',
      'GET  /api/status              — full system status',
      'GET  /api/recall?q=<query>    — hybrid recall (keyword + embedding)',
      'GET  /api/vec-search?q=<query> — pure vector KNN via sqlite-vec',
      'POST /api/atoms/ingest        — ingest new atom',
      'POST /api/atoms/claim         — add claim to atom',
      'POST /api/atoms/relation      — add relation between atoms',
      'GET  /api/atoms/:id           — get atom by id',
      'GET  /api/entropy-status      — cognitive entropy diagnostics',
      'POST /api/dream-micro         — run importance recalc (dream-micro)',
      'POST /api/dream-deep          — run tier maintenance (dream-deep)',
      'POST /api/evolve              — trigger entropy-driven evolution',
    ],
  });
}

// ─── Route: /api/health ─────────────────────────────────────────────────────

function handleHealth(req, res) {
  try {
    const db = atomsDb.getDb();
    const row = db.prepare('SELECT COUNT(*) as cnt FROM memory_atom').get();
    ok(res, { status: 'healthy', db_atoms: row.cnt, uptime: process.uptime() });
  } catch(e) {
    err(res, 503, e.message, 'DB_UNAVAILABLE');
  }
}

// ─── Route: /api/status ─────────────────────────────────────────────────────

async function handleStatus(req, res) {
  if (!sscRunner) { err(res, 503, 'SSC not available', 'SSC_UNAVAILABLE'); return; }
  try {
    const status = sscRunner.status();
    ok(res, { status });
  } catch(e) {
    err(res, 500, e.message, 'STATUS_FAILED');
  }
}

// ─── Route: /api/recall ─────────────────────────────────────────────────────

async function handleRecall(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const query = url.searchParams.get('q') || url.searchParams.get('query');
  const top = Math.min(50, parseInt(url.searchParams.get('top') || '5', 10));

  if (!query) { err(res, 400, 'Missing query param: q', 'MISSING_PARAM'); return; }

  try {
    const results = await atomsDb.hybridRecall(query, top, { minScore: 0.3 });
    ok(res, { query, top, count: results.length, results });
  } catch(e) {
    err(res, 500, e.message, 'RECALL_FAILED');
  }
}

// ─── Route: /api/vec-search (M1.5 — pure vector KNN via sqlite-vec) ──────────

// Falls back to local JS cosine sim if sqlite-vec is unavailable

async function handleVecSearch(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const query = url.searchParams.get('q') || url.searchParams.get('query');
  const top = Math.min(50, parseInt(url.searchParams.get('top') || '5', 10));

  if (!query) { err(res, 400, 'Missing query param: q', 'MISSING_PARAM'); return; }


  try {
    const results = await atomsDb.vecSearch(query, top);
    ok(res, { query, top, count: results.length, results });
  } catch(e) {
    err(res, 500, e.message, 'VEC_SEARCH_FAILED');
  }
}

// ─── Route: /api/atoms/ingest ───────────────────────────────────────────────

async function handleIngest(req, res) {
  let body;
  try { body = await parseBody(req); }
  catch(e) { err(res, 400, e.message, 'INVALID_JSON'); return; }

  const { content, confidence, namespace, human_pin, claims, relations } = body;
  if (!content) { err(res, 400, 'Missing required field: content', 'MISSING_FIELD'); return; }

  try {
    const id = atomsDb.ingestAtomWithClaims(content, {
      confidence: confidence || 0.5,
      namespace: namespace || 'default',
      human_pin: human_pin || 0,
      claims: claims || [],
      relations: relations || [],
    });
    created(res, { id, content: content.slice(0, 80) });
  } catch(e) {
    err(res, 500, e.message, 'INGEST_FAILED');
  }
}

// ─── Route: /api/atoms/:id ──────────────────────────────────────────────────

function handleGetAtom(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 1];

  try {
    const db = atomsDb.getDb();
    const atom = db.prepare('SELECT * FROM memory_atom WHERE id = ?').get(id);
    if (!atom) { err(res, 404, `Atom ${id} not found`, 'NOT_FOUND'); return; }

    const claims = db.prepare('SELECT * FROM claims WHERE atom_id = ?').all(id);
    const relations = db.prepare(
      'SELECT * FROM relations WHERE source_id = ? OR target_id = ?'
    ).all(id, id);

    ok(res, { atom, claims, relations });
  } catch(e) {
    err(res, 500, e.message, 'GET_ATOM_FAILED');
  }
}

// ─── Route: /api/atoms/claim ────────────────────────────────────────────────

async function handleAddClaim(req, res) {
  let body;
  try { body = await parseBody(req); }
  catch(e) { err(res, 400, e.message, 'INVALID_JSON'); return; }

  const { atom_id, subject, predicate, object, conceptual_depth } = body;
  if (!atom_id || !subject || !predicate || !object) {
    err(res, 400, 'Missing required fields: atom_id, subject, predicate, object', 'MISSING_FIELD'); return;
  }

  try {
    const id = atomsDb.ingestClaim(atom_id, subject, predicate, object, conceptual_depth);
    created(res, { id, atom_id, subject, predicate, object });
  } catch(e) {
    err(res, 500, e.message, 'ADD_CLAIM_FAILED');
  }
}

// ─── Route: /api/atoms/relation ─────────────────────────────────────────────

async function handleAddRelation(req, res) {
  let body;
  try { body = await parseBody(req); }
  catch(e) { err(res, 400, e.message, 'INVALID_JSON'); return; }

  const { source_id, target_id, relation_type, weight } = body;
  if (!source_id || !target_id || !relation_type) {
    err(res, 400, 'Missing required fields: source_id, target_id, relation_type', 'MISSING_FIELD'); return;
  }

  try {
    atomsDb.ingestRelation(source_id, target_id, relation_type, weight || 1.0);
    created(res, { source_id, target_id, relation_type, weight: weight || 1.0 });
  } catch(e) {
    err(res, 500, e.message, 'ADD_RELATION_FAILED');
  }
}

// ─── Route: /api/entropy-status ────────────────────────────────────────────

async function handleEntropyStatus(req, res) {
  if (!sscRunner) { err(res, 503, 'SSC not available', 'SSC_UNAVAILABLE'); return; }
  try {
    const status = sscRunner.entropyStatus();
    ok(res, { entropy: status });
  } catch(e) {
    err(res, 500, e.message, 'ENTROPY_STATUS_FAILED');
  }
}

// ─── Route: /api/dream-micro ────────────────────────────────────────────────

async function handleDreamMicro(req, res) {
  if (!sscRunner) { err(res, 503, 'SSC not available', 'SSC_UNAVAILABLE'); return; }
  try {
    const result = sscRunner.dreamMicro();
    ok(res, { action: 'dream-micro', result, note: 'Importance recalc for all atoms' });
  } catch(e) {
    err(res, 500, e.message, 'DREAM_MICRO_FAILED');
  }
}

// ─── Route: /api/dream-deep ─────────────────────────────────────────────────

async function handleDreamDeep(req, res) {
  if (!sscRunner) { err(res, 503, 'SSC not available', 'SSC_UNAVAILABLE'); return; }
  try {
    const result = sscRunner.dreamDeep();
    ok(res, { action: 'dream-deep', result, note: 'Tier maintenance: promote/demote atoms' });
  } catch(e) {
    err(res, 500, e.message, 'DREAM_DEEP_FAILED');
  }
}

// ─── Route: /api/evolve ─────────────────────────────────────────────────────

async function handleEvolve(req, res) {
  if (!sscRunner) { err(res, 503, 'SSC not available', 'SSC_UNAVAILABLE'); return; }
  try {
    const result = await sscRunner.entropyTriggeredEvolve();
    ok(res, { action: 'evolve', result });
  } catch(e) {
    err(res, 500, e.message, 'EVOLVE_FAILED');
  }
}

// ─── Router ────────────────────────────────────────────────────────────────

const ROUTES = [
  { method: 'GET',    path: '/',                        handler: handleRoot },
  { method: 'GET',    path: '/api/health',              handler: handleHealth },
  { method: 'GET',    path: '/api/status',              handler: handleStatus },
  { method: 'GET',    path: '/api/recall',              handler: handleRecall },
  { method: 'GET',    path: '/api/vec-search',        handler: handleVecSearch },
  { method: 'POST',   path: '/api/atoms/ingest',       handler: handleIngest },
  { method: 'GET',    path: '/api/atoms/',             handler: handleGetAtom },  // :id appended
  { method: 'POST',   path: '/api/atoms/claim',         handler: handleAddClaim },
  { method: 'POST',   path: '/api/atoms/relation',      handler: handleAddRelation },
  { method: 'GET',    path: '/api/entropy-status',      handler: handleEntropyStatus },
  { method: 'POST',   path: '/api/dream-micro',         handler: handleDreamMicro },
  { method: 'POST',   path: '/api/dream-deep',          handler: handleDreamDeep },
  { method: 'POST',   path: '/api/evolve',              handler: handleEvolve },
  { method: 'GET',    path: '/api/context-watermark',  handler: handleContextWatermark },
  { method: 'POST',   path: '/api/context-watermark',  handler: handleContextWatermarkUpdate },
];

function matchRoute(method, pathname) {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    if (route.path === '/') { if (pathname === '/') return route; continue; }
    if (route.path === '/api/atoms/') {
      if (pathname.startsWith('/api/atoms/') && pathname !== '/api/atoms/') return route;
      continue;
    }
    if (pathname === route.path) return route;
  }
  return null;
}

// ─── Server ─────────────────────────────────────────────────────────────────

// ─── Context Watermark Monitor (P1 — Memory Paging) ──────────────────────────
// Tracks context token usage per session and triggers scratchpad page swaps.
// When context window > 70% → swap out lowest-access hot pages
// When context window < 30% → optionally swap in recently accessed cold pages

const MAX_TOKEN_ESTIMATE = 128000; // conservative context window size
const HIGH_WATERMARK = 0.70;       // trigger swap-out when > 70%
const LOW_WATERMARK  = 0.30;       // optionally swap-in when < 30%
const DEFAULT_MAX_HOT_PAGES = 20;  // budget per session

/**
 * Track context token usage for a session.
 * Call this on every user turn to keep watermark current.
 *
 * @param {string} sessionId - Session ID
 * @param {number} tokenCount - Estimated token count in current context
 * @returns {Object} { sessionId, tokenCount, watermark, action: string|null }
 */
function updateContextWatermark(sessionId, tokenCount) {
  if (!ctxWatermarkStore[sessionId]) {
    ctxWatermarkStore[sessionId] = { tokens: 0, lastUpdate: Date.now() };
  }
  ctxWatermarkStore[sessionId].tokens = tokenCount;
  ctxWatermarkStore[sessionId].lastUpdate = Date.now();

  const watermark = tokenCount / MAX_TOKEN_ESTIMATE;
  let action = null;

  if (watermark > HIGH_WATERMARK) {
    // Trigger swap-out: evict lowest-access pages
    const result = atomsDb.enforceScratchpadBudget(sessionId, Math.floor(DEFAULT_MAX_HOT_PAGES * (1 - (watermark - HIGH_WATERMARK) / 0.3)));
    action = `swap_out:${result.evicted.length} pages`;
  } else if (watermark < LOW_WATERMARK) {
    // Optional swap-in: bring in recently accessed cold pages
    const cold = atomsDb.getScratchpadLRU(sessionId);
    if (cold.length > 0) {
      const toSwapIn = cold.slice(-Math.min(3, cold.length)).map(p => p.id);
      atomsDb.swapInScratchpad(toSwapIn);
      action = `swap_in:${toSwapIn.length} pages`;
    }
  }

  return { sessionId, tokenCount, watermark: Math.round(watermark * 100) + '%', action };
}

/**
 * Get current watermark status for a session.
 */
function getContextWatermark(sessionId) {
  const entry = ctxWatermarkStore[sessionId];
  if (!entry) return { sessionId, watermark: '0%', tokens: 0 };
  const watermark = entry.tokens / MAX_TOKEN_ESTIMATE;
  return {
    sessionId,
    tokens: entry.tokens,
    watermark: Math.round(watermark * 100) + '%',
    level: watermark > HIGH_WATERMARK ? 'HIGH' : watermark < LOW_WATERMARK ? 'LOW' : 'NORMAL',
  };
}

// Module-level store (resets on server restart — intentional)
const ctxWatermarkStore = {};

// ─── Route: /api/context-watermark (P1 — Memory Paging) ───────────────────────

function handleContextWatermark(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('session_id') || 'default';
  const status = getContextWatermark(sessionId);
  ok(res, status);
}

async function handleContextWatermarkUpdate(req, res) {
  let body;
  try { body = await parseBody(req); }
  catch(e) { err(res, 400, e.message, 'INVALID_JSON'); return; }

  const { session_id, token_count } = body;
  if (!session_id || token_count == null) {
    err(res, 400, 'Missing required fields: session_id, token_count', 'MISSING_FIELD'); return;
  }

  try {
    const result = updateContextWatermark(session_id, parseInt(token_count, 10));
    ok(res, result);
  } catch(e) {
    err(res, 500, e.message, 'WATERMARK_UPDATE_FAILED');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS preflight (localhost only)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end();
    return;
  }

  const route = matchRoute(req.method, pathname);
  if (!route) {
    err(res, 404, `Route not found: ${method} ${pathname}`, 'NOT_FOUND');
    return;
  }

  try {
    await route.handler(req, res);
  } catch(e) {
    console.error('[API] Handler error:', e);
    err(res, 500, e.message, 'HANDLER_ERROR');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[MemoryPlanet-API] listening on http://${HOST}:${PORT}`);
  console.log(`[MemoryPlanet-API] PID=${process.pid}`);
});

server.on('error', e => {
  console.error('[API] Server error:', e.message);
  process.exit(1);
});

process.on('SIGTERM', () => { server.close(() => { process.exit(0); }); });
process.on('SIGINT',  () => { server.close(() => { process.exit(0); }); });