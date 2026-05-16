# HEARTBEAT.md - Heartbeat Tasks

tasks:
  - name: memory-recall
    interval: 30m
    prompt: |
      Run: node memory/scripts/memory.js atoms recall "最近对话主题" --top 5
      Read memory/.dreams/recall-latest.md (if exists) to get previous results.
      Log comparison to memory/.dreams/recall-feedback.log:
      Format: [HH:mm] query=<query> added=<ids> dropped=<ids> scores=<top3>
      If results changed significantly, overwrite recall-latest.md with new output.
      If nothing needs attention, reply HEARTBEAT_OK.

  - name: memory-maintenance
    interval: 6h
    prompt: |
      1. Read memory/daily-logs/YYYY-MM-DD.md (today + yesterday) for recent context
      2. Check MEMORY.md line count: if >180 lines, run memory/scripts/memory.js compact
      3. Check memory/archive/ for files >30d unused, move to archive if found
      4. Update MEMORY.md if there are important new context entries from today
      If nothing needs attention, reply HEARTBEAT_OK.

  - name: system-health
    interval: 2h
    prompt: |
      1. Run: openclaw --version (check OpenClaw version)
      2. Check disk space: (Get-PSDrive C).Free / Used * 100 > 20%
      3. Run: openclaw gateway status (check Gateway is stable, no respawn loop)
      4. Run: git status --porcelain in workspace (check pending changes)
      If anything broke or unexpected error, reply with diagnostic summary.
      If disk < 20%, alert immediately.
      If nothing needs attention, reply HEARTBEAT_OK.

  - name: verifier-check
    interval: 12h
    prompt: |
      1. 检查 memory/plugins/ 和 ~/.openclaw/hooks/ 目录下的新文件
      2. 验证者心态：不是来确认没问题，是来尝试找出问题
      3. 重点查：语法错误、null 检查缺失、文件不存在 edge case
      4. 如果有问题，给出具体文件位置 + 修复建议
      如果无新文件或未发现问题，reply HEARTBEAT_OK.

## When to Reach Out

- OpenClaw has a new version available
- Disk space < 20%
- Anything broke or unexpected error
- It's been >8h since I said anything and there's something useful to share

## When to Stay Quiet

- Late night (23:00-08:00) unless urgent
- Human is clearly busy
- Nothing new since last check
- Just checked <30 minutes ago