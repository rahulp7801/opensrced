/** Big, tight sans title with a quiet grey description: Apple product-page style. */
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
    <header className="mb-10 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pt-4">
      <div className="min-w-0 animate-fade-rise">
        <h1 className="display text-[40px] leading-[1.05] text-paper sm:text-[48px]">
          {title}
        </h1>
        {description && (
          <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-paper-muted">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
