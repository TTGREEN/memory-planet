# HEARTBEAT.md - Proactive Checklist

_Keep this small to limit token burn. Edit freely._

## Active Checks (rotate through)

**基础检查（每次心跳轮转）：**
- [ ] Memory maintenance — read recent memory/YYYY-MM-DD.md, update MEMORY.md if needed
- [ ] System health — OpenClaw version, disk space, running processes
- [ ] Project status — git status in workspace, any pending commits
- [ ] Check if OpenClaw update available (npm vs installed)

**主动检查（每 4 周期一次）：**
- [ ] OpenClaw Gateway 进程是否稳定（无 respawn 循环）
- [ ] 检查 heartbeat-state.json 的 lastChecks 时间戳是否有异常
- [ ] MEMORY.md 是否接近 200 行上限（超过 180 行则压缩）
- [ ] memory/archive/ 是否有超过 30 天未访问的文件（需归档）

## When to Reach Out

- OpenClaw has a new version available
- Disk space < 20%
- Anything broke or unexpected error
- It's been >8h since I said anything and there's something useful to share

## When to Stay Quiet

- Late night (23:00-08:00)
- Human is clearly busy
- Nothing new since last check
- Just checked <30 minutes ago

## Notes

- Heartbeat runs every 30 minutes
- Check heartbeat-state.json for last run timestamps
- Archive old memory entries to memory/archive/ when they get too old