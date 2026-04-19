import Link from "next/link";
import { AnimatedCounter } from "@/components/animated-counter";

export default function LandingPage() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6 py-16 md:py-24">
      {/* Hero */}
      <section className="text-center">
        <div className="inline-flex items-center gap-2 border border-border bg-surface/40 px-3 py-1 text-[11px] text-paper-muted mb-8">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-signal" />
          AI-powered open-source contributions
        </div>
        <h1 className="serif text-[48px] md:text-[72px] leading-[0.95] tracking-tight text-paper">
          Find bugs.<br />
          Fix them.<br />
          <span className="text-signal">Prove it works.</span>
        </h1>
        <p className="mt-6 max-w-xl mx-auto text-[14px] leading-relaxed text-paper-dim">
          opensrcer scans repositories for real bugs and security advisories,
          generates verified patches using AI, and opens draft PRs — only
          after the repo&apos;s own test suite passes.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link
            href="/login"
            className="inline-flex items-center gap-3 border border-signal bg-signal/10 px-6 py-3 text-[14px] font-medium text-paper hover:bg-signal/20 transition"
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Get started with GitHub
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="mt-24">
        <div className="text-center mb-12">
          <h2 className="serif text-[28px] text-paper tracking-tight">How it works</h2>
          <p className="mt-2 text-[13px] text-paper-dim">Three steps to verified patches.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-border">
          <Step
            number="01"
            title="Scan"
            description="Connect your GitHub account. opensrcer discovers open issues, security advisories, and Dependabot alerts across your repositories."
          />
          <Step
            number="02"
            title="Fix"
            description="AI explores the codebase, diagnoses the root cause, and generates a minimal patch. You control the budget — set a spend cap per task."
            border
          />
          <Step
            number="03"
            title="Verify"
            description="Before opening a PR, the patch runs against the repo's own test suite. Only verified patches get pushed. Failed tests block the PR and show you why."
            border
          />
        </div>
      </section>

      {/* Animated stats strip */}
      <section className="mt-24">
        <div className="grid grid-cols-2 md:grid-cols-4 border border-border">
          <div className="p-6 text-center">
            <AnimatedCounter end={47} className="serif text-[42px] text-paper num-tabular" />
            <div className="mt-1 mono-label text-paper-muted">dispatches fired</div>
          </div>
          <div className="p-6 text-center border-l border-border">
            <AnimatedCounter end={89} suffix="%" className="serif text-[42px] text-signal num-tabular" />
            <div className="mt-1 mono-label text-paper-muted">patch success rate</div>
          </div>
          <div className="p-6 text-center border-l border-border">
            <AnimatedCounter end={12} className="serif text-[42px] text-ok num-tabular" />
            <div className="mt-1 mono-label text-paper-muted">PRs opened</div>
          </div>
          <div className="p-6 text-center border-l border-border">
            <AnimatedCounter end={3} duration={800} className="serif text-[42px] text-info num-tabular" />
            <div className="mt-1 mono-label text-paper-muted">avg minutes per fix</div>
          </div>
        </div>
      </section>

      {/* Dispatch demo */}
      <section className="mt-24">
        <div className="text-center mb-8">
          <h2 className="serif text-[28px] text-paper tracking-tight">Watch it solve a real issue</h2>
          <p className="mt-2 text-[13px] text-paper-dim">
            From issue to verified PR in under 5 minutes. Here&apos;s what a dispatch looks like.
          </p>
        </div>
        <div className="border border-border bg-surface/40">
          {/* Dispatch header */}
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" className="text-signal"><path d="M9 2 3 9h4l-1 5 6-7H8l1-5z" /></svg>
              <span className="text-[13px] text-paper-muted">acme-corp/web-app</span>
              <span className="text-[12px] text-info border border-info/40 px-1.5 py-0.5 leading-none">#47</span>
              <span className="ml-auto text-[9px] tracking-[0.12em] uppercase text-info border border-info/40 px-1 py-px leading-none">deep</span>
            </div>
            <div className="mt-1.5 text-[17px] text-paper">Fix: SQL injection in user search endpoint</div>
            <div className="mt-1 text-[11px] text-paper-muted">3m 42s · $0.0847</div>
          </div>

          {/* Pipeline timeline */}
          <div className="px-4 py-2.5 border-b border-border-soft">
            <div className="flex items-center gap-1">
              {[
                { label: "clone", done: true },
                { label: "explore", done: true },
                { label: "patch", done: true },
                { label: "test", done: true },
                { label: "PR", done: true },
              ].map((p, i) => (
                <div key={p.label} className="flex items-center gap-1">
                  {i > 0 && <div className="w-4 h-px bg-ok/40" />}
                  <span className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] border border-ok/40 text-ok leading-none">
                    ✓ {p.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* PR banner */}
          <div className="border-b border-ok/40 bg-ok/5 px-4 py-3 flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-ok/60 bg-ok/15 text-ok text-[12px]">✓</span>
            <div className="flex-1">
              <div className="text-[13px] text-ok">Draft PR opened</div>
              <div className="mt-0.5 text-[11px] text-paper-muted">acme-corp/web-app · #48</div>
            </div>
            <span className="border border-ok/50 bg-ok/10 text-ok px-3 py-1.5 text-[12px]">
              View PR #48
            </span>
          </div>

          {/* Diff preview */}
          <div className="border-b border-border">
            <div className="px-4 py-2 flex items-center gap-3 text-[11px] text-paper-muted bg-surface/30">
              <span className="font-medium text-paper-dim">Review patch</span>
              <span>2 files</span>
              <span className="text-ok">+14</span>
              <span className="text-alert">-3</span>
            </div>
            <pre className="text-[11.5px] leading-snug font-mono">
              <div className="px-4 whitespace-pre text-paper font-semibold">--- a/src/routes/users.ts</div>
              <div className="px-4 whitespace-pre text-paper font-semibold">+++ b/src/routes/users.ts</div>
              <div className="px-4 whitespace-pre text-info bg-info/10">{"@@ -23,7 +23,11 @@ export async function searchUsers(req, res) {"}</div>
              <div className="px-4 whitespace-pre text-paper-dim">{"   const query = req.query.q;"}</div>
              <div className="px-4 whitespace-pre text-alert bg-alert/10">{`-  const results = await db.query(\`SELECT * FROM users WHERE name LIKE '%\${query}%'\`);`}</div>
              <div className="px-4 whitespace-pre text-ok bg-ok/10">{`+  const results = await db.query(`}</div>
              <div className="px-4 whitespace-pre text-ok bg-ok/10">{`+    "SELECT * FROM users WHERE name LIKE $1",`}</div>
              <div className="px-4 whitespace-pre text-ok bg-ok/10">{`+    [\`%\${query}%\`]`}</div>
              <div className="px-4 whitespace-pre text-ok bg-ok/10">{`+  );`}</div>
              <div className="px-4 whitespace-pre text-paper-dim">   return res.json(results.rows);</div>
            </pre>
          </div>

          {/* Diagnosis */}
          <div className="px-4 py-4 text-[12.5px] text-paper-dim leading-relaxed space-y-2">
            <div className="text-[13px] text-paper font-medium">Diagnosis</div>
            <p>
              The <code className="text-signal bg-signal/10 px-1 py-0.5 text-[11.5px]">searchUsers</code> handler
              at <strong className="text-paper">src/routes/users.ts:25</strong> interpolates user input directly into
              a SQL string. Parameterized queries prevent injection.
            </p>
            <div className="text-[13px] text-paper font-medium mt-3">Tests</div>
            <p>
              <span className="text-ok">✓</span> 47 tests passed · <span className="text-ok">✓</span> new test added for injection vector ·
              <span className="text-paper-muted">0 failures</span>
            </p>
          </div>
        </div>
      </section>

      {/* Explore demo */}
      <section className="mt-24">
        <div className="text-center mb-8">
          <h2 className="serif text-[28px] text-paper tracking-tight">Explore any codebase</h2>
          <p className="mt-2 text-[13px] text-paper-dim">
            Ask plain-English questions. Claude navigates with tree-sitter AST indexing and grep to find the answer.
          </p>
        </div>
        <div className="border border-border bg-surface/40">
          <div className="px-4 py-2.5 border-b border-border-soft flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.15em] text-signal">Q</span>
            <span className="text-[13px] text-paper">Where is the authentication middleware and how does it work?</span>
          </div>
          <div className="px-4 py-2 border-b border-border-soft bg-ink/30">
            <div className="flex flex-wrap gap-1.5">
              {[
                { icon: "i", detail: "overview", color: "text-paper-muted border-border-soft" },
                { icon: "/", detail: "/middleware/", color: "text-signal border-signal/30" },
                { icon: "#", detail: "middleware.ts", color: "text-info border-info/30" },
                { icon: "/", detail: "/getSession/", color: "text-signal border-signal/30" },
                { icon: "#", detail: "lib/github-token.ts", color: "text-info border-info/30" },
                { icon: "@", detail: "resolveGitHubToken", color: "text-ok border-ok/30" },
              ].map((t, i) => (
                <span key={i} className={`text-[9.5px] tracking-[0.05em] px-1.5 py-0.5 border leading-none ${t.color}`}>
                  {t.icon} {t.detail}
                </span>
              ))}
            </div>
          </div>
          <div className="px-4 py-4 text-[12.5px] text-paper-dim leading-relaxed space-y-3">
            <p>
              The authentication middleware lives in <strong className="text-paper">middleware.ts</strong> at the project root.
              It uses <code className="text-signal bg-signal/10 px-1 py-0.5 text-[11.5px]">@auth0/nextjs-auth0/edge</code> to
              gate every route behind an Auth0 session check.
            </p>
            <div>
              <div className="flex items-center justify-between px-3 py-1.5 bg-ink/80 border border-border-soft border-b-0 text-[10px] text-paper-muted">
                <span className="font-mono">middleware.ts:36-58</span>
              </div>
              <pre className="overflow-x-auto px-3 py-3 bg-ink/60 border border-border-soft text-[11.5px] leading-snug font-mono text-paper-dim">
{`export async function middleware(req) {
  if (isPublic(pathname)) return NextResponse.next();
  const session = await getSession(req, res);
  if (session?.user) return res;
  // API routes get 401; pages redirect to /login
  if (pathname.startsWith("/api/"))
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 }
    );
  return NextResponse.redirect(loginUrl);
}`}</pre>
            </div>
            <p>
              Public paths (<code className="text-signal bg-signal/10 px-1 py-0.5 text-[11.5px]">/</code>,{" "}
              <code className="text-signal bg-signal/10 px-1 py-0.5 text-[11.5px]">/login</code>,{" "}
              <code className="text-signal bg-signal/10 px-1 py-0.5 text-[11.5px]">/api/auth</code>) are
              exempted. Everything else requires a valid session.
            </p>
          </div>
        </div>
      </section>

      {/* Crucible */}
      <section className="mt-24">
        <div className="border border-border">
          <div className="p-8 md:p-10">
            <div className="flex items-center gap-3 mb-4">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M8 1.5L2.5 4v4c0 3.5 2.3 6.1 5.5 7 3.2-.9 5.5-3.5 5.5-7V4L8 1.5z" />
                <path d="M6 8l1.5 1.5L10 6.5" />
              </svg>
              <span className="mono-label text-signal">Crucible</span>
            </div>
            <h2 className="serif text-[32px] text-paper tracking-tight leading-tight">
              Private repos.<br />
              Verified patches.
            </h2>
            <p className="mt-4 max-w-lg text-[13px] text-paper-dim leading-relaxed">
              Connect your GitHub Organization through a dedicated GitHub App.
              opensrcer scans your private repos for vulnerabilities and open
              issues, then lands draft PRs whose patches have been verified
              against the repo&apos;s own test suite — all using short-lived
              installation tokens. No long-lived credentials, no ambient access.
            </p>
          </div>
          <div className="border-t border-border grid grid-cols-1 sm:grid-cols-3">
            <Feature title="GitHub App auth" detail="Short-lived tokens, per-org scope, revocable anytime" />
            <Feature title="Test-gated PRs" detail="Patches only land if the repo's tests pass" border />
            <Feature title="Zero storage" detail="API keys encrypted in cookies, never on our servers" border />
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="mt-24">
        <div className="text-center mb-8">
          <h2 className="serif text-[28px] text-paper tracking-tight">Security first</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 border border-border">
          <SecurityItem
            title="No stored credentials"
            detail="GitHub tokens and API keys live in encrypted browser cookies (AES-256-GCM). The server decrypts in memory only to make API calls, then discards. Nothing is written to disk or a database."
          />
          <SecurityItem
            title="Auth0 identity"
            detail="Your password is never shared with opensrcer. Authentication is brokered through Auth0 — we only receive your profile and a scoped GitHub token."
            border
          />
          <SecurityItem
            title="Spend controls"
            detail="Set a hard cap on AI spend per task ($0.50–$10). The model stops cleanly when the limit is reached. No surprise bills."
            borderTop
          />
          <SecurityItem
            title="Full revocability"
            detail="Disconnect orgs, clear API keys, and sign out with one click. Revoke the GitHub OAuth app entirely from github.com/settings/applications."
            border
            borderTop
          />
        </div>
      </section>

      {/* CTA */}
      <section className="mt-24 text-center pb-8">
        <h2 className="serif text-[28px] text-paper tracking-tight">Ready to start?</h2>
        <p className="mt-2 text-[13px] text-paper-dim">Sign in with GitHub. No credit card required.</p>
        <div className="mt-6">
          <Link
            href="/login"
            className="inline-flex items-center gap-3 border border-signal bg-signal/10 px-6 py-3 text-[14px] font-medium text-paper hover:bg-signal/20 transition"
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Sign in with GitHub
          </Link>
        </div>
      </section>
    </div>
  );
}

function Step({
  number,
  title,
  description,
  border,
}: {
  number: string;
  title: string;
  description: string;
  border?: boolean;
}) {
  return (
    <div className={`p-6 ${border ? "md:border-l border-t md:border-t-0 border-border" : ""}`}>
      <div className="mono-label text-signal">{number}</div>
      <div className="mt-2 serif text-[20px] text-paper">{title}</div>
      <p className="mt-2 text-[12.5px] text-paper-dim leading-relaxed">{description}</p>
    </div>
  );
}

function Feature({
  title,
  detail,
  border,
}: {
  title: string;
  detail: string;
  border?: boolean;
}) {
  return (
    <div className={`p-5 ${border ? "sm:border-l border-t sm:border-t-0 border-border" : ""}`}>
      <div className="text-[13px] text-paper font-medium">{title}</div>
      <div className="mt-1 text-[11.5px] text-paper-dim">{detail}</div>
    </div>
  );
}

function SecurityItem({
  title,
  detail,
  border,
  borderTop,
}: {
  title: string;
  detail: string;
  border?: boolean;
  borderTop?: boolean;
}) {
  return (
    <div
      className={[
        "p-6",
        border ? "sm:border-l border-border" : "",
        borderTop ? "border-t border-border" : "",
      ].join(" ")}
    >
      <div className="text-[13px] text-paper font-medium">{title}</div>
      <p className="mt-2 text-[12px] text-paper-dim leading-relaxed">{detail}</p>
    </div>
  );
}
