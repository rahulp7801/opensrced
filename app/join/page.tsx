import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { JoinForm } from "@/components/join-form";

export const metadata: Metadata = {
  title: "Get early access",
  description: "opensrcer is in private preview. Leave your name, email and GitHub username to get access.",
};

// The early-access form (app/api/interest): public, for people without an invite.
export default function JoinPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8">
      <PageHeading
        path="opensrcer / early access"
        title={<>Get early access</>}
        description="opensrcer is in private preview. Leave your details and you'll get access with your GitHub account."
      />
      <JoinForm />
    </div>
  );
}
