// s2 Resources: where would you ask for help? Not graded; it is for exposure.
// The places are found ahead of time from the README (resourceLinks) and
// shown on the step card.

import { textAnswer, type StepDef } from "./shared";

export type Resource = { kind: "contributing" | "docs" | "discussions" | "chat" | "forum"; url: string };

const CHAT = /^https:\/\/(?:discord\.(?:gg|com)|[\w-]+\.slack\.com|join\.slack\.com|matrix\.to|app\.element\.io|gitter\.im|zulip(?:chat)?\.[\w.]+|[\w-]+\.zulipchat\.com)\//i;
const FORUM = /^https:\/\/(?:discuss\.|forum\.|community\.|groups\.google\.com\/)/i;

/** CONTRIBUTING, the docs site, Discussions and chat or forum links in the
 *  README, plus the repository's own CONTRIBUTING and Discussions pages. */
export function resourceLinks(readme: string, repo: string): Resource[] {
  const out = new Map<string, Resource>();
  const add = (kind: Resource["kind"], url: string) => { if (!out.has(url)) out.set(url, { kind, url }); };
  add("contributing", `https://github.com/${repo}/blob/HEAD/CONTRIBUTING.md`);
  for (const [raw] of readme.matchAll(/https:\/\/[^\s)<>"'\]]+/g)) {
    const url = raw.replace(/[.,;:!?]+$/, "");
    if (CHAT.test(url)) add("chat", url);
    else if (FORUM.test(url)) add("forum", url);
    else if (/\/discussions\b/i.test(url)) add("discussions", url);
    else if (/contributing/i.test(url)) add("contributing", url);
    else if (/^https:\/\/(?:docs\.|[\w-]+\.readthedocs\.io|[\w-]+\.github\.io)|\/docs?\b/i.test(url)) add("docs", url);
  }
  return [...out.values()].slice(0, 12);
}

export const s2: StepDef<string> = {
  id: "s2",
  title: "Where to ask for help",
  question: "Look at the places this project talks. Where would you ask a question if you got stuck, and why there?",
  hintQuestion: "Does the project say where questions belong: issues, Discussions or a chat?",
  nudge: "Check CONTRIBUTING and the README's \"Community\" or \"Support\" section.",
  needs: ["readme"],
  parseAnswer: (raw) => textAnswer(raw, 1, 1500),
  grade: () => null,
};
