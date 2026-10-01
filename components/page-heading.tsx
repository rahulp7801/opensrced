/** Display-serif title over a hairline rule with a short vermilion lead-in. */
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
    <header className="relative mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-border-soft pb-7">
      <div className="min-w-0 animate-fade-rise">
        <h1 className="display text-[38px] leading-[1.02] text-paper sm:text-[46px]">
          {title}
        </h1>
        {description && (
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-paper-dim">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
      <span aria-hidden className="absolute -bottom-px left-0 h-px w-20 bg-signal" />
    </header>
  );
}
