#!/usr/bin/env node
/**
 * search-logs.js - Cross-platform FTS5 search for daily logs
 * Usage: node search-logs.js <query> [--limit 10] [--db <path>]
 * Example: node search-logs.js memory --limit 5
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const WORKSPACE = 'C:/Users/Administrator/.openclaw/workspace';
const MEMORY_ROOT = path.join(WORKSPACE, 'memory');
const DB_PATH = process.env.SEARCH_DB || path.join(MEMORY_ROOT, 'logs.db');
const DAILY_LOGS = path.join(MEMORY_ROOT, 'daily-logs');

const args = process.argv.slice(2);
const queryArg = args.find(a => !a.startsWith('--'));
const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1] || '10';
const dbArg = args.find(a => a.startsWith('--db='))?.split('=')[1];

const query = queryArg || (console.error('Usage: node search-logs.js <query> [--limit=10]'), process.exit(1));
const limit = parseInt(limitArg, 10);
const db = dbArg || DB_PATH;

// ── SQLite helpers ──────────────────────────────────────────────────────────

function sqlite(sql) {
    return new Promise((resolve, reject) => {
        const proc = spawn('sqlite3', [db], { shell: true });
        let out = '', err = '';
        proc.stdout.on('data', d => out += d);
        proc.stderr.on('data', d => err += d);
        proc.on('close', code => {
            if (err) console.error('sqlite err:', err.toString().slice(0, 200));
            resolve({ code, out: out.trim() });
        });
        proc.stdin.write(sql + '\n');
        proc.stdin.end();
    });
}

async function ensureSchema() {
    await sqlite(`
        CREATE TABLE IF NOT EXISTS daily_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT UNIQUE NOT NULL,
            date TEXT,
            content TEXT,
            indexed_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
    `);
    await sqlite(`CREATE VIRTUAL TABLE IF NOT EXISTS logs_fts USING fts5(filename, date, content, content="daily_logs", content_rowid="id");`);
}

async function indexFile(filepath) {
    const filename = path.basename(filepath);
    const date = filename.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || 'unknown';
    const content = fs.readFileSync(filepath, 'utf8');
    const escaped = content.replace(/'/g, "''").replace(/"/g, '""');
    await sqlite(`DELETE FROM daily_logs WHERE filename = '${filename.replace(/'/g, "''")}';`);
    await sqlite(`INSERT INTO daily_logs (filename, date, content) VALUES ('${filename.replace(/'/g, "''")}', '${date}', '${escaped}');`);
}

async function buildIndex() {
    await ensureSchema();
    if (!fs.existsSync(DAILY_LOGS)) return 0;
    let count = 0;
    for (const fname of fs.readdirSync(DAILY_LOGS)) {
        if (!fname.endsWith('.md')) continue;
        await indexFile(path.join(DAILY_LOGS, fname));
        count++;
    }
    await sqlite(`INSERT INTO logs_fts(logs_fts) VALUES('rebuild');`);
    return count;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`\n  Search: "${query}"  (limit=${limit})\n`);

    // Build index if DB doesn't exist or is stale
    const dbExists = fs.existsSync(db);
    if (!dbExists) {
        console.log('  Building initial index...');
        const n = await buildIndex();
        console.log(`  Indexed ${n} files\n`);
    }

    // Rebuild FTS to ensure index is current
    try {
        await sqlite(`INSERT INTO logs_fts(logs_fts) VALUES('rebuild');`);
    } catch (_) {}

    const escapedQuery = query.replace(/'/g, "''");
    const sql = `SELECT filename, date, snippet(logs_fts, 2, '>>>', '<<<', '...', ${limit}) AS snippet FROM logs_fts WHERE logs_fts MATCH '${escapedQuery}' ORDER BY rank LIMIT ${limit};`;

    const { code, out } = await sqlite(sql);

    if (!out || code !== 0) {
        console.log(`  No results for: ${query}`);
        return;
    }

    const lines = out.split('\n').filter(Boolean);
    console.log(`  Results (${lines.length}):\n`);
    for (const line of lines) {
        const parts = line.split('|');
        if (parts.length >= 3) {
            console.log(`  📄 ${parts[0]} (${parts[1]})`);
            console.log(`     ${parts[2]}`);
            console.log('');
        }
    }

    const logCount = fs.readdirSync(DAILY_LOGS).filter(f => f.endsWith('.md')).length;
    console.log(`  ─────────────────────────────`);
    console.log(`  Searched ${logCount} log files | DB: ${db}`);
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
