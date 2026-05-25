#!/usr/bin/env node
/**
 * Causal Topology Builder (Node 2)
 * Enriches relations with strong CAUSE/EFFECT causal links via MiniMax LLM.
 * Run: node memory/scripts/causal-topology-builder.js [--dry-run] [--limit 10]
 */

'use strict';
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

process.chdir('C:/Users/Administrator/.openclaw/workspace');

const Database = require(path.join(__dirname, 'node_modules', 'better-sqlite3'))(
  path.join(__dirname, '..', '..', 'storage', 'atoms.db')
);
Database.pragma('journal_mode = WAL');

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '$MINIMAX_API_KEY';

function callMiniMax(opts) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'MiniMax-M2.7',
      max_tokens: opts.max_tokens || 800,
      thinking_enabled: !!opts.thinking,
      system: opts.system || '',
      messages: [{ role: 'user', content: opts.user }],
    });
    const options = {
      hostname: 'api.minimaxi.com',
      path: '/anthropic/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': MINIMAX_API_KEY,
        'anthropic-version': '2023-06-01',
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'error' || parsed.error) {
            reject(new Error(parsed.error?.message || JSON.stringify(parsed)));
            return;
          }
          const textBlock = parsed.content && parsed.content.find
            ? parsed.content.find(b => b.type === 'text')
            : null;
          resolve(textBlock ? textBlock.text : '');
        } catch(e) {
          reject(new Error('JSON parse error: ' + data.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function now() { return new Date().toISOString(); }

const DRY_RUN = process.argv.includes('--dry-run');
let limitArg = 8;
process.argv.forEach(a => { if (a.startsWith('--limit=')) limitArg = parseInt(a.split('=')[1], 10) || 8; });

const CAUSAL_PREDICATES = ['CAUSES', 'MITIGATES', 'PREVENTS', 'ENHANCES', 'FOLLOWS', 'PRECEDES'];
const CAUSAL_PRED_PLACEHOLDER = CAUSAL_PREDICATES.map(() => '?').join(',');

async function main() {
  console.log('=== Causal Topology Builder (Node 2) ===');
  console.log('Mode:', DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (writing to DB)');

  // Get top high-importance atoms
  const atoms = Database.prepare(`
    SELECT id, content, importance, namespace, human_pin, tier
    FROM memory_atom ORDER BY importance DESC LIMIT ?
  `).all(limitArg);

  console.log('Processing', atoms.length, 'atoms...\n');

  let causalClaimCount = 0;

  for (const atom of atoms) {
    console.log('[' + atoms.indexOf(atom) + ']', atom.id.slice(0, 8), '"' + atom.content.slice(0, 45) + '..."');

    const prompt = `Given this knowledge statement, extract 1-3 causal relationship triplets.
A causal relationship: CAUSE directly leads to EFFECT, or something PREVENTS/ENHANCES/MITIGATES something else.

Statement: ${atom.content.slice(0, 600)}

Output one triplet per line in this exact format:
CAUSE | PREDICATE | EFFECT
PREDICATE must be one of: CAUSES / MITIGATES / PREVENTS / ENHANCES / FOLLOWS / PRECEDES

Examples:
延迟初始�?| CAUSES | 内存占用过高
try-catch缺失 | PREVENTS | 错误被吞�?
Ollama离线 | CAUSES | 向量检索退化为纯关键词
过度设计 | CAUSES | 开发速度下降

Only output the triplets, one per line. If no causal relationship exists, output exactly: NONE`;

    try {
      const response = await callMiniMax({
        system: 'You are a causal reasoning engine.',
        user: prompt,
        max_tokens: 200,
      });

      const lines = (response || '').split('\n').map(l => l.trim()).filter(l => l.includes('|'));
      if (lines.length === 0 || (lines.length === 1 && lines[0].toUpperCase() === 'NONE')) {
        console.log('  -> No causal links found');
        continue;
      }

      let linksFound = 0;
      for (const line of lines) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length >= 3) {
          const cause = parts[0].replace(/^\d+[\.\)]\s*/, '').trim();
          const predicate = parts[1].toUpperCase().replace(/[^A-Z_]/g, '').trim();
          const effect = parts.slice(2).join(' | ').trim();
          if (CAUSAL_PREDICATES.indexOf(predicate) < 0) continue;
          if (!cause || !effect) continue;
          if (cause.length > 80 || effect.length > 120) continue;

          console.log('  [CAUSAL]', predicate, ':', cause.slice(0, 35), '->', effect.slice(0, 35));

          if (!DRY_RUN) {
            // Check if already exists
            const existing = Database.prepare(
              'SELECT id FROM claims WHERE atom_id=? AND predicate=? AND object=? LIMIT 1'
            ).get(atom.id, predicate, effect);
            if (!existing) {
              const claimId = crypto.randomUUID();
              Database.prepare(`
                INSERT INTO claims (id, atom_id, subject, predicate, object, conceptual_depth, created_at)
                VALUES (?, ?, ?, ?, ?, 2, ?)
              `).run(claimId, atom.id, cause, predicate, effect, now());
              causalClaimCount++;

              // Also build causal relation: find target atom that contains the effect text
              // Use simple substring match to find the atom most relevant to the EFFECT
              const targetRows = Database.prepare(`
                SELECT id, content FROM memory_atom
                WHERE content LIKE '%' || ? || '%'
                ORDER BY importance DESC LIMIT 3
              `).all(effect.slice(0, 40));

              if (targetRows.length > 0) {
                // Link the source atom (atom) to the most relevant target atom
                const targetAtom = targetRows[0];
                if (targetAtom.id !== atom.id) {
                  try {
                    Database.prepare(`
                      INSERT OR IGNORE INTO relations (source_id, target_id, relation_type, weight, created_at)
                      VALUES (?, ?, ?, 0.85, ?)
                    `).run(atom.id, targetAtom.id, predicate, now());
                    console.log('    [RELATION] ' + atom.id.slice(0,8) + ' --' + predicate + '--> ' + targetAtom.id.slice(0,8));
                  } catch(e) { /* duplicate PK */ }
                }
              }
              // Also self-link for fractal topology: atom CAUSES itself (enables chain traversal)
              try {
                Database.prepare(`
                  INSERT OR IGNORE INTO relations (source_id, target_id, relation_type, weight, created_at)
                  VALUES (?, ?, 'CAUSES_SELF', 0.5, ?)
                `).run(atom.id, atom.id, now());
              } catch(e) { /* duplicate PK */ }
            }
          }
          linksFound++;
        }
      }
      console.log('  ->', linksFound, 'causal links');
    } catch(e) {
      console.log('  [ERROR]', e.message);
    }
  }

  console.log('\n=== Results ===');
  console.log('Causal claims inserted:', causalClaimCount);

  const strongRels = Database.prepare(`
    SELECT r.relation_type, COUNT(*) as cnt
    FROM relations r
    WHERE r.relation_type IN (${CAUSAL_PRED_PLACEHOLDER})
    GROUP BY r.relation_type
  `).all(...CAUSAL_PREDICATES);
  console.log('\nStrong causal relations in DB:');
  strongRels.forEach(r => console.log(' ', r.relation_type + ':', r.cnt));

  const causalClaimsCount = Database.prepare(`
    SELECT COUNT(*) as c FROM claims WHERE predicate IN (${CAUSAL_PRED_PLACEHOLDER})
  `).get(...CAUSAL_PREDICATES);
  console.log('Causal claims (claims table):', causalClaimsCount.c);

  Database.close();
  console.log('\n=== Causal Topology Builder Complete ===');
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  Database.close();
  process.exit(1);
});
