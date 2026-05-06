// local-server/minimax_embedding.js - MiniMax Embedding 客户端（ES6）
// 基于 OpenAI 兼容接口

export default class MiniMaxEmbedding {
  constructor() {
    this.baseUrl = 'https://api.minimaxi.com/v1';
    this.apiKey = this.getApiKey();
    this.model = 'embedding-float';
    this.cache = new Map();
  }

  getApiKey() {
    const key = process.env.MINIMAX_API_KEY;
    if (!key) {
      throw new Error('MINIMAX_API_KEY 环境变量未设置');
    }
    return key;
  }

  async embed(text) {
    if (this.cache.has(text)) {
      return this.cache.get(text);
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        input: text
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`MiniMax API Error (${response.status}): ${err}`);
    }

    const json = await response.json();
    const vec = json.embedding || json.data?.embedding;
    if (!vec) {
      throw new Error('MiniMax API 返回格式异常');
    }

    this.cache.set(text, vec);
    return vec;
  }

  async embedBatch(texts, concurrency = 5) {
    const results = [];
    const semaphore = new Array(concurrency).fill(null);

    await Promise.all(semaphore.map(async (_, idx) => {
      for (let i = idx; i < texts.length; i += concurrency) {
        try {
          results[i] = await this.embed(texts[i]);
        } catch (err) {
          console.error(`MiniMax batch failed (${i}):`, err.message);
          results[i] = null;
        }
      }
    }));

    return results;
  }

  clearCache() {
    this.cache.clear();
  }
}
