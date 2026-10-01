export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-end justify-between gap-6 px-6 py-8">
        <div>
          <span className="display text-[22px] leading-none text-paper">opensrcer</span>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-paper-muted">
            Careful contributions, reviewed before they ship
          </p>
        </div>
        <div className="flex items-center gap-5 text-[13px] text-paper-muted">
          <a className="transition-colors hover:text-signal" href="https://github.com/rahulp7801/opensrced" target="_blank" rel="noreferrer">
            Source
          </a>
          <a className="transition-colors hover:text-signal" href="/api/health">
            Service status
          </a>
        </div>
      </div>
    </footer>
  );
}
