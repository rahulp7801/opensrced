"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  IconOverview,
  IconPrs,
  IconRepos,
  IconRuns,
  IconTrigger,
  IconPulse,
  IconSearch,
  IconShield,
} from "./icons";

const ITEMS = [
  { href: "/", label: "Home", Icon: IconOverview },
  { href: "/discover", label: "Browse", Icon: IconSearch, title: "Browse public GitHub repos by stars and language" },
  { href: "/graph", label: "Map", Icon: IconPulse, title: "Visualize and query any codebase as a knowledge graph" },
  { href: "/issues", label: "Issues", Icon: IconTrigger, title: "Browse open issues across repos to pick one to solve" },
  { href: "/prs", label: "PRs", Icon: IconPrs, title: "Pull requests opened by opensrcer" },
  { href: "/repos", label: "Repos", Icon: IconRepos, title: "Your indexed GitHub repos" },
  { href: "/trigger", label: "Fix", Icon: IconPulse, title: "Trigger a run to fix a specific GitHub issue" },
  { href: "/dispatches", label: "History", Icon: IconRuns, title: "Active and past fix runs" },
  { href: "/stats", label: "Stats", Icon: IconRuns, title: "Your contribution activity, streaks, and impact" },
  { href: "/crucible", label: "Settings", Icon: IconShield, title: "API keys, GitHub App, org settings" },
];

export function Nav() {
  const path = usePathname();

  return (
    <nav className="flex items-stretch flex-1 min-w-0">
      {ITEMS.map(({ href, label, Icon, title }) => {
        const active = path === href || (href !== "/" && path.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            title={title ?? label}
            className={cn(
              "group relative flex items-center justify-center gap-1.5 border-r border-border px-3 transition-colors min-w-0",
              "hover:bg-surface-2/60",
              active ? "bg-surface-2/80" : "bg-transparent",
            )}
          >
            <Icon className={cn("shrink-0", active ? "text-signal" : "text-paper-muted group-hover:text-paper")} />
            <span
              className={cn(
                "text-[12px] tracking-tight hidden xl:inline truncate",
                active ? "text-paper" : "text-paper-dim group-hover:text-paper",
              )}
            >
              {label}
            </span>
            {active && (
              <span className="absolute inset-x-0 -bottom-px h-px bg-signal signal-glow" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
