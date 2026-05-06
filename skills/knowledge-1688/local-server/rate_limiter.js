// rate_limiter.js - 令牌桶限流器
// 防止 Ollama 或外部 API 被压垮

export class RateLimiter {
  /**
   * @param {number} rate  - 每秒允许的请求数
   * @param {number} burst - 突发容量（桶大小）
   */
  constructor(rate = 10, burst = 20) {
    this.rate = rate;        // 平均速率
    this.burst = burst;      // 最大突发
    this.tokens = burst;     // 当前令牌数
    this.lastRefill = Date.now();

    // 启动定时器自动补充令牌
    setInterval(() => this.refill(), 100);
  }

  /**
   * 获取令牌（阻塞直到有令牌）
   */
  async acquire() {
    while (true) {
      this.refill();  // 先补充

      if (this.tokens >= 1) {
        this.tokens -= 1;
        return true;
      }

      // 令牌不足，等待 100ms 重试
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * 补充令牌（按时间比例）
   */
  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;  // 秒
    const newTokens = elapsed * this.rate;

    if (newTokens >= 1) {
      this.tokens = Math.min(this.burst, this.tokens + newTokens);
      this.lastRefill = now;
    }
  }

  /**
   * 当前状态
   */
  getStatus() {
    this.refill();
    return {
      tokens: this.tokens,
      burst: this.burst,
      rate: this.rate,
      utilization: ((this.burst - this.tokens) / this.burst * 100).toFixed(1) + '%'
    };
  }
}

// 使用示例：
// const limiter = new RateLimiter(10, 20);  // 10 QPS，突发 20
// await limiter.acquire();  // 获取令牌（阻塞）
// console.log(limiter.getStatus());
