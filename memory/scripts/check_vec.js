/**
 * atoms-db.js 健康检查脚本
 * 用法: node memory/scripts/check_vec.js
 *
 * 检查项:
 *   1. sqlite-vec vec0 module 是否已注册
 *   2. vec_atoms_knn virtual table 是否可用
 *   3. memory_atom 表状态
 *   4. 向量索引完整性（vec_atoms_id 与 vec_atoms_knn 行数是否匹配）
 */

process.chdir('C:/Users/Administrator/.openclaw/workspace');
const { getDb } = require('C:/Users/Administrator/.openclaw/workspace/memory/scripts/atoms-db.js');

let ok = true;

console.log('=== atoms-db.js 健康检查 ===\n');

// ── 1. sqlite-vec vec0 注册状态 ──────────────────────────────────
try {
  const db = getDb();
  const modules = db.pragma('module_list');
  const vec0Loaded = modules.some(m => m.name === 'vec0');

  if (vec0Loaded) {
    console.log('✅ vec0 module: 已注册');
  } else {
    console.log('❌ vec0 module: 未注册');
    ok = false;
  }

  // ── 2. vec_atoms_knn virtual table 可用性 ───────────────────────
  try {
    const cnt = db.prepare('SELECT COUNT(*) as c FROM vec_atoms_knn').get();
    console.log(`✅ vec_atoms_knn: 可查询 (${cnt.c} 条向量)`);

    // ── 3. 向量索引完整性 ──────────────────────────────────────
    const idCount = db.prepare('SELECT COUNT(*) as c FROM vec_atoms_id').get();
    const atomCount = db.prepare('SELECT COUNT(*) as c FROM memory_atom').get();

    console.log(`   vec_atoms_id: ${idCount.c} 条`);
    console.log(`   memory_atom:  ${atomCount.c} 条`);

    if (idCount.c !== cnt.c) {
      console.log(`   ⚠️ 索引不完整: vec_atoms_id (${idCount.c}) ≠ vec_atoms_knn (${cnt.c})`);
    }
    if (idCount.c !== atomCount.c) {
      console.log(`   ⚠️ 索引不完整: vec_atoms_id (${idCount.c}) ≠ memory_atom (${atomCount.c})`);
    }
  } catch(e) {
    console.log(`❌ vec_atoms_knn 查询失败: ${e.message}`);
    ok = false;
  }

  // ── 4. KNN 检索功能验证 ──────────────────────────────────────
  try {
    const testVec = new Array(1024).fill(0).map(() => 0.001);
    const k = 5;
    const sql = `SELECT v.rowid, v.distance, a.id
      FROM vec_atoms_knn v
      JOIN vec_atoms_id vid ON v.rowid = vid.vec_rowid
      JOIN memory_atom a ON vid.atom_id = a.id
      WHERE v.embedding MATCH ? AND k = ${k}
      ORDER BY v.distance
      LIMIT 3`;
    const results = db.prepare(sql).all(JSON.stringify(testVec));
    console.log(`✅ KNN 检索: 正常 (测试查询返回 ${results.length} 条)`);
  } catch(e) {
    console.log(`❌ KNN 检索失败: ${e.message}`);
    ok = false;
  }

  // ── 5. vec_distance_cosine 函数 ──────────────────────────────
  try {
    const row = db.prepare('SELECT id, embedding FROM memory_atom WHERE embedding IS NOT NULL LIMIT 1').get();
    if (row) {
      const stmt = db.prepare(`
        SELECT ma.id, vec_distance_cosine(v.embedding, ?) as dist
        FROM vec_atoms_knn v
        JOIN vec_atoms_id va ON va.vec_rowid = v.rowid
        JOIN memory_atom ma ON va.atom_id = ma.id
        WHERE ma.id != ?
        LIMIT 2
      `);
      const r = stmt.all(row.embedding, row.id);
      console.log(`✅ vec_distance_cosine: 正常 (测试 ${r.length} 条)`);
    }
  } catch(e) {
    console.log(`❌ vec_distance_cosine 失败: ${e.message}`);
    ok = false;
  }

  db.close();
} catch(e) {
  console.log(`❌ getDb() 失败: ${e.message}`);
  ok = false;
}

// ── 结果 ──────────────────────────────────────────────────────────
console.log('\n' + (ok ? '✅ 健康检查通过 — vec0 KNN 正常工作' : '❌ 有错误，见上方'));

process.exit(ok ? 0 : 1);