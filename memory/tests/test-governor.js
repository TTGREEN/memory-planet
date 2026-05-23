/**
 * Integration test for memory-governor.js
 */

'use strict';
const path = require('path');
const Database = require('better-sqlite3');

// storage/atoms.db (up 2 from memory/scripts/)
const DB_PATH = path.join(__dirname, '..', '..', 'storage', 'atoms.db');
const governor = require('./memory-governor');

console.log('\n=== memory-governor Integration Test ===\n');
console.log('DB:', DB_PATH);

const db = new Database(DB_PATH, Database.OPEN_READONLY);

// 1. Test computeActivationEnergy on sample atoms
console.log('1. computeActivationEnergy samples:');
const samples = db.prepare(`
  SELECT id, content, importance, confidence, last_recalled_at, human_pin, recall_count, claims_count, created_at
  FROM memory_atom 
  LIMIT 5
`).all();

samples.forEach(a => {
  const E = governor.computeActivationEnergy(a, {});
  console.log(`  E=${E.toFixed(3)} imp=${a.importance.toFixed(2)} conf=${a.confidence.toFixed(2)} pin=${a.human_pin} recall=${a.recall_count || 0} claims=${a.claims_count || 0} | ${a.content.slice(0, 50)}...`);
});

// 2. Test computeBoundaryGating
console.log('\n2. computeBoundaryGating tests:');
const same = governor.computeBoundaryGating('default', 'default', '[]', '{}');
console.log(`  same namespace: ${same.toFixed(2)} (expected 1.0)`);
const diff = governor.computeBoundaryGating('project-a', 'project-b', '[]', '{}');
console.log(`  different namespace (no boundary): ${diff.toFixed(2)} (expected 0.5)`);
const excluded = governor.computeBoundaryGating('project-a', 'project-b', '[]', JSON.stringify({excludedNamespaces: ['project-a']}));
console.log(`  excluded namespace: ${excluded.toFixed(2)} (expected 0)`);
const allowed = governor.computeBoundaryGating('project-a', 'project-b', '["ai","coding"]', JSON.stringify({allowedNamespaces: ['project-a', 'project-b']}));
console.log(`  allowed via boundary: ${allowed.toFixed(2)} (expected 1.0)`);

// 3. Test life_status state transitions
console.log('\n3. Life Status State Machine:');
[
  ['high E → ACTIVE', {life_status:'CRYOSLEEP', importance:0.9, confidence:0.9, created_at: new Date().toISOString()}, 0.8, {}],
  ['low E → CRYOSLEEP', {life_status:'ACTIVE', importance:0.3, confidence:0.3, created_at: new Date().toISOString()}, 0.1, {}],
  ['conflict K > 0.75 → RESEARCH', {life_status:'GROWTH', importance:0.6, confidence:0.6, created_at: new Date().toISOString()}, 0.4, {cognitiveConflict: 0.8}],
  ['cluster ≥5 + CRYOSLEEP → DEPRECATED', {life_status:'CRYOSLEEP', importance:0.4, confidence:0.5, created_at: new Date().toISOString()}, 0.2, {clusterSize: 5}],
  ['validation failed → DEPRECATED', {life_status:'RESEARCH', importance:0.5, confidence:0.5, created_at: new Date().toISOString()}, 0.3, {validationFailed: true}],
  ['gating 0.3 → CRYOSLEEP', {life_status:'ACTIVE', importance:0.6, confidence:0.6, created_at: new Date().toISOString()}, 0.4, {boundaryGating: 0.3}],
].forEach(([name, atom, E, opts]) => {
  const result = governor.computeLifeStatus(atom, E, opts);
  console.log(`  ${name} → ${result}`);
});

// 4. Test mental_layer computation
console.log('\n4. Mental Layer Computation:');
[
  [{human_pin: 1, importance: 0.9}, {}, 'MINDBASE'],
  [{human_pin: 0, importance: 0.5}, {isHypothesis: true}, 'RESEARCH'],
  [{human_pin: 0, importance: 0.5}, {}, 'GROWTH'],
].forEach(([atom, opts, expected]) => {
  const result = governor.computeMentalLayer(atom, opts);
  const ok = result === expected ? '✓' : `✗ (expected ${expected})`;
  console.log(`  pin=${atom.human_pin} + ${JSON.stringify(opts)} → ${result} ${ok}`);
});

// 5. Count current distribution
console.log('\n5. Current DB distribution:');
const dist = db.prepare(`
  SELECT life_status, mental_layer, COUNT(*) as c 
  FROM memory_atom GROUP BY life_status, mental_layer
`).all();
dist.forEach(r => console.log(`  ${r.mental_layer}/${r.life_status}: ${r.c}`));

db.close();
console.log('\n=== All tests complete ===\n');