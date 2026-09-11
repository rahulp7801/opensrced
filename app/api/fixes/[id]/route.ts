// GET /api/fixes/[id] — retrieve a shared fix by ID

import { NextRequest } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { readJson } from "@/lib/blob-store";
import { cloudExecution } from "@/lib/cloud-run-state";

export const dynamic = "force-dynamic";

const FIXES_DIR = join(process.cwd(), ".fixes");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) return Response.json({ error: "Fix not found" }, { status: 404 });
  if (cloudExecution()) {
    const fix = await readJson(`shares/${id}.json`);
    return fix ? Response.json(fix.value) : Response.json({ error: "Fix not found" }, { status: 404 });
  }
  const safeId = id;
  const filePath = join(FIXES_DIR, `${safeId}.json`);

  if (!existsSync(filePath)) {
    return Response.json({ error: "Fix not found" }, { status: 404 });
  }

  try {
    const data = JSON.parse(readFileSync(filePath, "utf8"));
    return Response.json(data);
  } catch {
    return Response.json({ error: "Failed to read fix" }, { status: 500 });
  }
}
