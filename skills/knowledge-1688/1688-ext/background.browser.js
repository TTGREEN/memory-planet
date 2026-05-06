/**
 * background.js - 1688 标题采集器 v3（MiniMax Embedding 版）
 * 功能：语义关键词推荐 + mtop API 商品获取
 */

// ========== 配置 ==========
const OLLAMA_URL = 'http://localhost:11434/api/embeddings';
const OLLAMA_MODEL = 'nomic-embed-text';
const MTOP_BASE = 'https://h5api.m.1688.com/h5/mtop.relationrecommend.WirelessRecommend.recommend/2.0/';
const MTOP_APPKEY = '12574478';
const MTOP_TOKEN = '7f1460da33ecc27e96cafa07b1c1d3c3';

// ========== 工具 ==========
function md5(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  return crypto.subtle.digest('MD5', data).then(buf => {
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  });
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function tokenize(text) {
  return text.toLowerCase().split(/[\s,，]+/).filter(t => t.length > 0);
}

// ========== 语义排序器（Ollama） ==========
class SemanticRanker {
  constructor() {
    this.cache = new Map();
  }

  keywordToSentence(keyword) {
    const hints = {
      '项链': '颈部饰品，装饰用',
      '手链': '手腕饰品，装饰用',
      '耳环': '耳部饰品，装饰用',
      '戒指': '手指饰品，装饰用',
      'T恤': '上衣，棉质服装',
      '水杯': '饮水容器，日用品',
      '耳坠': '耳部装饰品',
      '手镯': '手腕装饰品',
      '银饰': '贵金属饰品',
      '珍珠': '珠宝配件'
    };
    return keyword;
  }

  async embed(text) {
    if (this.cache.has(text)) return this.cache.get(text);

    console.log('🔗 请求 Ollama embedding:', text.substring(0, 20));
    const resp = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: text
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Ollama API ${resp.status}: ${err}`);
    }

    const json = await resp.json();
    console.log('📦 Ollama 响应:', json.embedding ? 'embedding长度=' + json.embedding.length : '无embedding字段');
    const vec = json.embedding;  // Ollama 格式: {embedding: [...]}
    this.cache.set(text, vec);
    return vec;
  }

  async rerank(query, candidates, topK = 5) {
    const qv = await this.embed(query);
    const scored = [];
    for (const cand of candidates) {
      const kv = await this.embed(this.keywordToSentence(cand.keyword));
      const sim = cosineSim(qv, kv);
      scored.push({ ...cand, semantic_sim: sim, final_score: 0.4 * cand.score + 0.6 * sim });
    }
    return scored.sort((a, b) => b.final_score - a.final_score).slice(0, topK);
  }

  clearCache() { this.cache.clear(); }
}

// ========== mtop 客户端 ==========
class MtopClient {
  async getRecommendations(offerId, limit = 20) {
    const timestamp = Date.now();
    const data = JSON.stringify({ type: 'offer', offerId: offerId, pageSize: limit });
    const sign = await md5(`${MTOP_TOKEN}&${timestamp}&${MTOP_APPKEY}&${data}`);
    const url = `${MTOP_BASE}?token=${MTOP_TOKEN}&timestamp=${timestamp}&sign=${sign}&appKey=${MTOP_APPKEY}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(data)
    });
    const json = await resp.json();
    const items = json?.data?.data?.OFFER?.items || [];
    return items.map(item => ({
      offerId: item.data.offerId,
      title: item.data.title,
      price: item.data.priceInfo?.price || '面议',
      shopName: item.data.shop?.text || '',
      imageUrl: item.data.image?.imgUrl || ''
    }));
  }
}

// ========== 全局实例 ==========
const ranker = new SemanticRanker();
const mtop = new MtopClient();

// ========== 启动初始化 ==========
(async () => {
  console.log('✅ 1688 语义推荐服务启动（MiniMax 模式）');

  const { keywords } = await chrome.storage.local.get('keywords');
  if (!keywords || keywords.length === 0) {
    try {
      const resp = await fetch(chrome.runtime.getURL('keywords.json'));
      if (resp.ok) {
        const data = await resp.json();
        await chrome.storage.local.set({ keywords: data });
        console.log('📦 已加载 ' + data.length + ' 条关键词');
      } else {
        console.warn('⚠️ keywords.json 未找到');
      }
    } catch (e) {
      console.error('❌ 加载关键词失败:', e);
    }
  } else {
    console.log('📦 关键词已存在 (' + keywords.length + ' 条)');
  }
})();

// ========== 消息处理 ==========
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'search') {
    handleSearch(request.query).then(sendResponse).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
  if (request.action === 'recommend') {
    handleRecommend(request.offerId).then(sendResponse).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
  if (request.action === 'embed') {
    handleEmbed(request.text).then(sendResponse).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});

async function handleEmbed(text) {
  try {
    const vec = await ranker.embed(text);
    return { success: true, embedding: vec };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleSearch(query) {
  console.log('🔍 handleSearch 收到查询:', query);
  const data = await chrome.storage.local.get('keywords');
  const allKeywords = data.keywords || [];
  console.log('📊 关键词库大小:', allKeywords.length);

  const terms = tokenize(query);
  console.log('🔤 分词结果:', terms);

  const candidates = allKeywords
    .filter(kw => terms.some(t => kw.word.includes(t)))
    .slice(0, 50)
    .map(kw => ({ keyword: kw.word, score: kw.heat || 0 }));
  console.log('🎯 候选数量:', candidates.length);

  if (candidates.length === 0) {
    console.log('⚠️ 无候选关键词');
    return { success: true, results: [], message: '无匹配关键词' };
  }

  try {
    const topKeywords = await ranker.rerank(query, candidates, 5);
    console.log('✅ rerank 完成，返回', topKeywords.length, '个结果');

    return {
      success: true,
      results: topKeywords.map(k => ({
        type: 'keyword',
        keyword: k.keyword,
        score: k.final_score,
        semantic_sim: k.semantic_sim
      }))
    };
  } catch (err) {
    console.error('❌ rerank 失败:', err);
    // 降级：直接返回候选（按 heat 排序）
    return {
      success: true,
      results: candidates.slice(0, 5).map(k => ({
        type: 'keyword',
        keyword: k.keyword,
        score: k.score,
        semantic_sim: 0
      }))
    };
  }
}

async function handleRecommend(offerId) {
  try {
    const products = await mtop.getRecommendations(offerId, 10);
    return { success: true, results: products };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

