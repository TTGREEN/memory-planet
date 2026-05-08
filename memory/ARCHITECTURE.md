# Memory System Architecture v3

> **Status:** ✅ Fully Implemented
> **Date:** 2026-05-08
> **Supersedes:** memory/topics/memory-system.md, memory/topics/dream-integration.md

---

## Phase Execution Status

| Phase | Description | Status | Notes |
|-------|-------------|--------|-------|
| 1 | Create `memory.js` + `config.json` | ✅ Done | All 6 sub-commands implemented |
| 2 | Redirect usage to `memory.js` | ✅ Done | AGENTS.md references `memory.js` |
| 3 | Delete redundant scripts | ✅ Done | 11 scripts → archive; flush.ps1 deleted |
| 4 | Archive design docs | ✅ Done | Topic files marked obsolete |

**Last updated:** 2026-05-08 17:37 (flush.ps1 deleted, topic files marked obsolete)

---

## 1. The Problem: Script Sprawl

Currently 8+ independent scripts in `memory/scripts/`:

| Script | Lang | Overlaps with |
|--------|------|--------------|
| `consolidate-memory.ps1` | PS | Dreaming (score decay) |
| `consolidate-memory.js` | JS | Dreaming (score decay), above |
| `compact-memory.ps1` | PS | AGENTS.md (200-line cap) |
| `check-consistency.ps1` | PS | Topic index files |
| `flush.ps1` | PS | Daily log writing |
| `scan-project.ps1` | JS | Project state |
| `search-logs.js` + `.ps1` | both | FTS5 SQLite index |
| `build-search-index.ps1` | PS | Same as search-logs.js |

**Core issue:** Score decay and low-activation detection run independently in workspace scripts, unaware that OpenClaw Dreaming already owns the recall store with proper six-dimension scoring.

---

## 2. Clear Division: OpenClaw vs Workspace

### OpenClaw (Dreaming) OWNS

These are **platform-native** — workspace scripts MUST NOT replicate:

- ✅ Six-dimension recall scoring (Frequency, Relevance, QueryDiversity, Recency, Consolidation, ConceptualRichness)
- ✅ Automatic promotion from session corpus → recall store → MEMORY.md
- ✅ Daily 3 AM cron scheduling
- ✅ Recall store (`memory/.dreams/short-term-recall.json`) with 192 entries
- ✅ Session corpus ingestion (writes `session-corpus/YYYY-MM-DD.txt`)
- ✅ Light/Deep/REM phase scoring

### Workspace OWNS

These are **workspace-specific** — Dreaming cannot know about them:

- ✅ Session-end `flush.ps1` → writes daily logs + project state + topic lessons
- ✅ Project awareness: `scan-project.ps1` → writes `memory/state/<project>.md`
- ✅ Full-text search: `search-logs.js` → SQLite FTS5 over daily logs
- ✅ MEMORY.md 200-line cap enforcement (workspace-level policy)
- ✅ Pattern detection from daily logs → topic promotion candidates
- ✅ Index drift detection (topics index vs disk)
- ✅ Hook handler: bootstrap event → loads `@project:xxx` context

---

## 3. Layered Memory Model

This architecture defines 4 tiers. **No changes to tier definitions** — they're already correct in the current design.

| Tier | Name | Location | Load | Hard Limit |
|------|------|----------|------|------------|
| L0 | HOT | `MEMORY.md` (pointer index) | Injected at every session start | 200 lines |
| L1 | WARM | `memory/topics/*.md` | On `@project:xxx` trigger | Per-file |
| L2 | COLD | `memory/daily-logs/YYYY-MM-DD.md` | Today + yesterday at session start | None |
| L3 | FROZEN | `memory/archive/` | Never auto-loaded | None |

**Critical rule:** L0 content is frozen at session start. Changes write-through to disk but only take effect next session.

---

## 4. The ONE Script: `memory/scripts/memory.js`

**Replaces ALL current scattered scripts.** Cross-platform Node.js entry point.

```
memory/scripts/
├── memory.js              ← THE ONE SCRIPT (replaces all below)
├── flush.ps1              ← REMOVE (absorbed into memory.js flush)
├── consolidate-memory.ps1 ← REMOVE (Dreaming owns scoring)
├── consolidate-memory.js  ← REMOVE (Dreaming owns scoring)
├── compact-memory.ps1     ← MERGE into memory.js compact sub-command
├── check-consistency.ps1  ← MERGE into memory.js health sub-command
├── scan-project.ps1       ← MERGE into memory.js project sub-command
├── search-logs.js         ← MERGE into memory.js search sub-command
├── search-logs.ps1        ← REMOVE (search-logs.js is cross-platform)
├── build-search-index.ps1 ← REMOVE (search sub-command handles this)
├── test-compact-memory.ps1    ← REMOVE (tests inline or removed)
├── test-consolidate-memory.ps1← REMOVE
└── test-enc.ps1            ← REMOVE
```

### Central Config: `memory/config.json`

```json
{
  "memoryRoot": "C:/Users/Administrator/.openclaw/workspace/memory",
  "workspaceRoot": "C:/Users/Administrator/.openclaw/workspace",
  "memoryFile": "C:/Users/Administrator/.openclaw/workspace/MEMORY.md",
  "lineHardLimit": 200,
  "lineSoftLimit": 150,
  "activationThreshold": 20,
  "staleDays": 30,
  "patternMinCount": 3,
  "searchDbPath": "C:/Users/Administrator/.openclaw/workspace/memory/logs.db",
  "dailyLogsDir": "C:/Users/Administrator/.openclaw/workspace/memory/daily-logs",
  "topicsDir": "C:/Users/Administrator/.openclaw/workspace/memory/topics",
  "stateDir": "C:/Users/Administrator/.openclaw/workspace/memory/state",
  "archiveDir": "C:/Users/Administrator/.openclaw/workspace/memory/archive"
}
```

### Sub-commands

```bash
node memory.js flush     # Session-end checkpoint
node memory.js health    # Index drift + MEMORY.md cap check
node memory.js consolidate # Pattern detection from daily logs
node memory.js search    # FTS5 full-text search
node memory.js project   # Scan and update project state
node memory.js compact    # MEMORY.md 200-line enforcement
```

#### `flush` — Session End Checkpoint
- **Inputs:** `--working`, `--blocked`, `--next`, `--projects`, `--lessons`
- **Writes:** `memory/daily-logs/YYYY-MM-DD.md`, `memory/state/<project>.md`, appends blocked threads to MEMORY.md
- **Note:** No longer does score decay or activation management — Dreaming owns that

#### `health` — Consistency Check (replaces `check-consistency.ps1`)
- MEMORY.md line count vs 200 hard limit
- Topic files referenced in index vs on disk (orphan detection)
- Required directory structure integrity
- Stale topic files (>30 days untouched)
- **Does NOT:** do score decay (Dreaming's job)

#### `consolidate` — Pattern Detection Only (replaces both `consolidate-memory.*`)
- Scans `memory/daily-logs/` for dated lesson entries
- Counts occurrences of each lesson pattern
- Reports patterns appearing 3+ times as HOT promotion candidates
- **Does NOT:** do score decay (Dreaming owns recall store scoring)
- **Does NOT:** modify topic files' activation scores directly

#### `search` — FTS5 Search (replaces `search-logs.js` + `build-search-index.ps1`)
- Builds/updates SQLite FTS5 index on first run or with `--reindex`
- Searches daily logs by query
- Usage: `node memory.js search <query> [--limit=10]`

#### `project` — Project Awareness (replaces `scan-project.ps1`)
- Scans a project directory for structure, git status, knowledge files
- Writes structured output to `memory/state/<project>.md`
- Usage: `node memory.js project <path>`

#### `compact` — MEMORY.md Compression (from `compact-memory.ps1`)
- Triggered when MEMORY.md exceeds 200 lines
- Removes entries with activation score < 20
- Merges duplicate entries
- Compact empty lines

---

## 5. Integration Points

### How Workspace Scripts Feed INTO Dreaming

```
flush.ps1 (session-end)
  → writes memory/daily-logs/YYYY-MM-DD.md
      → Dreaming auto-ingests session corpus (writes memory/.dreams/session-corpus/)
          → Dreaming scores with six dimensions
              → Automatic promotion to MEMORY.md (when thresholds met)
```

**Key insight:** `flush.ps1` does NOT write directly to the recall store. It writes daily logs, which Dreaming ingests as session corpus. Dreaming's scoring pipeline does the rest.

### Hooks Integration

The OpenClaw `agent:bootstrap` event triggers `hooks/memory-maintenance/handler.js`, which:
1. Loads `@project:xxx` topic files on demand
2. Checks session corpus ingestion health
3. **Should call** `node memory.js health` (non-blocking)

### Dreaming → Workspace Handoff

When Dreaming promotes content to MEMORY.md:
- Dreaming writes directly to `MEMORY.md`
- Workspace scripts read `MEMORY.md` (read-only from workspace perspective)
- Workspace scripts should NEVER write activation scores to MEMORY.md — that breaks Dreaming's scoring

---

## 6. Migration Plan

### Phase 1: Create `memory.js` + `config.json` (no deletion yet)
- Implement all 6 sub-commands
- New script fully functional alongside old scripts
- No breaking changes

### Phase 2: Redirect usage
- Update AGENTS.md memory section to reference `memory.js`
- Update any hooks/cron to use `memory.js`
- Old scripts still exist but are not invoked

### Phase 3: Delete redundant scripts
After verifying `memory.js` handles all use cases:
```
DELETE: consolidate-memory.ps1
DELETE: consolidate-memory.js
DELETE: search-logs.ps1
DELETE: build-search-index.ps1
DELETE: test-compact-memory.ps1
DELETE: test-consolidate-memory.ps1
DELETE: test-enc.ps1
```
Note: `flush.ps1`, `compact-memory.ps1`, `check-consistency.ps1`, `scan-project.ps1`, `search-logs.js` are absorbed into `memory.js` — original files deleted after migration verified.

### Phase 4: Archive design docs
- `memory/topics/memory-system.md` — marked obsolete, replaced by this file
- `memory/topics/dream-integration.md` — mark obsolete, integrate summary into this file

---

## 7. What Dreaming Already Handles (Do Not Replicate)

| Function | Dreaming Location | Status |
|----------|-------------------|--------|
| Score decay | Recall store scoring | ✅ Built-in |
| Low-activation detection | Six-dimension scoring | ✅ Built-in |
| Pattern detection (cross-session) | REM phase | ✅ Built-in |
| Daily 3 AM cron | Dreaming cron config | ✅ Built-in |
| Session corpus ingestion | Automatic on session end | ✅ Built-in |
| Recall store | `memory/.dreams/short-term-recall.json` | ✅ 192 entries |

The `consolidate-memory.*` scripts currently try to do score decay on topic files, but Dreaming scores entries in its own recall store — not in topic files. Topic files are L1/WARM storage, not Dreaming's scoring surface. **Therefore, the workspace score-decay approach was always decoupled from Dreaming's actual scoring engine.**

The consolidation scripts' pattern detection (3x same lesson in daily logs) is still useful — it's a workspace-level signal Dreaming doesn't have. This is the one function worth keeping in the new `consolidate` sub-command.

---

## 8. File Layout After Migration

```
memory/
├── ARCHITECTURE.md           ← This file (fully implemented)
├── config.json               ← Central configuration
├── scripts/
│   └── memory.js             ← THE ONE SCRIPT (6 sub-commands)
│   └── flush.ps1             ← DELETED 2026-05-08 (memory.js flush is the only entry)
│   └── consolidate-memory.*  ← Archived 2026-05-08 (Dreaming owns scoring)
│   └── compact-memory.ps1    ← Archived 2026-05-08 (absorbed into memory.js)
│   └── check-consistency.ps1 ← Archived 2026-05-08 (absorbed into memory.js)
│   └── scan-project.ps1      ← Archived 2026-05-08 (absorbed into memory.js)
│   └── search-logs.*         ← Archived 2026-05-08 (absorbed into memory.js)
│   └── build-search-index.ps1← Archived 2026-05-08 (absorbed into memory.js)
│   └── node_modules/         ← better-sqlite3 (git-ignored)
│   └── package.json          ← Dependencies
├── topics/
│   ├── memory-system.md       ← ⚠️ OBSOLETE — content moved here
│   └── dream-integration.md  ← ⚠️ OBSOLETE — content moved here
├── daily-logs/
├── state/
├── indexes/
├── archive/
│   └── scripts-2026-05-08/  ← Archived originals (git history preserved)
└── logs.db                   ← FTS5 search index (better-sqlite3, git-ignored)

hooks/
└── memory-maintenance/
    └── handler.js            ← Calls: node memory.js health
```

---

## 9. Key Design Decisions

1. **Node.js only for the unified script** — no PowerShell duplication. PowerShell scripts are harder to invoke cross-platform and harder to chain as sub-commands.

2. **Config in `memory/config.json`** — single source of truth for paths, thresholds, and limits. No hard-coded paths scattered across scripts.

3. **Consolidation is pattern-detection only** — score decay on topic files was always disconnected from Dreaming's actual recall store. The useful part is the daily-log pattern scanner, which Dreaming can't do (it only sees session corpus, not raw daily logs).

4. **`flush` is still the session-end checkpoint** — it writes to daily logs (Dreaming's input) and project state. It does NOT manage MEMORY.md content directly; Dreaming's promotion pipeline handles that.

5. **MEMORY.md compact is workspace-level policy** — Dreaming promotes to MEMORY.md; the workspace enforces the 200-line cap. These are complementary.

6. **No automatic cron in the unified script** — Dreaming already has 3 AM cron. Workspace `memory.js health` is invoked by the bootstrap hook, not by a separate cron.

---

_Last updated: 2026-05-08_
