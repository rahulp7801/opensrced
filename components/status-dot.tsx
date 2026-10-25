import { cn } from "@/lib/utils";

type Tone = "ok" | "signal" | "alert" | "info" | "muted";

// Still dots: colour carries the state; nothing pulses (calm working screens).
const MAP: Record<Tone, string> = {
  ok: "bg-ok",
  signal: "bg-signal",
  alert: "bg-alert",
  info: "bg-info",
  muted: "bg-paper-faint",
};

export function StatusDot({ tone = "ok", className }: { tone?: Tone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", MAP[tone], className)}
    />
  );
}

/** A status as a dot and plain words (.chip in app/app.css draws the dot);
 *  the tone names the state. */
export function StatusChip({
  tone = "ok",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("chip", className)} data-tone={tone === "muted" ? undefined : tone}>
      {children}
    </span>
  );
}
