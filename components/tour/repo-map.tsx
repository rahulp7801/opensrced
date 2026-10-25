"use client";

// The stage's map of a large, real repository: pallets/flask's code graph, built by the site's
// own graph builder (graphify) and exported as a snapshot (public/demo/flask-graph.json; see
// RepoSnapshot). The layout was computed for the presentation from that real graph (the
// snapshot's `layout` says how); graphify's own view lays it out live in the browser.
// A canvas draws the dense overview (thousands of nodes coloured by community, faint edges) and
// then the stage's drawing of a real Explore answer on it: a semantic zoom from the whole
// repository through the answer's community to its function, then back out as what depends on
// it lights up hop by hop (the snapshot's path and hops, from the graph's real relations), and a
// slow current along the path. Demo only: the Explore page does not animate answers.
// The zoom follows the stage clock, smoothed between its 50 ms ticks; the current and the
// breathing ring run on wall time, so they keep moving while the stage waits for the presenter.
// Reduced motion shows the final state, still.

import { useEffect, useRef, useState } from "react";
import { useT } from "./kit";

/** The snapshot, as exported: compact arrays so thousands of nodes stay small. */
export type RepoSnapshot = {
  repo: string;
  commit?: string;
  layout?: string;
  stats: { nodes: number; edges: number; communities: number };
  communities?: Array<{ id: number; label?: string }>;
  /** [id, label, type, source file, community, x, y]; x and y in any units (fitted here). */
  nodes: Array<[string, string, string, string, number, number, number]>;
  /** [source index, target index, relation]. */
  edges: Array<[number, number, string?]>;
  answer?: { question: string; text: string; cites: string[]; cost?: string };
  focus: {
    primary: number;
    /** Edges to light, each [dependent, dependency], in draw order outward from the primary node. */
    path: Array<[number, number]>;
    /** What depends on the primary node: [node index, hop 1–3]. */
    hops: Array<[number, number]>;
  };
  breadcrumb: string[];
};

const SNAPSHOT_URL = "/demo/flask-graph.json";
let snapshotLoad: Promise<RepoSnapshot> | null = null;
/** Starts loading the snapshot (once), so it is in hand before the Explore stop. */
export function preloadRepoSnapshot(): Promise<RepoSnapshot> {
  snapshotLoad ??= fetch(SNAPSHOT_URL).then((r) => {
    if (!r.ok) throw new Error(`repo map snapshot: HTTP ${r.status}`);
    return r.json() as Promise<RepoSnapshot>;
  });
  return snapshotLoad;
}

/** How long the focus sequence runs, from `focusAt`, before it settles. */
export const MAP_FOCUS_LENGTH = 7400;
// The beats, from `focusAt`, unhurried: hold on the whole repository, ease in to the community,
// then to the function, then out as the reach spreads wave by wave (hop 1, 2, 3), then settle.
const F = { hold: 1000, community: 2800, fn: 4000, wave: [4200, 5100, 5600, 6200], out: [4400, 6400], legend: 6600 };

// Dark, like graphify's own map, so the community colours carry.
const BG: Rgb = [14, 16, 22];
const ACCENT = "#4da3ff";
// One colour per hop of the reach, warm and fading with distance.
const HOP: Record<number, Rgb> = { 1: [255, 107, 107], 2: [255, 169, 77], 3: [255, 212, 59] };
// Community colours: distinct and bright on the dark ground.
const PALETTE = [
  "#5b8ff9", "#f6903d", "#e8684a", "#5ad8a6", "#9270ca", "#f6bd16", "#ff9d4d", "#6dc8ec", "#ff99c3", "#269a99",
  "#bdd2fd", "#e86452", "#61ddaa", "#7262fd", "#f08bb4", "#78d3f8", "#b6e3a8", "#ffd666", "#d3adf7", "#5cdbd3",
  "#ff7875", "#95de64", "#69c0ff", "#ffc069", "#b37feb", "#87e8de",
];
// The chrome's bands, in CSS px: the header row on top and the legend row below stay clear.
const TOP = 32;
const BOTTOM = 30;
const EDGE = 56; // labels this close to the pane's side are not drawn

type Rgb = [number, number, number];
type Cam = { x: number; y: number; k: number };
type Box = { x0: number; y0: number; x1: number; y1: number };

function hexRgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}
/** 70% saturation: still colourful, but secondary. */
function muted([r, g, b]: Rgb): Rgb {
  const grey = 0.3 * r + 0.59 * g + 0.11 * b;
  return [r, g, b].map((c) => grey + (c - grey) * 0.7) as Rgb;
}
function rgba([r, g, b]: Rgb, a: number): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
}
function mix(a: Rgb, b: Rgb, u: number): Rgb {
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}
function span(t: number, from: number, to: number): number {
  return Math.min(1, Math.max(0, (t - from) / (to - from)));
}
function easeInOut(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}
function quantile(v: number[], p: number): number {
  return v[Math.min(v.length - 1, Math.max(0, Math.floor(p * v.length)))];
}
/** The box holding the middle of these points (from `lo` to `hi`), so stragglers don't set the zoom. */
function boxOf(ids: number[], x: Float32Array, y: Float32Array, lo = 0, hi = 1): Box {
  const xs = ids.map((i) => x[i]).sort((a, b) => a - b), ys = ids.map((i) => y[i]).sort((a, b) => a - b);
  return { x0: quantile(xs, lo), x1: quantile(xs, hi - 1e-9), y0: quantile(ys, lo), y1: quantile(ys, hi - 1e-9) };
}

/** What the renderer needs, worked out once per snapshot. */
type Prepared = {
  snap: RepoSnapshot;
  x: Float32Array;
  y: Float32Array;
  size: Float32Array; // base radius, CSS px at the overview
  note: Uint8Array; // graphify's rationale notes: drawn small and faint, for texture
  byCommunity: Map<number, number[]>;
  colour: Map<number, { full: Rgb; muted: Rgb }>;
  hop: Map<number, number>; // the reach; the primary node is hop 0
  drawn: Array<{ from: number; to: number; hop: number; start: number; end: number }>; // path edges, oriented outward, with when each draws
  arrive: Map<number, number>; // when the light reaches each node of the reach (the function: 0)
  overview: Box;
  community: Box;
  reach: Box;
};

function prepare(snap: RepoSnapshot): Prepared {
  const n = snap.nodes.length;
  const x = new Float32Array(n), y = new Float32Array(n), size = new Float32Array(n), note = new Uint8Array(n);
  const degree = new Uint16Array(n);
  snap.nodes.forEach((v, i) => { x[i] = v[5]; y[i] = v[6]; note[i] = v[2] === "note" ? 1 : 0; });
  for (const [a, b] of snap.edges) { degree[a]++; degree[b]++; }
  for (let i = 0; i < n; i++) size[i] = note[i] ? 0.8 : Math.min(5, 1.4 + Math.sqrt(degree[i]) * 0.45);
  const byCommunity = new Map<number, number[]>();
  snap.nodes.forEach((v, i) => {
    const list = byCommunity.get(v[4]) ?? [];
    list.push(i);
    byCommunity.set(v[4], list);
  });
  // The biggest communities get the first colours.
  const order = [...byCommunity.entries()].sort((a, b) => b[1].length - a[1].length).map(([c]) => c);
  const colour = new Map(order.map((c, i) => {
    const full = hexRgb(PALETTE[i % PALETTE.length]);
    return [c, { full, muted: muted(full) }];
  }));
  const { primary, path, hops } = snap.focus;
  const hop = new Map<number, number>([[primary, 0], ...hops]);
  const reached = new Set([primary]);
  const oriented = path.map(([a, b]) => {
    const from = reached.has(a) ? a : b;
    const to = from === a ? b : a;
    reached.add(to);
    return { from, to, hop: Math.min(3, Math.max(1, hop.get(to) ?? 1)) };
  });
  const inWave = (h: number) => oriented.filter((e) => e.hop === h);
  const arrive = new Map<number, number>([[primary, 0]]);
  const drawn = oriented.map((e) => {
    const peers = inWave(e.hop), k = peers.indexOf(e);
    const [a0, a1] = [F.wave[e.hop - 1], F.wave[e.hop]];
    const start = a0 + ((a1 - a0) * 0.5 * k) / Math.max(1, peers.length - 1 || 1);
    const end = start + (a1 - a0) * 0.5;
    arrive.set(e.to, end);
    return { ...e, start, end };
  });
  const all = [...x.keys()];
  return {
    snap, x, y, size, note, byCommunity, colour, hop, drawn, arrive,
    overview: boxOf(all, x, y, 0.04, 0.96),
    community: boxOf(byCommunity.get(snap.nodes[primary][4]) ?? [primary], x, y, 0.05, 0.95),
    reach: boxOf([...hop.keys()], x, y),
  };
}

/** The camera that fits `box` into the drawable area (w by h CSS px), with `pad` px around it. */
function fit(box: Box, w: number, h: number, pad: number, maxK = Infinity): Cam {
  const bw = Math.max(box.x1 - box.x0, 1e-6), bh = Math.max(box.y1 - box.y0, 1e-6);
  const k = Math.min((w - 2 * pad) / bw, (h - TOP - BOTTOM - 2 * pad) / bh, maxK);
  return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 - (TOP - BOTTOM) / 2 / k, k };
}

/** Between two cameras: zoom on a log scale while the target glides to the centre of the screen. */
function between(a: Cam, b: Cam, u: number): Cam {
  const k = a.k * Math.pow(b.k / a.k, u);
  const sx = (1 - u) * (b.x - a.x) * a.k, sy = (1 - u) * (b.y - a.y) * a.k;
  return { k, x: b.x - sx / k, y: b.y - sy / k };
}

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => { setReduce(window.matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);
  return reduce;
}

/** The map. `buildAt`: when the overview starts revealing; `focusAt`: when the answer's drawing starts. */
export function RepoMap({ buildAt, focusAt }: { buildAt: number; focusAt: number }) {
  const t = useT();
  const reduce = useReducedMotion();
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [failed, setFailed] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const clock = useRef({ t, wall: 0 });

  useEffect(() => {
    let live = true;
    preloadRepoSnapshot().then((s) => live && setPrep(prepare(s)), () => live && setFailed(true));
    return () => { live = false; };
  }, []);

  // The stage clock ticks every 50 ms; note when each tick lands, to smooth between them.
  useEffect(() => { clock.current = { t, wall: performance.now() }; }, [t]);

  useEffect(() => {
    if (!prep) return;
    const el = canvas.current!;
    const ctx = el.getContext("2d")!;
    const mono = getComputedStyle(el).getPropertyValue("--font-mono").trim() || "ui-monospace, monospace";
    const layer = { canvas: document.createElement("canvas"), key: "" };
    let raf = 0, lastDraw = 0, still = "";
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth, h = el.clientHeight;
      if (w === 0 || h === 0) return;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr); el.height = Math.round(h * dpr);
      }
      const wall = performance.now();
      const now = clock.current.t + Math.min(50, wall - clock.current.wall);
      // Draw only what moves: nothing does before the focus (once the overview is in) or, with
      // reduced motion, after it starts, so those are drawn once; once settled, only the slow
      // current and the breathing ring move, and 20 frames a second is plenty for them.
      const f = now - focusAt;
      const quiet = (f < 0 && now >= buildAt + 1400) || (reduce && f >= 0);
      const scene = `${w}x${h}@${dpr}:${f < 0 ? "overview" : "focus"}`;
      if (quiet) {
        if (still === scene) return;
        still = scene;
      } else {
        still = "";
        if (f >= MAP_FOCUS_LENGTH && wall - lastDraw < 48) return;
      }
      lastDraw = wall;
      draw(ctx, prep, { w, h, dpr, now, wall, buildAt, focusAt, reduce, mono, layer });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [prep, buildAt, focusAt, reduce]);

  const f = reduce && t >= focusAt ? MAP_FOCUS_LENGTH : t - focusAt;
  const crumbs = prep?.snap.breadcrumb ?? [];
  const depth = f < F.hold ? 0 : f < F.community ? 1 : f < F.fn ? crumbs.length - 1 : crumbs.length;
  const crumb = depth === 0 ? prep?.snap.repo : crumbs.slice(0, Math.max(1, depth)).join(" › ");
  const chrome = Math.min(1, Math.max(0, (t - buildAt - 900) / 500));
  const stats = prep?.snap.stats;
  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: rgba(BG, 1) }}>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" role="img"
        aria-label={stats ? `Code graph of ${prep.snap.repo}: ${stats.nodes} nodes in ${stats.communities} communities${f >= 0 ? `, focused on ${crumbs.at(-1)} and what depends on it` : ""}` : "Code graph, loading"} />
      {failed && <p className="absolute inset-0 grid place-items-center text-[13px] text-white/70">The map didn&apos;t load.</p>}
      {stats && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-3 px-3 text-[11px]" style={{ height: TOP }}>
            <span key={crumb} className="stage-tick truncate font-mono text-white/85">{crumb}</span>
            <span className="shrink-0 text-white/60" style={{ opacity: chrome }}>
              {stats.nodes.toLocaleString("en-US")} nodes · {stats.edges.toLocaleString("en-US")} edges · {stats.communities} communities
            </span>
          </div>
          {f >= F.legend && (
            <div className="stage-settle pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-end gap-4 px-3 text-[11px] text-white/75" style={{ height: BOTTOM }}>
              <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-white" />{crumbs.at(-1)}</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: ACCENT }} />Path</span>
              <span className="inline-flex items-center gap-1.5">Depends on it
                {[1, 2, 3].map((k) => <span key={k} className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: rgba(HOP[k], 1) }} />{k}</span>)}
                hops
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

type Frame = { w: number; h: number; dpr: number; now: number; wall: number; buildAt: number; focusAt: number; reduce: boolean; mono: string; layer: { canvas: HTMLCanvasElement; key: string } };

function draw(ctx: CanvasRenderingContext2D, p: Prepared, fr: Frame) {
  const { w, h, dpr, reduce } = fr;
  const f = fr.now < fr.focusAt ? -1 : reduce ? MAP_FOCUS_LENGTH : fr.now - fr.focusAt;
  const { x, y } = p;
  const primary = p.snap.focus.primary;

  // The camera: the whole repository, the answer's community, its function, then out to the reach.
  const c0 = fit(p.overview, w, h, 12);
  const c1 = fit(p.community, w, h, 40, c0.k * 5);
  const c2: Cam = { x: x[primary], y: y[primary], k: c0.k * 9 };
  const c3 = fit(p.reach, w, h, 70, c0.k * 4);
  const out = easeInOut(span(f, F.out[0], F.out[1]));
  const cam = f < 0 ? c0
    : out > 0 ? between(c2, c3, out)
    : f >= F.community ? between(c1, c2, easeInOut(span(f, F.community, F.fn)))
    : between(c0, c1, easeInOut(span(f, F.hold, F.community)));
  const recede = f < 0 ? 0 : easeInOut(span(f, F.hold + 600, F.fn));
  const sx = (i: number) => (x[i] - cam.x) * cam.k + w / 2;
  const sy = (i: number) => (y[i] - cam.y) * cam.k + h / 2;
  // Nodes grow with the zoom, but slower than it, so the close-up stays a map and not blobs.
  const grow = Math.pow(cam.k / c0.k, 0.45);

  // The map itself (edges and nodes) changes only while the camera moves, the colours recede, the
  // overview reveals or a wave lands; it's drawn into a layer then and copied in between, so a
  // settled frame costs one copy plus the highlights.
  const reveal = reduce ? 1 : span(fr.now, fr.buildAt, fr.buildAt + 1400);
  // The reach is drawn on top once its wave arrives (the function, from the start).
  const lit = (i: number) => { const at = p.arrive.get(i); return f >= 0 && at !== undefined && f >= at - 150; };
  let landed = -1;
  if (f >= 0) for (const at of p.arrive.values()) if (f >= at - 150) landed++;
  const key = [w, h, dpr, cam.x, cam.y, cam.k, recede, reveal, landed].join(":");
  const layer = fr.layer;
  if (layer.key !== key) {
    layer.key = key;
    if (layer.canvas.width !== Math.round(w * dpr) || layer.canvas.height !== Math.round(h * dpr)) {
      layer.canvas.width = Math.round(w * dpr); layer.canvas.height = Math.round(h * dpr);
    }
    const b = layer.canvas.getContext("2d")!;
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    b.fillStyle = rgba(BG, 1);
    b.fillRect(0, 0, w, h);
    if (reveal > 0) {
      b.save();
      // The overview reveals outward from the middle as the graph builds.
      if (reveal < 1) {
        b.beginPath();
        b.arc(w / 2, h / 2, Math.hypot(w, h) * 0.55 * easeInOut(reveal), 0, Math.PI * 2);
        b.clip();
      }
      const onScreen = (i: number) => { const a = sx(i), c = sy(i); return a > -30 && a < w + 30 && c > -30 && c < h + 30; };
      // Edges: one faint stroke for the lot.
      b.beginPath();
      for (const [i, j] of p.snap.edges) {
        if (!onScreen(i) && !onScreen(j)) continue;
        b.moveTo(sx(i), sy(i));
        b.lineTo(sx(j), sy(j));
      }
      b.strokeStyle = `rgba(200,210,235,${0.11 - 0.04 * recede})`;
      b.lineWidth = 0.6;
      b.stroke();
      // Nodes, one fill per community (notes in a fainter second pass).
      for (const [c, ids] of p.byCommunity) {
        const col = p.colour.get(c)!;
        const tone = mix(col.full, col.muted, recede);
        for (const notes of [0, 1]) {
          b.fillStyle = rgba(tone, (notes ? 0.45 : 0.95) * (1 - 0.38 * recede));
          b.beginPath();
          for (const i of ids) {
            if (p.note[i] !== notes || lit(i) || !onScreen(i)) continue;
            const r = p.size[i] * grow;
            b.moveTo(sx(i) + r, sy(i));
            b.arc(sx(i), sy(i), r, 0, Math.PI * 2);
          }
          b.fill();
        }
      }
      b.restore();
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (reveal <= 0 || f < 0) return;

  const radius = (i: number) => p.size[i] * grow + (i === primary ? 3.5 : 1.5);
  // The path, wave by wave outward from the function: a glow under a bright core, then the current.
  ctx.lineCap = "round";
  for (const { from, to, start, end } of p.drawn) {
    const u = 1 - Math.pow(1 - span(f, start, end), 3);
    if (u <= 0) continue;
    const ax = sx(from), ay = sy(from);
    const bx = ax + (sx(to) - ax) * u, by = ay + (sy(to) - ay) * u;
    ctx.save();
    ctx.shadowColor = ACCENT; ctx.shadowBlur = 10;
    ctx.strokeStyle = rgba(hexRgb(ACCENT), 0.35); ctx.lineWidth = 4.5;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    // The current: slow (one loop every 4 s), low contrast, outward; off under reduced motion.
    if (u >= 1 && !reduce) {
      ctx.save();
      ctx.setLineDash([3, 13]); ctx.lineDashOffset = -((fr.wall % 4000) / 4000) * 16;
      ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.restore();
    }
  }

  // The reach: as the light arrives, a halo ripples out in the hop's colour and the node stays lit.
  for (const [i, hop] of p.hop) {
    if (i === primary) continue;
    const at = p.arrive.get(i) ?? F.wave[hop];
    const u = span(f, at - 150, at + 650);
    if (u <= 0) continue;
    const col = HOP[hop] ?? HOP[3];
    if (u < 1) {
      ctx.strokeStyle = rgba(col, 0.8 * (1 - u)); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx(i), sy(i), radius(i) + 2 + u * 18, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.save();
    ctx.shadowColor = rgba(col, 1); ctx.shadowBlur = 8 * Math.min(1, u * 2);
    ctx.fillStyle = rgba(col, Math.min(1, u * 2));
    ctx.beginPath(); ctx.arc(sx(i), sy(i), radius(i), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // The answer's function: bright, ringed, a pulse when the camera arrives, then it breathes.
  {
    const pulse = Math.sin(Math.PI * span(f, F.fn - 200, F.fn + 500)); // one soft pulse as the camera arrives
    const r = radius(primary) * (1 + 0.3 * pulse);
    ctx.save();
    ctx.shadowColor = "#ffffff"; ctx.shadowBlur = 14;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(sx(primary), sy(primary), r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(sx(primary), sy(primary), r + 4, 0, Math.PI * 2); ctx.stroke();
    if (f >= F.fn && !reduce) {
      for (const k of [0, 1]) {
        const v = ((fr.wall + k * 1100) % 2200) / 2200;
        ctx.strokeStyle = `rgba(255,255,255,${(1 - v) * 0.45})`; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(sx(primary), sy(primary), r + 5 + v * 22, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  // Labels: the function as soon as the camera is on it; the reach once the camera has pulled
  // back. Files first, then functions where they fit; none overlapping each other, the header
  // and legend bands, or the pane's sides.
  const placed: Box[] = [];
  const label = (i: number, alpha: number, strong: boolean) => {
    if (alpha <= 0) return;
    const text = p.snap.nodes[i][1];
    ctx.font = `${strong ? 600 : 500} ${i === primary ? 14 : 11.5}px ${fr.mono}`;
    const tw = ctx.measureText(text).width;
    const lx = sx(i) + radius(i) + (i === primary ? 9 : 6), ly = sy(i) + 4;
    const box = { x0: lx - 3, y0: ly - 12, x1: lx + tw + 3, y1: ly + 4 };
    if (box.x0 < EDGE || box.x1 > w - EDGE || box.y0 < TOP + 4 || box.y1 > h - BOTTOM - 4) return;
    if (placed.some((b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) return;
    placed.push(box);
    ctx.fillStyle = rgba(BG, 0.86 * alpha);
    ctx.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    ctx.fillStyle = strong ? `rgba(255,255,255,${alpha})` : `rgba(225,228,236,${0.85 * alpha})`;
    ctx.fillText(text, lx, ly);
  };
  label(primary, span(f, F.fn - 400, F.fn), true);
  const reachLabels = span(f, F.out[1] - 300, F.out[1] + 200);
  const isFile = (i: number) => p.snap.nodes[i][1].endsWith(".py");
  const byHop = [...p.hop.entries()].filter(([i]) => i !== primary).sort((a, b) => a[1] - b[1]);
  for (const [i] of byHop) if (isFile(i)) label(i, reachLabels, false);
  for (const [i] of byHop) if (!isFile(i)) label(i, reachLabels, false);

  // Zoomed in, what the camera cuts off fades into the pane's edges; the header band stays clear.
  const vignette = easeInOut(span(f, F.hold, F.community));
  if (vignette > 0) {
    const fade = (x0: number, y0: number, x1: number, y1: number, gx0: number, gy0: number, gx1: number, gy1: number) => {
      const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      g.addColorStop(0, rgba(BG, vignette));
      g.addColorStop(1, rgba(BG, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    };
    ctx.fillStyle = rgba(BG, vignette);
    ctx.fillRect(0, 0, w, TOP);
    fade(0, TOP, w, TOP + 22, 0, TOP, 0, TOP + 22);
    fade(0, h - BOTTOM - 28, w, h, 0, h - BOTTOM + 4, 0, h - BOTTOM - 28);
    fade(0, 0, 44, h, 0, 0, 44, 0);
    fade(w - 44, 0, w, h, w, 0, w - 44, 0);
  }
}
