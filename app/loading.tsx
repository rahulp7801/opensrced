export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6 space-y-6">
      <div className="space-y-2">
        <div className="h-7 w-48 bg-surface-3 animate-pulse" />
        <div className="h-3.5 w-96 max-w-full bg-surface-2 animate-pulse" />
      </div>
      <div className="border border-border bg-surface/40 p-6 space-y-4">
        <div className="h-4 w-3/4 bg-surface-3 animate-pulse" />
        <div className="h-4 w-1/2 bg-surface-2 animate-pulse" />
        <div className="h-4 w-2/3 bg-surface-2 animate-pulse" />
        <div className="h-32 w-full bg-surface-2 animate-pulse" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="border border-border bg-surface/40 p-4 space-y-3">
          <div className="h-3 w-24 bg-surface-3 animate-pulse" />
          <div className="h-3 w-full bg-surface-2 animate-pulse" />
          <div className="h-3 w-2/3 bg-surface-2 animate-pulse" />
        </div>
        <div className="border border-border bg-surface/40 p-4 space-y-3">
          <div className="h-3 w-24 bg-surface-3 animate-pulse" />
          <div className="h-3 w-full bg-surface-2 animate-pulse" />
          <div className="h-3 w-2/3 bg-surface-2 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
