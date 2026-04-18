export function PageHeading({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  /** @deprecated retained for compatibility, no longer rendered */
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="serif text-[26px] leading-tight tracking-tight text-paper">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-[12.5px] text-paper-dim leading-snug max-w-3xl">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
