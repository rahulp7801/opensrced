// GET /api/me/export: "Export my data" as a JSON download: the account's
// database rows, its stored run records (Blob listing and run summaries
// hosted, .dispatches sidecars locally) and its activity stats.
// Graph and log contents are listed, not inlined: they can be tens of MB.

import { join } from "node:path";
import { list } from "@vercel/blob";
import { exportUserRows, listUserBlobs, localUserRuns, localUserStats } from "@/lib/account-data";
import { cloudExecution } from "@/lib/cloud-run-state";
import { listCloudRunSummaries } from "@/lib/cloud-runs";
import { sessionAccount } from "@/lib/require-session";
import { getStatsSummary } from "@/lib/stats";
import { optionalDb } from "@/lib/users";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const account = await sessionAccount();
  if (!account) return Response.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const db = await optionalDb();
    const dir = join(process.cwd(), ".dispatches");
    const data = {
      exportedAt: new Date().toISOString(),
      account: { id: account.id, login: account.login },
      database: db ? await exportUserRows(db, account.id) : null,
      storage: cloudExecution()
        ? { blobs: await listUserBlobs({ list }, account.id), runSummaries: await listCloudRunSummaries(account.id, 100) }
        : { runs: localUserRuns(dir, account.id), stats: localUserStats(dir, account.id) },
      stats: await getStatsSummary(account.id),
    };
    const day = data.exportedAt.slice(0, 10);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="opensrcer-data-${day}.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[me/export]", error instanceof Error ? error.message : error);
    return Response.json({ error: "Your data could not be exported right now. Please try again." }, { status: 503 });
  }
}
