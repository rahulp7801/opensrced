// The placeholder an app page shows while its data loads. Each signed-in
// section re-exports it as its loading.tsx. It is deliberately not at the app
// root: a root loading.tsx wraps every page in a Suspense boundary, and React
// holds that reveal back for about a second, so the public pages (landing,
// tour, sign-in, privacy, shared fixes), which have nothing to load, would
// flash a skeleton first. Its shapes follow the page rhythm (PageHeading, then
// sheets) so nothing jumps when the page arrives.
export default function PageSkeleton() {
  const bar = "rounded-full bg-surface-2 animate-pulse";
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8" aria-busy="true">
      <div className="mb-10 max-w-3xl space-y-4 pt-2 sm:mb-12 sm:pt-6">
        <div className={`h-3 w-40 ${bar}`} />
        <div className="h-12 w-72 max-w-full rounded-2xl bg-surface-3 animate-pulse sm:h-14" />
        <div className={`h-3.5 w-[28rem] max-w-full ${bar}`} />
      </div>
      <div className="card space-y-4 p-6">
        <div className={`h-3.5 w-3/4 ${bar}`} />
        <div className={`h-3.5 w-1/2 ${bar}`} />
        <div className="h-32 w-full rounded-xl bg-surface-2 animate-pulse" />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="card space-y-3 p-5">
            <div className={`h-3 w-24 ${bar}`} />
            <div className={`h-3 w-full ${bar}`} />
            <div className={`h-3 w-2/3 ${bar}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
