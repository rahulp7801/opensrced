import Link from "next/link";

export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: { label: string; href: string };
  children: React.ReactNode;
}) {
  return (
    <section className="animate-fade-rise">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="serif text-[28px] leading-none text-paper">{title}</h2>
          {description && (
            <p className="mt-1.5 text-[12px] text-paper-muted">{description}</p>
          )}
        </div>
        {action && (
          <Link
            href={action.href}
            className="mono-label text-paper-muted hover:text-signal transition-colors inline-flex items-center gap-1.5"
          >
            {action.label} →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
