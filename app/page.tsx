import { Landing } from "@/components/landing";

export default function LandingPage() {
  const localMode = process.env.AUTH_DISABLED === "1" && process.env.NODE_ENV !== "production";
  const primary = localMode
    ? { href: "/discover", label: "Browse repositories" }
    : { href: "/demo", label: "See a complete run" };
  const secondary = localMode
    ? { href: "/demo", label: "Explore the demo" }
    : { href: "/login", label: "Connect GitHub" };

  return <Landing primary={primary} secondary={secondary} />;
}
