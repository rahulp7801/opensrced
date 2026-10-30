// The leak check (PLAN §7.3, §8.3): run on every teacher reply before it is
// sent, with no model call. Two signals:
//
//   1. Code: the reply repeats the hidden diff's ADDED lines, by word-triple
//      overlap (copyOverlap from lib/understanding.ts). Checked per line (one
//      quoted line of the fix is a leak even inside a long reply) and over the
//      whole reply (a paraphrased dump of the patch).
//   2. Names: the reply names a changed file or symbol before the stage that
//      unlocks it. File names unlock at hint level 2 of s7 (and once s7 is
//      done); symbols only at hint level 3 of s8. A name the contributor
//      already wrote themselves is theirs to discuss.
//
// After the reveal nothing is hidden, so nothing leaks.

import { copyOverlap } from "../understanding";
import type { Stage } from "./machine";

export type LeakResult = { leak: boolean; reasons: string[] };

/** Share of one added line's word triples found in the reply. At or above
 *  this, the reply quotes that line. */
export const LINE_LEAK_THRESHOLD = 0.6;
/** Share of the reply's word triples taken from the added lines. */
export const REPLY_LEAK_THRESHOLD = 0.35;
/** Lines shorter than this many words (`return None`, `}`) are too generic to count. */
const MIN_LINE_WORDS = 4;
/** Shorter symbols (`x`, `run`) match too much ordinary prose. */
const MIN_SYMBOL_LENGTH = 4;

export type HiddenDiff = { addedLines: string[]; files: string[]; symbols: string[] };

const wordCount = (text: string) => (text.match(/[\p{L}\p{N}_]+/gu) ?? []).length;

/** What the hidden diff gives away: its added lines (minus lines that were
 *  already in the file, which the contributor can read anyway), the files it
 *  changes, and the symbols it defines or changes. */
export function hiddenDiffFacts(diff: string): HiddenDiff {
  const files = new Set<string>();
  const symbols = new Set<string>();
  const added: string[] = [];
  const existing = new Set<string>();
  const definition = /^[+-]\s*(?:export\s+)?(?:pub\s+)?(?:async\s+)?(?:def|function|fn|func|class|struct|interface|type|const|let|var)\s+([A-Za-z_]\w*)/;
  for (const line of diff.replace(/\r\n/g, "\n").split("\n")) {
    const file = /^\+\+\+ (?:b\/)?(\S+)/.exec(line)?.[1];
    if (file) { if (file !== "/dev/null") files.add(file); continue; }
    if (line.startsWith("---") || line.startsWith("diff --git") || line.startsWith("index ")) continue;
    // The hunk header names the enclosing function: "@@ -1,4 +1,5 @@ def save_session(self, app):"
    const hunk = /^@@[^@]*@@\s*(.*)$/.exec(line);
    if (hunk) {
      const enclosing = /([A-Za-z_]\w*)\s*\(/.exec(hunk[1])?.[1];
      if (enclosing) symbols.add(enclosing);
      continue;
    }
    const defined = definition.exec(line)?.[1];
    if (defined) symbols.add(defined);
    if (line.startsWith("+")) added.push(line.slice(1).trim());
    else existing.add(line.slice(1).trim());
  }
  return {
    addedLines: added.filter((l) => wordCount(l) >= MIN_LINE_WORDS && !existing.has(l)),
    files: [...files],
    symbols: [...symbols].filter((s) => s.length >= MIN_SYMBOL_LENGTH),
  };
}

/** Where the lesson is, for deciding which names are still hidden. */
export type LeakGate = {
  stage: Stage;
  revealed: boolean;
  /** Highest hint level shown for s7 / s8 (-1: none). */
  s7HintLevel: number;
  s8HintLevel: number;
  /** s7 is done, so its grading has already pointed at the fix's files. */
  s7Done: boolean;
};

export function fileNamesUnlocked(gate: LeakGate): boolean {
  return gate.revealed || gate.s7HintLevel >= 2 || (gate.s7Done && gate.stage !== "kickoff" && gate.stage !== "locate");
}

export function symbolsUnlocked(gate: LeakGate): boolean {
  return gate.revealed || gate.s8HintLevel >= 3;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A name as a whole token: `sessions.py` matches "sessions.py," but not "mysessions.py". */
const namedIn = (text: string, name: string) => new RegExp(`(?<![\\w./-])${escape(name)}(?![\\w-])`, "i").test(text);
const basename = (file: string) => file.slice(file.lastIndexOf("/") + 1);
/** A symbol that is also an English word (`render`, `session`) counts only
 *  when written as code: in backticks, called, or as a member. Identifier-
 *  shaped ones (`save_session`, `isRedirect`) count anywhere. */
function symbolNamedIn(text: string, symbol: string): boolean {
  if (!/^[a-z]+$/.test(symbol)) return namedIn(text, symbol);
  const s = escape(symbol);
  return new RegExp(`\`[^\`\\n]*\\b${s}\\b[^\`\\n]*\`|\\b${s}\\s*\\(|\\.${s}\\b`).test(text);
}

/** Whether `reply` gives away the hidden fix. `contributorText` is what the
 *  contributor wrote in this lesson (answers and messages): names they used
 *  first are not a leak. */
export function checkLeak(reply: string, diff: string, gate: LeakGate, contributorText = ""): LeakResult {
  if (gate.revealed) return { leak: false, reasons: [] };
  const facts = hiddenDiffFacts(diff);
  const reasons: string[] = [];

  for (const line of facts.addedLines) {
    if (copyOverlap(line, [reply]) >= LINE_LEAK_THRESHOLD) reasons.push(`quotes an added line: ${line.slice(0, 80)}`);
  }
  if (facts.addedLines.length && copyOverlap(reply, facts.addedLines) >= REPLY_LEAK_THRESHOLD) reasons.push("repeats the added code");

  const theirs = (name: string) => namedIn(contributorText, name);
  if (!fileNamesUnlocked(gate)) {
    for (const file of facts.files) {
      const hit = [file, basename(file)].find((name) => namedIn(reply, name) && !theirs(name));
      if (hit) reasons.push(`names a changed file: ${hit}`);
    }
  }
  if (!symbolsUnlocked(gate)) {
    for (const symbol of facts.symbols) {
      if (symbolNamedIn(reply, symbol) && !theirs(symbol)) reasons.push(`names a changed symbol: ${symbol}`);
    }
  }
  return { leak: reasons.length > 0, reasons };
}
