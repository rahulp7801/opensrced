import { Wordmark } from "./brand/wordmark";

/** `inviteOnly`: during the private preview the source link is left out too. */
export function SiteFooter({ inviteOnly = false }: { inviteOnly?: boolean }) {
  return (
    <footer className="mt-20 border-t border-border-soft bg-ink">
      <div className="mx-auto grid max-w-[1320px] gap-x-8 gap-y-5 px-5 py-8 sm:grid-cols-[1fr_auto] sm:items-end sm:px-8 min-[1384px]:px-0">
        <div>
          <Wordmark className="text-[30px] text-paper" />
          <p className="mt-2 text-[13px] text-paper-muted">
            Careful contributions, reviewed before they ship. opensrced.vercel.app
          </p>
        </div>
        {/* Pills are 40px tall so they're easy to tap on a phone. */}
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-1.5">
          {!inviteOnly && (
            <a className="pill" data-quiet href="https://github.com/rahulp7801/opensrced" target="_blank" rel="noreferrer">
              Source
            </a>
          )}
          <a className="pill" data-quiet href="/privacy">
            Privacy
          </a>
        </nav>
      </div>
    </footer>
  );
}
