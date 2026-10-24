"use client";

// Tour acts "Ship" and "Teams": answering review comments and questions,
// sharing a fix, the Impact page, private organizations and security fixes.

import { cn } from "@/lib/utils";
import { StatusChip } from "@/components/status-dot";
import { AppWindow, Count, Inline, LogLine, PageHead, Press, Reveal, Typed, progress, useAutoScroll, useScrollFraction, useT, type Chapter } from "./kit";
import { ACTIVITY, COMMENT_FIX, DEMO_REPO, DRAFTED_REPLY, FINDINGS, ORG, ORG_REPOS, PATCH_STATS, QUESTION, REVIEW_COMMENT, RUN, SHARE, STATS, VERIFY_CHECKS } from "./data";

// ── 8. Respond to review ──────────────────────────────────────────────────

const STEPS = [
  { at: 5900, text: "Reading src/truncate.ts" },
  { at: 6700, text: "Finding references to truncate" },
  { at: 7500, text: "Generating fix..." },
];

function InboxPhase() {
  return (
    <div className="px-4 py-4 sm:px-6">
      <PageHead title="Pull requests" description="View and follow up on your open PRs. Click any PR to see review comments and push fixes." />
      <div className="flex gap-4 border-b border-border text-[12px]">
        <span className="border-b-2 border-signal pb-1.5 font-medium text-paper">Inbox <span className="ml-0.5 rounded-full bg-alert px-1.5 text-[10px] text-white">1</span></span>
        <span className="text-paper-muted">All PRs (1)</span>
        <span className="hidden text-paper-muted sm:inline">Opened with opensrcer</span>
      </div>
      <Reveal at={500} className="mt-3 overflow-hidden rounded-xl border border-border-soft bg-surface">
        <p className="border-b border-border-soft px-3 py-2 text-[12px]"><span className="font-semibold text-signal">!</span> <span className="font-medium text-paper">Has comments</span> <span className="text-paper-muted">· Review feedback to address</span></p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[12px]">
          <span className="text-paper-muted">{DEMO_REPO}</span>
          <span className="text-paper-faint">#{RUN.pr}</span>
          <span className="min-w-0 flex-1 truncate font-medium text-paper">{RUN.prTitle}</span>
          <span className="text-info">1 comment</span>
          <span className="hidden font-mono sm:inline"><span className="text-ok">+{PATCH_STATS.additions}</span> <span className="text-alert">-{PATCH_STATS.deletions}</span></span>
          <Press at={2900} className="rounded-full border border-signal/40 px-2 py-0.5 text-[11px] text-signal">review</Press>
        </div>
        <p className="border-t border-border-soft bg-surface-2/50 px-3 py-1.5 text-[11px] text-paper-muted">Click to read comments and draft replies. Use AI to generate responses.</p>
      </Reveal>
    </div>
  );
}

// Left out on purpose: the PR page can also write a "why this fix" note and post
// it as a comment, but its prompt keeps AI out of what it writes, and a
// maintainer should be told. The tour shows the fix being pushed by the user,
// and the drafted reply being edited by them before it is sent.

/** What the user adds to the drafted reply before sending it. */
const REPLY_EDIT = " I can open that follow-up this week if it helps.";
const REPLY_EDIT_AT = 10200;
/** When the reply is sent (the send button's click, after the user's edit is typed). */
const REPLY_SEND_AT = REPLY_EDIT_AT + Math.ceil((REPLY_EDIT.length / 22) * 1000) + 1500;
/** When the posted reply shows, with the note lib/disclosure.ts appends to it. */
export const REPLY_SENT_AT = REPLY_SEND_AT + 600;
const REPLY_NOTE = "Drafted with AI assistance (opensrcer, claude-haiku-4-5); reviewed and posted by me.";

function WorkspacePhase() {
  const t = useT();
  const fixing = t >= 5800;
  const fixed = t >= 8800;
  const pushed = t >= 16800;
  const step = [...STEPS].reverse().find((s) => t >= s.at);
  // Down through the fix and its checks, then back up to the comment, now fixed.
  const scrollRef = useScrollFraction(t < 17800 ? progress(t, 9200, 15400) : 1 - progress(t, 17800, 19000));
  return (
    <div ref={scrollRef} data-chat-room className="h-full space-y-2.5 overflow-hidden px-4 py-3 sm:px-6">
      <p className="text-[11px] text-paper-muted">PRs / {DEMO_REPO} / #{RUN.pr}</p>
      <div className="rounded-xl border border-border-soft bg-surface px-3 py-2.5">
        <p className="text-[13px] font-medium text-paper"><span className="mr-1.5 rounded border border-signal/40 px-1 text-[10px] text-signal">OPEN</span>{RUN.prTitle}</p>
        <p className="mt-0.5 text-[11px] text-paper-muted">rahulp7801 wants to merge <span className="text-info">{RUN.branch}</span> into <span className="text-info">main</span></p>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-[11.5px] text-paper-muted">
        1 review comments
        {pushed ? <><span className="text-ok">1 fixed</span><StatusChip tone="ok">all addressed</StatusChip></> : <span className="text-signal">1 pending</span>}
        <span className="ml-auto">fix mode <span className="rounded-full bg-ok/15 px-1.5 text-ok">quick</span> <span className="px-1 text-paper-faint">deep</span></span>
      </p>
      <div className={cn("rounded-xl border bg-surface px-3 py-2.5", pushed ? "border-l-[3px] border-ok/60" : "border-border-soft", t < 8800 && t >= 4200 && "ring-1 ring-signal/50")}>
        <p className="flex flex-wrap items-center gap-2 text-[11px] text-paper-muted">
          <span className="font-semibold text-paper">{REVIEW_COMMENT.author}</span> just now
          {pushed && <StatusChip tone="ok">fixed</StatusChip>}
          <code className="font-mono text-info">{REVIEW_COMMENT.path}:{REVIEW_COMMENT.line}</code>
          <span className="rounded-full border border-signal/40 px-1.5 text-[10px] text-signal">inline</span>
        </p>
        <p className="mt-1.5 text-[12px] leading-5 text-paper-dim">{REVIEW_COMMENT.body}</p>
        {!fixing && (
          <div className="mt-2 flex gap-2 text-[11px]">
            <Press at={5600} className="rounded-full border border-ok/40 bg-ok/10 px-2.5 py-0.5 text-ok">quick fix</Press>
            <span className="rounded-full border border-info/40 px-2.5 py-0.5 text-info">draft reply</span>
            <span className="rounded-full border border-border px-2.5 py-0.5 text-paper-muted">reply manually</span>
          </div>
        )}
      </div>
      {fixing && (
        <Reveal at={5800} className="rounded-xl border border-border-soft bg-surface">
          <p className="flex items-center justify-between border-b border-border-soft px-3 py-1.5 text-[11.5px]">
            <span className="font-medium text-paper">fix generation</span>
            {fixed ? <span className="font-mono text-ok">$0.0042 — minimal</span> : <span className="text-paper-muted">{step?.text}</span>}
          </p>
          <div className="space-y-1 px-3 py-2 text-[11px]">
            <p className="mono-label">Agent activity <span className="font-normal text-paper-faint">· 2 tool calls</span></p>
            <Reveal at={5900}><span className="text-info">#</span> read file <code className="font-mono text-paper-dim">src/truncate.ts</code></Reveal>
            <Reveal at={6700}><span className="text-ok">&amp;</span> find references <code className="font-mono text-paper-dim">truncate</code></Reveal>
          </div>
          {fixed && (
            <Reveal at={8800} className="mx-3 mb-2 overflow-hidden rounded-lg bg-[#1d1d1f] px-3 py-2 font-mono text-[10.5px] leading-[1.6]">
              {COMMENT_FIX.map((l) => <LogLine key={l} text={l} />)}
            </Reveal>
          )}
        </Reveal>
      )}
      {t >= 9800 && (
        <Reveal at={9800} spot="verify-checks" className="rounded-xl border border-border-soft bg-surface px-3 py-2">
          <p className="flex items-center justify-between text-[11.5px]"><span className="font-medium text-paper">verification checks</span>{t >= 12600 && <StatusChip tone="signal">review needed</StatusChip>}</p>
          <ul className="mt-1.5 space-y-1">
            {VERIFY_CHECKS.map((c, i) => (
              <Reveal as="li" key={c.name} at={10000 + i * 420} className="flex gap-2 text-[11px] leading-5">
                <span className={c.tone === "pass" ? "font-semibold text-ok" : "font-semibold text-signal"}>{c.tone === "pass" ? "+" : "!"}</span>
                <span><span className="font-semibold text-paper">{c.name}</span> <span className="text-paper-muted">{c.detail}</span></span>
              </Reveal>
            ))}
          </ul>
        </Reveal>
      )}
      {t >= 15400 && (
        <Reveal at={15400} className="flex flex-wrap items-center gap-2 rounded-xl border border-border-soft bg-surface px-3 py-2 text-[11.5px]">
          <span className="text-paper-muted">commit:</span>
          <code className="min-w-0 flex-1 truncate rounded border border-border px-2 py-0.5 font-mono text-paper">address review feedback</code>
          <Press at={16200} className={cn("rounded-full px-3 py-0.5", pushed ? "bg-ok/15 text-ok" : "bg-signal text-white")}>{pushed ? "pushed" : t >= 16200 ? "pushing..." : "push fix"}</Press>
        </Reveal>
      )}
    </div>
  );
}

function RespondView() {
  const t = useT();
  const workspace = t >= 3400;
  return (
    <AppWindow path={workspace ? `/prs/${DEMO_REPO}/${RUN.pr}` : "/prs"} section="Ship" tab="Pull requests">
      {workspace ? <WorkspacePhase /> : <InboxPhase />}
      {t >= 16800 && t < 20500 && (
        <Reveal at={16800} className="pointer-events-none absolute bottom-3 right-3 max-w-[90%] truncate rounded-xl bg-paper px-3 py-2 text-[11.5px] text-surface shadow-lg">Pushed commit 3f9e2a1 to branch</Reveal>
      )}
    </AppWindow>
  );
}

export const respond: Chapter = {
  id: "respond",
  act: "Ship",
  label: "Fix a comment",
  title: "Answer the reviewer",
  duration: 22000,
  source: "Example review comment on the real pull request #7",
  captions: [
    { at: 0, text: "Ship: when maintainers comment, your pull requests come back to one inbox." },
    { at: 3400, text: "Open one and every review comment is listed with its file and line." },
    { at: 5600, text: "Ask for a fix. The agent reads the file and its callers, then proposes the smallest change that answers the comment." },
    { at: 9800, text: "Before anything is pushed, the change is checked for size, secrets, syntax, and whether it touches the file the reviewer meant. It says plainly that tests weren't run." },
    { at: 15400, text: "Review the diff and push it to the same branch yourself. The comment is marked fixed, and the pull request is ready for another look." },
  ],
  View: RespondView,
};

// ── 9. Private organizations ──────────────────────────────────────────────

const PERMISSIONS = [
  "Repository contents — read & write",
  "Pull requests — read & write",
  "Issues, Dependabot alerts, security advisories — read",
];

function OrgsView() {
  const t = useT();
  const sheet = t >= 2200 && t < 5600;
  const connected = t >= 5600;
  const orgPage = t >= 8400;
  return (
    <AppWindow path={orgPage ? `/crucible/orgs/${ORG}` : "/crucible"} section="none">
      <div className="relative h-full overflow-hidden px-4 py-4 sm:px-6">
        {!orgPage ? (
          <>
            <PageHead title="Settings" description="Manage provider credentials, GitHub access, and your account." />
            <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
              <div>
                <p className="text-[13px] font-semibold text-paper">GitHub access</p>
                <p className="mt-1 text-[11.5px] leading-5 text-paper-muted">Connect an organization only when you need to scan its private repositories.</p>
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border-soft bg-surface px-3 py-2.5">
                  <span className="text-[11px] text-paper-muted">Signed in as<br /><span className="text-[13px] font-medium text-paper">rahulp7801</span></span>
                  <Press at={1800} className="rounded-md border border-border-strong px-3 py-1.5 text-[12px] font-medium text-paper">Connect organization</Press>
                </div>
                <p className="mono-label">Connected organizations <span className="font-normal">{connected ? "1" : "0"}</span></p>
                {connected ? (
                  <Reveal at={5600} className="flex flex-wrap items-center gap-3 rounded-lg border border-border-soft bg-surface px-3 py-2.5 text-[12px]">
                    <span className="font-medium text-paper">{ORG}</span>
                    <StatusChip tone="ok">Verified Oct 21</StatusChip>
                    <span className="ml-auto text-paper-muted">disconnect</span>
                    <Press at={8000} className="rounded-full border border-border px-2.5 py-0.5 text-paper">Open →</Press>
                  </Reveal>
                ) : (
                  <p className="text-[11.5px] text-paper-muted">No organizations connected. Public repository workflows are already available.</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <Reveal at={8400}>
            <PageHead title={ORG} description="Private repos reachable via the opensrcer-crucible installation. Click a repo to scan for advisories, Dependabot alerts, and open issues." />
            <p className="mono-label">{ORG_REPOS.length} repos accessible</p>
            <ul className="mt-2 divide-y divide-border-soft overflow-hidden rounded-xl border border-border-soft bg-surface">
              {ORG_REPOS.map((r, i) => (
                <Reveal as="li" key={r.name} at={8700 + i * 300} className="flex items-center gap-3 px-3 py-2.5 text-[12px]">
                  <span className="font-medium text-paper">{r.name}</span>
                  <span className="rounded border border-border px-1 text-[10px] text-paper-muted">private</span>
                  <span className="hidden text-[11px] text-paper-muted sm:inline">{r.lang} · default: main · updated {r.updated}</span>
                  <span className="ml-auto text-signal">scan →</span>
                </Reveal>
              ))}
            </ul>
          </Reveal>
        )}
        {sheet && (
          <div className="absolute inset-0 grid place-items-center bg-ink/70 p-4 backdrop-blur-sm">
            <Reveal at={2200} className="w-full max-w-[400px] rounded-2xl border border-border bg-surface p-4 shadow-xl">
              <p className="text-[11px] text-paper-muted">github.com</p>
              <p className="mt-0.5 text-[15px] font-semibold text-paper">Install opensrcer on {ORG}</p>
              <ul className="mt-2.5 space-y-1.5 text-[12px] text-paper-dim">
                {PERMISSIONS.map((p, i) => <Reveal as="li" key={p} at={2700 + i * 450}><span className="mr-1.5 text-ok">+</span>{p}</Reveal>)}
              </ul>
              <Reveal at={4100} className="mt-2.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[11.5px] text-paper-muted">Only select repositories: {ORG_REPOS.map((r) => r.name).join(", ")}</Reveal>
              <Press at={5100} className="mt-3 w-full rounded-full border border-ok/50 bg-ok/10 py-1.5 text-[12px] font-medium text-ok">Install &amp; Authorize</Press>
            </Reveal>
          </div>
        )}
      </div>
    </AppWindow>
  );
}

export const orgs: Chapter = {
  id: "orgs",
  act: "Teams",
  label: "Private repos",
  title: "Bring in private repositories",
  duration: 12000,
  source: "Example organization · fictional repositories",
  captions: [
    { at: 0, text: "Private repositories work through your organization, not your personal account." },
    { at: 2200, text: "An organization admin installs the opensrcer GitHub App and chooses exactly which repositories it can see." },
    { at: 5600, text: "Each run then gets a fresh, short-lived token for one repository. No personal token is stored, and access can be revoked at any time." },
    { at: 8400, text: "The organization's private repositories appear, ready to scan." },
  ],
  View: OrgsView,
};

// ── 10. Security fixes ────────────────────────────────────────────────────

const SEV_CLASS: Record<string, string> = {
  critical: "border-alert/40 bg-alert/5 text-alert",
  high: "border-[#b45309]/40 bg-[#b45309]/5 text-[#9a4a06]",
  medium: "border-[#a16207]/40 bg-[#a16207]/5 text-[#7c5a05]",
};

const FIX_LOG = [
  { at: 0.05, text: "[tool] read_file package.json" },
  { at: 0.16, text: "[tool] grep path-matcher" },
  { at: 0.27, text: "[tool] read_file package-lock.json" },
  { at: 0.4, text: "## Diagnosis" },
  { at: 0.46, text: "path-matcher 2.1.0 arrives through router-core; 2.1.4 fixes the backtracking." },
  { at: 0.58, text: "+  \"overrides\": { \"path-matcher\": \"^2.1.4\" }" },
  // Runs end at review (lib/run-finish.ts); the PR opens only when the user publishes.
  { at: 0.74, text: "[preview] ready for review: \"fix(deps): override path-matcher to ^2.1.4\" (1 file(s), sign-off=false, verification=not run)" },
  { at: 0.86, text: "[preview] nothing has been published; review the patch and evidence, then use Publish on the run page" },
];

function SecureView() {
  const t = useT();
  const running = t >= 4800;
  const f = progress(t, 5000, 12400);
  const repo = `${ORG}/${ORG_REPOS[0].name}`;
  return (
    <AppWindow path={`/crucible/orgs/${repo}`} section="none">
      <div className="h-full overflow-hidden px-4 py-4 sm:px-6">
        <PageHead title={repo} description="Security findings and open issues. Click Fix issue on any row to start a run scoped to this repo." />
        {!running ? (
          <>
            <p className="flex items-center gap-2 text-[12px] font-medium text-paper">security findings ({FINDINGS.length}) <span className="rounded-md border border-alert/30 px-1.5 text-[11px] font-normal text-alert">1 critical · 2 high</span></p>
            <ul className="mt-2 space-y-2">
              {FINDINGS.map((x, i) => (
                <Reveal as="li" key={x.pkg} at={500 + i * 350} className={cn("flex items-start gap-3 rounded-xl border bg-surface px-3 py-2", i === 0 && t >= 3000 ? "border-alert/40" : "border-border-soft")}>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className={cn("rounded border px-1 font-mono", SEV_CLASS[x.severity])}>{x.severity}</span>
                      <span className="text-paper-muted">{x.kind}</span>
                      <code className="font-mono text-paper-dim">{x.pkg}</code>
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-paper">{x.summary}</p>
                  </div>
                  <Press at={i === 0 ? 4400 : null} className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-[11px] text-paper">Fix issue</Press>
                </Reveal>
              ))}
            </ul>
          </>
        ) : (
          <Reveal at={4800} className="overflow-hidden rounded-2xl border border-border-soft bg-surface">
            <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-paper">{FINDINGS[0].summary}</p>
                <p className="text-[11px] text-paper-muted">{repo} · {FINDINGS[0].pkg}</p>
              </div>
              {f >= 0.9 ? <StatusChip tone="ok">waiting for your review</StatusChip> : <StatusChip tone="signal">live</StatusChip>}
            </div>
            {f >= 0.9 && <p className="border-b border-ok/30 bg-ok/5 px-3 py-1.5 text-[12px] font-medium text-ok">Waiting for your review · publish opens the draft PR</p>}
            <div className="term h-[220px] overflow-hidden rounded-none px-3 py-2.5 font-mono text-[10.5px] leading-[1.6]">
              {FIX_LOG.filter((l) => l.at <= f).map((l) => <LogLine key={l.text} text={l.text} />)}
            </div>
          </Reveal>
        )}
      </div>
    </AppWindow>
  );
}

export const secure: Chapter = {
  id: "secure",
  act: "Teams",
  label: "Security fixes",
  title: "Fix vulnerable dependencies",
  duration: 13500,
  source: "Example organization · fictional repositories and advisories",
  captions: [
    { at: 0, text: "Security advisories and Dependabot alerts for a private repository, sorted by severity." },
    { at: 4400, text: "Pick a finding and the agent traces where the vulnerable package comes from, then patches the dependency." },
    { at: 9400, text: "It stops at review like every run. When you publish, the pull request is opened with the organization's short-lived installation token, scoped to this one repository." },
  ],
  View: SecureView,
};

// ── 11. Impact ────────────────────────────────────────────────────────────

function ImpactView() {
  const tiles = [
    { label: "runs", value: STATS.runs, sub: "your history", tone: "bg-info" },
    { label: "patches", value: STATS.patches, sub: "74% success rate", tone: "bg-signal" },
    { label: "PRs opened", value: STATS.prs, sub: "26% of runs", tone: "bg-ok" },
    { label: "recorded spend", value: STATS.spend, sub: "Anthropic API", tone: "bg-signal", money: true },
    { label: "scans", value: STATS.scans, sub: `${STATS.discover} via Discover`, tone: "bg-paper-muted" },
  ];
  // Brings contributions and activity into view on small screens; a no-op when they fit.
  const scrollRef = useAutoScroll(3000, 8000);
  return (
    <AppWindow path="/stats" section="Ship" tab="Impact">
      <div ref={scrollRef} className="h-full overflow-hidden px-4 py-4 sm:px-6">
        <PageHead title="Impact" description="Track recorded runs, patches, pull requests, and provider spend across your work." />
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border-soft bg-border-soft sm:grid-cols-5">
          {tiles.map((tile, i) => (
            <div key={tile.label} className={cn("bg-surface p-3", i === 4 && "col-span-2 sm:col-span-1")}>
              <p className="mono-label flex items-center gap-1.5"><span className={cn("size-1.5 rounded-full", tile.tone)} />{tile.label}</p>
              <p className="display mt-1 text-[26px] leading-none text-paper sm:text-[30px]">
                <Count to={tile.value} at={400 + i * 150} duration={1600} format={tile.money ? (n) => `$${n.toFixed(2)}` : undefined} />
              </p>
              <p className="mt-1 text-[11px] text-paper-dim">{tile.sub}</p>
            </div>
          ))}
        </div>
        <Reveal at={2200} className="mt-4">
          <p className="flex items-baseline justify-between gap-3 text-[13px] font-semibold text-paper">Biggest contributions <span className="text-[11px] font-normal text-paper-muted">Draft PRs on repositories with 1,000+ stars</span></p>
          <p className="mt-1.5 flex items-center gap-3 rounded-xl border border-border-soft bg-surface px-3 py-2 text-[12px]"><span className="font-mono text-paper-faint">1</span><span className="text-signal">acme/ui-kit ↗</span><span className="text-paper-muted">fixes #2290</span><span className="ml-auto text-signal">★ 12.3k</span></p>
        </Reveal>
        <p className="mt-4 text-[13px] font-semibold text-paper">Recent activity</p>
        <ul className="mt-1.5 divide-y divide-border-soft overflow-hidden rounded-xl border border-border-soft bg-surface">
          {ACTIVITY.map((a, i) => (
            <Reveal as="li" key={a.text} at={2600 + i * 350} className="flex items-center gap-3 px-3 py-2 text-[12px]">
              <span className="tag w-[78px] justify-start" data-tone={a.kind === "run" ? "signal" : a.kind === "discover" ? "info" : undefined}>{a.kind}</span>
              <span className="w-[52px] shrink-0 text-[11px] text-paper-muted">{a.when}</span>
              <span className={cn("truncate", a.kind === "run" && a.text.includes("PR opened") ? "text-signal" : "text-paper-dim")}><Inline text={a.text} /></span>
            </Reveal>
          ))}
        </ul>
      </div>
    </AppWindow>
  );
}

export const impact: Chapter = {
  id: "impact",
  act: "Ship",
  label: "Impact",
  title: "Keep track of the work",
  duration: 10000,
  source: "Example account history",
  captions: [
    { at: 0, text: "Impact keeps score: runs, patches, pull requests, and every dollar of provider spend." },
    { at: 4400, text: "Every scan, run and pull request is in your history, so you always know what the agent did on your behalf." },
  ],
  View: ImpactView,
};


// ── Answer a question ─────────────────────────────────────────────────────

function ReplyView() {
  const t = useT();
  const drafting = t >= 4200 && t < 5600;
  const drafted = t >= 5600;
  // The user edits the draft before sending it.
  const sendAt = REPLY_SEND_AT;
  const sent = t >= REPLY_SENT_AT;
  const editing = t >= REPLY_EDIT_AT && !sent;
  // Follows the draft down to the send button on small screens; a no-op when it fits.
  const scrollRef = useAutoScroll(5600, 11400);
  return (
    <AppWindow path={`/prs/${DEMO_REPO}/${RUN.pr}`} section="Ship" tab="Pull requests">
      <div ref={scrollRef} data-chat-room className="h-full space-y-2.5 overflow-hidden px-4 py-3 sm:px-6">
        <p className="flex flex-wrap items-center gap-2 text-[11.5px] text-paper-muted">
          2 review comments <span className="text-ok">1 fixed</span>
          {sent ? <><span className="text-info">1 replied</span><StatusChip tone="ok">all addressed</StatusChip></> : <span className="text-signal">1 pending</span>}
        </p>
        <div className="rounded-xl border border-l-[3px] border-ok/60 bg-surface px-3 py-2 opacity-90">
          <p className="flex flex-wrap items-center gap-2 text-[11px] text-paper-muted"><span className="font-semibold text-paper">{REVIEW_COMMENT.author}</span><StatusChip tone="ok">fixed</StatusChip><code className="font-mono text-info">{REVIEW_COMMENT.path}:{REVIEW_COMMENT.line}</code></p>
          <p className="mt-1 truncate text-[12px] text-paper-dim">{REVIEW_COMMENT.body}</p>
        </div>
        <div className={cn("rounded-xl border bg-surface px-3 py-2.5", sent ? "border-l-[3px] border-info/60" : "border-border-soft ring-1 ring-signal/50")}>
          <p className="flex flex-wrap items-center gap-2 text-[11px] text-paper-muted">
            <span className="font-semibold text-paper">{QUESTION.author}</span> just now
            {sent && <StatusChip tone="info">replied</StatusChip>}
            <code className="font-mono text-info">{QUESTION.path}:{QUESTION.line}</code>
            <span className="rounded-full border border-signal/40 px-1.5 text-[10px] text-signal">inline</span>
          </p>
          <p className="mt-1.5 text-[12.5px] leading-5 text-paper-dim">{QUESTION.body}</p>
          {!drafted && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
              <Press at={4200} className="rounded-full border border-info/40 bg-info/10 px-2.5 py-0.5 text-info">{drafting ? "drafting..." : "draft reply"}</Press>
              <span className="rounded-full border border-border px-2.5 py-0.5 text-paper-muted">reply manually</span>
              <span className="text-paper-muted">question — AI will draft a reply</span>
            </div>
          )}
          {drafted && (
            <Reveal at={5600} className="mt-2.5 space-y-2">
              <p className={cn("min-h-[86px] rounded-lg border bg-surface px-3 py-2 text-[12px] leading-5 text-paper", editing ? "border-signal/60" : "border-border")}>
                {sent ? DRAFTED_REPLY : <Typed text={DRAFTED_REPLY} at={5700} cps={70} />}
                {t >= REPLY_EDIT_AT && <span className="rounded-sm bg-signal/10"><Typed text={REPLY_EDIT} at={REPLY_EDIT_AT} cps={22} /></span>}
                {sent && <span data-spot="reply-note" className="mt-2 block text-[11px] text-paper-muted">{REPLY_NOTE}</span>}
              </p>
              {!sent && t >= REPLY_EDIT_AT - 1200 && <p className="text-[10.5px] text-paper-muted">AI draft · edit it before you send</p>}
              <div className="flex items-center gap-2 text-[11px]">
                <Press at={sendAt} className={cn("rounded-full px-3 py-0.5", sent ? "bg-ok/15 text-ok" : "border border-info/40 bg-info/10 text-info")}>{sent ? "replied" : t >= sendAt ? "..." : "send"}</Press>
                {!sent && <span className="rounded-full border border-border px-2.5 py-0.5 text-paper-muted">cancel</span>}
              </div>
            </Reveal>
          )}
        </div>
      </div>
      {sent && t < sendAt + 3700 && (
        <Reveal at={sendAt + 600} className="pointer-events-none absolute bottom-3 right-3 rounded-xl bg-paper px-3 py-2 text-[11.5px] text-surface shadow-lg">Reply posted successfully</Reveal>
      )}
    </AppWindow>
  );
}

export const reply: Chapter = {
  id: "reply",
  act: "Ship",
  label: "Answer a question",
  title: "Answer a reviewer's question",
  duration: REPLY_SENT_AT + 7500,
  source: "Example question on the real pull request #7",
  captions: [
    { at: 0, text: "Not every comment needs code. When a reviewer asks a question, opensrcer recognizes it and offers to draft an answer." },
    { at: 5600, text: "The draft explains the trade-off in plain words and offers a follow-up instead of growing the change." },
    { at: 10200, text: "It's a draft. Edit it or write your own; nothing is posted until you press send." },
  ],
  View: ReplyView,
};

// ── Share a fix ───────────────────────────────────────────────────────────

function ShareView() {
  const t = useT();
  const page = t >= 3600;
  const scrollRef = useAutoScroll(5600, 9200);
  return (
    <AppWindow path={page ? `/fix/${SHARE.id}` : `/prs/${DEMO_REPO}/${RUN.pr}`} section={page ? undefined : "Ship"} tab="Pull requests">
      {!page ? (
        <div className="space-y-3 px-4 py-4 sm:px-6">
          <div className="rounded-xl border border-border-soft bg-surface px-3 py-2.5 text-[12px]">
            <p className="font-medium text-paper">fix generation <span className="font-mono text-[11px] font-normal text-ok">$0.0042 — minimal</span></p>
            <div className="mt-2 overflow-hidden rounded-lg bg-[#1d1d1f] px-3 py-2 font-mono text-[10.5px] leading-[1.6]">{COMMENT_FIX.map((l) => <LogLine key={l} text={l} />)}</div>
            <p className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-paper-faint">
              <span className="font-medium text-paper-muted">export</span>
              <span className="rounded-full border border-border px-2 py-0.5">copy diff</span>
              <span className="rounded-full border border-border px-2 py-0.5">download .patch</span>
              <span className="hidden rounded-full border border-border px-2 py-0.5 sm:inline">copy full response</span>
              <Press at={1800} className="rounded-full border border-signal/30 px-2 py-0.5 text-signal">share fix</Press>
            </p>
          </div>
          {t >= 2300 && <Reveal at={2300} className="ml-auto w-fit rounded-xl bg-paper px-3 py-2 text-[11.5px] text-surface shadow-lg">Share link copied to clipboard</Reveal>}
        </div>
      ) : (
        <div ref={scrollRef} className="h-full space-y-3 overflow-hidden px-4 py-4 sm:px-8">
          <Reveal at={3600} className="rounded-2xl border border-border-soft bg-surface px-4 py-3">
            <p className="flex items-center justify-between text-[11px]"><span><span className="font-semibold text-signal">shared fix</span> <span className="ml-1 rounded-full border border-info/40 px-1.5 text-info">PR #{RUN.pr}</span></span><span className="text-paper-muted">Oct 22, 2026</span></p>
            <p className="serif mt-1 text-[20px] text-paper">{DEMO_REPO}</p>
            <p className="mt-1 text-[11.5px] text-paper-muted">Shared by an opensrcer user. opensrcer does not review shared fixes; check the code before you use it.</p>
            <p className="mt-2 border-l-2 border-signal pl-2.5 text-[12px] italic text-paper-dim">{REVIEW_COMMENT.body}</p>
          </Reveal>
          <Reveal at={5200} className="rounded-xl border border-ok/30 bg-ok/5 px-4 py-2.5 text-[12px] leading-5">
            <p className="font-semibold text-ok">Why this fix</p>
            <p className="text-paper-dim">Trailing commas, semicolons and colons are now trimmed along with whitespace, so <code className="font-mono">&quot;The quick, brown&quot;</code> at 11 returns <code className="font-mono">&quot;The quick…&quot;</code>.</p>
          </Reveal>
          <Reveal at={6800} className="overflow-hidden rounded-xl border border-border-soft bg-surface">
            <p className="flex items-center justify-between border-b border-border-soft px-3 py-1.5 text-[11.5px]"><span className="font-medium text-paper">Diff</span><span className="rounded-full border border-border px-2 py-0.5 text-paper-dim">Copy diff</span></p>
            <pre className="overflow-hidden px-3 py-2 font-mono text-[10.5px] leading-[1.6]">{COMMENT_FIX.map((l) => <span key={l} className={cn("block", l.startsWith("+") && !l.startsWith("+++") ? "text-ok" : l.startsWith("-") && !l.startsWith("---") ? "text-alert" : l.startsWith("@@") ? "text-info" : "text-paper-dim")}>{l}</span>)}</pre>
          </Reveal>
          <Reveal at={8600}><p className="text-[11px] text-paper-muted">Available until {SHARE.until}</p></Reveal>
        </div>
      )}
    </AppWindow>
  );
}

export const share: Chapter = {
  id: "share",
  act: "Ship",
  label: "Share a fix",
  title: "Share a fix as a link",
  duration: 13000,
  source: "Example share of the fix from the review chapter",
  captions: [
    { at: 0, text: "Any fix can be shared as a link, handy for a teammate, a maintainer, or anyone who doesn't use opensrcer." },
    { at: 3600, text: "The page shows the review comment, a plain explanation and the diff. It says clearly that shared fixes aren't reviewed by opensrcer." },
    { at: 8600, text: "Links are unlisted and stop working after 30 days." },
  ],
  View: ShareView,
};
