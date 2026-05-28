#!/usr/bin/env node
/**
 * memory.js — Unified memory maintenance CLI
 *
 * Replaces: flush.ps1, consolidate-memory.{ps1,js}, compact-memory.ps1,
 *           check-consistency.ps1, scan-project.ps1, search-logs.{ps1,js},
 *           build-search-index.ps1
 *
 * Usage: node memory.js <command> [options]
 *
 * Commands:
 *   flush        Session-end checkpoint (writes daily logs + project state)
 *   health      Index drift + MEMORY.md cap check
 *   consolidate Pattern detection from daily logs (3x rule)
 *   search      FTS5 full-text search over daily logs
 *   project     Scan and update project state
 *   compact     Enforce MEMORY.md 200-line hard limit
 *   atoms       List/update atoms.db atoms (M0)
 */

'use strict';

const fs        = require('fs');
const path      = require('path');
const atomsDb   = require('./atoms-db');

// ─── Config ───────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error('config.json not found at ' + CONFIG_PATH);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

const cfg = loadConfig();

// ─── Utilities ────────────────────────────────────────────────────────────────

function log(msg, level = 'INFO') {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log('[' + ts + '] [' + level + '] ' + msg);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
}

function writeLines(filePath, lines) {
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(date) {
  return (date instanceof Date ? date : new Date(date))
    .toISOString().slice(0, 10);
}

// Extract @project:xxx references from content
function extractProjectRefs(content) {
  const refs = new Set();
  const re = /@project:(\w[\w-]*)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    refs.add(m[1]);
  }
  return [...refs];
}

// Read JSON safely
function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// ─── Sub-command: flush ───────────────────────────────────────────────────────

async function cmdFlush(args) {
  const WORKING  = args.includes('--working');
  const BLOCKED  = args.includes('--blocked');
  const NEXT     = args.includes('--next');
  const PROJECTS = args.includes('--projects');
  const LESSONS  = args.includes('--lessons');

  const doAll = !WORKING && !BLOCKED && !NEXT && !PROJECTS && !LESSONS;

  log('Starting flush checkpoint');

  ensureDir(cfg.dailyLogsDir);
  ensureDir(cfg.stateDir);

  const dateStr  = today();
  const logFile  = path.join(cfg.dailyLogsDir, dateStr + '.md');
  const lines    = [];
  const projRefs = new Set();

  if (doAll || WORKING) {
    lines.push('', '## Working Context',
      '_Flushed at: ' + new Date().toISOString() + '_',
      '<!-- @project:working -->', ''
    );
    const memLines = readLines(cfg.memoryFile);
    const active = memLines.filter(l =>
      l.startsWith('[2026-') || l.startsWith('## ') || l.startsWith('- [x]') || l.startsWith('- [ ]')
    );
    lines.push('### Active Items', '');
    for (const line of active.slice(0, 20)) lines.push(line);
  }

  if (doAll || BLOCKED) {
    lines.push('', '## Blocked / Waiting',
      '<!-- @project:blocked -->',
      '_No blocked items recorded yet_', ''
    );
  }

  if (doAll || NEXT) {
    lines.push('', '## Next Actions',
      '<!-- @project:next -->',
      '_No next actions recorded yet_', ''
    );
  }

  if (doAll || PROJECTS) {
    if (fs.existsSync(cfg.stateDir)) {
      const projectFiles = fs.readdirSync(cfg.stateDir).filter(f => f.endsWith('.md'));
      if (projectFiles.length > 0) {
        lines.push('', '## Project States', '');
        for (const pf of projectFiles) {
          const projName = pf.replace('.md', '');
          projRefs.add(projName);
          const content = fs.readFileSync(path.join(cfg.stateDir, pf), 'utf8');
          extractProjectRefs(content).forEach(r => projRefs.add(r));
        }
      }
    }
  }

  if (doAll || LESSONS) {
    lines.push('', '## Lessons Learned',
      '<!-- @project:lessons -->',
      '_No new lessons this session_', ''
    );
  }

  // Append to daily log
  const existing = fs.existsSync(logFile) ? readLines(logFile) : [];
  writeLines(logFile, [...existing, ...lines]);
  log('Daily log written: ' + logFile);

  // Create project state files for newly referenced projects
  for (const projName of projRefs) {
    const projFile = path.join(cfg.stateDir, projName + '.md');
    if (!fs.existsSync(projFile)) {
      const content = [
        '# Project: ' + projName, '',
        '_Created: ' + new Date().toISOString() + '_', '',
        '## Status', '',
        '_No status recorded yet_', '',
        '## Recent Activity', '',
        '_Last updated: ' + new Date().toISOString() + '_'
      ].join('\n');
      fs.writeFileSync(projFile, content, 'utf8');
      log('Project state created: ' + projFile);
    }
  }

  log('Flush checkpoint complete');
}

// ─── Sub-command: health ───────────────────────────────────────────────────────

async function cmdHealth(args) {
  const VERBOSE = args.includes('--verbose');
  const issues  = [];

  log('Running health check');

  // 1. MEMORY.md line count
  if (fs.existsSync(cfg.memoryFile)) {
    const lines = readLines(cfg.memoryFile);
    const count = lines.length;
    if (count > cfg.lineHardLimit) {
      issues.push('MEMORY.md exceeds hard limit: ' + count + '/' + cfg.lineHardLimit + ' lines');
    } else if (count > cfg.lineSoftLimit) {
      issues.push('MEMORY.md exceeds soft limit: ' + count + '/' + cfg.lineSoftLimit + ' lines');
    } else {
      log('MEMORY.md OK: ' + count + '/' + cfg.lineHardLimit + ' lines');
    }
  } else {
    issues.push('MEMORY.md not found');
  }

  // 2. Required directories
  for (const dir of [cfg.dailyLogsDir, cfg.topicsDir, cfg.stateDir]) {
    if (!fs.existsSync(dir)) issues.push('Required directory missing: ' + dir);
  }

  // 3. Topic files referenced in index
  const indexesDir = cfg.indexDir;
  if (fs.existsSync(indexesDir)) {
    const topicsIndex = path.join(indexesDir, 'topics.md');
    if (fs.existsSync(topicsIndex)) {
      const content = fs.readFileSync(topicsIndex, 'utf8');
      const topicRefs = (content.match(/[\w.-]+\/[\w./-]+\.md/g) || [])
        .filter(ref => !ref.includes('YYYY-MM-DD'));
      for (const ref of topicRefs) {
        const fullPath = path.join(cfg.workspaceRoot, ref);
        if (!fs.existsSync(fullPath)) {
          issues.push('Topic file referenced in index but missing: ' + ref);
        }
      }
    }
  }

  // 4. Stale topic files
  if (fs.existsSync(cfg.topicsDir)) {
    const staleMs = Date.now() - cfg.staleDays * 86400000;
    const topicFiles = fs.readdirSync(cfg.topicsDir).filter(f => f.endsWith('.md'));
    for (const tf of topicFiles) {
      const mtime = fs.statSync(path.join(cfg.topicsDir, tf)).mtimeMs;
      if (mtime < staleMs && VERBOSE) {
        log('Stale topic: ' + tf + ' (' + Math.round((Date.now() - mtime) / 86400000) + ' days old)', 'WARN');
      }
    }
  }

  // 5. Daily log count
  if (fs.existsSync(cfg.dailyLogsDir)) {
    const logs = fs.readdirSync(cfg.dailyLogsDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
    log('Daily logs: ' + logs.length + ' files');
  }

  if (issues.length === 0) {
    log('Health check PASSED — no issues found');
  } else {
    issues.forEach(i => log('ISSUE: ' + i, 'WARN'));
  }

  return issues;
}

// ─── Sub-command: consolidate ─────────────────────────────────────────────────

async function cmdConsolidate(args) {
  const dryRun = args.includes('--dry-run');
  let minCount = cfg.patternMinCount;
  const minIdx  = args.indexOf('--min');
  if (minIdx >= 0) minCount = parseInt(args[minIdx + 1]);

  log('Scanning daily logs for patterns (min=' + minCount + ', dry-run=' + dryRun + ')');

  if (!fs.existsSync(cfg.dailyLogsDir)) {
    log('No daily-logs directory found', 'WARN');
    return;
  }

  const patternCounts = new Map();
  const logFiles = fs.readdirSync(cfg.dailyLogsDir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort();

  for (const logFile of logFiles) {
    const content = fs.readFileSync(path.join(cfg.dailyLogsDir, logFile), 'utf8');
    const re = /^\[(\d{4}-\d{2}-\d{2})\]\s+\*\*(.+?)\*\*\s*[-—]/gm;
    let m;
    while ((m = re.exec(content)) !== null) {
      const text = m[2].trim();
      if (text.length < 10) continue;
      if (!patternCounts.has(text)) {
        patternCounts.set(text, { count: 0, files: new Set(), dates: [] });
      }
      const e = patternCounts.get(text);
      e.count++;
      e.files.add(logFile);
      e.dates.push(m[1]);
    }
  }

  const candidates = [...patternCounts.entries()]
    .filter(([, data]) => data.count >= minCount)
    .sort((a, b) => b[1].count - a[1].count);

  if (candidates.length === 0) {
    log('No patterns meeting threshold found');
    return;
  }

  log('Found ' + candidates.length + ' pattern(s) meeting threshold:');
  for (const [pattern, data] of candidates) {
    log('  [' + data.count + 'x] "' + pattern.slice(0, 60) + '" (dates: ' + data.dates.join(', ') + ')');
    if (!dryRun) {
      const candFile = path.join(cfg.dailyLogsDir, '..', 'pattern-candidates.md');
      const entry = [
        '## Pattern Candidate [' + today() + ']',
        '',
        '**Pattern:** ' + pattern,
        '**Count:** ' + data.count + 'x',
        '**Files:** ' + [...data.files].join(', '),
        '**Dates:** ' + data.dates.join(', '),
        ''
      ].join('\n') + '\n';
      const existing = fs.existsSync(candFile) ? fs.readFileSync(candFile, 'utf8') : '';
      fs.writeFileSync(candFile, existing + entry, 'utf8');
      log('  -> Written to pattern-candidates.md');
    }
  }
}

// ─── Sub-command: search ───────────────────────────────────────────────────────

async function cmdSearch(args) {
  const queryIdx = args.indexOf('--query');
  const limitIdx = args.indexOf('--limit');
  const reindex  = args.includes('--reindex');

  if (queryIdx < 0 && !reindex) {
    console.log('Usage: node memory.js search --query <text> [--limit 10]');
    console.log('       node memory.js search --reindex');
    return;
  }

  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (e) {
    log('better-sqlite3 not installed. Run: npm install better-sqlite3 in memory/scripts/', 'ERROR');
    return;
  }

  const dbPath = cfg.searchDbPath;
  ensureDir(path.dirname(dbPath));
  const db = new Database(dbPath);

  db.exec(
    'CREATE VIRTUAL TABLE IF NOT EXISTS logs_fts USING fts5(' +
    '`file`, line_num, `content`, tokenize="unicode61")'
  );

  if (reindex) {
    log('Rebuilding FTS5 index...');
    db.exec('DELETE FROM logs_fts');

    const logFiles = fs.existsSync(cfg.dailyLogsDir)
      ? fs.readdirSync(cfg.dailyLogsDir).filter(f => /\.md$/.test(f))
      : [];

    const insert = db.prepare('INSERT INTO logs_fts (file, line_num, content) VALUES (?, ?, ?)');
    let indexed = 0;
    for (const lf of logFiles) {
      const lines = readLines(path.join(cfg.dailyLogsDir, lf));
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.length < 3) continue;
        insert.run(lf, i + 1, line);
        indexed++;
      }
    }
    log('Indexed ' + indexed + ' lines from ' + logFiles.length + ' files');
    db.close();
    return;
  }

  const query = args[queryIdx + 1];
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 10;

  log('Searching: "' + query + '" (limit=' + limit + ')');

  const stmt = db.prepare(
    'SELECT file, line_num, content FROM logs_fts WHERE logs_fts MATCH ? ORDER BY rank LIMIT ?'
  );
  const results = stmt.all(query, limit);

  if (results.length === 0) {
    log('No results found');
  } else {
    log('Found ' + results.length + ' result(s):');
    for (const r of results) {
      console.log('  [' + r.file + ':' + r.line_num + '] ' + r.content.slice(0, 120));
    }
  }

  db.close();
}

// ─── Sub-command: project ─────────────────────────────────────────────────────

async function cmdProject(args) {
  const pathIdx = args.indexOf('--path');
  if (pathIdx < 0) {
    console.log('Usage: node memory.js project --path <directory>');
    return;
  }

  const projectPath = args[pathIdx + 1];
  if (!fs.existsSync(projectPath)) {
    log('Project path does not exist: ' + projectPath, 'ERROR');
    return;
  }

  const wsRoot = cfg.workspaceRoot.replace(/\\/g, '/');
  const projPathNorm = projectPath.replace(/\\/g, '/');
  if (projPathNorm === wsRoot || projPathNorm === wsRoot + '/') {
    log('Skipping workspace root (not a tracked project). Use --path for actual project directories.', 'WARN');
    return;
  }

  const projectName = path.basename(projectPath);
  ensureDir(cfg.stateDir);
  const outFile = path.join(cfg.stateDir, projectName + '.md');

  log('Scanning project: ' + projectName + ' at ' + projectPath);

  const info = {
    name:     projectName,
    path:     projectPath,
    scannedAt: new Date().toISOString(),
    git:      null,
    dirs:     [],
    files:    [],
    size:     0,
    hasReadme:     false,
    hasPackageJson: false,
    packageJson:   null,
  };

  const gitDir = path.join(projectPath, '.git');
  if (fs.existsSync(gitDir)) {
    info.git = {};
    const headFile = path.join(gitDir, 'HEAD');
    if (fs.existsSync(headFile)) {
      const head = fs.readFileSync(headFile, 'utf8').trim();
      if (head.startsWith('ref: ')) {
        const branch = head.slice(5);
        const branchFile = path.join(gitDir, branch);
        if (fs.existsSync(branchFile)) {
          info.git.branch = branch;
          info.git.commit = fs.readFileSync(branchFile, 'utf8').trim().slice(0, 8);
        }
      } else {
        info.git.detached = true;
      }
    }
  }

  try {
    const entries = fs.readdirSync(projectPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const full = path.join(projectPath, entry.name);
      try {
        const stat = fs.statSync(full);
        info.size += stat.size;
        if (entry.isDirectory()) {
          info.dirs.push(entry.name + '/');
        } else {
          info.files.push({ name: entry.name, size: stat.size });
          if (entry.name === 'README.md') info.hasReadme = true;
          if (entry.name === 'package.json') {
            info.hasPackageJson = true;
            try {
              info.packageJson = JSON.parse(fs.readFileSync(full, 'utf8'));
            } catch { /* skip */ }
          }
        }
      } catch { /* skip inaccessible */ }
    }
  } catch (e) {
    log('Error scanning directory: ' + e.message, 'WARN');
  }

  const lines = [
    '# Project: ' + info.name,
    '',
    '_Scanned: ' + info.scannedAt + '_',
    '',
    '## Overview',
    '',
    '- **Path:** `' + info.path + '`',
    '- **Size:** ' + (info.size / 1024).toFixed(1) + ' KB',
    '- **Git:** ' + (info.git
      ? (info.git.branch ? info.git.branch + ' @ ' + info.git.commit : 'detached HEAD')
      : 'no git'),
    '- **README:** ' + (info.hasReadme ? 'yes' : 'no'),
    '- **package.json:** ' + (info.hasPackageJson ? 'yes' : 'no'),
    '',
    '## Directory Structure',
    '',
    ...info.dirs.map(d => '- `' + d + '`'),
    '',
    '## Key Files',
    '',
    ...info.files.slice(0, 20).map(f => '- `' + f.name + '` (' + (f.size/1024).toFixed(1) + ' KB)'),
  ];

  if (info.packageJson) {
    const pkg = info.packageJson;
    lines.push('', '## package.json', '');
    lines.push('- **Name:** ' + (pkg.name || 'unknown'));
    lines.push('- **Version:** ' + (pkg.version || 'unknown'));
    if (pkg.scripts) {
      lines.push('- **Scripts:**');
      for (const [k, v] of Object.entries(pkg.scripts)) {
        lines.push('  - `' + k + '`: ' + v);
      }
    }
  }

  lines.push('', '_Last updated: ' + new Date().toISOString() + '_');

  fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
  log('Project state written: ' + outFile);
}

// ─── Sub-command: compact ─────────────────────────────────────────────────────

async function cmdCompact(args) {
  const FORCE   = args.includes('--force');
  const DRY_RUN = args.includes('--dry-run');

  if (!fs.existsSync(cfg.memoryFile)) {
    log('MEMORY.md not found', 'ERROR');
    return;
  }

  const lines = readLines(cfg.memoryFile);
  log('MEMORY.md: ' + lines.length + ' lines (hard limit: ' + cfg.lineHardLimit + ')');

  if (lines.length <= cfg.lineHardLimit && !FORCE) {
    log('Within limit, no compaction needed');
    return;
  }

  if (DRY_RUN) {
    log('Would compact ' + lines.length + ' -> target ~' + cfg.lineSoftLimit + ' lines (DRY RUN)');
    return;
  }

  const HEADER = 25;
  const header = lines.slice(0, HEADER);
  const body   = lines.slice(HEADER);

  const compacted = [];
  let blanks = 0;
  for (const line of body) {
    if (line.trim() === '') {
      blanks++;
      if (blanks <= 1) compacted.push(line);
    } else {
      blanks = 0;
      compacted.push(line);
    }
  }

  let result = [...header, ...compacted];

  if (result.length > cfg.lineHardLimit) {
    const removed = [];
    const kept    = [];
    let i = HEADER;
    while (i < result.length) {
      const line = result[i];
      if (/^\[\d{4}-\d{2}-\d{2}\]/.test(line)) {
        const lowPat = /\b(?:activation[:\s]*[01]\d|low activation|minor activation|trivial importance)\b/i;
        if (lowPat.test(line)) {
          const entry = [line];
          i++;
          while (i < result.length && result[i].trim() !== '' && !/^\[\d{4}-\d{2}-\d{2}\]/.test(result[i])) {
            entry.push(result[i]);
            i++;
          }
          removed.push(entry);
          continue;
        }
      }
      kept.push(line);
      i++;
    }
    if (removed.length > 0) {
      removed.forEach(e => log('REMOVED: "' + e[0].slice(0, 80) + '"', 'WARN'));
      log('Removed ' + removed.length + ' low-activation entries');
    }
    result = [...header, ...kept];
  }

  while (result.length > 0 && result[result.length - 1].trim() === '') result.pop();
  result.push('');

  writeLines(cfg.memoryFile, result);
  log('Compacted: ' + lines.length + ' -> ' + result.length + ' lines');
}

// ─── Atoms M0 CLI ──────────────────────────────────────────────────────────

async function cmdAtoms(args) {
  const action = args[0] || 'list';

  if (action === 'list') {
    const limitIdx = args.indexOf('--limit');
    const limit    = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 20;
    const atoms = atomsDb.listAtoms(limit);
    console.log('[OK] atoms.db 有', atoms.length, '条 atom:');
    for (const a of atoms) {
      const age = Math.round((Date.now() - new Date(a.created_at).getTime()) / (1000*60*60*24));
      console.log('  [' + a.importance.toFixed(3) + ']', a.content.slice(0, 60) + (a.content.length > 60 ? '...' : ''),
        '| age:', age + 'd', 'pin:', a.human_pin);
    }
  } else if (action === 'pin') {
    const id = args[1];
    if (!id) { console.error('Usage: node memory.js atoms pin <id>'); process.exit(1); }
    const result = atomsDb.pinAtom(id, 1);
    if (!result.success) {
      console.error('[FAIL] ' + result.error);
      const recents = atomsDb.listAtoms(5);
      console.log('最近 5 条 atom:');
      for (const a of recents) console.log('  ' + a.id + '  ' + a.content.slice(0, 60));
      process.exit(1);
    }
    console.log('[OK] atom', id, '已 pin');
  } else if (action === 'unpin') {
    const id = args[1];
    if (!id) { console.error('Usage: node memory.js atoms unpin <id>'); process.exit(1); }
    const result = atomsDb.pinAtom(id, 0);
    if (!result.success) {
      console.error('[FAIL] atom not found:', id);
      const recents = atomsDb.listAtoms(5);
      console.log('最近 5 条 atom:');
      for (const a of recents) console.log('  ' + a.id + '  ' + a.content.slice(0, 60));
      process.exit(1);
    }
    console.log('[OK] atom', id, '已 unpin');
  } else if (action === 'info') {
    const id = args[1];
    if (!id) { console.error('Usage: node memory.js atoms info <id>'); process.exit(1); }
    const atom = atomsDb.getAtom(id);
    if (!atom) { console.error('Atom not found:', id); process.exit(1); }
    const age = Math.round((Date.now() - new Date(atom.created_at).getTime()) / (1000*60*60*24));
    console.log('=== Atom Info ===');
    console.log('  ID:              ', atom.id);
    console.log('  Content:         ', atom.content);
    console.log('  Namespace:       ', atom.namespace);
    console.log('  Confidence:      ', atom.confidence);
    console.log('  Importance:      ', atom.importance);
    console.log('  Human Pin:      ', atom.human_pin);
    console.log('  Status:          ', atom.status);
    console.log('  Embedding:       ', atom.embedding ? '✓ (' + atom.embedding.length + ' chars)' : '✗');
    console.log('  Created:         ', atom.created_at, '(' + age + 'd ago)');
    console.log('  Updated:         ', atom.updated_at);
  } else if (action === 'recall') {
    const query = args[1];
    if (!query) { console.error('Usage: node memory.js atoms recall "查询词" [--top 5]'); process.exit(1); }
    const topIdx = args.indexOf('--top');
    const topK   = topIdx >= 0 ? parseInt(args[topIdx + 1], 10) : 5;
    const nsIdx  = args.indexOf('--namespace');
    const namespace = nsIdx >= 0 ? args[nsIdx + 1] : undefined;
    const results = await atomsDb.recall(query, topK, namespace ? { namespace } : {});
    console.log('[OK] recall "' + query + '" 返回', results.length, '条:');
    for (const r of results) {
      console.log('  [' + (r.rrf_score||0).toFixed(3) + '](' + r.phase + ')', r.content.slice(0, 80) + (r.content.length > 80 ? '...' : ''));
    }
  } else if (action === 'embed') {
    const query = args[1];
    if (!query) { console.error('Usage: node memory.js atoms embed "查询词" [--top 5]'); process.exit(1); }
    const topIdx = args.indexOf('--top');
    const topK   = topIdx >= 0 ? parseInt(args[topIdx + 1], 10) : 5;
    console.log('[OK] Ollama hybrid search "' + query + '"...');
    const results = await atomsDb.embedSearch(query, topK);
    console.log('[OK] 搜索返回', results.length, '条:');
    for (const r of results) {
      console.log('  [' + (r.rrf_score||0).toFixed(3) + '](' + r.phase + ') cos=' + (r.cos_sim||0).toFixed(3), r.content.slice(0, 80) + (r.content.length > 80 ? '...' : ''));
    }
  } else if (action === 'update-importance') {
    const updated = atomsDb.updateAllImportance();
    console.log('[OK] importance 更新完成，', updated.length, '条 atom 已更新');
  } else if (action === 'conflicts') {
    const conflicts = atomsDb.getConflicts();
    if (!conflicts || conflicts.length === 0) {
      console.log('[OK] 无认知冲突，系统主干稳固 ✅');
    } else {
      console.log('\n⚠️  发现', conflicts.length, '处认知冲突：\n');
      conflicts.forEach((c, i) => {
        console.log('[' + (i+1) + '] ID:', c.id);
        console.log('    来源:', c.origin_agent || 'unknown');
        console.log('    内容:', c.content.slice(0, 80) + (c.content.length > 80 ? '...' : ''));
        console.log('    标签:', c.tags || '');
        console.log('---');
      });
    }
  } else if (action === 'resolve') {
    const winnerId = args[1];
    const loserId  = args[2];
    if (!winnerId || !loserId) { console.error('Usage: memory.js atoms resolve <winner_id> <loser_id>'); process.exit(1); }
    const winnerAtom = atomsDb.getAtom(winnerId);
    const loserAtom  = atomsDb.getAtom(loserId);
    if (!winnerAtom) { console.error('Winner atom not found:', winnerId); process.exit(1); }
    if (!loserAtom)  { console.error('Loser atom not found:', loserId); process.exit(1); }
    console.log('  Winner: ' + winnerId + ' — "' + winnerAtom.content.slice(0, 60) + (winnerAtom.content.length > 60 ? '...' : '') + '"');
    console.log('  Loser:  ' + loserId  + ' — "' + loserAtom.content.slice(0, 60) + (loserAtom.content.length > 60 ? '...' : '') + '"');
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('[y/N]: ', answer => {
      rl.close();
      if (answer.trim().toLowerCase() !== 'y') { console.log('Aborted.'); return; }
      const result = atomsDb.resolveConflict(winnerId, loserId);
      if (!result.success) { console.error('[FAIL]', result.error); process.exit(1); }
      console.log('[OK] 冲突已裁决：winner=Committed, loser=Deprecated');
    });
    return;
  } else if (action === 'wiki-blocks') {
    const nsIdx   = args.indexOf('--namespace');
    const topicIdx = args.indexOf('--topic');
    const limitIdx = args.indexOf('--limit');
    const namespace = nsIdx >= 0 ? args[nsIdx + 1] : undefined;
    const topic    = topicIdx >= 0 ? args[topicIdx + 1] : undefined;
    const limit    = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 20;
    const count = atomsDb.getWikiBlockCount();
    console.log('[OK] wiki_blocks 表有', count, '条 active block');
    const blocks = atomsDb.listWikiBlocks({ namespace, topic, limit });
    if (blocks.length === 0) {
      console.log('  (空，shadow-compile 未运行或无高重要性 atoms)');
    } else {
      console.log('显示 ' + blocks.length + ' 条:');
      for (const b of blocks) {
        const srcIds = (() => { try { return JSON.parse(b.source_ids || '[]').length; } catch { return 0; } })();
        console.log('  [' + b.importance.toFixed(3) + '][' + b.namespace + '] ' + b.content.slice(0, 80) + (b.content.length > 80 ? '...' : ''));
        console.log('    topic=' + (b.topic || 'n/a') + ' src=' + srcIds + ' atoms conf=' + b.confidence.toFixed(2));
      }
    }
  } else {
    console.error('Unknown atoms action:', action);
    console.log('Usage: node memory.js atoms [list|pin|recall|update-importance|wiki-blocks]');
  }
}

// ─── Governance Plane CLI ─────────────────────────────────────────────────────

async function cmdGovernance(args) {
  const action = args[0] || 'list';
  const readline = require('readline');

  if (action === 'list' || action === 'status') {
    const conflicts = atomsDb.getConflicts();
    if (!conflicts || conflicts.length === 0) {
      console.log('\n✅ Memory Planet v2.1 治理平面 — 系统主干稳固，无冲突');
    } else {
      console.log('\n🪐 Memory Planet v2.1 治理平面 — 发现', conflicts.length, '处认知冲突\n');
      conflicts.forEach((c, i) => {
        console.log('[' + (i+1) + '] ──────────────────────────────────────────');
        console.log('    ID:', c.id.slice(0, 8) + '...');
        console.log('    来源Agent:', c.origin_agent || 'system');
        console.log('    会话:', c.session_id || 'n/a');
        console.log('    状态:', c.status);
        console.log('    内容:', c.content.slice(0, 100) + (c.content.length > 100 ? '...' : ''));
        console.log();
      });
      console.log('请用以下命令裁决：');
      console.log('  memory.js governance resolve <winner_id> <loser_id>');
      console.log('  memory.js governance synthesize <id1> <id2> --text "综合结论内容"');
    }
    return;
  }

  if (action === 'resolve') {
    const [winnerId, loserId] = [args[1], args[2]];
    if (!winnerId || !loserId) { console.error('Usage: governance resolve <winner_id> <loser_id>'); process.exit(1); }
    atomsDb.resolveConflict(winnerId, loserId);
    console.log('[OK] 冲突裁决完成 — winner=Committed, loser=Deprecated');
    return;
  }

  if (action === 'synthesize') {
    const [id1, id2] = [args[1], args[2]];
    const textIdx = args.indexOf('--text');
    if (!id1 || !id2 || textIdx < 0) {
      console.error('Usage: governance synthesize <id1> <id2> --text "综合结论"'); process.exit(1);
    }
    const synthesizedContent = args[textIdx + 1];
    if (!synthesizedContent) { console.error('--text 参数需要内容'); process.exit(1); }
    const result = atomsDb.resolveConflictSynthesize(id1, id2, synthesizedContent, 'governance-plane');
    console.log('[OK] 综合裁决完成，生成新atom:', result.id);
    return;
  }

  if (action === 'help') {
    console.log('\n🪐 Memory Planet v2.1 治理平面 CLI');
    console.log('Usage: memory.js governance <action>');
    console.log('');
    console.log('  list/status   — 列出所有 Conflict_Pending 冲突');
    console.log('  resolve <win> <lose>  — 裁决：winner设为Committed，loser标为Deprecated');
    console.log('  synthesize <id1> <id2> --text "综合结论"  — 综合两者生成新结论');
    console.log('  ping  — 测试云端Skeptic连通性');
    return;
  }

  if (action === 'ping') {
    const lg = require('./llm_gateway');
    lg.ping().then(r => {
      if (r.ok) { console.log('[OK] Skeptic连通性正常'); }
      else { console.error('[FAIL] Skeptic故障:', r.reason); }
    }).catch(e => console.error('[ERR]', e.message));
    return;
  }

  console.error('Unknown governance action:', action);
  console.error('Try: list | resolve | synthesize | ping | help');
  process.exit(1);
}

// ─── P0: Session Inject CLI ─────────────────────────────────────────────────
// node memory.js session-inject "用户第一句话" [--raw-window 48] [--raw-topk 5] [--wiki-topk 5]

async function cmdSessionInject(args) {
  const query = args[0];
  if (!query) {
    console.error('Usage: node memory.js session-inject "<query>" [options]');
    console.error('  --raw-window  24-48h 时间窗口（小时），默认 48');
    console.error('  --raw-topk    raw atoms 返回数量，默认 5');
    console.error('  --wiki-topk  wiki blocks 返回数量，默认 5');
    console.error('  --no-profile  跳过 user_profile 注入');
    process.exit(1);
  }

  const rawWindowIdx = args.indexOf('--raw-window');
  const rawTopkIdx   = args.indexOf('--raw-topk');
  const wikiTopkIdx  = args.indexOf('--wiki-topk');
  const noProfile    = args.includes('--no-profile');

  const rawWindow = rawWindowIdx >= 0 ? parseInt(args[rawWindowIdx + 1], 10) : 48;
  const rawTopk   = rawTopkIdx   >= 0 ? parseInt(args[rawTopkIdx + 1], 10)   : 5;
  const wikiTopk  = wikiTopkIdx  >= 0 ? parseInt(args[wikiTopkIdx + 1], 10)  : 5;

  log(`session-inject: query="${query}" rawWindow=${rawWindow}h rawTopk=${rawTopk} wikiTopk=${wikiTopk}`);

  const result = await atomsDb.sessionInject(query, {
    rawWindowHours: rawWindow,
    rawTopK: rawTopk,
    wikiTopK: wikiTopk,
    includeProfile: !noProfile,
  });

  console.log('\n=== USER PROFILE (全量注入) ===');
  if (result.profile.length === 0) {
    console.log('(无活跃标签)');
  } else {
    for (const p of result.profile) {
      console.log(`  [${p.tag}] ${p.content} (importance=${p.importance})`);
    }
  }

  console.log('\n=== RAW ATOMS L0 (最近 ' + rawWindow + 'h) ===');
  if (result.raw_atoms.length === 0) {
    console.log('(无近期碎片)');
  } else {
    for (const a of result.raw_atoms) {
      console.log(`  - ${a.content.slice(0, 80)}${a.content.length > 80 ? '...' : ''} [${a.namespace}] imp=${a.importance.toFixed(2)}`);
    }
  }

  console.log('\n=== WIKI BLOCKS L1 (全局知识) ===');
  if (result.wiki_blocks.length === 0) {
    console.log('(无 wiki blocks，夜间 Shadow Compiler 未生成)');
  } else {
    for (const b of result.wiki_blocks) {
      console.log(`  - ${b.content.slice(0, 80)}${b.content.length > 80 ? '...' : ''} [${b.topic || 'general'}]`);
    }
  }

  console.log('\n=== ASSEMBLED SYSTEM PROMPT ===');
  console.log(result.assembled_prompt || '(空)');
}

// ─── P0: User Profile CLI ─────────────────────────────────────────────────────
// node memory.js profile list|add|remove

async function cmdProfile(args) {
  const action = args[0] || 'list';

  if (action === 'list') {
    const tags = atomsDb.getUserProfileTags();
    console.log(`\n=== User Profile Tags (${tags.length}) ===`);
    if (tags.length === 0) {
      console.log('(空，请用 profile add <tag> <content> 添加)');
    } else {
      for (const t of tags) {
        console.log(`  [${t.tag}] ${t.content} (imp=${t.importance})`);
      }
    }
    return;
  }

  if (action === 'add') {
    const tag = args[1];
    const content = args.slice(2).join(' ');
    if (!tag || !content) {
      console.error('Usage: profile add <tag> <content>');
      process.exit(1);
    }
    const result = atomsDb.upsertUserProfileTag({ tag, content });
    console.log(`[OK] 添加/更新标签: ${result.tag}`);
    return;
  }

  if (action === 'remove') {
    const tag = args[1];
    if (!tag) { console.error('Usage: profile remove <tag>'); process.exit(1); }
    const db = atomsDb.getDb();
    const row = db.prepare('SELECT id FROM user_profile WHERE tag = ?').get(tag);
    if (!row) { console.log(`标签 [${tag}] 不存在`); return; }
    db.prepare('UPDATE user_profile SET active=0 WHERE tag=?').run(tag);
    console.log(`[OK] 软删除标签: ${tag}`);
    return;
  }

  console.error('Unknown action:', action, '(list|add|remove)');
  process.exit(1);
}

// ─── P0: Summarize CLI ────────────────────────────────────────────────────────
// echo "对话内容..." | node memory.js summarize [--tags tag1,tag2]

async function cmdSummarize(args) {
  // 从 stdin 读取对话内容
  let dialogContent = '';
  if (!process.stdin.isTTY) {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) { dialogContent += chunk; }
  }

  const tagsIdx = args.indexOf('--tags');
  const tags = tagsIdx >= 0 ? args[tagsIdx + 1].split(',').map(t => t.trim()) : [];

  if (!dialogContent.trim()) {
    console.error('Usage: echo "对话内容" | node memory.js summarize [--tags tag1,tag2]');
    process.exit(1);
  }

  // 简单启发式摘要（未来可替换为 LLM API 调用）
  const sentences = dialogContent.split(/[。！？.!?\n]+/).filter(s => s.trim().length > 10);
  const summary = sentences.slice(0, 3).join('。').trim();
  const finalSummary = summary.length > 0 ? summary + '。' : dialogContent.slice(0, 200);

  const atom = atomsDb.writeDialogSummary(finalSummary, { tags });
  if (atom) {
    console.log(`[OK] 写入 raw_atom: ${atom.id.slice(0, 8)}...`);
    console.log(`  内容: ${atom.content.slice(0, 100)}...`);
  } else {
    console.log('[SKIP] 内容太短，未写入');
  }
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

const [, , cmd, ...cmdArgs] = process.argv;

// ─── P0: Ingest CLI ───────────────────────────────────────────────────────────
// node memory.js ingest [--file <json> --topic <name>]
// JSON array from stdin or file: [{ title, concept, applicable_scenario, tags[], confidence?, namespace? }]


async function cmdIngest(args) {
  const fileIdx  = args.indexOf('--file');
  const topicIdx = args.indexOf('--topic');


  let atoms = [];
  let topicTitle = 'untitled';

  if (fileIdx >= 0) {
    const filePath = args[fileIdx + 1];
    if (!filePath) { console.error('Usage: ingest --file <json> [--topic <name>]'); process.exit(1); }
    if (!fs.existsSync(filePath)) { console.error('File not found: ' + filePath); process.exit(1); }
    try { atoms = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch(e) {
      console.error('Invalid JSON: ' + e.message); process.exit(1);
    }
    if (topicIdx >= 0) topicTitle = args[topicIdx + 1];
  } else {
    // read from stdin
    process.stdin.setEncoding('utf8');
    let jsonStr = '';
    for await (const chunk of process.stdin) { jsonStr += chunk; }
    try { atoms = JSON.parse(jsonStr); } catch(e) {
      console.error('Invalid JSON from stdin: ' + e.message); process.exit(1);
    }
    if (topicIdx >= 0) topicTitle = args[topicIdx + 1];
  }

  if (!Array.isArray(atoms) || atoms.length === 0) {
    console.error('Expected JSON array of atoms, got: ' + JSON.stringify(atoms).slice(0, 80));
    process.exit(1);
  }

  const ns = args.indexOf('--namespace') >= 0 ? args[args.indexOf('--namespace') + 1] : 'pattern';
  const dryRun = args.includes('--dry-run');

  log('Ingesting ' + atoms.length + ' atom(s) into namespace="' + ns + '"' + (dryRun ? ' (DRY RUN)' : ''));


  // Archive full source markdown to topicsDir
  if (!dryRun) {
    ensureDir(cfg.topicsDir);
    const dateStr  = today();
    const safeName = topicTitle.replace(/[^\w.-]/g, '_');
    const fileName = dateStr + '-' + safeName + '.md';
    const topicPath = path.join(cfg.topicsDir, fileName);
    const mdLines = [
      '# Topic: ' + topicTitle,
      '_Archived: ' + new Date().toISOString() + '_',
      '',
      '## Source Atoms (' + atoms.length + ')',
      ''
    ];
    for (const atom of atoms) {
      mdLines.push('### ' + atom.title);
      mdLines.push('');
      mdLines.push('- **概念**: ' + (atom.concept || ''));
      mdLines.push('- **适用场景**: ' + (atom.applicable_scenario || ''));
      mdLines.push('- **标签**: ' + ((atom.tags || []).join(', ')));
      mdLines.push('- **置信度**: ' + (atom.confidence || 0.6));
      mdLines.push('');
    }
    fs.writeFileSync(topicPath, mdLines.join('\n'), 'utf8');
    log('Archived to topics: ' + fileName);

    // Update MEMORY.md pointer
    const pointerEntry = '\n- **' + dateStr + '** ' + topicTitle + ': `memory/topics/' + fileName + '`  (' + atoms.length + ' atoms)';
    const memLines = readLines(cfg.memoryFile);
    const insertIdx = memLines.findIndex((l, i) => i > 5 && l.trim() === '' && memLines[i+1] && memLines[i+1].trim() === '');
    if (insertIdx > 0) {
      memLines.splice(insertIdx, 0, pointerEntry.trim());
    } else {
      memLines.push(pointerEntry.trim());
    }
    writeLines(cfg.memoryFile, memLines);
    log('Updated MEMORY.md pointer');
  }

  // Batch ingest atoms
  let success = 0, failed = 0;
  for (const atom of atoms) {
    if (!atom.concept && !atom.content) {
      console.warn('  [SKIP] atom missing concept: ' + JSON.stringify(atom).slice(0, 60));
      failed++; continue;
    }
    const content = atom.concept || atom.content;
    if (dryRun) {
      console.log('  [DRY] ' + atom.title + ' → "' + content.slice(0, 60) + '..."');
      success++; continue;
    }
    try {
      const result = await atomsDb.ingestAtomWithEmbedding({
        content,
        confidence: atom.confidence ?? 0.6,
        namespace:  ns,
        atom_type:  'pattern',
        origin_agent: 'memory-cli',
        session_id: process.env.OPENCLAW_SESSION_ID || null,
        trace_id: process.env.OPENCLAW_TRACE_ID || null,
      });
      console.log('  [OK] ' + atom.title + ' → ' + result.id);
      success++;
    } catch(e) {
      console.error('  [FAIL] ' + atom.title + ': ' + e.message);
      failed++;
    }
  }

  log('Done: ' + success + ' ingested, ' + failed + ' failed');
  if (dryRun) log('(DRY RUN — no actual writes)');
}

// ─── P0: Shadow Compiler CLI ─────────────────────────────────────────────────
// node memory.js shadow-compile [--min-importance 0.6]

async function cmdShadowCompile(args) {
  const minIdx = args.indexOf('--min-importance');
  const minImp = minIdx >= 0 ? parseFloat(args[minIdx + 1]) : 0.6;

  if (isNaN(minImp) || minImp < 0 || minImp > 1) {
    console.error('Usage: shadow-compile [--min-importance 0.6]');
    process.exit(1);
  }

  log('Shadow Compiler starting (min-importance=' + minImp + ')');

  const result = await atomsDb.shadowCompile(minImp);

  if (result.errors && result.errors.length > 0) {
    console.log('\n⚠️  Errors during compilation:');
    result.errors.forEach(e => console.log('  - ' + e));
  }

  console.log('\n[OK] Shadow Compiler complete:');
  console.log('  wiki_blocks created : ' + result.created);
  console.log('  duplicates skipped  : ' + result.skipped);

  if (result.created > 0) {
    console.log('\nTop importance blocks:');
    const blocks = atomsDb.listWikiBlocks({ limit: 10 });
    for (const b of blocks) {
      console.log('  [' + b.importance.toFixed(3) + '] ' + b.content.slice(0, 80) + (b.content.length > 80 ? '...' : ''));
    }
  }
}

const COMMANDS = {
  flush:          { fn: cmdFlush,          desc: 'Session-end checkpoint (writes daily logs)' },
  health:         { fn: cmdHealth,         desc: 'Index drift + MEMORY.md cap check' },
  consolidate:    { fn: cmdConsolidate,    desc: 'Pattern detection from daily logs (3x rule)' },
  search:         { fn: cmdSearch,         desc: 'FTS5 full-text search over daily logs' },
  project:        { fn: cmdProject,        desc: 'Scan and update project state' },
  compact:        { fn: cmdCompact,       desc: 'Enforce MEMORY.md 200-line hard limit' },
  atoms:          { fn: cmdAtoms,          desc: 'List/update atoms.db atoms (M0)' },
  governance:     { fn: cmdGovernance,     desc: 'RFC governance workflow (delegates to governance-plane.js)' },
  'session-inject': { fn: cmdSessionInject, desc: 'P0: Tiered session injection (L0/L1/user_profile)' },
  profile:          { fn: cmdProfile,        desc: 'P0: User profile tag management (list/add/remove)' },
  summarize:        { fn: cmdSummarize,      desc: 'P0: Write dialog summary to raw_atoms L0' },
  ingest:           { fn: cmdIngest,         desc: 'Ingest JSON atoms [--file <json> --topic <name>]' },
  'shadow-compile': { fn: cmdShadowCompile,  desc: 'Synthesize wiki blocks from high-importance atoms' },
};

function showHelp() {
  console.log('memory.js — Unified memory maintenance CLI');
  console.log('');
  console.log('Usage: node memory.js <command> [options]');
  console.log('');
  for (const [name, info] of Object.entries(COMMANDS)) {
    console.log('  ' + name.padEnd(14) + info.desc);
  }
  console.log('');
  console.log('Options (general):');
  console.log('  --dry-run       Show what would be done without doing it');
  console.log('  --verbose      Verbose output');
  console.log('');
  console.log('Config: memory/config.json');
}

async function main() {
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    showHelp();
    return;
  }
  const handler = COMMANDS[cmd];
  if (!handler) {
    console.error('Unknown command: ' + cmd);
    showHelp();
    process.exit(1);
  }
  try {
    await handler.fn(cmdArgs);
  } catch (err) {
    log('Error in ' + cmd + ': ' + err.message, 'ERROR');
    if (cmdArgs.includes('--verbose')) console.error(err.stack);
    process.exit(1);
  }
}

main();