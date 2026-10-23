"use client";

// The demo repository as the code graph draws it: its real modules, symbols and
// test cases (rahulp7801/opensrcer-demo), laid out by hand in a 600x400 viewBox
// around the index.ts hub, one colour per community. Like every tour view it is
// a pure function of local time: it builds itself from `buildAt`, and `lights`
// pick out a node and its connections (what clicking a node does in the real
// graph view), with flowing edges, a pulsing focus node and a badge.

import { useId } from "react";
import { progress, useT } from "./kit";

type GraphKind = "module" | "function" | "type" | "test";
type GraphGroup = "core" | "truncate" | "slugify" | "duration" | "csv" | "tests";
type GraphNode = { id: string; label: string; kind: GraphKind; group: GraphGroup; x: number; y: number; side: "below" | "left" | "right" | "above" | "none" };

const GROUP_COLOR: Record<GraphGroup, string> = {
  core: "#1d1d1f", truncate: "#0056ad", slugify: "#156534", duration: "#b45309", csv: "#6d28d9", tests: "#6e6e73",
};

const G_NODES: GraphNode[] = [
  { id: "index", label: "src/index.ts", kind: "module", group: "core", x: 300, y: 190, side: "below" },
  { id: "truncate.ts", label: "src/truncate.ts", kind: "module", group: "truncate", x: 432, y: 118, side: "above" },
  { id: "truncate", label: "truncate()", kind: "function", group: "truncate", x: 512, y: 182, side: "right" },
  { id: "TruncateOptions", label: "TruncateOptions", kind: "type", group: "truncate", x: 540, y: 66, side: "left" },
  { id: "slugify.ts", label: "src/slugify.ts", kind: "module", group: "slugify", x: 160, y: 270, side: "below" },
  { id: "slugify", label: "slugify()", kind: "function", group: "slugify", x: 70, y: 318, side: "above" },
  { id: "duration.ts", label: "src/duration.ts", kind: "module", group: "duration", x: 440, y: 268, side: "below" },
  { id: "parseDuration", label: "parseDuration()", kind: "function", group: "duration", x: 540, y: 300, side: "below" },
  { id: "UNIT_MS", label: "UNIT_MS", kind: "type", group: "duration", x: 548, y: 232, side: "below" },
  { id: "csv.ts", label: "src/csv.ts", kind: "module", group: "csv", x: 168, y: 112, side: "above" },
  { id: "splitCsvLine", label: "splitCsvLine()", kind: "function", group: "csv", x: 66, y: 70, side: "below" },
  { id: "test", label: "test/text.test.ts", kind: "module", group: "tests", x: 300, y: 318, side: "left" },
  { id: "t-slugify", label: "test: slugify", kind: "test", group: "tests", x: 232, y: 372, side: "none" },
  { id: "t-truncate", label: "test: truncate", kind: "test", group: "tests", x: 282, y: 384, side: "none" },
  { id: "t-duration", label: "test: parseDuration", kind: "test", group: "tests", x: 334, y: 384, side: "none" },
  { id: "t-csv", label: "test: splitCsvLine", kind: "test", group: "tests", x: 384, y: 372, side: "none" },
];

// from → to; "calls" edges are drawn dashed.
const G_EDGES: Array<{ from: string; to: string; kind: "contains" | "uses" | "imports" | "calls" }> = [
  { from: "index", to: "truncate.ts", kind: "imports" }, { from: "index", to: "slugify.ts", kind: "imports" },
  { from: "index", to: "duration.ts", kind: "imports" }, { from: "index", to: "csv.ts", kind: "imports" },
  { from: "truncate.ts", to: "truncate", kind: "contains" }, { from: "truncate.ts", to: "TruncateOptions", kind: "contains" },
  { from: "truncate", to: "TruncateOptions", kind: "uses" },
  { from: "slugify.ts", to: "slugify", kind: "contains" },
  { from: "duration.ts", to: "parseDuration", kind: "contains" }, { from: "duration.ts", to: "UNIT_MS", kind: "contains" },
  { from: "parseDuration", to: "UNIT_MS", kind: "uses" },
  { from: "csv.ts", to: "splitCsvLine", kind: "contains" },
  { from: "test", to: "index", kind: "imports" },
  { from: "test", to: "t-slugify", kind: "contains" }, { from: "test", to: "t-truncate", kind: "contains" },
  { from: "test", to: "t-duration", kind: "contains" }, { from: "test", to: "t-csv", kind: "contains" },
  { from: "t-slugify", to: "slugify", kind: "calls" }, { from: "t-truncate", to: "truncate", kind: "calls" },
  { from: "t-duration", to: "parseDuration", kind: "calls" }, { from: "t-csv", to: "splitCsvLine", kind: "calls" },
];
const COMMUNITIES = new Set(G_NODES.map((n) => n.group)).size - 1; // the hub is not a community

/** What stands out, and its badge. Edges as "from>to". */
export type GraphLight = { focus: readonly string[]; nodes: readonly string[]; edges: readonly string[]; badge: string };

export const LIGHTS = {
  // What clicking a node does in the real graph view: it and its connections stand out.
  select: { focus: ["truncate"], nodes: ["truncate", "truncate.ts", "TruncateOptions", "t-truncate"], edges: ["truncate.ts>truncate", "truncate>TruncateOptions", "t-truncate>truncate"], badge: "truncate() · 3 connections" },
} satisfies Record<string, GraphLight>;

// Nodes pop in outward from the hub; rank is the order, from the build's start.
const HUB = G_NODES[0];
const RANK = new Map([...G_NODES].sort((a, b) => Math.hypot(a.x - HUB.x, a.y - HUB.y) - Math.hypot(b.x - HUB.x, b.y - HUB.y)).map((n, rank) => [n.id, rank]));

/** An overshooting ease, for nodes popping into place. */
function easeOutBack(p: number): number {
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
}

/** The code graph. `buildAt`: when it starts building (omit: already built).
 *  `lights`: what to light up from when, in time order. */
export function CodeGraph({ buildAt, lights = [] }: { buildAt?: number; lights?: ReadonlyArray<{ at: number; light: GraphLight }> }) {
  const t = useT();
  const id = useId().replace(/:/g, "");
  const built = buildAt ?? -Infinity;
  const appear = (node: string) => built + (RANK.get(node) ?? 0) * 110;
  const shown = lights.reduce((last, l, i) => (t >= l.at ? i : last), -1);
  const lightAt = shown >= 0 ? lights[shown].at : null;
  const light = shown >= 0 ? lights[shown].light : null;
  const litNodes = new Set<string>(light?.nodes ?? []);
  const litEdges = new Set<string>(light?.edges ?? []);
  // A slow drift keeps the graph alive; edges follow the drifting nodes.
  const pos = new Map(G_NODES.map((n, i) => [n.id, { x: n.x + Math.sin(t / 1700 + i * 1.3) * 1.6, y: n.y + Math.cos(t / 1900 + i * 0.9) * 1.6 }]));
  const flow = -(t / 28) % 18;
  const chrome = buildAt === undefined ? 1 : progress(t, built + 1500, built + 2100);

  return (
    <svg viewBox="0 0 600 400" className="h-full w-full" role="img" aria-label="Code graph of the demo repository: modules, symbols and tests, grouped by community">
      <defs>
        <pattern id={`${id}-dots`} width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.9" fill="#d2d2d7" /></pattern>
        <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" /></filter>
        <marker id={`${id}-arrow`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="#a1a1a6" /></marker>
        <marker id={`${id}-arrow-lit`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="#0056ad" /></marker>
      </defs>
      <rect width="600" height="400" fill={`url(#${id}-dots)`} opacity={buildAt === undefined ? 1 : progress(t, built - 100, built + 500)} />

      {G_EDGES.map((e) => {
        const a = pos.get(e.from)!;
        const b = pos.get(e.to)!;
        const key = `${e.from}>${e.to}`;
        const lit = litEdges.has(key);
        // A gentle curve, bending to one side of the straight line.
        const mx = (a.x + b.x) / 2 - (b.y - a.y) * 0.12;
        const my = (a.y + b.y) / 2 + (b.x - a.x) * 0.12;
        const from = Math.max(appear(e.from), appear(e.to));
        const drawn = buildAt === undefined ? 1 : progress(t, from + 150, from + 700);
        if (drawn === 0) return null;
        const d = `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`;
        return (
          <g key={key} opacity={light && !lit ? 0.18 : 1}>
            {lit && <path d={d} fill="none" stroke="#0056ad" strokeWidth="7" opacity="0.18" filter={`url(#${id}-glow)`} />}
            <path
              d={d} fill="none" pathLength={1}
              stroke={lit ? "#0056ad" : "#c7c7cc"} strokeWidth={lit ? 2.2 : e.kind === "calls" ? 1 : 1.3}
              strokeDasharray={drawn < 1 ? "1 1" : e.kind === "calls" && !lit ? "0.012 0.012" : undefined}
              strokeDashoffset={drawn < 1 ? 1 - drawn : undefined}
              markerEnd={drawn >= 1 && e.kind !== "contains" ? `url(#${id}-${lit ? "arrow-lit" : "arrow"})` : undefined}
            />
            {lit && drawn >= 1 && <path d={d} fill="none" stroke="#ffffff" strokeWidth="2.2" strokeDasharray="3 15" strokeDashoffset={flow} strokeLinecap="round" opacity="0.9" />}
          </g>
        );
      })}

      {G_NODES.map((n) => {
        const p = pos.get(n.id)!;
        const grow = buildAt === undefined ? 1 : easeOutBack(progress(t, appear(n.id), appear(n.id) + 450));
        if (grow <= 0) return null;
        const color = GROUP_COLOR[n.group];
        const lit = litNodes.has(n.id);
        const focus = light?.focus.includes(n.id) ?? false;
        const size = n.kind === "module" ? (n.id === "index" ? 15 : 11) : n.kind === "function" ? 9 : n.kind === "type" ? 8 : 4.5;
        const labelY = n.side === "below" ? size + 13 : n.side === "above" ? -size - 7 : 4;
        const labelX = n.side === "left" ? -size - 6 : n.side === "right" ? size + 6 : 0;
        const anchor = n.side === "left" ? "end" : n.side === "right" ? "start" : "middle";
        return (
          <g key={n.id} transform={`translate(${p.x} ${p.y})`} opacity={light && !lit ? 0.28 : 1}>
            <g transform={`scale(${grow})`}>
              {focus && [0, 1].map((k) => {
                const ring = ((t + k * 800) % 1600) / 1600;
                return <circle key={k} r={size + 4 + ring * 18} fill="none" stroke={color} strokeWidth="1.5" opacity={(1 - ring) * 0.55} />;
              })}
              {lit && <circle r={size + 7} fill={color} opacity="0.16" filter={`url(#${id}-glow)`} />}
              {n.kind === "module" && <rect x={-size} y={-size} width={size * 2} height={size * 2} rx={size * 0.38} fill={lit ? color : "#ffffff"} stroke={color} strokeWidth={n.id === "index" ? 2.4 : 1.8} />}
              {n.kind === "module" && <rect x={-size * 0.45} y={-size * 0.45} width={size * 0.9} height={size * 0.9} rx={size * 0.2} fill={lit ? "#ffffff" : color} opacity={lit ? 0.9 : 0.85} />}
              {n.kind === "function" && <circle r={size} fill={color} stroke="#ffffff" strokeWidth="2" />}
              {n.kind === "type" && <rect x={-size * 0.75} y={-size * 0.75} width={size * 1.5} height={size * 1.5} transform="rotate(45)" fill={lit ? color : "#ffffff"} stroke={color} strokeWidth="1.8" />}
              {n.kind === "test" && <circle r={size} fill={lit ? color : "#ffffff"} stroke={color} strokeWidth="1.5" />}
            </g>
            {n.side !== "none" && (
              <text x={labelX} y={labelY} textAnchor={anchor} fontSize={n.kind === "module" ? 10 : 10.5} fontWeight={n.kind === "function" || lit ? 600 : 400} fill={lit ? "#1d1d1f" : "#424245"} fontFamily="var(--font-mono)" opacity={buildAt === undefined ? 1 : progress(t, appear(n.id) + 200, appear(n.id) + 500)}>
                {n.label}
              </text>
            )}
          </g>
        );
      })}

      {/* What the current answer is about, in the corner, clear of the nodes it describes. */}
      {light && lightAt !== null && (
        <g transform="translate(10 8)" opacity={progress(t, lightAt, lightAt + 400)}>
          <rect width="150" height="22" rx="11" fill="#1d1d1f" />
          <text x="75" y="15" textAnchor="middle" fontSize="10.5" fill="#ffffff" fontWeight="600" fontFamily="var(--font-sans)">{light.badge}</text>
        </g>
      )}

      <>
          <g transform="translate(10 386)" opacity={chrome} fontFamily="var(--font-sans)" fontSize="10" fill="#636366">
            <rect x="0" y="-7" width="8" height="8" rx="2" fill="#ffffff" stroke="#636366" strokeWidth="1.3" /><text x="12" y="0">module</text>
            <circle cx="62" cy="-3" r="4" fill="#636366" /><text x="70" y="0">function</text>
            <rect x="118" y="-7" width="7" height="7" transform="rotate(45 121.5 -3.5)" fill="#ffffff" stroke="#636366" strokeWidth="1.3" /><text x="130" y="0">type</text>
            <circle cx="160" cy="-3" r="3" fill="#ffffff" stroke="#636366" strokeWidth="1.3" /><text x="167" y="0">test</text>
          </g>
          <text x="590" y="18" textAnchor="end" fontSize="10.5" fill="#636366" fontFamily="var(--font-sans)" opacity={chrome}>
            {G_NODES.length} nodes · {G_EDGES.length} edges · {COMMUNITIES} communities
          </text>
      </>
    </svg>
  );
}
