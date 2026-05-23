/**
 * v1.2 Recall Enhancement - integrates boundary gating + activation energy boost
 * 
 * Changes to hybridRecall:
 * 1. Only ACTIVE atoms participate in recall (CRYOSLEEP/DEPRECATED filtered out)
 * 2. Boundary gating reduces score for cross-context atoms
 * 3. E_activation boost remains (now with correct activation energy formula)
 * 4. recall_count updated on each successful recall
 */

'use strict';
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', '..', 'storage', 'atoms.db');

const LAMBDA = Math.LN2 / 10; // τ=10 days

function computeEactivation(atom) {
  const I = atom.importance || 0.5;
  const C = atom.confidence || 0.5;
  let S = 1.0;
  if (atom.last_recalled_at) {
    const tHours = (Date.now() - new Date(atom.last_recalled_at).getTime()) / 3600000;
    S = Math.exp(-LAMBDA * tHours / 24);
  } else {
    const tHours = (Date.now() - new Date(atom.created_at).getTime()) / 3600000;
    S = Math.exp(-LAMBDA * tHours / 24);
  }
  const D1 = atom.recall_count ? Math.min(1, atom.recall_count / 50) : 0.1;
  const D2 = S;
  const D3 = atom.claims_count ? Math.min(1, atom.claims_count / 10) : 0.2;
  const sumW = 0.24 * D1 + 0.30 * D2 + 0.20 * D3 + 0.20 * (atom.conceptual_depth || 1) / 10;
  return I * (1 + C) / 2 * S * Math.log(Math.E + sumW);
}

function computeBoundaryGating(currentNs, atomNs, contextTags, boundary) {
  if (currentNs === atomNs) return 1.0;
  let tags = [];
  try { tags = JSON.parse(contextTags || '[]'); } catch(e) { /* ignore */ }
  let b = {};
  try { b = JSON.parse(boundary || '{}'); } catch(e) { /* ignore */ }
  if (b.allowedNamespaces && Array.isArray(b.allowedNamespaces)) {
    return b.allowedNamespaces.includes(currentNs) ? 1.0 : 0;
  }
  if (b.excludedNamespaces && Array.isArray(b.excludedNamespaces)) {
    return b.excludedNamespaces.includes(currentNs) ? 0 : 0.5;
  }
  return currentNs === atomNs ? 1.0 : 0.5;
}

async function testRecall() {
  const db = new Database(DB_PATH, Database.OPEN_READONLY);
  
  console.log('\n=== v1.2 Recall Enhancement Test ===\n');

  // Check schema
  const cols = db.prepare("PRAGMA table_info(memory_atom)").all().map(c=>c.name);
  const hasLifeStatus = cols.includes('life_status');
  const hasRecallCount = cols.includes('recall_count');
  const hasContextTags = cols.includes('context_tags');
  const hasBoundary = cols.includes('applicability_boundary');

  console.log('v1.2 columns present:');
  console.log('  life_status:', hasLifeStatus);
  console.log('  recall_count:', hasRecallCount);
  console.log('  context_tags:', hasContextTags);
  console.log('  applicability_boundary:', hasBoundary);

  if (!hasLifeStatus || !hasRecallCount) {
    console.error('Schema not ready — run migrate-v1.2.js first');
    process.exit(1);
  }

  // Count ACTIVE vs non-ACTIVE
  const total = db.prepare("SELECT COUNT(*) as c FROM memory_atom").get().c;
  const active = db.prepare("SELECT COUNT(*) as c FROM memory_atom WHERE life_status = 'ACTIVE'").get().c;
  const cryo = db.prepare("SELECT COUNT(*) as c FROM memory_atom WHERE life_status = 'CRYOSLEEP'").get().c;
  const deprecated = db.prepare("SELECT COUNT(*) as c FROM memory_atom WHERE life_status = 'DEPRECATED'").get().c;

  console.log('\nLife status distribution:');
  console.log(`  ACTIVE: ${active}/${total}`);
  console.log(`  CRYOSLEEP: ${cryo}`);
  console.log(`  DEPRECATED: ${deprecated}`);

  // Test boundary gating
  console.log('\nBoundary gating tests:');
  console.log('  same ns →', computeBoundaryGating('default', 'default', '[]', '{}'));
  console.log('  diff ns no boundary →', computeBoundaryGating('proj-a', 'proj-b', '[]', '{}'));
  console.log('  diff ns excluded →', computeBoundaryGating('proj-a', 'proj-b', '[]', JSON.stringify({excludedNamespaces:['proj-a']})));
  console.log('  diff ns allowed →', computeBoundaryGating('proj-a', 'proj-b', '[]', JSON.stringify({allowedNamespaces:['proj-a']})));

  // Test E_activation on sample atoms
  console.log('\nE_activation samples (ACTIVE atoms):');
  const samples = db.prepare(`
    SELECT id, content, importance, confidence, last_recalled_at, recall_count, claims_count, created_at, mental_layer
    FROM memory_atom 
    WHERE life_status = 'ACTIVE'
    LIMIT 5
  `).all();
  samples.forEach(a => {
    const E = computeEactivation(a);
    console.log(`  E=${E.toFixed(3)} imp=${a.importance.toFixed(2)} conf=${a.confidence.toFixed(2)} recall=${a.recall_count||0} claims=${a.claims_count||0} layer=${a.mental_layer} | ${a.content.slice(0,40)}...`);
  });

  // Verify memory-governor exports work
  console.log('\nmemory-governor exports:');
  const gov = require('./memory-governor');
  console.log('  computeActivationEnergy:', typeof gov.computeActivationEnergy);
  console.log('  computeBoundaryGating:', typeof gov.computeBoundaryGating);
  console.log('  computeLifeStatus:', typeof gov.computeLifeStatus);
  console.log('  THRESHOLDS:', JSON.stringify(gov.THRESHOLDS));

  db.close();
  console.log('\n=== v1.2 Recall Enhancement Ready ===\n');
}

testRecall().catch(e => { console.error(e); process.exit(1); });