/**
 * 性能剖析器 (Profiler)
 * 职责：定期 CPU/Memory 快照，识别热点函数
 * 位置：skills/knowledge-1688-mtop-api/local-server/profiler.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const WORKSPACE = 'C:/Users/Administrator/.openclaw/workspace';
const PROFILER_DIR = path.join(WORKSPACE, 'logs', 'profiler');

class Profiler {
  constructor(options = {}) {
    this.enabled = options.enabled || false;
    this.intervalMs = options.intervalMs || 3600000; // 默认 1 小时
    this.maxSamples = options.maxSamples || 10;
    this.samples = [];
    this.timer = null;

    fs.mkdirSync(PROFILER_DIR, { recursive: true });
  }

  /**
   * 启动周期性剖析
   */
  start() {
    if (!this.enabled) return;
    console.log('[Profiler] 启动周期性剖析（每 ' + (this.intervalMs / 1000 / 60) + ' 分钟）');

    this.timer = setInterval(() => {
      this.capture();
    }, this.intervalMs);
  }

  /**
   * 停止剖析
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 捕获性能快照
   */
  capture() {
    try {
      // 1. 堆快照（内存分析）
      if (global.gc && process.memoryUsage().heapUsed > 100 * 1024 * 1024) {
        this.captureHeapSnapshot();
      }

      // 2. CPU 剖析（使用 Node.js --prof）
      // 注意：生产环境建议外部触发，避免性能影响
      this.recordMetrics();

      // 3. 系统指标
      this.recordSystemMetrics();

      console.log('[Profiler] 快照已捕获');
    } catch (err) {
      console.error('[Profiler] 捕获失败:', err.message);
    }
  }

  /**
   * 记录指标（不阻塞）
   */
  recordMetrics() {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();

    this.samples.push({
      timestamp: new Date().toISOString(),
      memory: {
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        external: mem.external
      },
      cpu: {
        user: cpu.user,
        system: cpu.system
      },
      uptime: process.uptime()
    });

    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  /**
   * 记录系统指标
   */
  recordSystemMetrics() {
    const cpus = os.cpus();
    const loadAvg = os.loadAvg();

    // 计算总 CPU 使用率（简化）
    let totalIdle = 0, totalTick = 0;
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });

    const cpuUsage = ((totalTick - totalIdle) / totalTick * 100).toFixed(1);

    // 写入系统监控文件
    const sysData = {
      timestamp: new Date().toISOString(),
      hostname: os.hostname(),
      cpuUsage: parseFloat(cpuUsage),
      loadAvg: loadAvg.map(v => Number(v.toFixed(2))),
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      uptime: os.uptime()
    };

    const sysFile = path.join(PROFILER_DIR, 'system.jsonl');
    fs.appendFileSync(sysFile, JSON.stringify(sysData) + '\n', 'utf8');
  }

  /**
   * 触发堆快照（需要 --heap-prof 或 Chrome DevTools）
   */
  captureHeapSnapshot() {
    // 触发 V8 heap snapshot（需启动时加 --heap-prof）
    // 这里仅记录警告
    console.warn('[Profiler] 内存使用 >100MB，建议重启服务或检查泄漏');
  }

  /**
   * 生成报告（最近 N 条采样）
   */
  generateReport(limit = 100) {
    const samples = this.samples.slice(-limit);
    const avgMem = samples.reduce((sum, s) => sum + s.memory.heapUsed, 0) / samples.length;
    const avgCpu = samples.reduce((sum, s) => sum + parseFloat(s.cpu.user + s.cpu.system), 0) / samples.length;

    return {
      generatedAt: new Date().toISOString(),
      sampleCount: samples.length,
      averageMemoryMb: Math.round(avgMem / 1024 / 1024),
      averageCpuMs: Math.round(avgCpu),
      latest: samples[samples.length - 1],
      trend: this.analyzeTrend(samples)
    };
  }

  /**
   * 趋势分析（内存增长判断）
   */
  analyzeTrend(samples) {
    if (samples.length < 10) return 'insufficient data';

    const memValues = samples.map(s => s.memory.heapUsed);
    const recent = memValues.slice(-5);
    const earlier = memValues.slice(0, 5);

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const earlierAvg = earlier.reduce((a, b) => a + b, 0) / earlier.length;

    const growth = (recentAvg - earlierAvg) / earlierAvg * 100;

    if (growth > 20) return `memory growing (+${growth.toFixed(1)}%)`;
    if (growth < -10) return `memory shrinking (${growth.toFixed(1)}%)`;
    return 'stable';
  }

  /**
   * 导出报告到文件
   */
  exportReport() {
    const dateStr = new Date().toISOString().slice(0, 10);
    const reportPath = path.join(PROFILER_DIR, `report-${dateStr}.json`);
    const report = this.generateReport();
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[Profiler] Report saved: ${reportPath}`);
    return report;
  }
}

/**
 * 便捷函数：启动 profiling（命令行触发）
 */
function runProfiling(durationMs = 30000, outputDir = PROFILER_DIR) {
  console.log(`[Profiler] 启动 profiling（${durationMs}ms）...`);
  const start = process.hrtime.bigint();

  // 定时中断
  setTimeout(() => {
    const duration = Number(process.hrtime.bigint() - start) / 1000000;
    console.log(`[Profiler] 完成: ${duration.toFixed(2)}ms`);
    process.exit(0);
  }, durationMs);
}

module.exports = { Profiler, runProfiling };
