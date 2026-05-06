// minimax_embedding.js - MiniMax Embedding API 客户端
// 基于 OpenAI 兼容接口

class MiniMaxEmbedding {
  constructor() {
    this.baseUrl = 'https://api.minimaxi.com/v1';
    this.apiKey = this.getApiKey();
    this.model = 'embedding-float';  // MiniMax embedding 模型名（需确认）
    this.cache = new Map();
  }

  /**
   * 从环境变量获取 API Key（必须）
   */
  getApiKey() {
    const key = process.env.MINIMAX_API_KEY;
    if (!key) {
      throw new Error('MINIMAX_API_KEY 环境变量未设置。请设置：export MINIMAX_API_KEY=sk-...');
    }
    return key;
  }

  /**
   * 获取单条文本的 embedding
   * @param {string} text - 输入文本
   * @returns {Promise<number[]>} 向量
   */
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
      throw new Error(`MiniMax API Error ${response.status}: ${err}`);
    }

    const json = await response.json();
    const vector = json.data[0].embedding;

    this.cache.set(text, vector);
    return vector;
  }

  /**
   * 批量嵌入（并发控制）
   * @param {string[]} texts - 文本数组
   * @param {number} concurrency - 并发数（默认 5）
   */
  async embedBatch(texts, concurrency = 5) {
    const results = [];
    const semaphore = new Array(concurrency).fill(null);

    await Promise.all(semaphore.map(async (_, idx) => {
      for (let i = idx; i < texts.length; i += concurrency) {
        try {
          const vec = await this.embed(texts[i]);
          results[i] = vec;
        } catch (err) {
          console.error(`Batch embed failed (index ${i}):`, err.message);
          results[i] = null;
        }
      }
    }));

    return results;
  }

  /**
   * 清空缓存
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = MiniMaxEmbedding;
