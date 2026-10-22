import { Suspense } from "react";
import Link from "next/link";
import { InviteNotice } from "./invite-notice";

/** The public page during the invite-only preview (lib/access.ts): the line,
 *  one sentence, and a way in for invited accounts. The full landing page
 *  (components/landing.tsx) comes back when OPENSRCER_ACCESS is unset. */
export function PreviewLanding() {
  return (
    <section className="flex flex-1 flex-col items-center justify-center px-5 py-24 text-center sm:py-32">
      <p className="animate-fade-rise text-[19px] font-semibold tracking-[-0.01em] text-paper sm:text-[21px]">opensrcer</p>
      <h1 className="animate-fade-rise display mx-auto mt-3 max-w-[900px] text-[48px] leading-[1.04] text-paper sm:text-[80px]" style={{ animationDelay: "80ms" }}>
        Issues in. <span className="sm:block">Pull requests out.</span>
      </h1>
      <p className="animate-fade-rise mx-auto mt-6 max-w-[560px] text-balance text-[19px] leading-[1.45] text-paper-muted sm:text-[21px]" style={{ animationDelay: "160ms" }}>
        An agent that turns open issues into pull requests you review line by line.
      </p>
      <p className="animate-fade-rise mt-10 inline-flex items-center gap-2 rounded-full bg-surface-3 px-4 py-1.5 text-[14px] font-medium text-paper" style={{ animationDelay: "240ms" }}>
        <span aria-hidden className="size-1.5 rounded-full bg-signal" />
        Coming soon · Private preview
      </p>
      <Suspense fallback={null}>
        <InviteNotice />
      </Suspense>
      <div className="animate-fade-rise mt-9 flex flex-wrap items-center justify-center gap-x-8 gap-y-4" style={{ animationDelay: "320ms" }}>
        <Link href="/demo" className="btn-primary min-h-11 px-6 text-[17px] transition-[background-color,transform] duration-150 active:scale-[0.97]">
          Watch the product tour
        </Link>
        <Link href="/login" className="text-[17px] text-signal hover:underline">
          Have an invite? Sign in
        </Link>
      </div>
    </section>
  );
}
