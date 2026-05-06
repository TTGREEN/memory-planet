// local-server/server.js - 本地核心服务（完整修复版）
// 职责：语义搜索、embedding 计算、关键词管理
// 数据源：keywords.json（内存加载）

import express from 'express';
import cors from 'cors';
import { SemanticRanker } from './semantic_ranker.js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// 并行 embedding 与性能监控
import EmbeddingWorkerPool from './worker-pool.js';
import { PerformanceMonitor, middleware } from './performance-monitor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 11456;

// ========== 初始化组件 ==========
const workerPool = new EmbeddingWorkerPool({ workers: 4, timeoutMs: 30000 });
await workerPool.initialize();
console.log(`⚡ WorkerPool 已启动: ${workerPool.workerCount} workers`);

const monitor = new PerformanceMonitor({
  slowThresholdMs: 1000,
  memoryHighWatermark: 1024 * 1024 * 1024
});
monitor.scheduleAutoReport(3600000);
console.log(`📊 PerformanceMonitor 已启用`);

// ========== 中间件 ==========
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(middleware(monitor));

// ========== 加载关键词库 ==========
const KEYWORDS_FILE = 'C:/Users/Administrator/.openclaw/workspace/skills/knowledge-1688-scraper/1688-ext/keywords.json';
let keywords = [];

async function loadKeywords() {
  try {
    const data = readFileSync(KEYWORDS_FILE, 'utf8');
    keywords = JSON.parse(data);
    console.log(`✅ 关键词库已加载: ${keywords.length} 条`);

    ranker.keywords = keywords;
    await ranker.initializeTFIDF(keywords);
  } catch (err) {
    console.error('❌ 关键词库加载失败:', err.message);
    console.error(`   路径: ${KEYWORDS_FILE}`);
    keywords = [];
  }
}

// ========== 初始化 ranker ==========
const ranker = new SemanticRanker({ provider: 'ollama' });
console.log(`🧠 SemanticRanker 已初始化 (provider: ${ranker.embedding.provider})`);

// ========== 限流器 ==========
const { RateLimiter } = await import('./rate_limiter.js');
const rateLimiter = new RateLimiter(10, 20);

// ========== 路由 ==========

app.post('/api/search/semantic', async (req, res) => {
  try {
    const { query, limit = 5 } = req.body;
    if (!query) return res.status(400).json({ error: '缺少 query' });

    console.log(`🔍 语义搜索: "${query}"`);
    const candidates = await getBM25Candidates(query, 50);
    const results = await ranker.rerank(query, candidates, limit);
    res.json({ success: true, query, results });
  } catch (err) {
    console.error('❌ 搜索失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/keywords/search', async (req, res) => {
  const { q, limit = 5 } = req.query;
  if (!q) return res.status(400).json({ error: '缺少 q 参数' });

  try {
    const results = await getBM25Candidates(q, parseInt(limit));
    res.json({ success: true, query: q, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/embed', async (req, res) => {
  try {
    await rateLimiter.acquire();
    const { texts } = req.body;
    if (!Array.isArray(texts) || texts.length === 0) {
      return res.status(400).json({ error: 'texts 必须是非空数组' });
    }
    const embeddings = await workerPool.embedBatch(texts);
    res.json({ success: true, embeddings });
  } catch (err) {
    console.error('❌ Embedding 失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    provider: ranker.embedding.provider,
    cacheSize: ranker.embedding.cache.size,
    keywordsCount: keywords.length,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/stats', (req, res) => {
  res.json({
    totalKeywords: keywords.length,
    provider: ranker.embedding.provider,
    rateLimit: rateLimiter.getStatus(),
    cacheSize: ranker.embedding.cache.size
  });
});

app.post('/api/keywords/update', (req, res) => {
  const { keywords: newKeywords } = req.body;
  if (!Array.isArray(newKeywords)) {
    return res.status(400).json({ error: 'keywords 必须是数组' });
  }

  keywords = newKeywords;
  console.log(`✅ 关键词库已更新: ${keywords.length} 条`);

  try {
    writeFileSync(KEYWORDS_FILE, JSON.stringify(keywords, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ 保存关键词失败:', err.message);
  }

  res.json({ success: true, count: keywords.length });
});

app.get('/api/performance', (req, res) => {
  res.json(monitor.snapshot());
});

// ========== 工具函数 ==========

async function getBM25Candidates(query, limit = 50) {
  const lowerQuery = query.toLowerCase();
  const scores = new Map();

  for (const kw of keywords) {
    const word = (kw.word || '').toLowerCase();
    if (!word) continue;

    let score = 0;
    if (word.includes(lowerQuery)) {
      score += 1.0;
    }
    if (lowerQuery.includes(word)) {
      score += 0.5;
    }

    if (score > 0) {
      const heatScore = Math.log10((kw.heat || 1) + 1) * 0.1;
      scores.set(kw.word, { ...kw, score: score + heatScore });
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ========== 启动服务 ==========
loadKeywords().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 本地服务已启动: http://localhost:${PORT}`);
    console.log(`📡 接口:`);
    console.log(`   POST /api/search/semantic  - 语义搜索`);
    console.log(`   GET  /api/keywords/search  - BM25 搜索`);
    console.log(`   POST /api/embed            - 批量 embedding (并行)`);
    console.log(`   POST /api/keywords/update  - 更新关键词库`);
    console.log(`   GET  /api/health           - 健康检查`);
    console.log(`   GET  /api/stats            - 统计`);
    console.log(`   GET  /api/performance      - 性能快照`);
  });
}).catch(err => {
  console.error('❌ 服务启动失败:', err);
  process.exit(1);
});

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('\n🛑 关闭服务...');
  await workerPool.terminate();
  process.exit(0);
});
