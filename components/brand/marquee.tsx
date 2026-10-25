"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const SEPARATOR = " • ";

/**
 * A ticker band of short phrases, in the shouting display voice.
 *
 * Straight (default): a cobalt band; the track loops with a CSS transform.
 * Curved: the band is one thick SVG stroke along an arc and the words ride a
 * textPath on it; they drift, and scrolling the page pushes them along.
 *
 * The phrases are read once by screen readers (sr-only list); the moving
 * copies are aria-hidden. Reduced motion: the band holds still.
 */
export function Marquee({
  items,
  curved = false,
  tone = "signal",
  className,
}: {
  items: readonly string[];
  curved?: boolean;
  tone?: "signal" | "ink";
  className?: string;
}) {
  const line = items.join(SEPARATOR) + SEPARATOR;
  const band = tone === "signal" ? "var(--color-signal)" : "var(--color-paper)";
  const said = <p className="sr-only">{items.join(". ")}.</p>;

  if (!curved) {
    return (
      <div className={cn("marquee py-3.5", className)} style={{ background: band }}>
        {said}
        <div aria-hidden className="marquee-track" data-run>
          {[0, 1].map((copy) => (
            <span key={copy} className="shout whitespace-pre pr-0 text-[clamp(28px,4vw,52px)] text-ink [line-height:1]">
              {line.repeat(3)}
            </span>
          ))}
        </div>
      </div>
    );
  }
  return <CurvedMarquee line={line} band={band} said={said} className={className} />;
}

// The arc the band follows, in a 1440×260 box. On narrow screens the SVG is
// cropped to its middle (slice), which keeps the type large.
const ARC = "M-80 214C330 40 1010 12 1520 128";

function CurvedMarquee({ line, band, said, className }: { line: string; band: string; said: React.ReactNode; className?: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const path = useRef<SVGTextPathElement>(null);
  const unit = useRef<SVGTextElement>(null);

  useEffect(() => {
    const el = svg.current;
    if (!el || !path.current || !unit.current) return;
    if (!matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    // One repetition's length on the path; offsets wrap by it, so the loop is seamless.
    const period = unit.current.getComputedTextLength();
    if (!period) return;
    let raf = 0;
    let visible = false;
    let last = performance.now();
    let drift = 0;
    const tick = (now: number) => {
      drift += (now - last) * 0.045; // px per ms, in viewBox units
      last = now;
      const offset = -((drift + window.scrollY * 0.35) % period);
      path.current?.setAttribute("startOffset", String(offset));
      if (visible) raf = requestAnimationFrame(tick);
    };
    // Only animate while the band is on screen.
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className={cn("relative", className)}>
      {said}
      <svg ref={svg} aria-hidden focusable="false" viewBox="0 0 1440 260" preserveAspectRatio="xMidYMid slice" className="block h-[150px] w-full sm:h-[200px] lg:h-[260px]">
        <path id="brand-marquee-arc" d={ARC} fill="none" stroke={band} strokeWidth="84" />
        {/* Invisible ruler for one repetition. */}
        <text ref={unit} className="shout" fontSize="50" opacity="0" x="-9999">{line}</text>
        <text className="shout" fontSize="50" fill="var(--color-ink)" dominantBaseline="central">
          <textPath ref={path} href="#brand-marquee-arc" startOffset="0">{line.repeat(5)}</textPath>
        </text>
      </svg>
    </div>
  );
}
