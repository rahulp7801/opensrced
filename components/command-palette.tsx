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
import { SECTIONS } from "./nav-config";

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

// Every page in the IA, in nav order, flattened for the palette.
//
// This list used to be hand-maintained and had drifted into a THIRD set of
// names for the same pages — "Overview", "Pull Requests", "Repositories",
// "History", "Dispatch" — while omitting Discover, Issues, Graph and Stats
// entirely. Deriving it from components/nav-config.tsx means the palette,
// the header nav and the section tabs cannot disagree again, and a new page
// shows up in all three at once.
const NAV_LINKS = SECTIONS.flatMap((section) =>
  section.links.map((link) => ({ section, link })),
);

// `g` then a digit jumps to the nth page. Derived from the same order the
// palette lists them in, so the number next to a row is the key that gets you
// there.
const GOTO_KEYS: Record<string, string> = Object.fromEntries(
  NAV_LINKS.map(({ link }, i) => [String(i + 1), link.href]),
);

const NAV_ACTIONS: Action[] = NAV_LINKS.map(({ section, link }, i) => ({
  id: `go-${link.href}`,
  label: `${section.label} · ${link.label}`,
  keys: `g ${i + 1}`,
  Icon: section.Icon,
  onRun: ({ router, close }: Ctx) => {
    router.push(link.href);
    close();
  },
}));

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
        if (GOTO_KEYS[e.key]) {
          router.push(GOTO_KEYS[e.key]);
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
