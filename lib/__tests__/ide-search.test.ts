// lib/ide/search.ts: the bounded repo search behind the IDE's search view.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findMatches, searchCandidates, SEARCH_LIMITS } from "../ide/search";

const files = [
  { path: "src/b.ts", size: 10 },
  { path: "src/a.ts", size: 10 },
  { path: "logo.png", size: 10 },
  { path: "fonts/x.woff2", size: 10 },
  { path: "dist/bundle.js", size: 900_000 },
  { path: "node_modules/x/index.js", size: 10 },
  { path: "README.md", size: 0 },
];
const notNodeModules = (path: string) => !path.startsWith("node_modules/");

test("searchCandidates drops binaries, excluded and oversized files, sorted by path", () => {
  assert.deepEqual(searchCandidates(files, notNodeModules, Infinity), { paths: ["README.md", "src/a.ts", "src/b.ts"], skipped: 1 });
});

test("searchCandidates honours the query's own size limit and the file cap", () => {
  assert.deepEqual(searchCandidates(files, notNodeModules, 5), { paths: ["README.md"], skipped: 3 });
  assert.deepEqual(searchCandidates(files, notNodeModules, Infinity, { ...SEARCH_LIMITS, maxFiles: 2 }), { paths: ["README.md", "src/a.ts"], skipped: 2 });
  assert.deepEqual(searchCandidates(files, notNodeModules, Infinity, { ...SEARCH_LIMITS, maxFiles: 0 }), { paths: [], skipped: 4 });
});

test("searchCandidates of an empty tree or a query that excludes everything is empty", () => {
  assert.deepEqual(searchCandidates([], () => true, Infinity), { paths: [], skipped: 0 });
  assert.deepEqual(searchCandidates(files, () => false, Infinity), { paths: [], skipped: 0 });
});

test("findMatches reports 0-based lines and columns with the line's text", () => {
  const text = "import { parse } from './p';\r\nconst a = parse(x);\nparse(parse(y));";
  assert.deepEqual(findMatches(text, /parse/g, 100), [
    { startLine: 0, startColumn: 9, endLine: 0, endColumn: 14, preview: "import { parse } from './p';" },
    { startLine: 1, startColumn: 10, endLine: 1, endColumn: 15, preview: "const a = parse(x);" },
    { startLine: 2, startColumn: 0, endLine: 2, endColumn: 5, preview: "parse(parse(y));" },
    { startLine: 2, startColumn: 6, endLine: 2, endColumn: 11, preview: "parse(parse(y));" },
  ]);
});

test("findMatches spans lines for a multi-line pattern and stops at max", () => {
  assert.deepEqual(findMatches("a\nb\nc", /a\nb/g, 10), [{ startLine: 0, startColumn: 0, endLine: 1, endColumn: 1, preview: "a\nb" }]);
  assert.equal(findMatches("x x x x", /x/g, 2).length, 2);
  assert.deepEqual(findMatches("x", /x/g, 0), []);
});

test("findMatches skips empty matches and finds nothing in empty text", () => {
  assert.deepEqual(findMatches("abc", /z*/g, 10), []);
  assert.deepEqual(findMatches("", /a/g, 10), []);
});

test("findMatches refuses a non-global regexp (exec would never advance)", () => {
  assert.throws(() => findMatches("a", /a/, 10), /global/);
});
