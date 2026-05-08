# Dream Integration — OpenClaw Dreaming + Custom Scripts

## Overview

OpenClaw's built-in **Dreaming system** and the workspace's custom memory scripts are complementary, not competing. Dreaming handles automated cross-session memory promotion; custom scripts handle health checks, consolidation, and project context.

---

## What Dreaming Handles

### Automated Promotion Pipeline

Dreaming runs on a cron (`0 3 * * *`, 3 AM UTC daily) and processes sessions in three phases:

| Phase | What it does | Output |
|-------|-------------|--------|
| **Light Sleep** | Deduplicates session corpus entries; assigns confidence scores | Staged candidates in `light/` |
| **Deep Sleep** | Six-dimension weighted scoring; strict promotion thresholds | `deep/` — candidates for MEMORY.md |
| **REM Sleep** | Cross-session pattern detection; abstract "lasting truths" | `rem/` — theme-level insights |

### Six Scoring Signals (Deep Sleep)

Weights from design doc:
- **Frequency** × 0.24 — recall count in recall store
- **Relevance** × 0.30 — semantic match to context
- **Query Diversity** × 0.15 — different query hashes triggering this entry
- **Recency** × 0.15 — last recalled timestamp
- **Consolidation** × 0.10 — grounded count (successful recall)
- **Conceptual Richness** × 0.06 — conceptTags array size

**Promotion requires:** `score ≥ 0.8` AND `recallCount ≥ 3`

Current status (2026-05-08): all 192 recall entries have `recallCount = 0`, so 0 promotions. This is normal — the system needs recall signals to accumulate over time.

### Session Corpus Ingestion

- Sessions are automatically written to `memory/.dreams/session-corpus/YYYY-MM-DD.txt`
- **Filename uses UTC date**, not local date
- Corpus files are the raw material for dreaming's analysis
- `session-ingestion.json` tracks which session files have been processed

### Recall Store

`memory/.dreams/short-term-recall.json` — per-segment recall tracking

**Entry format:**
```json
{
  "key": "memory:memory/.dreams/session-corpus/2026-05-07.txt:35:35",
  "path": "memory/.dreams/session-corpus/2026-05-07.txt",
  "startLine": 35,
  "endLine": 35,
  "snippet": "Assistant: 收到，仕泽！🦐 开始干活。...",
  "recallCount": 0,
  "dailyCount": 1,
  "groundedCount": 0,
  "totalScore": 0.58,
  "maxScore": 0.58,
  "firstRecalledAt": "2026-05-08T00:51:13.010Z",
  "lastRecalledAt": "2026-05-08T00:51:13.010Z",
  "conceptTags": ["收到", "开始", "干活", ...]
}
```

---

## What Custom Scripts Handle

| Script | Responsibility | Trigger |
|--------|---------------|---------|
| `flush.ps1` | Session-end checkpoint: daily log + topic updates + state files | Manual or session-end hook |
| `consolidate-memory.ps1` | MEMORY.md 200-line cap check; low-activation archive candidates | Hook (async) |
| `check-consistency.ps1` | Index drift detection; topic file staleness | Hook (async) |
| `memory-maintenance/handler.js` | Bootstrap: @project:xxx loading + session-corpus ingestion check | OpenClaw `agent:bootstrap` event |

---

## Division of Labor

```
OpenClaw Dreaming (built-in)
├── Session corpus ingestion (automatic)
├── Recall store maintenance (automatic)
├── Light/Deep/REM scoring (automatic, 3 AM cron)
└── Automatic promotion to MEMORY.md (threshold-gated)

Custom Scripts (workspace)
├── Human-facing health checks
├── MEMORY.md line cap enforcement
├── flush.ps1 checkpoint discipline
├── @project:xxx topic file loading
└── Session-corpus ingestion monitoring
```

**Key principle:** Custom scripts should feed INTO the dreaming system, not replace it. Daily logs written by `flush.ps1` become part of the session corpus that dreaming analyzes. Topic files updated by consolidation become richer context for future sessions.

---

## File Locations Reference

| What | Where |
|------|-------|
| Dreaming config | `memory/.dreams/` |
| Session corpus | `memory/.dreams/session-corpus/YYYY-MM-DD.txt` |
| Recall store | `memory/.dreams/short-term-recall.json` |
| Phase outputs | `memory/dreaming/{light,deep,rem}/YYYY-MM-DD.md` |
| Custom scripts | `memory/scripts/*.ps1` |
| Maintenance hook | `hooks/memory-maintenance/handler.js` |

---

_Last updated: 2026-05-08 14:00_
