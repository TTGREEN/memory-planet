// reindex-vec.js - Reindex all historical atoms into sqlite-vec
const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');

const dbPath = 'C:\\Users\\Administrator\\.openclaw\\workspace\\storage\\atoms.db';
const db = new Database(dbPath);
db.loadExtension(sqliteVec.getLoadablePath());

const atoms = db.prepare("SELECT id, embedding FROM memory_atom WHERE embedding IS NOT NULL").all();
console.log(`Found ${atoms.length} atoms with embedding`);

let indexed = 0, failed = 0;
const insertVec = db.prepare('INSERT INTO vec_atoms_knn (embedding) VALUES (?)');
const mapVec = db.prepare('INSERT OR REPLACE INTO vec_atoms_id (atom_id, vec_rowid) VALUES (?, ?)');

for (const atom of atoms) {
  try {
    const r = insertVec.run(atom.embedding);
    mapVec.run(atom.id, r.lastInsertRowid);
    indexed++;
    if (indexed % 20 === 0) console.log(`indexed ${indexed}...`);
  } catch(e) {
    console.warn(atom.id.slice(0,8), e.message);
    failed++;
  }
}

console.log(`Done. indexed: ${indexed}, failed: ${failed}`);

// Verify
const vecCount = db.prepare('SELECT COUNT(*) as c FROM vec_atoms_knn').get().c;
const atomCount = db.prepare("SELECT COUNT(*) as c FROM memory_atom WHERE embedding IS NOT NULL").get().c;
console.log(`vec_atoms_knn: ${vecCount}, memory_atom with embedding: ${atomCount}`);
console.log(`Match: ${vecCount === atomCount ? 'YES' : 'NO (diff=' + (atomCount - vecCount) + ')'}`);

db.close();