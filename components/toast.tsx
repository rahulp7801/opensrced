"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { cn } from "@/lib/utils";

type Toast = {
  id: number;
  message: string;
  tone: "ok" | "signal" | "alert" | "info";
};

type ToastCtx = {
  toast: (message: string, tone?: Toast["tone"]) => void;
};

const Ctx = createContext<ToastCtx>({ toast: () => {} });

export function useToast() {
  return useContext(Ctx);
}

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div role="status" aria-live="polite" className="fixed bottom-4 right-4 left-4 z-50 flex flex-col items-end gap-2 pointer-events-none sm:left-auto">
        {/* A near-black pill (the brand's CTA ink) with a tinted dot for the tone. */}
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-sm animate-fade-rise items-center gap-2.5 rounded-[20px] bg-paper px-4 py-2.5 text-[13.5px] font-medium text-ink"
          >
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full",
                t.tone === "ok" && "bg-ok-dim",
                t.tone === "signal" && "bg-signal-dim",
                t.tone === "alert" && "bg-alert-dim",
                t.tone === "info" && "bg-info-dim",
              )}
            />
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
