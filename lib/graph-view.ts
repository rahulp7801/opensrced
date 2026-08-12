// Pure rendering/suggestion logic for the codebase map.
//
// Split out of app/graph/page.tsx for the same reason as lib/diff-view.ts:
// these are the parts that can be quietly wrong. A markdown block parser that
// mis-splits still renders something, and a follow-up chip that suggests
// `trace ` with an empty symbol still looks like a button. Neither throws.

export type MdBlock =
  | { type: "paragraph"; content: string }
  | { type: "heading"; content: string }
  | { type: "bullet"; content: string }
  | { type: "code"; content: string; lang: string };

/**
 * Split an LLM answer into renderable blocks.
 *
 * Called on every streamed token, so it sees a lot of half-written input: an
 * unterminated ``` fence is normal mid-stream, not malformed, and is treated
 * as a code block running to the end of what has arrived so far.
 */
export function parseMarkdownBlocks(text: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = text.split("\n");
  const isBreak = (l: string) =>
    l.startsWith("```") ||
    /^#{1,4}\s/.test(l) ||
    /^\s*[-*]\s/.test(l) ||
    /^\s*\d+[.)]\s/.test(l);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // closing fence, if it arrived
      blocks.push({ type: "code", content: codeLines.join("\n"), lang });
      continue;
    }
    if (/^#{1,4}\s/.test(line)) {
      blocks.push({ type: "heading", content: line.replace(/^#+\s*/, "") });
      i++;
      continue;
    }
    if (/^\s*[-*]\s/.test(line)) {
      blocks.push({ type: "bullet", content: line.replace(/^\s*[-*]\s+/, "") });
      i++;
      continue;
    }
    if (/^\s*\d+[.)]\s/.test(line)) {
      blocks.push({ type: "bullet", content: line.replace(/^\s*\d+[.)]\s+/, "") });
      i++;
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBreak(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", content: paraLines.join(" ") });
  }
  return blocks;
}

/**
 * Three next queries to offer under a finished answer.
 *
 * Every suggestion has to be a runnable query. `trace` and `impact` need a
 * symbol and `explain` needs a path, so a suggestion is only emitted once the
 * argument is known to be non-empty — a bare `trace` chip is a dead end the
 * user has to discover by clicking it.
 */
export function generateFollowUps(query: string, response: string): string[] {
  const q = query.toLowerCase().trim();
  const out: string[] = [];

  const push = (verb: string, arg?: string | null) => {
    const a = arg?.replace("()", "").trim();
    if (!a) return;
    const s = `${verb} ${a}`;
    if (!out.includes(s)) out.push(s);
  };

  // Symbols the answer actually named — "-> foo", "* foo", "<- foo".
  const symbols = (response.match(/(?:^|\n)\s*(?:\*|->|<-)\s+(\w[\w.]*(?:\(\))?)/g) ?? [])
    .map((m) => m.replace(/^\s*(?:\*|->|<-)\s+/, "").trim())
    .filter((s) => s.length > 2 && s.length < 40);

  const paths = [...new Set(response.match(/\b\w+\/[\w/.-]+/g) ?? [])].slice(0, 3);
  const dirOfFirstPath = () => {
    const p = paths[0];
    if (!p) return null;
    return p.split("/").slice(0, -1).join("/") || p;
  };

  if (q === "help" || q === "-help" || q === "--help") {
    return ["stats", "god nodes", "explain src"];
  }

  if (q === "stats" || q === "statistics" || q === "overview") {
    out.push("god nodes");
    // Explain the busiest module the stats output listed, if it listed one.
    const mod = response.match(/^\s+(\S+\/\S+):/m);
    out.push(mod ? `explain ${mod[1]}` : "explain src");
    return out.slice(0, 3);
  }

  if (q.startsWith("god")) {
    push("trace", symbols[0]);
    push("impact", symbols[0]);
    out.push("stats");
    return out.slice(0, 3);
  }

  if (q.startsWith("trace ")) {
    push("impact", query.slice(6));
    push("trace", symbols[1]); // something the traced function calls
    push("explain", dirOfFirstPath());
    return out.slice(0, 3);
  }

  if (q.startsWith("impact ")) {
    const sym = query.slice(7).trim();
    push("trace", sym);
    push("impact", symbols.find((s) => s.toLowerCase() !== sym.toLowerCase()));
    push("explain", dirOfFirstPath());
    return out.slice(0, 3);
  }

  if (q.startsWith("explain ")) {
    push("trace", symbols[0]);
    push("impact", symbols[0]);
    out.push("god nodes");
    return out.slice(0, 3);
  }

  if (q.startsWith("path ")) {
    // Split the original, not the lowercased copy: symbol lookup is
    // case-sensitive, so `path AuthService to Billing` must not suggest
    // `impact authservice`.
    const ends = query.trim().slice(5).split(/\s+(?:to|→|->)\s+/i);
    if (ends.length >= 2) {
      push("impact", ends[0]);
      push("trace", ends[1]);
    }
    out.push("god nodes");
    return out.slice(0, 3);
  }

  push("trace", symbols[0]);
  push("impact", symbols[0]);
  out.push("help");
  return out.slice(0, 3);
}
