// lib/ide/ts-imports.ts: which repo files the TypeScript worker is handed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isScriptPath, relativeImports, resolveImport, TS_IMPORT_LIMITS } from "../ide/ts-imports";

for (const [path, ok] of [
  ["src/a.ts", true], ["src/a.tsx", true], ["a.d.ts", true], ["a.mts", true], ["a.cjs", true], ["a.js", true], ["a.jsx", true],
  ["a.py", false], ["a.json", false], ["a.ts.map", false], ["", false], ["ts", false],
] as Array<[string, boolean]>) {
  test(`isScriptPath(${JSON.stringify(path)}) is ${ok}`, () => assert.equal(isScriptPath(path), ok));
}

test("relativeImports finds every import form, relative only, each once", () => {
  const source = [
    `import { a } from "./a.ts";`,
    `import type { B } from '../types';`,
    `import "./side-effect";`,
    `export * from "./barrel/index.js";`,
    `export { c } from "./a.ts";`,
    `const lazy = await import("./lazy");`,
    `const old = require( "./old.cjs" );`,
    `/// <reference path="globals.d.ts" />`,
    `import React from "react";`,
    `import { test } from "node:test";`,
    `import x from "@scope/pkg/./not-relative";`,
  ].join("\n");
  assert.deepEqual(relativeImports(source), ["./a.ts", "../types", "./side-effect", "./barrel/index.js", "./lazy", "./old.cjs", "globals.d.ts"]);
});

test("relativeImports of a file with no imports is empty", () => {
  assert.deepEqual(relativeImports(""), []);
  assert.deepEqual(relativeImports("export const x = 1;\nconst s = 'from here';"), []);
});

const tree = new Set([
  "src/index.ts", "src/slugify.ts", "src/util/index.ts", "src/view.tsx", "src/types.d.ts", "src/old.js", "lib/esm.mts", "README.md",
]);
const exists = (path: string) => tree.has(path);

for (const [from, specifier, expected] of [
  ["src/index.ts", "./slugify.ts", "src/slugify.ts"], // as written (allowImportingTsExtensions)
  ["src/index.ts", "./slugify", "src/slugify.ts"], // extension added
  ["src/index.ts", "./slugify.js", "src/slugify.ts"], // ESM: the .ts behind the emitted .js
  ["src/index.ts", "./view.jsx", "src/view.tsx"],
  ["src/index.ts", "./view", "src/view.tsx"],
  ["src/index.ts", "./util", "src/util/index.ts"], // directory index
  ["src/index.ts", "./types", "src/types.d.ts"],
  ["src/index.ts", "./old.js", "src/old.js"], // a real .js file wins over the .ts guess
  ["src/util/index.ts", "../slugify", "src/slugify.ts"],
  ["src/util/index.ts", "./../../lib/esm.mjs", "lib/esm.mts"],
  ["index.ts", "./src/slugify", "src/slugify.ts"], // from the repo root
  ["src/index.ts", "./missing", null],
  ["src/index.ts", "../README.md", null], // not a script
  ["src/index.ts", "../../outside", null], // climbs out of the repo
  ["src/index.ts", "./", "src/index.ts"],
] as Array<[string, string, string | null]>) {
  test(`resolveImport(${from}, ${specifier}) is ${expected}`, () => assert.equal(resolveImport(from, specifier, exists), expected));
}

test("TS_IMPORT_LIMITS are positive", () => {
  assert.ok(TS_IMPORT_LIMITS.maxFiles > 0 && TS_IMPORT_LIMITS.maxFileBytes > 0);
});
