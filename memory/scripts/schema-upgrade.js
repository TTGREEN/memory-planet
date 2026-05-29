const Database = require('better-sqlite3');
const path = require('path');
const ATOMS_DB_PATH = path.join(__dirname, '..', '..', 'storage', 'atoms.db');
const db = new Database(ATOMS_DB_PATH);

console.log('=== Step 1: Schema 热更新 ===');

// 检查哪些字段已存在
const cols = db.prepare('PRAGMA table_info(memory_atom)').all().map(c => c.name);
console.log('Current columns:', JSON.stringify(cols));

const needed = ['origin_agent', 'session_id', 'trace_id', 'status'];
const missing = needed.filter(n => !cols.includes(n));
console.log('Missing columns to add:', JSON.stringify(missing));

// 添加缺失字段
for (const col of missing) {
  try {
    if (col === 'status') {
      db.exec('ALTER TABLE memory_atom ADD COLUMN ' + col + " TEXT DEFAULT 'Canary'");
    } else {
      db.exec('ALTER TABLE memory_atom ADD COLUMN ' + col + ' TEXT');
    }
    console.log('[OK] Added: ' + col);
  } catch(e) {
    console.log('[SKIP/ERR] ' + col + ': ' + e.message);
  }
}

// 旧数据保护：旧atom设为Committed，防止被新机制误杀
const updated = db.prepare("UPDATE memory_atom SET status = ? WHERE status IS NULL OR status = ?").run('Committed', 'Canary');
console.log('[OK] 保护性更新: ' + updated.changes + ' 条旧atom设为Committed');

// 验证最终Schema
const finalCols = db.prepare('PRAGMA table_info(memory_atom)').all().map(c => c.name);
console.log('Final columns:', JSON.stringify(finalCols));

// 统计各status数量
try {
  const statusCounts = db.prepare('SELECT status, COUNT(*) as cnt FROM memory_atom GROUP BY status').all();
  console.log('Status distribution:', JSON.stringify(statusCounts));
} catch(e) {
  console.log('Status query:', e.message);
}

// 统计origin_agent分布
try {
  const agentCounts = db.prepare('SELECT origin_agent, COUNT(*) as cnt FROM memory_atom GROUP BY origin_agent').all();
  console.log('Origin agent distribution:', JSON.stringify(agentCounts));
} catch(e) {
  console.log('Origin agent query:', e.message);
}

console.log('=== Schema 热更新完成 ===');