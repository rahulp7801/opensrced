// POST /api/graph/build
// Clones a GitHub repo and runs graphify to produce a knowledge graph.
// Streams progress via SSE. The graph is cached on disk for future queries.

import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { graphCacheDir } from "@/lib/graph";
import { resolveGitHubToken } from "@/lib/github-token";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    repo_url?: string;
    force?: boolean;
  };

  if (!body.repo_url) {
    return Response.json({ error: "Missing repo_url" }, { status: 400 });
  }

  const m =
    /github\.com[:/]+([^/]+)\/([^/?#\s.]+)|^([^/\s]+)\/([^/\s]+)$/.exec(
      body.repo_url.trim().replace(/\.git$/i, ""),
    );
  const owner = m?.[1] ?? m?.[3];
  const name = m?.[2] ?? m?.[4];
  if (!owner || !name) {
    return Response.json({ error: "Invalid repo URL" }, { status: 400 });
  }

  const cacheDir = graphCacheDir(owner, name);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
        );
      }

      try {
        // Step 1: Clone if needed
        if (body.force && existsSync(cacheDir)) {
          send({ status: "cleaning", message: "Clearing cached graph..." });
          const { rm } = await import("node:fs/promises");
          await rm(cacheDir, { recursive: true, force: true });
        }

        if (!existsSync(`${cacheDir}/.git`)) {
          send({
            status: "cloning",
            message: `Cloning ${owner}/${name}...`,
          });
          mkdirSync(cacheDir, { recursive: true });

          const token = await resolveGitHubToken();
          const cloneUrl = token
            ? `https://x-access-token:${token}@github.com/${owner}/${name}.git`
            : `https://github.com/${owner}/${name}.git`;

          await new Promise<void>((resolve, reject) => {
            const proc = spawn(
              "git",
              ["clone", "--depth", "1", cloneUrl, "."],
              { cwd: cacheDir, windowsHide: true },
            );
            let stderr = "";
            proc.stderr.on("data", (chunk: Buffer) => {
              stderr += chunk.toString();
            });
            proc.on("close", (code) =>
              code === 0
                ? resolve()
                : reject(
                    new Error(
                      `git clone failed (exit ${code}): ${stderr.slice(-300)}`,
                    ),
                  ),
            );
            proc.on("error", reject);
          });

          send({ status: "cloned", message: "Repository cloned." });
        } else {
          send({ status: "cached", message: "Using cached clone." });
        }

        // Step 2: Count files to decide which engine to use.
        // Graphify works well up to ~800 files (produces HTML viz + query engine).
        // Above that, it can crash or produce graphs too large for vis.js.
        // code-review-graph handles any size via SQLite + capped traversal.
        const FILE_CUTOFF = 800;
        let fileCount = 0;
        try {
          const { execFileSync } = await import("node:child_process");
          const out = execFileSync("git", ["-C", cacheDir, "ls-files"], {
            maxBuffer: 50 * 1024 * 1024,
            windowsHide: true,
          }).toString();
          fileCount = out.split("\n").filter(Boolean).length;
        } catch {
          // Can't count — default to graphify
        }

        send({
          status: "progress",
          message: `Detected ${fileCount} files. ${fileCount > FILE_CUTOFF ? `Using code-review-graph (large repo, >${FILE_CUTOFF} files).` : "Using graphify."}`,
          phase: "detect",
          percent: 5,
        });

        if (fileCount > FILE_CUTOFF) {
          // Large repo — go straight to CRG, skip graphify entirely
          send({
            status: "progress",
            message: "Building knowledge graph with code-review-graph (SQLite-backed, handles large repos)...",
            phase: "crg",
            percent: 10,
          });

          try {
            const { buildCrg } = await import("@/lib/graph-build");
            await buildCrg(cacheDir);
            send({
              status: "done",
              message: `Knowledge graph built with code-review-graph (${fileCount} files).`,
              owner,
              repo: name,
              engine: "crg",
            });
          } catch (crgErr) {
            send({
              error: `code-review-graph failed: ${crgErr instanceof Error ? crgErr.message : String(crgErr)}`,
            });
          }
        } else {
          // Small/medium repo — use graphify
        send({
          status: "graphifying",
          message:
            "Building knowledge graph with graphify (AST analysis, zero LLM cost)...",
          phase: "ast",
          percent: 10,
        });

        await new Promise<void>((resolve, reject) => {
          const useModule = process.platform === "win32";
          const cmd = useModule ? "python" : "graphify";
          const cmdArgs = useModule
            ? ["-c", "import sys; sys.setrecursionlimit(10000); sys.argv=['graphify','update','.']; from graphify.__main__ import main; main()"]
            : ["update", "."];
          const proc = spawn(cmd, cmdArgs, {
            cwd: cacheDir,
            windowsHide: true,
            env: { ...process.env },
          });

          let stderr = "";
          function forwardProgress(chunk: Buffer) {
            const text = chunk.toString();
            stderr += text;
            const lines = text.split("\n").filter(Boolean);
            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line) continue;

              // Parse graphify's progress output for structured updates
              // e.g. "  AST extraction: 100/161 files (62%)"
              const astMatch = line.match(
                /AST extraction:\s*(\d+)\/(\d+)\s+files\s+\((\d+)%\)/,
              );
              if (astMatch) {
                send({
                  status: "progress",
                  message: `Parsing files: ${astMatch[1]} of ${astMatch[2]} (${astMatch[3]}%)`,
                  phase: "ast",
                  current: parseInt(astMatch[1]),
                  total: parseInt(astMatch[2]),
                  percent: parseInt(astMatch[3]),
                });
                continue;
              }

              // e.g. "[graphify watch] Rebuilt: 219 nodes, 89 edges, 134 communities"
              const builtMatch = line.match(
                /Rebuilt:\s*(\d+)\s+nodes,\s*(\d+)\s+edges/,
              );
              if (builtMatch) {
                send({
                  status: "progress",
                  message: `Graph complete: ${builtMatch[1]} nodes, ${builtMatch[2]} edges`,
                  phase: "complete",
                  percent: 100,
                });
                continue;
              }

              // e.g. "graph.json, graph.html and GRAPH_REPORT.md updated"
              if (line.includes("graph.json") && line.includes("updated")) {
                send({
                  status: "progress",
                  message: "Writing graph files (graph.json, graph.html, report)",
                  phase: "writing",
                  percent: 100,
                });
                continue;
              }

              // Default: forward raw line
              send({ status: "progress", message: line });
            }
          }

          proc.stderr.on("data", forwardProgress);
          proc.stdout.on("data", forwardProgress);

          const timeout = setTimeout(() => {
            if (!proc.killed && proc.pid) {
              if (process.platform === "win32") {
                try {
                  require("node:child_process").execFileSync(
                    "taskkill",
                    ["/F", "/T", "/PID", String(proc.pid)],
                    { stdio: "pipe" },
                  );
                } catch {
                  proc.kill("SIGKILL");
                }
              } else {
                proc.kill("SIGKILL");
              }
            }
            reject(new Error("graphify timed out after 5 minutes"));
          }, 5 * 60 * 1000);

          proc.on("close", (code) => {
            clearTimeout(timeout);
            if (code === 0) resolve();
            else
              reject(
                new Error(
                  `graphify failed (exit ${code}): ${stderr.slice(-500)}`,
                ),
              );
          });
          proc.on("error", reject);
        });

        // Verify graph.json was actually produced
        const { graphJsonPath: gjp } = await import("@/lib/graph");
        const outputPath = gjp(owner, name);
        if (!existsSync(outputPath)) {
          // Graphify failed — fall back to code-review-graph
          send({
            status: "progress",
            message: "Graphify could not build this repo (too large). Falling back to code-review-graph...",
            phase: "crg",
            percent: 50,
          });

          try {
            const { buildCrg } = await import("@/lib/graph-build");
            await buildCrg(cacheDir);
            send({
              status: "done",
              message: "Knowledge graph built with code-review-graph (large repo mode).",
              owner,
              repo: name,
              engine: "crg",
            });
          } catch (crgErr) {
            send({
              error: `Both graphify and code-review-graph failed: ${crgErr instanceof Error ? crgErr.message : String(crgErr)}`,
            });
          }
        } else {
          // Also build CRG in background for blast radius analysis
          import("@/lib/graph-build").then(({ buildCrg }) =>
            buildCrg(cacheDir).catch(() => {}),
          );

          send({
            status: "done",
            message: "Knowledge graph built successfully.",
            owner,
            repo: name,
          });
        }
        } // end else (small/medium repo — graphify path)
      } catch (err) {
        send({
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
