export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="flex flex-col items-center gap-3 animate-fade-rise">
        <div className="relative w-8 h-8">
          <div className="absolute inset-0 border border-signal/30 rounded-full" />
          <div className="absolute inset-0 border border-t-signal rounded-full animate-spin" style={{ animationDuration: "0.8s" }} />
        </div>
        <span className="text-[11px] text-paper-muted tracking-[0.15em] uppercase">loading</span>
      </div>
    </div>
  );
}
