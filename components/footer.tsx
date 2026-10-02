export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-border-soft bg-ink">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-5 py-6 sm:px-8 text-[12px] text-paper-muted">
        <p>opensrcer. Careful contributions, reviewed before they ship.</p>
        <div className="flex items-center gap-5">
          <a className="transition-colors hover:text-paper" href="https://github.com/rahulp7801/opensrced" target="_blank" rel="noreferrer">
            Source
          </a>
          <a className="transition-colors hover:text-paper" href="/api/health">
            Service status
          </a>
        </div>
      </div>
    </footer>
  );
}
