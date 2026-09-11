// POST /api/prs/draft-reply
// Uses the Anthropic API directly (no MCP tools, no code exploration)
// to draft a reply to a reviewer's question. Fast and cheap (~$0.001).

import { NextRequest } from "next/server";
import { resolveAnthropicKey } from "@/lib/api-keys";
import { sanitizeForPrompt, sanitizeRepoId, sanitizeFilePath } from "@/lib/sanitize";
import { requireSession } from "@/lib/require-session";
import { anthropicStream } from "@/lib/anthropic-stream";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;

  const raw = (await req.json().catch(() => ({}))) as {
    repo?: string;
    pr_title?: string;
    pr_body?: string;
    comment_body?: string;
    comment_author?: string;
    file_path?: string | null;
  };

  if (!raw || [raw.repo, raw.pr_title, raw.comment_body, raw.comment_author, raw.file_path].some(value => value != null && typeof value !== "string")) return Response.json({ error: "Invalid text fields" }, { status: 400 });

  const body = {
    repo: raw.repo ? sanitizeRepoId(raw.repo) : null,
    pr_title: raw.pr_title ? sanitizeForPrompt(raw.pr_title).slice(0, 200) : null,
    comment_body: raw.comment_body ? sanitizeForPrompt(raw.comment_body) : null,
    comment_author: raw.comment_author?.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 50) ?? null,
    file_path: raw.file_path ? sanitizeFilePath(raw.file_path) : null,
  };

  if (!body.comment_body) {
    return Response.json({ error: "Missing comment_body" }, { status: 400 });
  }

  const apiKey = await resolveAnthropicKey();
  if (!apiKey) {
    return Response.json({ error: "No Anthropic API key configured." }, { status: 400 });
  }

  const systemPrompt = `You are the author of a pull request on ${body.repo ?? "a GitHub repo"}. A reviewer left a comment and you need to draft a concise, professional reply.

PR title: ${body.pr_title ?? "N/A"}
${body.file_path ? `File: ${body.file_path}` : ""}

Rules:
- Be concise (2-4 sentences max)
- Be professional and collaborative
- If they asked a technical question, answer it directly
- If they made a suggestion, acknowledge it
- Don't be defensive or overly apologetic
- Don't use emojis`;

  const userMsg = `Reviewer ${body.comment_author ?? "someone"} wrote:\n"${body.comment_body}"\n\nDraft a reply:`;

  return anthropicStream(apiKey, systemPrompt, userMsg, 300, req.signal);
}
