/** `inviteOnly`: during the private preview the source link is left out too. */
export function SiteFooter({ inviteOnly = false }: { inviteOnly?: boolean }) {
  // Links are at least 44px tall so they're easy to tap on a phone.
  const link = "inline-flex min-h-11 items-center transition-colors hover:text-paper";
  return (
    <footer className="mt-20 border-t border-border-soft bg-ink">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-4 sm:px-8 text-[12px] text-paper-muted">
        <p>opensrcer (opensrced.vercel.app). Careful contributions, reviewed before they ship.</p>
        <div className="flex items-center gap-5">
          {!inviteOnly && (
            <a className={link} href="https://github.com/rahulp7801/opensrced" target="_blank" rel="noreferrer">
              Source
            </a>
          )}
          <a className={link} href="/privacy">
            Privacy
          </a>
        </div>
      </div>
    </footer>
  );
}
