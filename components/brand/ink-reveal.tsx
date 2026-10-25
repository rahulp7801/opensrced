import { cn } from "@/lib/utils";

/**
 * A paragraph whose words fill in as you scroll through it: pale cobalt, then
 * cobalt, then ink, one word after another (brand.css: .ink-reveal).
 *
 * Pure CSS on a scroll timeline, so the server's HTML is already the finished,
 * readable paragraph: no JS, nothing hidden before hydration. Reduced motion,
 * or a browser without scroll timelines, gets plain ink. Pass a plain string;
 * the colour it ends on is the element's text colour (set --ink-to to change).
 */
export function InkReveal({
  text,
  as: Tag = "p",
  className,
}: {
  text: string;
  as?: "p" | "h2" | "h3" | "blockquote";
  className?: string;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <Tag className={cn("ink-reveal", className)}>
      {words.map((word, i) => (
        <span key={i} className="ink-word" style={{ "--i": i, "--n": words.length } as React.CSSProperties}>
          {word}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </Tag>
  );
}
