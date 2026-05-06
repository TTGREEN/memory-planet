// batch_embed_keywords.js - 批量计算关键词 embedding 并存储
// 使用语义排序模块，支持断点续传、进度保存

const sqlite3 = require('sqlite3');
const path = require('path');
const SemanticRanker = require('./semantic_ranker');

const DB_PATH = 'E:/1688标题生成/data/1688.db';
const BATCH_SIZE = 500;       // 每批处理量（增大减少DB事务）
const CONCURRENCY = 20;        // 并发数（提高吞吐）
const SAVE_INTERVAL = 5000;   // 保存间隔

async function main() {
  console.log('🚀 开始批量关键词 embedding 计算\n');
  console.log(`📋 数据库: ${DB_PATH}`);
  console.log(`📋 批大小: ${BATCH_SIZE}`);
  console.log(`📋 并发数: ${CONCURRENCY}\n`);

  // 1. 连接数据库
  const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE);
  db.serialize(() => {
    db.run("PRAGMA journal_mode=WAL");  // 启用 WAL 提升写入性能
  });

  // 2. 确保向量表存在（已存在，无需创建）
  // 3. 获取未计算的关键词（从 keywords 表 LEFT JOIN keyword_vectors）
  const keywords = await getUnprocessedKeywords(db);
  const total = keywords.length;
  console.log(`📊 待处理关键词: ${total} 条\n`);

  if (total === 0) {
    console.log('✅ 所有关键词已处理完毕');
    db.close();
    return;
  }

  // 4. 初始化 ranker（使用 Ollama + 句子级 embedding）
  const ranker = new SemanticRanker({ provider: 'ollama' });

  console.log(`🧠 Embedding Provider: ${ranker.getStats().embedding.provider}`);
  console.log(`   Model: ${ranker.getStats().embedding.model}\n`);

  // 5. 分批处理
  let processed = 0;
  let lastSaveTime = Date.now();

  for (let i = 0; i < keywords.length; i += BATCH_SIZE) {
    const batch = keywords.slice(i, i + BATCH_SIZE);

    try {
      // 批量计算向量（将关键词转换为句子）
      const sentences = batch.map(kw => ranker.keywordToSentence(kw.word));
      const vectors = await ranker.embedding.getEmbeddings(sentences, CONCURRENCY);

      // 写入数据库
      await saveVectors(db, batch, vectors);

      processed += batch.length;

      // 进度输出
      const progress = ((processed / total) * 100).toFixed(2);
      const eta = estimateETA(processed, total, lastSaveTime);
      process.stdout.write(`\r⏳ 进度: ${processed}/${total} (${progress}%) | ETA: ${eta}`);

      // 定期保存 + 清理缓存
      if (processed % SAVE_INTERVAL === 0) {
        ranker.clearCache();  // 防止内存溢出
        lastSaveTime = Date.now();
        console.log(`\n✅ 已保存 ${processed} 条，缓存已清理`);
      }

    } catch (err) {
      console.error(`\n❌ 批次 ${Math.floor(i/BATCH_SIZE) + 1} 失败:`, err.message);
      // 继续下一批
    }
  }

  console.log(`\n\n✅ 全部完成！共处理 ${processed} 条关键词`);
  db.close();
}

/**
 * 确保向量表存在（实际已存在，此函数为空）
 */
function ensureVectorTable(db) {
  return Promise.resolve();  // 表已存在
}

/**
 * 获取未处理的关键词（排除已计算的）
 * 从 keywords 表 LEFT JOIN keyword_vectors 获取未计算的 word
 */
function getUnprocessedKeywords(db) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT k.word, k.type, k.category, k.heat
      FROM keywords k
      LEFT JOIN keyword_vectors v ON k.word = v.keyword
      WHERE v.keyword IS NULL
      ORDER BY k.heat DESC
      -- 全量处理，无 LIMIT
    `, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

/**
 * 保存向量到数据库
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

/**
 * 预估剩余时间
 */
function estimateETA(processed, total, lastTime) {
  const now = Date.now();
  const elapsed = now - lastTime;
  if (processed === 0) return 'N/A';
  const perItem = elapsed / processed;
  const remain = (total - processed) * perItem;
  const secs = Math.round(remain / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

// 启动
main().catch(err => {
  console.error('❌ 批量处理失败:', err);
  process.exit(1);
});
