/**
 * 性能监控中间件 (Performance Monitor)
 * 职责：追踪慢操作、内存峰值、吞吐量统计
 * 位置：skills/knowledge-1688-mtop-api/local-server/performance-monitor.js
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { performance } from 'perf_hooks';

const WORKSPACE = 'C:/Users/Administrator/.openclaw/workspace';
const LOG_DIR = path.join(WORKSPACE, 'logs', 'performance');

/**
 * 性能监控器
 */
class PerformanceMonitor {
  constructor(options = {}) {
    this.slowThresholdMs = options.slowThresholdMs || 1000;  // 慢操作阈值
    this.memoryHighWatermark = options.memoryHighWatermark || 1024 * 1024 * 1024; // 1GB
    this.enabled = options.enabled !== false;
    this.metrics = {
      requests: 0,
      slowRequests: 0,
      totalDuration: 0,
      errors: 0,
      peakMemory: 0
    };
    this.requestHistory = []; // 最近 N 条请求记录

    // 确保日志目录存在
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  /**
   * 包装函数执行，自动计时
   */
  async time(name, fn, ...args) {
    const start = process.hrtime.bigint();
    const memBefore = process.memoryUsage().heapUsed;

    try {
      const result = await fn(...args);
      this.recordSuccess(name, start, memBefore);
      return result;
    } catch (err) {
      this.recordError(name, start, err);
      throw err;
    }
  }

  /**
   * 记录成功请求
   */
  recordSuccess(name, start, memBefore) {
    const durationMs = Number(process.hrtime.bigint() - start) / 1000000;
    const memAfter = process.memoryUsage().heapUsed;
    const memDelta = memAfter - memBefore;

    this.metrics.requests++;
    this.metrics.totalDuration += durationMs;
    this.metrics.peakMemory = Math.max(this.metrics.peakMemory, memAfter);

    if (durationMs > this.slowThresholdMs) {
      this.metrics.slowRequests++;
      this.logSlowOperation(name, durationMs, memDelta);
    }

    // 保留历史（最近 1000 条）
    this.requestHistory.push({
      name,
      timestamp: new Date().toISOString(),
      durationMs,
      memDelta,
      success: true
    });
    if (this.requestHistory.length > 1000) this.requestHistory.shift();
  }

  /**
   * 记录错误
   */
  recordError(name, start, err) {
    const durationMs = Number(process.hrtime.bigint() - start) / 1000000;
    this.metrics.errors++;

    this.requestHistory.push({
      name,
      timestamp: new Date().toISOString(),
      durationMs,
      error: err.message,
      success: false
    });
    if (this.requestHistory.length > 1000) this.requestHistory.shift();

    this.logError(name, durationMs, err);
  }

  /**
   * 日志：慢操作
   */
  logSlowOperation(name, durationMs, memDelta) {
    const logLine = `[SLOW] ${new Date().toISOString()} | ${name} | ${durationMs.toFixed(2)}ms | mem+${(memDelta/1024/1024).toFixed(2)}MB`;
    this.writeLog('slow.log', logLine);
  }

  /**
   * 日志：错误
   */
  logError(name, durationMs, err) {
    const logLine = `[ERROR] ${new Date().toISOString()} | ${name} | ${durationMs.toFixed(2)}ms | ${err.message}`;
    this.writeLog('errors.log', logLine);
  }

  /**
   * 写入日志文件
   */
  writeLog(filename, line) {
    const logFile = path.join(LOG_DIR, filename);
    fs.appendFileSync(logFile, line + '\n', 'utf8');
  }

  /**
   * 生成快照（当前指标）
   */
  snapshot() {
    const uptime = process.uptime();
    const avgDuration = this.metrics.requests > 0
      ? this.metrics.totalDuration / this.metrics.requests
      : 0;

    return {
      uptime: uptime,
      requests: this.metrics.requests,
      avgDurationMs: Math.round(avgDuration),
      slowRequests: this.metrics.slowRequests,
      errorRate: this.metrics.requests > 0
        ? (this.metrics.errors / this.metrics.requests * 100).toFixed(2) + '%'
        : '0%',
      peakMemoryMb: Math.round(this.metrics.peakMemory / 1024 / 1024),
      currentMemoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 导出统计报告
   */
  exportReport(filepath) {
    const report = {
      generatedAt: new Date().toISOString(),
      metrics: this.metrics,
      snapshot: this.snapshot(),
      topSlowOperations: this.requestHistory
        .filter(r => r.durationMs > this.slowThresholdMs)
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, 10)
    };
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[Performance] Report saved: ${filepath}`);
  }

  /**
   * 重置统计
   */
  reset() {
    this.metrics = { requests: 0, slowRequests: 0, totalDuration: 0, errors: 0, peakMemory: 0 };
    this.requestHistory = [];
  }

  /**
   * 定期自动保存（供 cron 调用）
   */
  scheduleAutoReport(intervalMs = 3600000) { // 默认 1 小时
    setInterval(() => {
      const dateStr = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const reportPath = path.join(LOG_DIR, `report-${dateStr}.json`);
      this.exportReport(reportPath);
      this.reset(); // 重置统计，开始新周期
    }, intervalMs);
  }
}

/**
 * 便捷函数：包装 Express 路由
 */
function middleware(monitor) {
  return async (req, res, next) => {
    const start = process.hrtime.bigint();
    const memBefore = process.memoryUsage().heapUsed;

    try {
      await next();
      const durationMs = Number(process.hrtime.bigint() - start) / 1000000;
      monitor.recordSuccess(req.path || req.url, start, memBefore);

      // 响应头添加耗时
      res.setHeader('X-Response-Time', `${durationMs.toFixed(2)}ms`);
    } catch (err) {
      const durationMs = Number(process.hrtime.bigint() - start) / 1000000;
      monitor.recordError(req.path || req.url, start, err);
      next(err);
    }
  };
}

export { PerformanceMonitor, middleware };
