import { Welcome } from "@/components/welcome";
import { safeReturnTo } from "@/lib/safe-return-to";

export const metadata = { title: "Welcome" };

/** First-run onboarding. A first sign-in is sent here once by
 *  /welcome/start; /account links here to redo it. The saved answers come
 *  from /api/me in the browser (no database work in this render). */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const returnTo = safeReturnTo((await searchParams).returnTo);
  // The last step lands on recommended issues; skipping returns to where they were.
  return <Welcome skipTo={returnTo === "/" ? "/issues" : returnTo} />;
}
