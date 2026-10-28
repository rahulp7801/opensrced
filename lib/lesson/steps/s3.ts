// s3 Two key libraries, with one learning resource each. Graded without a
// model: at least one pick is among the five dependencies the code imports
// most (counted from the graph's `imports` edges), and every pick has a link.
// Whether the link is the official docs is left to the teacher, who suggests
// better ones.

import type { GraphData } from "../../graph";
import { StepInputError, type StepDef } from "./shared";

export type LibraryPick = { name: string; url: string | null };

const IMPORT_RELATIONS = new Set(["imports", "imports_from"]);

/** A dependency's package name: `django.db.models` → `django`, `@scope/pkg/sub` → `@scope/pkg`. */
export function packageName(label: string): string {
  const clean = label.trim().replace(/\(\)$/, "").replace(/^["'`]|["'`]$/g, "").toLowerCase();
  if (clean.startsWith("@")) return clean.split("/").slice(0, 2).join("/");
  return clean.split(/[./:]/)[0];
}

/** External dependencies (nodes outside the repository's files) by how many
 *  import edges reach them, most imported first. */
export function topDependencies(graph: GraphData | null, limit = 5): string[] {
  if (!graph) return [];
  const external = new Map(graph.nodes.filter((n) => !n.source_file).map((n) => [n.id, packageName(n.label)]));
  const counts = new Map<string, number>();
  for (const link of graph.links) {
    const name = IMPORT_RELATIONS.has(link.relation) ? external.get(link.target) : undefined;
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([name]) => name);
}

/** "name — https://…" per line (any separator); 2 or 3 picks. */
function parsePicks(raw: unknown): LibraryPick[] {
  if (typeof raw !== "string") throw new StepInputError("The answer must be text.");
  const picks = raw.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const url = /https?:\/\/[^\s)<>"']+/.exec(line)?.[0]?.replace(/[.,;]+$/, "") ?? null;
    const name = line.replace(/https?:\/\/\S+/g, "").replace(/^[-*\d.)\s]+/, "").split(/\s+[-–—:|]\s*|\s*[:|]\s+|\s{2,}/)[0].trim();
    return { name: name.slice(0, 80), url };
  }).filter((p) => p.name);
  if (picks.length < 2) throw new StepInputError("Name two libraries, one per line, each with a link to learn it.");
  if (picks.length > 3) throw new StepInputError("Pick two (or at most three) libraries.");
  return picks;
}

export const s3: StepDef<LibraryPick[]> = {
  id: "s3",
  title: "Two key libraries",
  question: "Which two libraries does this project lean on most? For each, give one place to learn it (one per line: name — link).",
  hintQuestion: "Which imports show up at the top of almost every file?",
  nudge: "Open the dependency file (package.json, pyproject.toml, go.mod, Cargo.toml) and then a few core source files: what do they import?",
  needs: ["graph"],
  parseAnswer: parsePicks,
  grade(ctx, picks) {
    const missingLink = picks.filter((p) => !p.url).map((p) => p.name);
    const top = topDependencies(ctx.graph);
    const hits = picks.filter((p) => top.includes(packageName(p.name))).map((p) => p.name);
    // Without a graph there is nothing to rank against: the links decide.
    const inTop = top.length === 0 || hits.length > 0;
    const passed = inTop && missingLink.length === 0;
    const feedback = [
      missingLink.length ? `Add a link to learn ${missingLink.join(" and ")}.` : "",
      !inTop ? `Neither is among the libraries the code imports most${top.length ? ` (${top.join(", ")})` : ""}. Look again at the imports.` : "",
      passed ? `Good picks${hits.length ? `: ${hits.join(" and ")} ${hits.length === 1 ? "is" : "are"} among the most imported` : ""}.` : "",
    ].filter(Boolean).join(" ");
    return { passed, feedback, detail: { top, hits } };
  },
};
