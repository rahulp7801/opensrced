import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { isAdmin } from "@/lib/access-server";
import { authDisabled } from "@/lib/require-session";
import { PageHeading } from "@/components/page-heading";
import { AdminAccess } from "@/components/admin-access";

export const metadata: Metadata = { title: "Access requests", robots: { index: false } };
export const dynamic = "force-dynamic";

// Early-access requests from /join, for the admins in OPENSRCER_ADMIN_GITHUB_IDS. Anyone
// else gets the ordinary not-found page, so the page doesn't advertise itself.
export default async function AdminAccessPage() {
  if (!authDisabled()) {
    const session = await auth0.getSession().catch(() => null);
    if (!isAdmin(session?.user?.sub)) notFound();
  }
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8">
      <PageHeading
        path="admin / access"
        title={<>Access requests</>}
        description="People who asked for early access at /join. Approving lets that GitHub account sign in, within about a minute."
      />
      <AdminAccess />
    </div>
  );
}
