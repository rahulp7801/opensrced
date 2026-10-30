// /learn/ide-demo — the in-browser IDE on a real public repo, for development
// and spike S9. Off in production unless OPENSRCER_IDE=1.
// ?repo=owner/name&sha=<40-hex> loads another repo.

import { notFound } from "next/navigation";
import { Ide } from "@/components/ide/ide";
import { parseRunTarget } from "@/lib/run-target";
import { validSha } from "@/lib/ide/repo-tree";

export const dynamic = "force-dynamic";
export const metadata = { title: "IDE demo" };

// pallets/flask main on 2026-10-07: mid-size, Python, and has a local code graph in dev.
const DEMO = { repo: "pallets/flask", sha: "d086db856be187255b8ec61ef409357393020f32", runCommand: "pytest -q tests/test_basic.py" };

export default async function IdeDemoPage({ searchParams }: { searchParams: Promise<{ repo?: string; sha?: string }> }) {
  // ponytail: reads the env var directly; lib/flags.ts takes this over when it lands.
  if (process.env.OPENSRCER_IDE !== "1" && process.env.NODE_ENV !== "development") notFound();
  const query = await searchParams;
  let repo = DEMO.repo;
  let sha = DEMO.sha;
  if (query.repo || query.sha) {
    try { repo = parseRunTarget(query.repo).repo; } catch { notFound(); }
    if (!validSha(query.sha)) notFound();
    sha = query.sha;
  }
  return <Ide lessonId="ide-demo" repo={repo} sha={sha} runCommand={repo === DEMO.repo ? DEMO.runCommand : "npm test"} />;
}
