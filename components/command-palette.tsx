"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  IconArrow,
  IconOverview,
  IconPrs,
  IconRepos,
  IconRuns,
  IconTrigger,
  IconSearch,
  IconPulse,
} from "./icons";

type Action = {
  id: string;
  label: string;
  hint?: string;
  keys?: string;
  Icon: React.ComponentType<{ className?: string }>;
  onRun: (ctx: Ctx) => Promise<void> | void;
};

type Ctx = {
  router: ReturnType<typeof useRouter>;
  close: () => void;
  setStatus: (s: string) => void;
};

const NAV_ACTIONS: Action[] = [
  { id: "go-overview", label: "Go to Overview", keys: "g 1", Icon: IconOverview, onRun: ({ router, close }) => { router.push("/"); close(); } },
  { id: "go-prs", label: "Go to Pull Requests", keys: "g 2", Icon: IconPrs, onRun: ({ router, close }) => { router.push("/prs"); close(); } },
  { id: "go-repos", label: "Go to Repositories", keys: "g 3", Icon: IconRepos, onRun: ({ router, close }) => { router.push("/repos"); close(); } },
  { id: "go-dispatches", label: "Go to History", keys: "g 4", Icon: IconRuns, onRun: ({ router, close }) => { router.push("/dispatches"); close(); } },
  { id: "go-trigger", label: "Go to Dispatch", keys: "g 5", Icon: IconTrigger, onRun: ({ router, close }) => { router.push("/trigger"); close(); } },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [status, setStatus] = useState<string>("");
  const [dispatchId, setDispatchId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Global keybinds
  useEffect(() => {
    let prefix = false;
    let prefixTimer: ReturnType<typeof setTimeout> | null = null;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && /^(input|textarea|select)$/i.test(target.tagName);

      // Cmd+K / Ctrl+K everywhere
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      // ESC closes
      if (e.key === "Escape" && open) {
        setOpen(false);
        return;
      }
      if (typing) return;

      // `g` then digit to navigate
      if (prefix) {
        const map: Record<string, string> = { "1": "/", "2": "/prs", "3": "/repos", "4": "/dispatches", "5": "/trigger" };
        if (map[e.key]) {
          router.push(map[e.key]);
        }
        prefix = false;
        if (prefixTimer) clearTimeout(prefixTimer);
        return;
      }
      if (e.key.toLowerCase() === "g") {
        prefix = true;
        prefixTimer = setTimeout(() => { prefix = false; }, 1200);
      }
      if (e.key === "/") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (prefixTimer) clearTimeout(prefixTimer);
    };
  }, [open, router]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 20);
    else {
      setQ("");
      setRepoUrl("");
      setStatus("");
      setDispatchId(null);
    }
  }, [open]);

  const ctx: Ctx = {
    router,
    close: () => setOpen(false),
    setStatus,
  };

  const looksLikeRepo = /^https?:\/\/github\.com\/[^/]+\/[^/]+/.test(q.trim()) || /^[^/\s]+\/[^/\s]+$/.test(q.trim());
  const normalizedRepoUrl = (() => {
    const v = q.trim();
    if (v.startsWith("http")) return v;
    if (looksLikeRepo) return `https://github.com/${v}`;
    return "";
  })();

  async function dispatch(dry: boolean) {
    const url = repoUrl || normalizedRepoUrl;
    if (!url) return;
    setPending(true);
    setStatus("spawning opensrcer agent…");
    setDispatchId(null);
    try {
      const res = await fetch("/api/run/target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_url: url, dry_run: dry }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? `HTTP ${res.status}`);
      if (data.dispatch_id) {
        setDispatchId(data.dispatch_id);
        setStatus(`● spawned — pid pipeline running`);
      } else {
        setStatus(`✓ ${data.message ?? "queued"} — (no local dispatcher)`);
      }
    } catch (err) {
      setStatus(`✗ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPending(false);
    }
  }

  const filteredNav = NAV_ACTIONS.filter((a) =>
    q ? a.label.toLowerCase().includes(q.toLowerCase()) : true,
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/80 backdrop-blur-sm animate-fade-rise"
      onClick={() => setOpen(false)}
    >
      <div
        className="mt-[10vh] w-full max-w-[640px] border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* search input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <IconSearch className="text-paper-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search · or paste a GitHub repo URL to dispatch"
            className="flex-1 bg-transparent text-[14px] text-paper placeholder:text-paper-faint focus:outline-none"
          />
          <kbd className="text-[10px] text-paper-muted border border-border-soft px-1.5 py-0.5">ESC</kbd>
        </div>

        {/* dispatch row when input looks like a repo */}
        {looksLikeRepo && (
          <div className="border-b border-border bg-signal/5 px-4 py-3">
            <div className="flex items-center gap-2">
              <IconTrigger className="text-signal" />
              <span className="mono-label text-signal">dispatch</span>
              <span className="text-[12px] text-paper-dim truncate">{normalizedRepoUrl}</span>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => dispatch(true)}
                disabled={pending}
                className="inline-flex items-center gap-2 border border-info/50 bg-info/10 text-info px-3 py-1.5 text-[12px] hover:bg-info/20 disabled:opacity-50"
              >
                dry-run <IconArrow />
              </button>
              <button
                onClick={() => dispatch(false)}
                disabled={pending}
                className="inline-flex items-center gap-2 border border-signal bg-signal/10 text-paper px-3 py-1.5 text-[12px] hover:bg-signal/20 disabled:opacity-50"
              >
                launch live <IconArrow />
              </button>
              {status && (
                <span className={cn("text-[11px]", status.startsWith("✗") ? "text-alert" : "text-paper-dim")}>
                  {status}
                </span>
              )}
              {dispatchId && (
                <a
                  href="/dispatches"
                  className="ml-auto text-[11px] text-signal hover:underline"
                  onClick={() => setOpen(false)}
                >
                  view log →
                </a>
              )}
            </div>
          </div>
        )}

        {/* nav + actions list */}
        <div className="max-h-[50vh] overflow-y-auto">
          <Section title="Navigate">
            {filteredNav.map((a) => (
              <button
                key={a.id}
                onClick={() => a.onRun(ctx)}
                className="group w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2 transition-colors"
              >
                <a.Icon className="text-paper-muted group-hover:text-paper" />
                <span className="text-[13px] text-paper-dim group-hover:text-paper flex-1">{a.label}</span>
                {a.keys && (
                  <span className="text-[10px] text-paper-faint tabular-nums">{a.keys}</span>
                )}
              </button>
            ))}
          </Section>

          <Section title="Quick dispatch">
            <div className="px-4 py-3 space-y-2">
              <input
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                className="w-full border border-border bg-ink px-3 py-2 text-[13px] text-paper placeholder:text-paper-faint focus:border-signal focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => dispatch(true)}
                  disabled={pending || !repoUrl.trim()}
                  className="inline-flex items-center gap-2 border border-info/50 bg-info/10 text-info px-3 py-1.5 text-[12px] hover:bg-info/20 disabled:opacity-40"
                >
                  dry-run <IconArrow />
                </button>
                <button
                  onClick={() => dispatch(false)}
                  disabled={pending || !repoUrl.trim()}
                  className="inline-flex items-center gap-2 border border-signal bg-signal/10 text-paper px-3 py-1.5 text-[12px] hover:bg-signal/20 disabled:opacity-40"
                >
                  live <IconArrow />
                </button>
                {status && (
                  <span className={cn("text-[11px] ml-auto", status.startsWith("✗") ? "text-alert" : "text-paper-dim")}>
                    {status}
                  </span>
                )}
              </div>
            </div>
          </Section>

          <div className="border-t border-border px-4 py-2.5 flex items-center justify-between text-[10px] text-paper-muted">
            <div className="flex items-center gap-4">
              <span><kbd className="text-paper-dim">↑↓</kbd> select</span>
              <span><kbd className="text-paper-dim">g</kbd> then <kbd className="text-paper-dim">1–5</kbd> jump</span>
              <span><kbd className="text-paper-dim">/</kbd> open</span>
            </div>
            <span className="flex items-center gap-1.5">
              <IconPulse className="text-ok" />
              observatory ready
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border first:border-t-0">
      <div className="px-4 pt-3 pb-1 mono-label text-paper-muted">{title}</div>
      {children}
    </div>
  );
}
