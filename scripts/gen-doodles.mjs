// Generates components/brand/doodle-data.ts: the brand's hand-drawn line motifs.
//
//   node scripts/gen-doodles.mjs
//
// Each doodle is a few strokes. A stroke is a hand-placed list of points,
// smoothed with Catmull-Rom, nudged by a seeded wobble, then cut into short
// round-capped segments whose width follows a "pen pressure" curve (thin where
// the pen lands and lifts, a little uneven in between). Segments are bucketed
// by width so a stroke is ~6 <path>s, not hundreds. The smoothed centreline is
// kept too: components/brand/doodles.tsx draws it as a mask to animate the
// stroke on. Edit the points here, never the generated file.
import { writeFileSync } from "node:fs";

// Seeded so the output is stable between runs (a re-run is a no-op diff).
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Catmull-Rom through the points, `steps` samples per span. */
function smooth(points, steps = 8) {
  const p = [points[0], ...points, points.at(-1)];
  const out = [];
  for (let i = 1; i < p.length - 2; i++) {
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const f = (k) => 0.5 * (2 * p[i][k] + (-p[i - 1][k] + p[i + 1][k]) * t + (2 * p[i - 1][k] - 5 * p[i][k] + 4 * p[i + 1][k] - p[i + 2][k]) * t2 + (-p[i - 1][k] + 3 * p[i][k] - 3 * p[i + 1][k] + p[i + 2][k]) * t3);
      out.push([f(0), f(1)]);
    }
  }
  out.push(points.at(-1));
  return out;
}

const r1 = (n) => Math.round(n * 10) / 10;

/** One stroke: smoothed centreline + width-bucketed segments. */
function stroke(points, width, seed, { lift = 0.16, land = 0.08 } = {}) {
  const rand = rng(seed);
  const phase = rand() * 6.28, phase2 = rand() * 6.28;
  const pts = smooth(points).map(([x, y]) => [x + (rand() - 0.5) * width * 0.05, y + (rand() - 0.5) * width * 0.05]);
  const n = pts.length - 1;
  const buckets = new Map();
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    // Pressure: ramps up where the pen lands, tapers as it lifts, uneven between.
    const ramp = Math.min(1, t / land, (1 - t) / lift);
    const press = (0.42 + 0.58 * Math.sqrt(Math.max(0, ramp))) * (1 + 0.14 * Math.sin(t * 9 + phase) + 0.07 * Math.sin(t * 23 + phase2));
    const w = Math.max(0.6, Math.round(width * press * 2) / 2); // half-unit buckets
    const [a, b] = [pts[i], pts[i + 1]];
    buckets.set(w, (buckets.get(w) ?? "") + `M${r1(a[0])} ${r1(a[1])}L${r1(b[0])} ${r1(b[1])}`);
  }
  let len = 0;
  for (let i = 0; i < n; i++) len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return {
    c: pts.map(([x, y], i) => `${i ? "L" : "M"}${r1(x)} ${r1(y)}`).join(""),
    w: Math.round(width * 1.25 + 2),
    len: Math.round(len),
    segs: [...buckets].sort(([a], [b]) => a - b).map(([w, d]) => ({ w, d })),
  };
}

/** A wobbly hand-drawn ring that overshoots where it closes. */
function ring(cx, cy, r, seed, turns = 1.12) {
  const rand = rng(seed);
  const pts = [];
  const start = -1.9 + rand() * 0.6;
  const k = 9;
  for (let i = 0; i <= k * turns; i++) {
    const a = start + (i / k) * Math.PI * 2;
    const rr = r * (1 + (rand() - 0.5) * 0.16) * (1 + 0.04 * i / k); // spirals out a touch: the pen doesn't land on its start
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.94]);
  }
  return pts;
}

const DOODLES = {
  // The big pen loop: enters low, climbs, curls back on itself, leaves.
  loop: {
    viewBox: "0 0 420 320",
    strokes: [
      [[[8, 292], [70, 268], [142, 226], [196, 168], [226, 112], [228, 64], [206, 34], [170, 30], [140, 52], [134, 96], [156, 138], [204, 166], [262, 172], [318, 156], [366, 124], [410, 84]], 15, 11],
    ],
  },
  // The hero's loop: rises from the left, curls once, and runs off to the right.
  heroLoop: {
    viewBox: "0 0 620 250",
    strokes: [
      [[[4, 236], [90, 222], [170, 188], [232, 136], [266, 84], [268, 40], [246, 14], [212, 14], [194, 44], [204, 94], [242, 140], [302, 170], [384, 180], [472, 164], [560, 128], [640, 86]], 15, 13],
    ],
  },
  // Underline for a word: a quick wave out, then a lighter pass back under it.
  underline: {
    viewBox: "0 0 300 44",
    strokes: [
      [[[6, 24], [48, 16], [96, 20], [146, 12], [196, 17], [246, 10], [294, 12]], 7, 3],
      [[[294, 12], [250, 22], [180, 27], [110, 30], [52, 35], [20, 38]], 4.5, 5, { land: 0.04, lift: 0.35 }],
    ],
  },
  // A swooping arrow with a two-stroke head.
  arrow: {
    viewBox: "0 0 170 130",
    strokes: [
      [[[10, 14], [22, 54], [50, 88], [92, 108], [140, 110]], 6, 7],
      [[[122, 90], [142, 109], [120, 124]], 6, 9, { land: 0.12, lift: 0.2 }],
    ],
  },
  // A little code graph: three rings, joined by unsteady lines.
  nodes: {
    viewBox: "0 0 220 170",
    strokes: [
      [ring(50, 50, 22, 21), 5, 21],
      [[[70, 64], [104, 86], [138, 104]], 3.5, 22, { land: 0.15, lift: 0.25 }],
      [ring(160, 116, 24, 23), 5.5, 23],
      [[[58, 74], [62, 104], [72, 130]], 3.5, 24, { land: 0.15, lift: 0.25 }],
      [ring(84, 146, 15, 25), 4.5, 25],
      [[[178, 92], [186, 62], [184, 34]], 3.5, 26, { land: 0.15, lift: 0.25 }],
      [ring(182, 22, 12, 27), 4, 27],
    ],
  },
  // A rough oval to circle a word or number.
  circle: {
    viewBox: "0 0 300 130",
    strokes: [
      [(() => { const rand = rng(31); const pts = []; for (let i = 0; i <= 11; i++) { const a = -2.6 + (i / 10) * Math.PI * 2; pts.push([150 + Math.cos(a) * 138 * (1 + (rand() - 0.5) * 0.06), 64 + Math.sin(a) * 52 * (1 + (rand() - 0.5) * 0.12) + i * 0.8]); } return pts; })(), 5, 31],
    ],
  },
  // The wordmark's "o": one heavy pen ring that doesn't quite close on itself.
  o: {
    viewBox: "0 0 60 60",
    strokes: [[ring(30, 31, 19, 52, 1.1), 12, 52, { land: 0.04, lift: 0.1 }]],
  },
  // A tick, as a hand makes it: a short stroke down, then a long one up and away.
  check: {
    viewBox: "0 0 100 80",
    strokes: [
      [[[8, 42], [20, 54], [33, 70], [48, 50], [68, 26], [94, 6]], 8, 61, { land: 0.1, lift: 0.3 }],
    ],
  },
  // A hand asterisk: three quick crossing strokes.
  spark: {
    viewBox: "0 0 80 80",
    strokes: [
      [[[40, 6], [41, 40], [39, 74]], 6, 41],
      [[[10, 22], [40, 40], [71, 56]], 6, 42],
      [[[12, 60], [42, 39], [68, 20]], 6, 43],
    ],
  },
};

// One named export per doodle, so a client bundle only carries the ones it uses.
let ts = `// GENERATED by scripts/gen-doodles.mjs. Edit the points there and re-run; do not edit by hand.\n` +
  `export type DoodleData = { viewBox: string; strokes: { c: string; w: number; len: number; segs: { w: number; d: string }[] }[] };\n`;
for (const [name, { viewBox, strokes }] of Object.entries(DOODLES)) {
  const data = { viewBox, strokes: strokes.map(([pts, w, seed, opts]) => stroke(pts, w, seed, opts)) };
  ts += `export const ${name}: DoodleData = ${JSON.stringify(data)};\n`;
  console.log(name, data.strokes.map((s) => s.len));
}
writeFileSync(new URL("../components/brand/doodle-data.ts", import.meta.url), ts, "utf8");

// The favicon is the wordmark's "o": the cobalt pen ring on a blush tile.
const ringO = stroke(...DOODLES.o.strokes[0].slice(0, 2), DOODLES.o.strokes[0][2], DOODLES.o.strokes[0][3]);
writeFileSync(
  new URL("../app/icon.svg", import.meta.url),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">\n` +
    `  <rect x="1" y="1" width="30" height="30" rx="8" fill="#f6e9e0"/>\n` +
    `  <g transform="translate(1.6 1.4) scale(0.48)" fill="none" stroke="#2338e6" stroke-linecap="round">${ringO.segs.map((g) => `<path d="${g.d}" stroke-width="${g.w}"/>`).join("")}</g>\n` +
    `</svg>\n`,
  "utf8",
);
