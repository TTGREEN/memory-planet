/**
 * Schema migration v1.2: Memory Planet 三层心智架构
 * Compatible with existing _migrations table (id column only)
 */

'use strict';
const path = require('path');
const Database = require('better-sqlite3');

// Use same path resolution as atoms-db.js
const DB_PATH = path.join(__dirname, '..', '..', 'storage', 'atoms.db');
console.log('Database:', DB_PATH);

const MIGRATIONS = [
  {
    id: 'v1_2_mental_layer',
    name: 'Add mental_layer column to memory_atom',
    sql: `ALTER TABLE memory_atom ADD COLUMN mental_layer TEXT NOT NULL DEFAULT 'GROWTH'`,
  },
  {
    id: 'v1_2_life_status',
    name: 'Add life_status column to memory_atom',
    sql: `ALTER TABLE memory_atom ADD COLUMN life_status TEXT NOT NULL DEFAULT 'ACTIVE'`,
  },
  {
    id: 'v1_2_context_tags',
    name: 'Add context_tags column to memory_atom',
    sql: `ALTER TABLE memory_atom ADD COLUMN context_tags TEXT`,
  },
  {
    id: 'v1_2_applicability_boundary',
    name: 'Add applicability_boundary column to memory_atom',
    sql: `ALTER TABLE memory_atom ADD COLUMN applicability_boundary TEXT`,
  },
  {
    id: 'v1_2_contextual_weight',
    name: 'Add contextual_weight to claims',
    sql: `ALTER TABLE claims ADD COLUMN contextual_weight REAL NOT NULL DEFAULT 1.0`,
  },
  {
    id: 'v1_2_indexes',
    name: 'Create indexes for new v1.2 columns',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_atom_mental_layer ON memory_atom(mental_layer);
      CREATE INDEX IF NOT EXISTS idx_atom_life_status ON memory_atom(life_status);
      CREATE INDEX IF NOT EXISTS idx_atom_context_tags ON memory_atom(context_tags);
    `,
  },
  {
    id: 'v1_2_migrate_identity',
    name: 'Migrate human_pin=1 atoms to MINDBASE',
    sql: `UPDATE memory_atom SET mental_layer = 'MINDBASE' WHERE human_pin = 1 AND mental_layer = 'GROWTH'`,
  },
];

function runMigration(db, migration) {
  // Check if already applied (only id column exists in _migrations)
  const existing = db.prepare("SELECT id FROM _migrations WHERE id = ?").get(migration.id);
  if (existing) {
    console.log(`  [SKIP] ${migration.id}`);
    return false;
  }

  console.log(`  Applying: ${migration.id} — ${migration.name}`);
  try {
    db.exec(migration.sql);
    // Use only id column (existing schema)
    db.prepare("INSERT INTO _migrations(id) VALUES (?)").run(migration.id);
    console.log(`  [OK] ${migration.id}`);
    return true;
  } catch(e) {
    // Column already exists - not an error
    if (e.message.includes('duplicate column') || e.message.includes('no such column') || e.message.includes('already exists')) {
      console.log(`  [SKIP] ${migration.id}: ${e.message.split('\n')[0]}`);
      db.prepare("INSERT OR IGNORE INTO _migrations(id) VALUES (?)").run(migration.id);
      return false;
    }
    console.error(`  [FAIL] ${migration.id}: ${e.message}`);
    throw e;
  }
}

function main() {
  console.log('\n=== Memory Planet v1.2 Schema Migration ===\n');

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Ensure _migrations table (id only, compatible with existing)
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY)`);

  let applied = 0;
  for (const m of MIGRATIONS) {
    try {
      if (runMigration(db, m)) applied++;
    } catch(e) {
      console.error(`Stopped at ${m.id}: ${e.message}`);
      break;
    }
  }

  console.log(`\n=== ${applied}/${MIGRATIONS.length} applied ===\n`);

  // Verify final state
  const cols = db.prepare("PRAGMA table_info(memory_atom)").all();
  console.log('memory_atom columns:', cols.map(c => c.name).join(', '));

  const claimsCols = db.prepare("PRAGMA table_info(claims)").all();
  console.log('claims columns:', claimsCols.map(c => c.name).join(', '));

  try {
    const counts = db.prepare(`
      SELECT mental_layer, life_status, COUNT(*) as c 
      FROM memory_atom 
      GROUP BY mental_layer, life_status
    `).all();
    console.log('\nmemory_atom distribution:');
    counts.forEach(r => console.log(`  ${r.mental_layer}/${r.life_status}: ${r.c}`));
  } catch(e) {
    console.log('\n(life_status distribution check skipped - column may not exist yet)');
  }

  const total = db.prepare("SELECT COUNT(*) as c FROM memory_atom").get();
  console.log(`\nTotal atoms: ${total.c}`);

  db.close();
  console.log('\nDone.');
}

main();