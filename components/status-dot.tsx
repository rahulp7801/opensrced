import { cn } from "@/lib/utils";

type Tone = "ok" | "signal" | "alert" | "info" | "muted";

const MAP: Record<Tone, string> = {
  ok: "bg-ok animate-pulse-ok",
  signal: "bg-signal animate-pulse-signal",
  alert: "bg-alert",
  info: "bg-info",
  muted: "bg-paper-faint",
};

export function StatusDot({ tone = "ok", className }: { tone?: Tone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-1.5 w-1.5 rounded-full", MAP[tone], className)}
    />
  );
}

export function StatusChip({
  tone = "ok",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  const borders: Record<Tone, string> = {
    ok: "border-ok/40 text-ok",
    signal: "border-signal/40 text-signal",
    alert: "border-alert/50 text-alert",
    info: "border-info/40 text-info",
    muted: "border-border-strong text-paper-muted",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border px-1.5 py-[1px] text-[10px] uppercase tracking-[0.15em]",
        borders[tone],
        className,
      )}
    >
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}
