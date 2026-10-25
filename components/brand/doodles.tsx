import { useId } from "react";
import { cn } from "@/lib/utils";
import type { DoodleData } from "./doodle-data";

/**
 * One of the brand's hand-drawn line motifs. Pass one of the exports of
 * ./doodle-data (loop, underline, arrow, nodes, circle, spark, o); each is
 * its own export so a client bundle only carries the ones it uses.
 * scripts/gen-doodles.mjs draws them: variable-width, slightly uneven pen
 * strokes. Always decorative, so always aria-hidden.
 *
 * The visible ink is the width-varying segments; each stroke is revealed
 * through a mask whose centreline "pen" draws on, so the drawing keeps its
 * uneven edges while it animates.
 *
 * draw="load": draws once on page load (`delay`, `duration` in ms).
 * draw="scroll": draws as it crosses the viewport (scroll-timeline browsers).
 * draw="none": finished. Reduced motion or no support: finished.
 *
 * weight: pen thickness (default a fine 0.6 of the generated marker).
 * stretch: fill the box exactly (circling or underlining a word whose box
 * isn't the doodle's shape); otherwise it keeps its proportions.
 */
export function Doodle({
  doodle,
  tone = "signal",
  draw = "none",
  delay = 0,
  duration = 1100,
  stretch = false,
  weight = 0.6,
  className,
  style,
}: {
  doodle: DoodleData;
  tone?: "signal" | "ink" | "current";
  draw?: "load" | "scroll" | "none";
  delay?: number;
  duration?: number;
  stretch?: boolean;
  /** Pen weight as a share of the generated stroke widths. The default is a
   *  fine pen (0.6); 1 is the full marker the generator drew. */
  weight?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  // Mask ids must be unique per instance and plain enough for url(#…).
  const id = `d${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { viewBox, strokes } = doodle;
  const total = strokes.reduce((sum, s) => sum + s.len, 0);
  let before = 0;
  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio={stretch ? "none" : undefined}
      aria-hidden
      focusable="false"
      className={cn("doodle", className)}
      data-tone={tone === "current" ? undefined : tone}
      data-draw={draw}
      style={{ "--delay": `${delay}ms`, ...style } as React.CSSProperties}
    >
      {strokes.map((s, i) => {
        const from = before / total;
        before += s.len;
        const to = before / total;
        return (
          <g key={i}>
            <mask id={`${id}-${i}`} maskUnits="userSpaceOnUse">
              <path
                className="doodle-pen"
                d={s.c}
                pathLength={1}
                fill="none"
                stroke="#fff"
                strokeWidth={s.w}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  "--from": from.toFixed(3),
                  "--to": to.toFixed(3),
                  "--at": `${Math.round(from * duration)}ms`,
                  "--for": `${Math.max(120, Math.round((to - from) * duration))}ms`,
                } as React.CSSProperties}
              />
            </mask>
            <g mask={`url(#${id}-${i})`} fill="none" stroke="currentColor" strokeLinecap="round">
              {s.segs.map((seg) => (
                <path key={seg.w} d={seg.d} strokeWidth={seg.w * weight} />
              ))}
            </g>
          </g>
        );
      })}
    </svg>
  );
}
