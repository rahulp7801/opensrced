// Shared by the IDE's lesson routes (app/api/lessons/[id]/*) and the browser.
// The routes are stubs until the lesson store and the exec VM are wired in;
// the shapes here are the contract those later pieces keep.

/** Lesson ids are generated server-side; anything else is refused before any work. */
export function validLessonId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/** One line of the Run stream: SSE `data: {...}` lines, read with lib/sse.ts sseEvents. */
export type RunEvent = { type: "out"; data: string } | { type: "exit"; data: number };

/** Caps on what the browser may send. A lesson diff is a focused fix; 1 MB is generous. */
export const MAX_DIFF_BYTES = 1_000_000;
export const MAX_SELECTION_CHARS = 20_000;

/** Run's stub reply until the exec VM wiring lands (PLAN §8.0 step 3). */
export const RUN_NOT_CONNECTED: RunEvent[] = [
  { type: "out", data: "Running isn't connected yet.\r\n" },
  { type: "out", data: "Your edits are saved in this browser; when the exec VM is wired up, Run applies your diff to a clean checkout and streams the output here.\r\n" },
  { type: "exit", data: 1 },
];

/** Suggest's stub reply until the agent session and leak filter land (PLAN §8.3). */
export const SUGGEST_NOT_CONNECTED = "Suggestions aren't connected yet. Write a comment saying what this line should do, then ask the teacher about it.";

/** Encode run events as an SSE body. */
export function runEventStream(events: RunEvent[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}
