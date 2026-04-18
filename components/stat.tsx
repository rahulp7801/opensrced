import { cn } from "@/lib/utils";

export function Stat({
  code,
  label,
  value,
  sub,
  tone = "paper",
  className,
}: {
  code: string;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "paper" | "signal" | "ok" | "alert" | "info";
  className?: string;
}) {
  const toneColor = {
    paper: "text-paper",
    signal: "text-signal",
    ok: "text-ok",
    alert: "text-alert",
    info: "text-info",
  }[tone];
  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 border border-border bg-surface/40 p-5 transition-colors hover:bg-surface-2/40",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="mono-label text-paper-muted">[{code}]</span>
        <span className="mono-label text-paper-muted">{label}</span>
      </div>
      <div className={cn("serif text-[56px] leading-none num-tabular", toneColor)}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-paper-dim">{sub}</div>}
    </div>
  );
}
