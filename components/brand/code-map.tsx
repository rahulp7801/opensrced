import { o } from "./doodle-data";

// A small code map, placed by hand: eight files/functions, hairline edges
// between them, and one cobalt path that draws through the graph and ends in
// the wordmark's ring-"o", the function you're about to change.
const CENTER = { x: 318, y: 226 };
const NODES = [
  { x: 64, y: 92 }, // 0: where the cobalt path starts
  { x: 182, y: 58 },
  { x: 166, y: 190 }, // 2: on the cobalt path
  { x: 84, y: 300 },
  { x: 196, y: 362 },
  { x: 432, y: 96 },
  { x: 446, y: 352 },
  { x: 282, y: 104 },
] as const;
const EDGES = [[0, 1], [1, 7], [2, 3], [3, 4], [2, 7], [5, 7], [4, 6]] as const;
// Nodes wired straight to the centre (besides the cobalt path's last leg).
const TO_CENTER = [4, 5, 6, 7] as const;
const PATH = `M${NODES[0].x} ${NODES[0].y}C110 112 138 168 ${NODES[2].x} ${NODES[2].y}S262 236 ${CENTER.x - 26} ${CENTER.y}`;

const curve = (a: { x: number; y: number }, b: { x: number; y: number }, bend = 0.12) => {
  const mx = (a.x + b.x) / 2 - (b.y - a.y) * bend;
  const my = (a.y + b.y) / 2 + (b.x - a.x) * bend;
  return `M${a.x} ${a.y}Q${mx.toFixed(1)} ${my.toFixed(1)} ${b.x} ${b.y}`;
};

/**
 * The brand's signature motif: a quiet code map (brand.css .map-*).
 * Hairlines and nodes settle in, then one cobalt path draws on and lands in
 * the ring-"o". Decorative and illustrative: always caption it in HTML with a
 * true statement (the SVG is aria-hidden). `label` names the centre node.
 * Reduced motion: drawn, still.
 */
export function CodeMap({ label, delay = 250, className }: { label: string; delay?: number; className?: string }) {
  const at = (ms: number) => ({ "--d": `${delay + ms}ms` }) as React.CSSProperties;
  return (
    <svg viewBox="0 0 520 420" aria-hidden focusable="false" className={className}>
      <g fill="none" stroke="var(--color-border-strong)" strokeWidth="1" strokeLinecap="round">
        {EDGES.map(([a, b], i) => (
          <path key={`e${i}`} className="map-line" d={curve(NODES[a], NODES[b])} style={at(i * 50)} />
        ))}
        {TO_CENTER.map((n, i) => (
          <path key={`c${i}`} className="map-line" d={curve(NODES[n], CENTER, -0.1)} style={at(200 + i * 50)} />
        ))}
      </g>
      {NODES.map((n, i) => (
        <circle
          key={i}
          className="map-node"
          cx={n.x}
          cy={n.y}
          r={i === 0 || i === 2 ? 6 : 5}
          fill={i === 0 || i === 2 ? "var(--color-signal)" : "var(--color-surface)"}
          stroke={i === 0 || i === 2 ? "var(--color-signal)" : "var(--color-paper-muted)"}
          strokeWidth="1.2"
          style={at(100 + i * 45)}
        />
      ))}
      {/* The one path that matters. */}
      <path className="map-path" d={PATH} pathLength={1} fill="none" stroke="var(--color-signal)" strokeWidth="2.25" strokeLinecap="round" style={at(650)} />
      <g className="map-node" style={at(1350)}>
        <g transform={`translate(${CENTER.x - 27} ${CENTER.y - 28}) scale(0.9)`} fill="none" stroke="var(--color-signal)" strokeLinecap="round">
          <circle cx="30" cy="31" r="17" fill="var(--color-ink)" stroke="none" />
          {o.strokes[0].segs.map((seg) => (
            <path key={seg.w} d={seg.d} strokeWidth={seg.w * 0.55} />
          ))}
        </g>
        <text x={CENTER.x + 34} y={CENTER.y + 5} className="font-mono" fontSize="14" fill="var(--color-paper)">
          {label}
        </text>
      </g>
    </svg>
  );
}
