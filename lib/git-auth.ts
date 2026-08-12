// Authenticate git subprocesses without persisting the token.
//
// The obvious approach — `https://x-access-token:<TOK>@github.com/o/n.git` as
// a remote URL — writes the credential into the clone's .git/config, where it
// survives on disk indefinitely. The cache at ~/.contribai/repos/ is long
// lived and shared, so an installation token leaked there outlives the run
// that created it.
//
// `-c http.extraheader=...` applies for exactly one invocation and is never
// written to config. Pass the result as the FIRST args to git, before the
// subcommand.
//
//   await run("git", [...gitAuthArgs(token), "clone", url, dir])

export function gitAuthArgs(token?: string | null): string[] {
  if (!token) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.extraheader=AUTHORIZATION: basic ${basic}`];
}
