import { cn } from "@/lib/utils";

export function Panel({
  label,
  code,
  meta,
  children,
  className,
  dense,
}: {
  label?: string;
  code?: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  dense?: boolean;
}) {
  return (
    <section
      className={cn(
        "relative border border-border bg-surface/50 backdrop-blur-sm",
        className,
      )}
    >
      {(label || code || meta) && (
        <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-2">
          <div className="flex items-center gap-3 min-w-0">
            {code && (
              <span className="mono-label text-paper-muted shrink-0">[{code}]</span>
            )}
            {label && (
              <span className="mono-label text-paper-dim truncate">— {label}</span>
            )}
          </div>
          {meta && <div className="shrink-0 text-[10px] text-paper-muted">{meta}</div>}
        </header>
      )}
      <div className={cn(dense ? "p-0" : "p-5")}>{children}</div>
    </section>
  );
}
