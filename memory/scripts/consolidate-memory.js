#!/usr/bin/env node
/**
 * consolidate-memory.js - Cross-platform memory consolidation
 * Usage: node consolidate-memory.js [--dry-run] [--verbose]
 * 
 * Functions:
 * 1. Score decay (x0.95 per week) across topic files
 * 2. Low-activation detection (score < 20)
 * 3. Pattern detection (3x same lesson -> HOT candidate)
 * 4. Stale detection (>30 days untouched)
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE = 'C:/Users/Administrator/.openclaw/workspace';
const MEMORY_ROOT = path.join(WORKSPACE, 'memory');
const MEMORY_FILE = path.join(WORKSPACE, 'MEMORY.md');
const TOPICS_DIR = path.join(MEMORY_ROOT, 'topics');
const DAILY_LOGS = path.join(MEMORY_ROOT, 'daily-logs');
const ACTIVATION_THRESHOLD = 20;
const DECAY_FACTOR = 0.95;
const STALE_DAYS = 30;

const VERBOSE = process.argv.includes('--verbose');
const DRY_RUN = process.argv.includes('--dry-run');

function log(msg, color = 'default') {
    const colors = { red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', cyan: '\x1b[36m', dark: '\x1b[90m', reset: '\x1b[0m' };
    const c = colors[color] || '';
    console.log(`${c}${msg}${colors.reset}`);
}

function getScore(line) {
    const m = line.match(/\[score:(\d+)\]/);
    return m ? parseInt(m[1], 10) : null;
}

function setScore(line, newScore) {
    if (line.match(/\[score:\d+\]/)) {
        return line.replace(/\[score:\d+\]/, `[score:${newScore}]`);
    }
    return line;
}

function decayScore(score) {
    return Math.floor(score * DECAY_FACTOR);
}

async function main() {
    log('\n========================================', 'cyan');
    log(' Memory Consolidation & Forgetting', 'cyan');
    log(` ${new Date().toISOString().slice(0,16).replace('T',' ')}`, 'dark');
    log('========================================\n', 'cyan');

    let totalDecayed = 0;
    let totalLowActivation = 0;

    // ── 1. Score decay across topic files ─────────────────────────────────────
    log('[Decay] Scanning topic files...', 'cyan');
    if (!fs.existsSync(TOPICS_DIR)) {
        log('  Topics dir not found', 'dark');
    } else {
        for (const fname of fs.readdirSync(TOPICS_DIR)) {
            if (!fname.endsWith('.md')) continue;
            const fpath = path.join(TOPICS_DIR, fname);
            let lines = fs.readFileSync(fpath, 'utf8').split('\n');
            let changed = false;
            const newLines = lines.map(line => {
                const score = getScore(line);
                if (score !== null && score > 0) {
                    const newScore = decayScore(score);
                    if (newScore < score) {
                        changed = true;
                        totalDecayed++;
                        return setScore(line, newScore);
                    }
                }
                return line;
            });
            if (changed && !DRY_RUN) {
                fs.writeFileSync(fpath, newLines.join('\n'), 'utf8');
                log(`  Decayed: ${fname}`, 'yellow');
            } else if (VERBOSE) {
                log(`  OK (no decay needed): ${fname}`, 'green');
            }
        }
    }
    if (totalDecayed === 0) log('  No scores needed decay', 'green');

    // ── 2. Low-activation scan ─────────────────────────────────────────────────
    log('\n[Scan] Low-activation entries...', 'cyan');
    if (fs.existsSync(TOPICS_DIR)) {
        for (const fname of fs.readdirSync(TOPICS_DIR)) {
            if (!fname.endsWith('.md')) continue;
            const fpath = path.join(TOPICS_DIR, fname);
            const lines = fs.readFileSync(fpath, 'utf8').split('\n');
            lines.forEach((line, i) => {
                const score = getScore(line);
                if (score !== null && score < ACTIVATION_THRESHOLD) {
                    totalLowActivation++;
                    const preview = line.substring(0, Math.min(70, line.length));
                    log(`  [${fname}:${i+1}] score=${score} | ${preview}`, 'yellow');
                }
            });
        }
    }
    if (totalLowActivation === 0) {
        log(`  No low-activation entries (all >= ${ACTIVATION_THRESHOLD})`, 'green');
    }

    // ── 3. Pattern detection (3x rule) ─────────────────────────────────────────
    log('\n[Pattern] Pattern detection (3x rule)...', 'cyan');
    const lessonCounts = {};
    const lessonSamples = {};

    if (fs.existsSync(DAILY_LOGS)) {
        const logFiles = fs.readdirSync(DAILY_LOGS)
            .filter(f => f.endsWith('.md'))
            .map(f => path.join(DAILY_LOGS, f))
            .sort((a, b) => fs.statSync(b).mtime - fs.statSync(a).mtime)
            .slice(0, 14);

        for (const fpath of logFiles) {
            const content = fs.readFileSync(fpath, 'utf8');
            const fname = path.basename(fpath);
            for (const line of content.split('\n')) {
                const m = line.match(/^\s*-\s*\[\d{4}-\d{2}-\d{2}\]\s*\*\*?([^*]+)\*\*?/);
                if (m) {
                    const title = m[1].trim();
                    if (title.length > 5) {
                        if (!lessonCounts[title]) {
                            lessonCounts[title] = 0;
                            lessonSamples[title] = [];
                        }
                        lessonCounts[title]++;
                        lessonSamples[title].push(fname);
                    }
                }
            }
        }
    }

    const hotOnes = Object.entries(lessonCounts)
        .filter(([, count]) => count >= 3)
        .sort((a, b) => b[1] - a[1]);

    if (hotOnes.length === 0) {
        log('  No patterns found (need 3+ occurrences)', 'green');
    } else {
        log(`  Found ${hotOnes.length} patterns with 3+ occurrences:`, 'yellow');
        for (const [title, count] of hotOnes) {
            log(`    🔥 '${title}' appeared ${count}x in: ${[...new Set(lessonSamples[title])].join(', ')}`, 'yellow');
        }
        if (!DRY_RUN) {
            log('\n  Promotion: add these to topic files manually', 'dark');
        }
    }

    // ── 4. Stale detection ─────────────────────────────────────────────────────
    log('\n[Stale] Stale topic files check...', 'cyan');
    const staleThreshold = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
    let staleCount = 0;

    if (fs.existsSync(TOPICS_DIR)) {
        for (const fname of fs.readdirSync(TOPICS_DIR)) {
            if (!fname.endsWith('.md')) continue;
            const fpath = path.join(TOPICS_DIR, fname);
            const mtime = fs.statSync(fpath).mtimeMs;
            if (mtime < staleThreshold) {
                staleCount++;
                const lastMod = new Date(mtime).toISOString().slice(0, 10);
                log(`  STALE: ${fname} (last modified: ${lastMod})`, 'yellow');
            } else if (VERBOSE) {
                log(`  OK: ${fname}`, 'green');
            }
        }
    }
    if (staleCount === 0) {
        log(`  All topic files accessed in last ${STALE_DAYS} days`, 'green');
    }

    // ── Summary ────────────────────────────────────────────────────────────────
    log('\n========================================', 'cyan');
    log(`  Decayed: ${totalDecayed} entries`, 'dark');
    log(`  Low-activation: ${totalLowActivation} entries`, 'dark');
    log(`  HOT patterns: ${hotOnes.length}`, 'dark');
    log(`  Stale files: ${staleCount}`, 'dark');
    if (DRY_RUN) {
        log('\n  DryRun: no changes made', 'yellow');
    } else {
        log('\n  Consolidation check complete', 'green');
    }
    log('========================================\n', 'cyan');

    process.exit(totalLowActivation + staleCount > 0 ? 0 : 0);
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
