'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Logging ─────────────────────────────────────────────────────────────────
const LOG_DIR = path.join(__dirname, '..', '.dreams');
const LOG_FILE = path.join(LOG_DIR, 'streaming_compact.log');

function log(...args) {
  const msg = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(msg);
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, msg + '\n');
  } catch (_) {}
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { recentTurnsPreserve: 3, maxAgeMs: 30 * 60 * 1000, writeLockTimeoutMs: 5000, dryRun: false };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--recentTurnsPreserve' && args[i + 1] !== undefined) opts.recentTurnsPreserve = parseInt(args[++i], 10);
    else if (args[i] === '--maxAgeMs' && args[i + 1] !== undefined) opts.maxAgeMs = parseInt(args[++i], 10);
    else if (args[i] === '--writeLockTimeoutMs' && args[i + 1] !== undefined) opts.writeLockTimeoutMs = parseInt(args[++i], 10);
    else if (args[i] === '--dryRun') opts.dryRun = true;
    else if (!opts.filePath && !args[i].startsWith('--')) opts.filePath = args[i];
  }
  return opts;
}

// ─── Lock Detection ──────────────────────────────────────────────────────────
function detectLock(sessionFilePath) {
  const lockExtensions = ['.lock', '.writing', '.write.lock'];
  const dir = path.dirname(sessionFilePath);
  const base = path.basename(sessionFilePath, '.jsonl');
  for (const ext of lockExtensions) {
    const lockPath = path.join(dir, base + ext);
    if (fs.existsSync(lockPath)) return lockPath;
  }
  return null;
}

function waitForLock(sessionFilePath, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!detectLock(sessionFilePath)) return true;
    fs.readFileSync(sessionFilePath, 'utf8'); // probe-read to check liveliness
    const sleep = 200;
    if (Date.now() - start + sleep > timeoutMs) break;
    sleepSync(sleep);
  }
  return false;
}

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}

// ─── Core ────────────────────────────────────────────────────────────────────
/**
 * streamingCompact – fast truncate Phase 1; optional lightweight Phase 2.
 *
 * @param {string} sessionFilePath
 * @param {object} opts
 * @returns {{ compacted: boolean, keptTurns: number, droppedTurns: number,
 *             newFile: string, pendingFile: string }}
 */
function streamingCompact(sessionFilePath, opts) {
  const {
    recentTurnsPreserve = 3,
    maxAgeMs = 30 * 60 * 1000,
    writeLockTimeoutMs = 5000,
    dryRun = false,
  } = opts;

  log(`streamingCompact: ${sessionFilePath}`);
  log(`  recentTurnsPreserve=${recentTurnsPreserve} maxAgeMs=${maxAgeMs} dryRun=${dryRun}`);

  // 1. Lock check
  const lockPath = detectLock(sessionFilePath);
  if (lockPath) {
    log(`  lock detected: ${lockPath}`);
    if (!waitForLock(sessionFilePath, writeLockTimeoutMs)) {
      throw new Error(`WRITE_LOCK_TIMEOUT after ${writeLockTimeoutMs}ms`);
    }
    log(`  lock released (waited ${writeLockTimeoutMs}ms)`);
  }

  // 2. Read all JSONL lines
  const rawLines = fs.readFileSync(sessionFilePath, 'utf8').split('\n').filter(l => l.trim());
  const entries = [];
  for (const line of rawLines) {
    try { entries.push(JSON.parse(line)); } catch (_) { /* skip malformed */ }
  }
  log(`  read ${entries.length} entries`);

  // 3. Build parent→children map
  const children = new Map();
  for (const e of entries) {
    if (e.parentId) {
      if (!children.has(e.parentId)) children.set(e.parentId, []);
      children.get(e.parentId).push(e.id);
    }
  }

  // 4. Find user message ids (turn roots)
  //    Walk all descendants of an entry
  function getDescendants(id) {
    const result = new Set();
    const queue = [id];
    while (queue.length) {
      const curr = queue.shift();
      const kids = children.get(curr) || [];
      for (const k of kids) {
        if (!result.has(k)) {
          result.add(k);
          queue.push(k);
        }
      }
    }
    return result;
  }

  //    A turn = user message + ALL its descendants
  //    Identify user messages: type="message" && message.role="user"
  const userMsgIds = new Set();
  for (const e of entries) {
    if (e.type === 'message' && e.message && e.message.role === 'user') {
      userMsgIds.add(e.id);
    }
  }

  //    Sort user message ids by their index in entries (ascending = oldest first)
  const userMsgIndex = new Map();
  entries.forEach((e, i) => userMsgIndex.set(e.id, i));
  const sortedUserMsgs = [...userMsgIds].sort((a, b) => userMsgIndex.get(a) - userMsgIndex.get(b));

  // 5. Group entries into turns
  const turns = []; // array of { userMsgId, entryIds }
  for (const uid of sortedUserMsgs) {
    const entryIds = new Set([uid]);
    const desc = getDescendants(uid);
    desc.forEach(id => entryIds.add(id));
    // Only include entries that actually exist
    const existingIds = new Set(entries.map(e => e.id));
    const validIds = [...entryIds].filter(id => existingIds.has(id));
    if (validIds.length > 0) {
      turns.push({ userMsgId: uid, entryIds: validIds });
    }
  }
  log(`  identified ${turns.length} turns`);

  // 6. Decide cutoff
  const cutoffTime = Date.now() - maxAgeMs;
  const keptTurnsSet = new Set();
  const pendingEntries = [];

  // Always keep the last (most recent) turn even if empty
  let lastTurnIdx = turns.length - 1;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const userEntry = entries.find(e => e.id === turn.userMsgId);
    const turnTime = userEntry ? new Date(userEntry.timestamp).getTime() : 0;
    if (i >= lastTurnIdx - recentTurnsPreserve + 1 || turnTime > cutoffTime) {
      turn.entryIds.forEach(id => keptTurnsSet.add(id));
    } else {
      turn.entryIds.forEach(id => pendingEntries.push(id));
    }
  }

  const keptEntries = entries.filter(e => keptTurnsSet.has(e.id));
  const droppedTurns = turns.length - (lastTurnIdx - recentTurnsPreserve + 1 > 0 ? recentTurnsPreserve : 1);
  const keptTurns = Math.min(recentTurnsPreserve, turns.length);

  log(`  kept ${keptEntries.length} entries / ${keptTurns} turns; dropped ${pendingEntries.length} entries / ${droppedTurns} turns`);

  if (dryRun) {
    const origSize = fs.statSync(sessionFilePath).size;
    log(`  [DRY RUN] would compact: kept=${keptEntries.length}, dropped=${pendingEntries.length}`);
    log(`  [DRY RUN] original size: ${(origSize / 1024).toFixed(1)} KB`);
    return { compacted: false, keptTurns, droppedTurns, newFile: null, pendingFile: null };
  }

  // 7. Build compacted entry
  const lastKept = keptEntries[keptEntries.length - 1];
  const firstKept = keptEntries[0];
  const compactorId = crypto.randomUUID();

  const compactionEntry = {
    type: 'compaction',
    id: compactorId,
    parentId: lastKept ? lastKept.id : null,
    timestamp: new Date().toISOString(),
    firstKeptEntryId: firstKept ? firstKept.id : null,
    tokensBefore: keptEntries.length,
    summary: `Fast truncate: kept last ${keptTurns} turns (${keptEntries.length} entries). Semantic summarization pending.`,
    mode: 'streaming-compact',
  };

  // 8. Write temp file, then rename
  const tmpFile = sessionFilePath + '.compact-tmp.' + process.pid;
  const pendingFile = sessionFilePath + '.compact-pending.' + process.pid + '.jsonl';

  // Write kept entries + compaction entry
  const newContent = [...keptEntries, compactionEntry].map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(tmpFile, newContent, 'utf8');

  // Write pending (dropped) entries
  const pendingContent = entries
    .filter(e => pendingEntries.includes(e.id))
    .map(e => JSON.stringify(e))
    .join('\n') + '\n';
  if (pendingContent.trim()) fs.writeFileSync(pendingFile, pendingContent, 'utf8');

  // 9. Validate temp file
  let valid = false;
  try {
    const lines = fs.readFileSync(tmpFile, 'utf8').split('\n').filter(l => l.trim());
    for (const l of lines) JSON.parse(l);
    valid = lines.length === keptEntries.length + 1;
  } catch (_) { valid = false; }

  if (!valid) {
    fs.unlinkSync(tmpFile);
    throw new Error('Temp file validation failed – rolled back');
  }

  // 10. Atomic rename
  try {
    fs.renameSync(tmpFile, sessionFilePath);
  } catch (err) {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
    throw new Error('RENAME_FAILED: ' + err.message);
  }

  const newSize = fs.statSync(sessionFilePath).size;
  const origSize = fs.existsSync(sessionFilePath + '.bak')
    ? fs.statSync(sessionFilePath + '.bak').size
    : fs.statSync(sessionFilePath).size; // use original before-compact size if we had it

  log(`  compacted: ${keptEntries.length} kept entries, ${pendingEntries.length} pending`);
  log(`  output: ${sessionFilePath} (${(newSize / 1024).toFixed(1)} KB)`);
  log(`  pending: ${pendingFile}`);

  return {
    compacted: true,
    keptTurns,
    droppedTurns,
    newFile: sessionFilePath,
    pendingFile,
  };
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
if (require.main === module) {
  const opts = parseArgs(process.argv);
  if (!opts.filePath) {
    console.error('Usage: node streaming_compact.js <session.jsonl> [--recentTurnsPreserve N] [--maxAgeMs N] [--dryRun]');
    process.exit(1);
  }
  try {
    const result = streamingCompact(opts.filePath, opts);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    log('ERROR:', err.message);
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

module.exports = { streamingCompact };