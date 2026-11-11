// Copies the MCP server from harness/ into the extension (vscode/server/), so the
// .vsix carries it. harness/ stays the one source: vscode/server/ is gitignored.

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const harness = join(here, "..", "..", "harness");
const out = join(here, "..", "server");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "views"), { recursive: true });
for (const file of ["server.mjs", "graph.mjs", "views/lesson.html"]) cpSync(join(harness, file), join(out, file));
// The repository's licence ships in the .vsix (vsce stops to ask without one).
cpSync(join(here, "..", "..", "LICENSE"), join(here, "..", "LICENSE"));
console.log(`bundled the opensrcer server into ${out}`);
