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
 */

'use strict';

const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

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
      // Only match path-like refs (contain /) and exclude date patterns
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
    // Match lesson entries: [YYYY-MM-DD] **title** — description
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

  // Create FTS5 virtual table synchronously
  // Use backticks for column names that may be keywords
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

  // Skip if it's the workspace root itself — it's not a project worth tracking
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

  // Git info
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

  // Directory listing (shallow)
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

  // Format output
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

  // Remove excess blank lines (max 1 consecutive)
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

  // If still over limit, remove entries marked as low-activation
  if (result.length > cfg.lineHardLimit) {
    const removed = [];
    const kept    = [];
    let i = HEADER;
    while (i < result.length) {
      const line = result[i];
      if (/^\[\d{4}-\d{2}-\d{2}\]/.test(line)) {
        // Check for low-activation markers
        const lowPat = /\b(?:activation[:\s]*[01]\d|low activation|minor activation|trivial importance)\b/i;
        if (lowPat.test(line)) {
          // Collect full entry
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

  // Trim trailing blanks and ensure final newline
  while (result.length > 0 && result[result.length - 1].trim() === '') result.pop();
  result.push('');

  writeLines(cfg.memoryFile, result);
  log('Compacted: ' + lines.length + ' -> ' + result.length + ' lines');
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

const [, , cmd, ...cmdArgs] = process.argv;

const COMMANDS = {
  flush:       { fn: cmdFlush,       desc: 'Session-end checkpoint (writes daily logs)' },
  health:      { fn: cmdHealth,      desc: 'Index drift + MEMORY.md cap check' },
  consolidate: { fn: cmdConsolidate, desc: 'Pattern detection from daily logs (3x rule)' },
  search:      { fn: cmdSearch,      desc: 'FTS5 full-text search over daily logs' },
  project:     { fn: cmdProject,    desc: 'Scan and update project state' },
  compact:     { fn: cmdCompact,    desc: 'Enforce MEMORY.md 200-line hard limit' },
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
