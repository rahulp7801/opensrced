// GET /api/fixes/[id] — retrieve a shared fix by ID

import { NextRequest } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

const FIXES_DIR = join(process.cwd(), ".fixes");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Sanitize ID — only alphanumeric + hyphens
  const safeId = id.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 36);
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
