// The placeholder an app page shows while its data loads. Each signed-in
// section re-exports it as its loading.tsx. It is deliberately not at the app
// root: a root loading.tsx wraps every page in a Suspense boundary, and React
// holds that reveal back for about a second, so the public pages (landing,
// tour, sign-in, privacy, shared fixes), which have nothing to load, would
// flash a skeleton first.
export default function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 sm:px-8 py-10 space-y-6">
      <div className="space-y-2">
        <div className="h-7 w-48 bg-surface-3 animate-pulse" />
        <div className="h-3.5 w-96 max-w-full bg-surface-2 animate-pulse" />
      </div>
      <div className="rounded-2xl border border-border-soft bg-surface p-6 space-y-4">
        <div className="h-4 w-3/4 bg-surface-3 animate-pulse" />
        <div className="h-4 w-1/2 bg-surface-2 animate-pulse" />
        <div className="h-4 w-2/3 bg-surface-2 animate-pulse" />
        <div className="h-32 w-full bg-surface-2 animate-pulse" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border-soft bg-surface p-4 space-y-3">
          <div className="h-3 w-24 bg-surface-3 animate-pulse" />
          <div className="h-3 w-full bg-surface-2 animate-pulse" />
          <div className="h-3 w-2/3 bg-surface-2 animate-pulse" />
        </div>
        <div className="rounded-2xl border border-border-soft bg-surface p-4 space-y-3">
          <div className="h-3 w-24 bg-surface-3 animate-pulse" />
          <div className="h-3 w-full bg-surface-2 animate-pulse" />
          <div className="h-3 w-2/3 bg-surface-2 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
