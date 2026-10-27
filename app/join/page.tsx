import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import Link from "next/link";
import { JoinForm } from "@/components/join-form";

export const metadata: Metadata = {
  title: "Get early access",
  description: "opensrcer is in private preview. Leave your name, email and GitHub username to get access.",
};

// The early-access form (app/api/interest): public, for people without an invite.
// ?maintainer: for maintainers, to opt their repository out or try it with us.
export default async function JoinPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const maintainer = (await searchParams).maintainer !== undefined;
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8">
      <PageHeading
        path={maintainer ? "opensrcer / maintainers" : "opensrcer / early access"}
        title={maintainer ? <>Maintainers: opt out, or try it with us</> : <>Get early access</>}
        description={maintainer
          ? "Keep opensrcer off your repository, or try it on your project with us. Tell us which repository, and we'll confirm you maintain it."
          : "opensrcer is in private preview. Leave your details and you'll get access with your GitHub account."}
      />
      <JoinForm maintainer={maintainer} />
      {!maintainer && <p className="mt-8 text-[15px] text-paper-muted">Maintainer? <Link href="/join?maintainer" className="text-link">Opt your repo out, or try it with us</Link></p>}
    </div>
  );
}
