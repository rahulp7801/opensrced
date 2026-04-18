export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-ink/80">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-6 py-3 text-[11px] text-paper-muted">
        <span>opensrcer · observatory</span>
        <div className="flex items-center gap-4">
          <a className="hover:text-paper" href="https://github.com/rahulp7801/opensrc2" target="_blank" rel="noreferrer">
            source
          </a>
          <a className="hover:text-paper" href="/api/health">
            /api/health
          </a>
        </div>
      </div>
    </footer>
  );
}
