// Environment recipes (PLAN.md §5.2): how to install a repository and run
// its tests, compiled from what the repository already says about itself
// (its CI, devcontainer, version files, lockfiles). Pure data: detection
// lives in lib/env/detect.ts, running it in lib/exec-run.ts.

import { createHash } from "node:crypto";

export type RecipeSource = "builtin" | "devcontainer" | "ci" | "mise" | "lockfile" | "railpack" | "agent";

export type ServiceSpec = { name: string; image: string; env?: Record<string, string>; ports?: number[] };

export type RelatedKind = "jest" | "vitest" | "pytest-files" | "go-pkg" | "cargo-pkg";

export interface EnvRecipe {
  repo: string;                          // owner/name
  source: RecipeSource;
  runtimes: Record<string, string>;      // { python: "3.12", node: "20" } -> mise
  services: ServiceSpec[];
  env: Record<string, string>;           // non-secret env from the CI job
  setup: string[];                       // install steps, in order
  test: string[];                        // full-suite commands
  /** `{targets}` in the template is replaced by the selected files/packages
   *  (lib/env/related-tests.ts). */
  testRelated?: { kind: RelatedKind; template: string };
  lint: string[];
  devcontainer?: { path: string };       // run setup/test via `devcontainer exec`
  timeouts: { setupMs: number; testMs: number };
}

/** Defaults until the benchmark measures real times (§5.5). */
export const DEFAULT_TIMEOUTS = { setupMs: 15 * 60_000, testMs: 15 * 60_000 };

/** Hash of the files a recipe was derived from (workflows, devcontainer,
 *  lockfiles, version files): a changed hash means re-detect (§5.4). Order
 *  of the input does not matter; a path with no content (null) counts as
 *  absent, which is different from an empty file. */
export function recipeHash(files: Record<string, string | Buffer | null>): string {
  const hash = createHash("sha256");
  for (const p of Object.keys(files).sort()) {
    const content = files[p];
    if (content === null || content === undefined) continue;
    hash.update(`${p}\0${content.length}\0`);
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Quoted for the shell, except `$GITHUB_WORKSPACE` (what `${{ github.workspace }}`
 *  compiles to), which must still expand when the command runs. */
export const envQuote = (s: string) => shellQuote(s).replace(/\$GITHUB_WORKSPACE/g, `'"$GITHUB_WORKSPACE"'`);

/** `docker run -d` per service (§5.2 step 3.7). Non-fatal: the snapshot has
 *  no Docker yet, and a missing database should show up as failing tests
 *  with this line in the log, not as a failed install. */
export function serviceCommands(services: ServiceSpec[]): string[] {
  return services.map((s) => {
    const env = Object.entries(s.env ?? {}).map(([k, v]) => `-e ${shellQuote(`${k}=${v}`)}`);
    const ports = (s.ports ?? []).map((p) => `-p ${p}:${p}`);
    const run = ["docker run -d --name", shellQuote(`opensrcer-${s.name}`), ...env, ...ports, shellQuote(s.image)].join(" ");
    return `${run} || echo "[opensrcer] service ${s.name.replace(/[^\w.-]/g, "")} (${s.image.replace(/[^\w.:/@-]/g, "")}) did not start; tests that need it will fail"`;
  });
}

/** `mise use` for the recipe's runtimes. Non-fatal when the image has no
 *  mise (it is added with the Phase 1 base image): the run continues on the
 *  image's own runtimes and the log says so. */
export function runtimeCommand(runtimes: Record<string, string>): string | null {
  const tools = Object.entries(runtimes).map(([tool, version]) => shellQuote(`${tool}@${version || "latest"}`));
  if (!tools.length) return null;
  return `if command -v mise >/dev/null 2>&1; then mise use -g --yes ${tools.join(" ")} && export PATH="$HOME/.local/share/mise/shims:$PATH"; ` +
    `else echo "[opensrcer] mise is not in this image; using its preinstalled runtimes instead of ${tools.join(" ").replace(/'/g, "")}"; fi`;
}

/** Variables CI steps expect (GITHUB_ENV, GITHUB_PATH, ...), pointed at
 *  scratch files so `echo X=1 >> $GITHUB_ENV` does not fail the step. */
export const CI_SHIM = [
  `export CI=true GITHUB_ACTIONS=true GITHUB_WORKSPACE="$PWD" RUNNER_TEMP=/tmp RUNNER_OS=Linux`,
  `export GITHUB_ENV=/tmp/opensrcer-github-env GITHUB_PATH=/tmp/opensrcer-github-path GITHUB_OUTPUT=/tmp/opensrcer-github-output GITHUB_STEP_SUMMARY=/tmp/opensrcer-step-summary`,
  `: > "$GITHUB_ENV"; : > "$GITHUB_PATH"; : > "$GITHUB_OUTPUT"`,
].join("\n");

/** Apply what the previous step wrote to GITHUB_ENV / GITHUB_PATH, as the
 *  runner does between steps. ponytail: single-line `K=V` only; the
 *  `K<<EOF` multi-line form is skipped until a benchmark repo needs it. */
export const CI_SHIM_BETWEEN_STEPS =
  `while IFS= read -r l; do case "$l" in *"<<"*) ;; [A-Za-z_]*=*) export "$l" ;; esac; done < "$GITHUB_ENV"; ` +
  `while IFS= read -r p; do [ -z "$p" ] || PATH="$p:$PATH"; done < "$GITHUB_PATH"; : > "$GITHUB_PATH"`;

/** The ordered shell commands that install a recipe's environment: runtimes,
 *  services, then its setup steps with the CI shim between them. */
export function setupScript(recipe: EnvRecipe): string[] {
  const env = Object.entries(recipe.env).map(([k, v]) => `export ${k}=${envQuote(v)}`);
  const runtime = runtimeCommand(recipe.runtimes);
  return [
    ...(recipe.source === "ci" ? [CI_SHIM] : []),
    ...env,
    ...(runtime ? [runtime] : []),
    ...serviceCommands(recipe.services),
    ...recipe.setup.flatMap((s) => (recipe.source === "ci" ? [s, CI_SHIM_BETWEEN_STEPS] : [s])),
  ];
}
