// batch_embed_keywords.js - 批量关键词 embedding（优化版 v2）
// 优化：高并发 + 大批量 + 进度持久化 + 自动重试

const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');
const SemanticRanker = require('./semantic_ranker');

const DB_PATH = 'E:/1688标题生成/data/1688.db';
const PROGRESS_FILE = 'batch_embed_progress.json';

// ========== 可调参数 ==========
const BATCH_SIZE = 200;        // 每批数据库读取量（保守小批量）
const CONCURRENCY = 5;         // 并发请求数（低负载）
const SAVE_INTERVAL = 2000;   // 控制台输出间隔
const MAX_RETRIES = 3;        // 失败重试次数
const RETRY_DELAY = 1000;     // 重试延迟（ms）

// ========== 进度管理 ==========
function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
      console.log('📂 加载进度文件，已处理:', data.lastId);
      return data.lastId || 0;
    }
  } catch (e) {
    console.warn('⚠️ 进度文件损坏，从头开始');
  }
  return 0;
}

function saveProgress(lastId, stats) {
  const data = {
    lastId,
    stats,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2));
}

// ========== 主流程 ==========
async function main() {
  console.log('🚀 批量 Embedding 计算（优化版）\n');

  // 1. 连接数据库
  const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE);
  db.serialize(() => {
    db.run("PRAGMA journal_mode=WAL");
    db.run("PRAGMA synchronous=NORMAL");  // 平衡性能与安全
  });

  // 2. 获取未处理关键词（从 lastId 开始）
  const lastId = loadProgress();
  const keywords = await getUnprocessedKeywords(db, lastId);
  const total = keywords.length;

  if (total === 0) {
    console.log('✅ 所有关键词已处理完毕');
    db.close();
    if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
    return;
  }

  console.log(`📊 待处理: ${total} 条（从 ID ${lastId} 开始）`);
  console.log(`⚙️  批大小: ${BATCH_SIZE}, 并发: ${CONCURRENCY}\n`);

  // 3. 初始化 ranker
  const ranker = new SemanticRanker({ provider: 'ollama' });
  console.log(`🧠 Provider: ${ranker.getStats().embedding.provider}`);
  console.log(`   Model: ${ranker.getStats().embedding.model}\n`);

  // 4. 批量处理
  let processed = 0;
  let lastSavedId = lastId;
  const startTime = Date.now();

  for (let i = 0; i < keywords.length; i += BATCH_SIZE) {
    const batch = keywords.slice(i, i + BATCH_SIZE);
    const batchStartId = batch[0]?.id || lastSavedId;

    try {
      // 批量计算（并发）
      const sentences = batch.map(kw => ranker.keywordToSentence(kw.word));
      const vectors = await ranker.embedding.getEmbeddings(sentences, CONCURRENCY);

      // 写入数据库
      await saveVectors(db, batch, vectors);

      processed += batch.length;
      lastSavedId = batch[batch.length - 1].id;

      // 进度输出
      const progress = ((processed / total) * 100).toFixed(2);
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (processed / elapsed).toFixed(1);
      const eta = ((total - processed) / (processed / elapsed)).toFixed(0);
      process.stdout.write(`\r⏳ ${processed}/${total} (${progress}%) | 速度: ${rate}条/秒 | ETA: ${Math.round(eta/60)}分${Math.round(eta%60)}秒`);

      // 定期保存进度
      if (processed % SAVE_INTERVAL === 0) {
        ranker.clearCache();
        saveProgress(lastSavedId, { processed, total });
        console.log(`\n✅ 已保存进度 (ID: ${lastSavedId})`);
      }

    } catch (err) {
      console.error(`\n❌ 批次失败 (ID ${batchStartId}):`, err.message);
      // 重试逻辑
      await retryBatch(batch, db, ranker, lastSavedId);
    }
  }

  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`\n\n🎉 全部完成！共处理 ${processed} 条`);
  console.log(`⏱️  总耗时: ${Math.round(totalTime/60)} 分 ${Math.round(totalTime%60)} 秒`);
  console.log(`📈 平均速度: ${(processed/totalTime).toFixed(1)} 条/秒`);

  db.close();
  if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
}

/**
 * 重试失败批次
 */
async function retryBatch(batch, db, ranker, lastId) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`🔁 重试批次 (第 ${attempt} 次)...`);
    try {
      const sentences = batch.map(kw => ranker.keywordToSentence(kw.word));
      const vectors = await ranker.embedding.getEmbeddings(sentences, CONCURRENCY);
      await saveVectors(db, batch, vectors);
      console.log(`✅ 重试成功`);
      return;
    } catch (err) {
      console.error(`❌ 重试失败: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY * attempt));
      }
    }
  }
  console.log('⚠️ 跳过该批次，继续下一批');
}

/**
 * 获取未处理关键词（从指定ID之后）
 */
function getUnprocessedKeywords(db, afterId = 0) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT k.id, k.word, k.type, k.category, k.heat
      FROM keywords k
      LEFT JOIN keyword_vectors v ON k.word = v.keyword
      WHERE v.keyword IS NULL AND k.id > ?
      ORDER BY k.id ASC
    `, [afterId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

/**
 * 保存向量（事务批量插入）
 */
function saveVectors(db, batch, vectors) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO keyword_vectors (keyword, vector, provider, model, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      for (let i = 0; i < batch.length; i++) {
        const kw = batch[i].word;
        const vec = vectors[i];
        if (vec) {
          stmt.run(kw, JSON.stringify(vec), 'ollama', 'nomic-embed-text');
        }
      }
      db.run('COMMIT', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    stmt.finalize();
  });
}

// ========== 启动 ==========
main().catch(err => {
  console.error('❌ 批量处理失败:', err);
  process.exit(1);
});
