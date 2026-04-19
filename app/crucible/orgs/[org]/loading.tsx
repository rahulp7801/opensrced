export default function OrgLoading() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6 space-y-6">
      <div className="space-y-2">
        <div className="h-7 w-48 bg-surface-3 animate-pulse" />
        <div className="h-3.5 w-72 max-w-full bg-surface-2 animate-pulse" />
      </div>
      <div className="h-3 w-24 bg-surface-2 animate-pulse" />
      <div className="border border-border bg-surface/40 divide-y divide-border-soft">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="px-4 py-3 flex items-center gap-3">
            <div className="h-4 w-4 bg-surface-3 animate-pulse rounded-full" />
            <div className="h-4 flex-1 bg-surface-2 animate-pulse" />
            <div className="h-3 w-12 bg-surface-2 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
