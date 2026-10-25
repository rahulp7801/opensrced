import Link from "next/link";
import { cn } from "@/lib/utils";

/** The arrow inside the CTA pill's cobalt circle; it turns 45° on hover. */
export function ArrowGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden focusable="false">
      <path d="M4.5 11.5 11.4 4.6M5.6 4.4h6v6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The call to action: a near-black pill with a round cobalt arrow button.
 * One per view. For plain pills use the `.pill` class on a Link or button.
 */
export function CtaPill({
  href,
  children,
  size = "md",
  className,
}: {
  href: string;
  children: React.ReactNode;
  size?: "md" | "sm";
  className?: string;
}) {
  return (
    <Link href={href} className={cn("cta-pill", className)} data-size={size}>
      {children}
      <span className="cta-pill-arrow">
        <ArrowGlyph size={size === "sm" ? 13 : 16} />
      </span>
    </Link>
  );
}
