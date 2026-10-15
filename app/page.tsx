import { Landing } from "@/components/landing";
import { PreviewLanding } from "@/components/preview-landing";
import { inviteOnly } from "@/lib/access";

export default function LandingPage() {
  // Private preview: the public gets a short teaser; the full page returns
  // when OPENSRCER_ACCESS is unset (lib/access.ts).
  if (inviteOnly()) return <PreviewLanding />;
  const localMode = process.env.AUTH_DISABLED === "1" && process.env.NODE_ENV !== "production";
  const primary = localMode
    ? { href: "/discover", label: "Browse repositories" }
    : { href: "/demo", label: "See a complete run" };
  const secondary = localMode
    ? { href: "/demo", label: "Explore the demo" }
    : { href: "/login", label: "Connect GitHub" };

  return <Landing primary={primary} secondary={secondary} />;
}
