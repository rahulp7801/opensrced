export default function CrucibleLoading() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6 space-y-6">
      <div className="space-y-2">
        <div className="h-7 w-32 bg-surface-3 animate-pulse" />
        <div className="h-3.5 w-80 max-w-full bg-surface-2 animate-pulse" />
      </div>
      <div className="border border-border bg-surface/40 p-6 space-y-4">
        <div className="h-3 w-40 bg-surface-3 animate-pulse" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <div className="h-4 w-4 bg-surface-3 animate-pulse rounded-full" />
              <div className="h-4 flex-1 bg-surface-2 animate-pulse" />
              <div className="h-4 w-16 bg-surface-2 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
      <div className="border border-border bg-surface/40 p-6 space-y-3">
        <div className="h-3 w-32 bg-surface-3 animate-pulse" />
        <div className="h-8 w-full bg-surface-2 animate-pulse" />
        <div className="h-8 w-full bg-surface-2 animate-pulse" />
      </div>
    </div>
  );
}
