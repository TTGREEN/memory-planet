// plugin/recall.ts — Recall wrapper for atoms-db.js
// Loads atoms-db.js from the workspace memory/scripts directory

import { dirname } from "path";
import { fileURLToPath } from "url";

interface Atom {
  id: string;
  content: string;
  importance: number;
}

interface RecallOptions {
  top: number;
  minScore: number;
}

/**
 * Get the absolute path to atoms-db.js.
 * Resolves from <workspace>/memory/scripts/atoms-db.js
 * regardless of where this plugin is installed.
 */
function getAtomsDbPath(): string {
  // This file: <workspace>/memory/plugins/memory-recall-inject/plugin/recall.ts
  // Go up to workspace root: ../../../../.. then /memory/scripts/atoms-db.js
  const thisFile = fileURLToPath(import.meta.url);
  const workspaceRoot = dirname(dirname(dirname(dirname(thisFile))));
  return `${workspaceRoot}/memory/scripts/atoms-db.js`;
}

let dbPromise: ReturnType<typeof import> | null = null;

async function getDb() {
  if (!dbPromise) {
    const path = getAtomsDbPath();
    dbPromise = import(path).catch((err) => {
      console.warn("[memory-recall-inject] failed to load atoms-db.js:", err);
      return null;
    });
  }
  return dbPromise;
}

/**
 * Query atoms.db for top N atoms matching the query string.
 * Filters by minimum importance score.
 */
export async function recallAtoms(
  query: string,
  options: RecallOptions,
): Promise<Atom[]> {
  try {
    const mod = await getDb();
    if (!mod || !mod.recall) return [];

    // recall() returns atoms sorted by importance descending
    const all = mod.recall(query) as Atom[];
    return all
      .filter((a) => a.importance >= options.minScore)
      .slice(0, options.top);
  } catch (err) {
    // Fail silently rather than breaking the hook
    console.warn("[memory-recall-inject] recallAtoms failed:", err);
    return [];
  }
}