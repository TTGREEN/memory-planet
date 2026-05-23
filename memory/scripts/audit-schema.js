const Database = require('sql.js');
const fs = require('fs');
const buf = fs.readFileSync('memory/atoms.db');
const db = new Database(buf);

const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
console.log('TABLES:', JSON.stringify(tables, null, 2));

const mi = db.exec('PRAGMA table_info(memory_atom)');
console.log('memory_atom cols:', JSON.stringify(mi, null, 2));

const ci = db.exec('PRAGMA table_info(claims)');
console.log('claims cols:', JSON.stringify(ci, null, 2));

const ri = db.exec('PRAGMA table_info(relations)');
console.log('relations cols:', JSON.stringify(ri, null, 2));

db.close();