"use client";

import { useState } from "react";
import Link from "next/link";
import { useUser } from "@auth0/nextjs-auth0";
import { Nav } from "./nav";
import { AuthChip } from "./auth-chip";

export function SiteHeader() {
  const { user } = useUser();
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <>
      {/* Stickiness lives on the wrapper in app/layout.tsx, which pins this
          header and the section tab bar together. */}
      <header className="border-b border-border bg-ink/85 backdrop-blur-md">
        <div className="flex items-stretch w-full">
          <Link
            href={user ? "/discover" : "/"}
            className="group flex items-center gap-3 border-r border-border px-5 py-3 shrink-0"
          >
            <Mark />
            <span className="serif text-[20px] text-paper tracking-tight whitespace-nowrap">
              opensrcer
            </span>
          </Link>

          {user && <Nav />}

          {user && (
            <button
              onClick={() => setHelpOpen(!helpOpen)}
              className="flex items-center justify-center px-3 border-l border-border text-paper-muted hover:text-signal transition"
              title="Help & quick reference"
            >
              <span className="text-[14px] font-mono">?</span>
            </button>
          )}

          <AuthChip />
        </div>
      </header>

      {/* Help panel */}
      {helpOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={() => setHelpOpen(false)}>
          <div
            className="mt-12 mr-4 bg-ink border border-border shadow-2xl w-[320px] max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-border-soft flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.15em] text-paper-muted">Quick help</span>
              <button onClick={() => setHelpOpen(false)} className="text-[10px] text-paper-faint hover:text-paper-muted">close</button>
            </div>
            <div className="p-4 space-y-4 text-[12px]">
              {/* The "Key pages" list that used to sit here explained what
                  each of the ten nav items meant. The nav is four task-named
                  sections now (components/nav-config.tsx) and says so itself,
                  so the list was restating the navigation. What remains is
                  the part navigation cannot express: the order to do things
                  in, and the two shortcuts tables. */}
              <HelpSection title="Getting started">
                <p className="text-paper-dim">1. Add your Anthropic API key in <Link href="/crucible" className="text-signal hover:underline" onClick={() => setHelpOpen(false)}>Settings</Link>, behind your avatar</p>
                <p className="text-paper-dim">2. <strong className="text-paper">Find</strong> — browse repos or issues and pick one</p>
                <p className="text-paper-dim">3. <strong className="text-paper">Fix</strong> — start a run and watch it work</p>
                <p className="text-paper-dim">4. <strong className="text-paper">Ship</strong> — review the draft PR it opened</p>
              </HelpSection>
              <HelpSection title="PR review shortcuts">
                <div className="grid grid-cols-2 gap-1 text-[11px]">
                  <span className="text-paper-faint">j / k</span><span className="text-paper-dim">next / prev comment</span>
                  <span className="text-paper-faint">f</span><span className="text-paper-dim">fix focused comment</span>
                  <span className="text-paper-faint">r</span><span className="text-paper-dim">reply to comment</span>
                  <span className="text-paper-faint">d</span><span className="text-paper-dim">toggle diff</span>
                  <span className="text-paper-faint">Esc</span><span className="text-paper-dim">close panels</span>
                </div>
              </HelpSection>
              <HelpSection title="Fix modes">
                <p className="text-paper-dim"><strong className="text-ok">Quick</strong> — Reads file from cache + Haiku. ~$0.001</p>
                <p className="text-paper-dim"><strong className="text-signal">Deep</strong> — Full code exploration + Sonnet. ~$0.05+</p>
              </HelpSection>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.15em] text-paper-muted mb-1.5">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Mark() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 32 32"
      fill="none"
      className="shrink-0"
      aria-hidden
    >
      <circle cx="16" cy="16" r="9" stroke="currentColor" className="text-paper-muted" />
      <circle cx="16" cy="16" r="1.6" fill="currentColor" className="text-signal" />
    </svg>
  );
}
