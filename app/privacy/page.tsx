import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What opensrcer stores, where it goes, and how long it is kept.",
};

// Plain statement of the data the app handles. Keep it in step with the code:
// lib/key-cookie.ts (key cookie), lib/auth0.ts (GitHub scopes), lib/cloud-runs.ts
// (run retention), lib/shared-fix-data.ts (shared fix expiry), and
// app/api/auth/revoke-all/route.ts (what revoking clears).
const SECTIONS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Signing in",
    body: (
      <>
        You sign in with GitHub through Auth0. opensrcer asks GitHub for access to public repositories (to fork them
        and open draft pull requests), your profile and email (to identify your account and attribute commits), and
        organization membership (to check administrator access when you connect an organization). Your GitHub token
        stays inside the encrypted sign-in session; it is not written to opensrcer&apos;s storage.
      </>
    ),
  },
  {
    title: "Your AI provider keys",
    body: (
      <>
        Anthropic and Gemini keys you add in Settings are kept only in an encrypted, HTTP-only cookie in your browser,
        bound to your account. The cookie expires after 30 days and is deleted when you sign out. A key is sent only
        to the provider it belongs to, and to the isolated worker that runs a job you start.
      </>
    ),
  },
  {
    title: "Runs, logs and code graphs",
    body: (
      <>
        When you start a run, the issue and the relevant repository source are sent to the AI provider you configured,
        using your key. Run records, logs and code graphs are stored privately and scoped to your account; logs can
        contain repository content but never credential values. Your newest 100 runs and 20 code graphs are kept
        and older ones are removed automatically. Each job runs in a disposable virtual machine that is stopped when the job ends.
      </>
    ),
  },
  {
    title: "Pull requests and shared fixes",
    body: (
      <>
        Draft pull requests are created on GitHub under your account, and only by runs you start in live mode; preview runs never open one. A shared fix
        link is unlisted and anyone with the link can view it; it stops working 30 days after it is created.
      </>
    ),
  },
  {
    title: "Services we rely on",
    body: (
      <>
        Vercel (hosting, private storage and isolated workers), Auth0 (sign-in), GitHub (repositories and pull
        requests), and Anthropic or Google Gemini when you use them with your own key. opensrcer has no advertising
        and no analytics or tracking scripts.
      </>
    ),
  },
  {
    title: "Revoking access and deleting data",
    body: (
      <>
        Settings → “Disconnect all &amp; sign out” stops your active runs, disconnects your organizations, clears your saved keys and
        signs you out. It does not delete past run history or code graphs. You can also revoke opensrcer&apos;s GitHub
        access at any time from GitHub&apos;s application settings. To have your stored runs and graphs deleted,
        contact the maintainer through the{" "}
        <a className="text-signal hover:underline" href="https://github.com/rahulp7801/opensrced" target="_blank" rel="noreferrer">
          opensrcer repository
        </a>
        .
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-[860px] px-5 py-10 sm:px-8">
      <PageHeading title="Privacy" description="What opensrcer stores, where it goes, and how long it is kept. Last updated October 7, 2026." />
      <div className="space-y-10">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="text-[21px] font-semibold tracking-[-0.015em] text-paper">{section.title}</h2>
            <p className="mt-3 text-[16px] leading-[1.65] text-paper-dim">{section.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
