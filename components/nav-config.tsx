// The site's information architecture, in one place.
//
// The nav used to be ten flat destinations whose labels did not match their
// routes — /discover read "Browse", /graph read "Map", /crucible read
// "Settings", /trigger read "Fix", /dispatches read "History". Three of them
// were all "find something to work on" and three more were all "what
// happened", so the header shipped a help panel whose only job was
// explaining what the nav items meant. Below `xl` the labels were hidden
// entirely, leaving ten near-identical icons.
//
// Now: four sections named for the task you came to do, each grouping the
// pages that belong to that task. Nothing moved — every route is exactly
// where it was, so existing links and bookmarks still resolve. What changed
// is how they are presented: top-level nav picks the task, a sub-tab bar
// picks the page within it (components/section-nav.tsx).
//
// Settings is deliberately absent. It lives behind the account chip, which
// already linked to /crucible — a per-account concern does not belong in a
// task-shaped nav.

import {
  IconPrs,
  IconPulse,
  IconSearch,
  IconTrigger,
  type IconProps,
} from "./icons";

export type NavLink = {
  href: string;
  label: string;
  /** Shown as the tooltip and in the help panel. Say what the page does. */
  title: string;
};

export type NavSection = {
  label: string;
  Icon: (p: IconProps) => React.ReactElement;
  title: string;
  links: NavLink[];
};

export const SECTIONS: NavSection[] = [
  {
    label: "Find",
    Icon: IconSearch,
    title: "Find something worth fixing",
    links: [
      {
        href: "/discover",
        label: "Browse repos",
        title: "Search public GitHub repos by stars and language",
      },
      {
        href: "/issues",
        label: "Issues",
        title: "Suggested good-first-issues, plus a scanner for any repo",
      },
      {
        href: "/repos",
        label: "Your repos",
        title: "Repos you own, starred, or have contributed to",
      },
    ],
  },
  {
    label: "Fix",
    Icon: IconTrigger,
    title: "Run the agent on an issue",
    links: [
      {
        href: "/trigger",
        label: "New run",
        title: "Point the agent at an issue and let it open a draft PR",
      },
      {
        href: "/dispatches",
        label: "Runs",
        title: "Live output and history for every run you have started",
      },
    ],
  },
  {
    label: "Ship",
    Icon: IconPrs,
    title: "Land the work",
    links: [
      {
        href: "/prs",
        label: "Pull requests",
        title: "Your open PRs — review comments, push fixes, reply",
      },
      {
        href: "/stats",
        label: "Impact",
        title: "Contribution activity, streaks, and merged-PR impact",
      },
    ],
  },
  {
    label: "Explore",
    Icon: IconPulse,
    title: "Understand a codebase",
    links: [
      {
        href: "/graph",
        label: "Codebase map",
        title: "Build a knowledge graph of any repo and ask questions about it",
      },
    ],
  },
];

/** Does `pathname` sit under `href`? Nested routes count — /prs/o/r/12 is
 *  still the PRs page as far as the nav is concerned. */
export function isLinkActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/** The section a path belongs to, or null for pages outside the IA
 *  (landing, login, settings, the public /fix/<id> viewer). */
export function sectionFor(pathname: string): NavSection | null {
  return (
    SECTIONS.find((s) => s.links.some((l) => isLinkActive(pathname, l.href))) ??
    null
  );
}
