import { cn } from "@/lib/utils";
import { Doodle } from "./doodles";
import { o } from "./doodle-data";

/**
 * "opensrcer" set in the display face, lowercase and condensed, with one
 * custom touch: the "o" is a single cobalt pen ring that doesn't quite close
 * (the same hand as the doodles). It scales with font-size; set the size and
 * colour of the letters with text utilities.
 *
 * draw: the ring draws itself once on page load (header, hero), or not.
 */
export function Wordmark({ draw = false, className }: { draw?: boolean; className?: string }) {
  return (
    <span role="img" aria-label="opensrcer" className={cn("wordmark inline-flex items-baseline whitespace-nowrap font-display font-extrabold leading-none tracking-[-0.025em] [font-stretch:80%]", className)}>
      <Doodle
        doodle={o}
        draw={draw ? "load" : "none"}
        delay={150}
        duration={700}
        className="mr-[0.015em] h-[0.6em] w-[0.6em] shrink-0 self-baseline [vertical-align:-0.02em]"
      />
      <span aria-hidden>pensrcer</span>
    </span>
  );
}
