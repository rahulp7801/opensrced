export function PageHeading({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 pb-6">
      <div className="min-w-0">
        <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.035em] text-paper">
          {title}
        </h1>
        {description && (
          <p className="mt-2 text-[14px] text-paper-dim leading-relaxed max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
