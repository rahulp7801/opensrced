import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { childEnv } from "./child-env";
import { gitAuthArgs } from "./git-auth";
import { applyDiff } from "./apply-diff";
import { scanSecrets } from "./gitleaks-scanner";
import { githubApi } from "./github-api";

const exec = promisify(execFile);
export type PushPatch = { repo: string; branch: string; diff: string; commit_message: string };

/** Shared by the local runner and the disposable Vercel worker. */
export async function pushPrPatch(input: PushPatch, token: string) {
  const root = await mkdtemp(join(tmpdir(), "opensrcer-push-"));
  const repo = join(root, "repo");
  const hooks = join(root, "hooks");
  const config = join(root, "gitconfig");
  try {
    await mkdir(hooks);
    await writeFile(config, "");
    const env = childEnv({ GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" });
    const git = async (args: string[]) => (await exec("git", ["-c", `core.hooksPath=${hooks}`, ...args], { env, timeout: 60_000, maxBuffer: 5_000_000, windowsHide: true })).stdout.trim();
    const user = await githubApi<{ login: string; id: number }>("/user", token);
    await git([...gitAuthArgs(token), "clone", "--depth=50", "--single-branch", "--branch", input.branch, `https://github.com/${input.repo}.git`, repo]);
    const applied = await applyDiff(repo, input.diff, join(root, "fix.patch"), { env });
    if (!applied.ok) throw new Error("The patch could not be applied. Regenerate it against the current PR head.");
    if (!await git(["-C", repo, "diff", "--cached", "--name-only"])) throw new Error("No changes to push; this patch may already be applied.");
    const scan = await scanSecrets(repo);
    if (scan.status !== "clean") throw new Error(`Secret scan did not pass (${scan.status}). Push blocked.`);
    await git(["-C", repo, "-c", `user.name=${user.login}`, "-c", `user.email=${user.id}+${user.login}@users.noreply.github.com`, "commit", "-m", input.commit_message]);
    // A normal push rejects concurrent changes instead of overwriting them.
    await git([...gitAuthArgs(token), "-C", repo, "push", "origin", `HEAD:refs/heads/${input.branch}`]);
    const sha = await git(["-C", repo, "rev-parse", "HEAD"]);
    return { ok: true, commit: sha.slice(0, 8), message: `Pushed commit ${sha.slice(0, 8)} to ${input.repo}/${input.branch}` };
  } finally {
    // root is the concrete directory returned by mkdtemp, never client input.
    await rm(root, { recursive: true, force: true });
  }
}
