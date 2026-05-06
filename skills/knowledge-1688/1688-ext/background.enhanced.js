/**
 * background.js - 1688 标题采集器 v3（增强版）
 * 新增：语义关键词推荐 + mtop API 商品获取
 */

const sqlite3 = require('sqlite3');

// ========== 1. 简易 BM25 服务（数据库查询） ==========
class SimpleBM25 {
  constructor(db) {
    this.db = db;
  }

  async search(query, limit = 20) {
    const terms = this.tokenize(query);
    if (terms.length === 0) return [];

    const likeClauses = terms.map(() => 'word LIKE ?').join(' OR ');
    const params = terms.map(t => `%${t}%`);
    params.push(limit);

    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT word as keyword, heat as score
        FROM keywords
        WHERE ${likeClauses}
        ORDER BY heat DESC
        LIMIT ?
      `, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  tokenize(text) {
    return text.toLowerCase().split(/[\s,，]+/).filter(t => t.length > 0);
  }
}

// ========== 2. 语义排序服务（简化版，直接调用 Ollama） ==========
class SimpleSemanticRanker {
  constructor() {
    this.cache = new Map();
    this.ollamaUrl = 'http://localhost:11434/api/embeddings';
    this.model = 'nomic-embed-text';
  }

  keywordToSentence(keyword) {
    const hints = {
      '项链': '颈部饰品，装饰用',
      '手链': '手腕饰品，装饰用',
      '耳环': '耳部饰品，装饰用',
      '戒指': '手指饰品，装饰用',
      'T恤': '上衣，棉质服装',
      '水杯': '饮水容器，日用品'
    };
    const hint = hints[keyword] || '1688 商品关键词';
    return `${keyword}: ${hint}`;
  }

  async embed(text) {
    if (this.cache.has(text)) return this.cache.get(text);

    const resp = await fetch(this.ollamaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text })
    });
    const json = await resp.json();
    const vec = json.embedding;
    this.cache.set(text, vec);
    return vec;
  }

  async rerank(query, candidates, topK = 10) {
    const queryVec = await this.embed(query);
    const scored = [];

    for (const cand of candidates) {
      const sent = this.keywordToSentence(cand.keyword);
      const kwVec = await this.embed(sent);
      const sim = this.cosineSim(queryVec, kwVec);
      scored.push({ ...cand, semantic_sim: sim, final_score: 0.4 * cand.score + 0.6 * sim });
    }

    return scored.sort((a, b) => b.final_score - a.final_score).slice(0, topK);
  }

  cosineSim(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  clearCache() { this.cache.clear(); }
}

// ========== 3. mtop API 客户端 ==========
class MtopClient {
  constructor() {
    this.baseUrl = 'https://h5api.m.1688.com/h5/mtop.relationrecommend.WirelessRecommend.recommend/2.0/';
    this.appKey = '12574478';
    this.token = '7f1460da33ecc27e96cafa07b1c1d3c3';  // 需定期刷新
  }

  generateSignature(token, timestamp, data) {
    const crypto = require('crypto');
    const raw = `${token}&${timestamp}&${this.appKey}&${data}`;
    return crypto.createHash('md5').update(raw).digest('hex');
  }

  async getRecommendations(offerId, limit = 20) {
    const timestamp = Date.now();
    const data = JSON.stringify({ type: 'offer', offerId: offerId, pageSize: limit });
    const sign = this.generateSignature(this.token, timestamp, data);

    const url = `${this.baseUrl}?token=${this.token}&timestamp=${timestamp}&sign=${sign}&appKey=${this.appKey}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(data)
    });

    const json = await resp.json();
    return this.parseProducts(json);
  }

  parseProducts(resp) {
    const items = resp?.data?.data?.OFFER?.items || [];
    return items.map(item => ({
      offerId: item.data.offerId,
      title: item.data.title,
      price: item.data.priceInfo?.price || '面议',
      shopName: item.data.shop?.text || '',
      imageUrl: item.data.image?.imgUrl || ''
    }));
  }
}

// ========== 4. 主服务 ==========
let db, bm25, ranker, mtop;

async function init() {
  // 连接数据库（只读）
  db = new sqlite3.Database('E:/1688标题生成/data/1688.db', sqlite3.OPEN_READONLY);

  bm25 = new SimpleBM25(db);
  ranker = new SimpleSemanticRanker();
  mtop = new MtopClient();

  console.log('✅ 后台服务初始化完成');
}

// ========== 5. 消息监听 ==========
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'search') {
    handleSearch(request.query, sendResponse);
    return true;  // 异步响应
  }

  if (request.action === 'recommend') {
    handleRecommend(request.offerId, sendResponse);
    return true;
  }
});

async function handleSearch(query, sendResponse) {
  try {
    console.log('🔍 搜索:', query);

    // 1. BM25 初筛（top 20）
    const candidates = await bm25.search(query, 20);
    if (candidates.length === 0) {
      sendResponse({ success: true, results: [], message: '无匹配关键词' });
      return;
    }

    // 2. 语义重排（top 5 关键词）
    const topKeywords = await ranker.rerank(query, candidates, 5);

    console.log('🎯 推荐关键词:', topKeywords.map(k => k.keyword));

    // 3. 对每个关键词获取商品（去重合并）
    const allProducts = [];
    const seenOfferIds = new Set();

    for (const kw of topKeywords) {
      // 用关键词作为伪 offerId（实际应搜索，这里用 mock）
      // 暂时返回空，后续实现真正搜索
      // const products = await mtop.getRecommendations(kw.keyword);  // 需真正搜索接口
      // 目前仅返回关键词信息
      allProducts.push({
        type: 'keyword',
        keyword: kw.keyword,
        score: kw.final_score,
        semantic_sim: kw.semantic_sim
      });
    }

    sendResponse({ success: true, results: allResults });
  } catch (err) {
    console.error('❌ 搜索失败:', err);
    sendResponse({ success: false, error: err.message });
  }
}

async function handleRecommend(offerId, sendResponse) {
  try {
    const products = await mtop.getRecommendations(offerId, 10);
    sendResponse({ success: true, results: products });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ========== 6. 启动 ==========
init().catch(console.error);
