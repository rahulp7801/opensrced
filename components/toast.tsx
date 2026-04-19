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
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto animate-fade-rise border px-4 py-2.5 text-[12px] shadow-lg max-w-sm",
              t.tone === "ok" && "border-ok/40 bg-ink text-ok",
              t.tone === "signal" && "border-signal/40 bg-ink text-signal",
              t.tone === "alert" && "border-alert/40 bg-ink text-alert",
              t.tone === "info" && "border-info/40 bg-ink text-info",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
