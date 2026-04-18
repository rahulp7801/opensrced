"use client";

import { useEffect, useState } from "react";

export function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!now) return <span className="mono-label opacity-0">— — : — — : — —</span>;
  const t = now.toISOString().slice(11, 19);
  const d = now.toISOString().slice(0, 10);
  return (
    <span className="mono-label text-paper-dim tabular-nums">
      <span className="text-paper-muted">{d}</span>
      <span className="mx-1.5 text-paper-faint">·</span>
      <span className="text-paper">{t}</span>
      <span className="ml-1.5 text-paper-muted">UTC</span>
    </span>
  );
}
