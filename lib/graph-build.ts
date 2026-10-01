// Optional code-review-graph (CRG) helpers. Graph BUILDS go through
// lib/graph-worker.ts (disposable clone, symlinks removed, `python -I`): the
// in-place builder that used to live here ran `python -c` inside the clone, so
// a repository-committed graphify/ or code_review_graph/ package executed on
// the host. CRG queries run lib/crg-*.py from the app directory, not the clone.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { graphCacheDir } from "./graph";
export { graphCacheDir };

/** Path to the code-review-graph Python package, or null when it isn't
 *  configured.
 *
 *  This used to default to `C:/Users/rahul/crg-pkg` in four separate files.
 *  On any other machine that path doesn't exist, and the failure surfaced as
 *  an opaque Python ImportError rather than "the optional CRG feature isn't
 *  set up". Callers now check for null and degrade cleanly. */
export function crgPythonPath(): string | null {
  return process.env.CRG_PYTHONPATH || null;
}

/** True when CRG-backed features can run at all. */
export function crgAvailable(): boolean {
  return crgPythonPath() !== null;
}

export function crgDbPath(owner: string, repo: string): string {
  return join(graphCacheDir(owner, repo), ".code-review-graph", "graph.db");
}

export function hasCrg(owner: string, repo: string): boolean {
  return existsSync(crgDbPath(owner, repo));
}
