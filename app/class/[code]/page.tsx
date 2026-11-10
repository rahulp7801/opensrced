import type { Metadata } from "next";
import Link from "next/link";
import { auth0 } from "@/lib/auth0";
import { canUse } from "@/lib/access-server";
import { closedReason, findClassInvite } from "@/lib/classes";
import { getDb } from "@/lib/db/client";
import { PageHeading } from "@/components/page-heading";
import { GitHubSignIn } from "@/components/github-sign-in";
import { ClassJoin } from "@/components/class-join";

export const metadata: Metadata = { title: "Join a class", robots: { index: false } };
export const dynamic = "force-dynamic";

// A class invite link (lib/classes.ts), public in the preview gate: whoever
// has the link sees the class, signs in with GitHub, and joins with one press.
export default async function ClassPage({ params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toLowerCase();
  const invite = await findClassInvite(await getDb(), code).catch(() => null);
  const session = await auth0.getSession().catch(() => null);
  const sub = session?.user?.sub;
  const admitted = sub ? await canUse(sub) : false;

  if (!invite) {
    return (
      <Shell title="Class link not found" description="That class link isn't valid. Check it with your instructor: it ends in a 10-letter code." />
    );
  }
  const reason = closedReason(invite);
  return (
    <Shell title={invite.name} description="Your instructor is using opensrcer to teach open-source contribution. Join with your GitHub account.">
      {!sub ? (
        <div className="space-y-3">
          <p className="text-paper-dim">Step 1 of 3: sign in with GitHub. You come straight back here.</p>
          <GitHubSignIn returnTo={`/class/${code}`}>Sign in with GitHub</GitHubSignIn>
        </div>
      ) : admitted ? (
        <NextSteps name={invite.name} />
      ) : reason ? (
        <div role="alert" className="callout" data-tone="warn"><p className="text-paper">{reason}</p></div>
      ) : (
        <ClassJoin code={code} name={invite.name} />
      )}
    </Shell>
  );
}

function Shell({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[860px] px-5 py-10 sm:px-8">
      <PageHeading path="opensrcer / class" title={<>{title}</>} description={description} />
      <div className="mt-6">{children}</div>
    </div>
  );
}

/** What a student does once admitted: one token, one install. */
function NextSteps({ name }: { name: string }) {
  return (
    <div className="space-y-5">
      <div role="status" className="callout" data-tone="ok"><p className="font-semibold text-paper">You&apos;re in {name}.</p></div>
      <ol className="list-decimal space-y-4 pl-5 text-paper-dim">
        <li>
          <Link href="/account#harness-heading" className="link">Create your token</Link> on your Account page (Harness). Copy it: it&apos;s shown once.
        </li>
        <li>
          Install the plugin and paste the token when it asks. In Claude Code:
          {/* Scrolls sideways on phones, so it takes keyboard focus. */}
          <pre tabIndex={0} role="region" aria-label="Claude Code install commands" className="card mt-2 overflow-x-auto px-4 py-3 font-mono text-[13px] text-paper">{"/plugin marketplace add rahulp7801/opensrced\n/plugin install opensrcer@opensrced"}</pre>
          <span className="mt-2 block text-[14px]">Using VS Code with Copilot? Your Account page has the steps.</span>
        </li>
        <li>Ask your agent to teach you an issue, for example: <q>Teach me issue 429 in pallets/itsdangerous.</q></li>
      </ol>
    </div>
  );
}
