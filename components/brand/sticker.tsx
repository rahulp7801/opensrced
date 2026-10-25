import { cn } from "@/lib/utils";

/**
 * A tilted pill slapped onto a headline. Position it yourself (usually
 * `absolute` inside a `relative` headline wrapper).
 *
 * pop="load" pops it in on page load after `delay` ms; pop="scroll" pops it as
 * it scrolls into view (where the browser supports scroll timelines);
 * pop="none" just sits there. Reduced motion: it just sits there.
 */
export function Sticker({
  children,
  tone = "ink",
  tilt = -5,
  pop = "load",
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  tone?: "ink" | "signal" | "paper";
  tilt?: number;
  pop?: "load" | "scroll" | "none";
  delay?: number;
  className?: string;
}) {
  return (
    <span
      className={cn("sticker", className)}
      data-tone={tone}
      data-pop={pop}
      style={{ "--tilt": `${tilt}deg`, "--delay": `${delay}ms` } as React.CSSProperties}
    >
      {children}
    </span>
  );
}
