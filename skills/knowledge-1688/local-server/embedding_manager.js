// local-server/embedding_manager.js - 统一 Embedding 接口（纯 ES6 版）
// 支持 provider：ollama | minimax

export class EmbeddingManager {
  constructor(options = {}) {
    this.provider = options.provider || 'ollama';
    this.cache = new Map();
  }

  async ollamaEmbed(text) {
    if (this.cache.has(`ollama:${text}`)) {
      return this.cache.get(`ollama:${text}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch('http://localhost:11434/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'nomic-embed-text',
          prompt: text
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);
      const json = await response.json();
      const vec = json.embedding;
      this.cache.set(`ollama:${text}`, vec);
      return vec;
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') throw new Error('Ollama 请求超时（10秒）');
      throw err;
    }
  }

  async getEmbedding(text) {
    return await this.ollamaEmbed(text);
  }

  async getEmbeddings(texts, concurrency = 5) {
    const results = [];
    const semaphore = new Array(concurrency).fill(null);

    await Promise.all(semaphore.map(async (_, idx) => {
      for (let i = idx; i < texts.length; i += concurrency) {
        try {
          results[i] = await this.ollamaEmbed(texts[i]);
        } catch (err) {
          console.error(`Ollama batch failed (${i}):`, err.message);
          results[i] = null;
        }
      }
    }));

    return results;
  }

  cosineSim(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  clearCache() {
    this.cache.clear();
  }

  getStats() {
    return {
      provider: this.provider,
      cacheSize: this.cache.size,
      model: 'nomic-embed-text'
    };
  }
}
