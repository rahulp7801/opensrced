"use client";

// Entry point for the IDE on /learn pages. The workbench (several MB of VS
// Code) loads only in the browser, only on wide screens, and only from here.

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import type { IdeProps } from "./workbench";

const Workbench = dynamic(() => import("./workbench"), {
  ssr: false,
  loading: () => <p role="status" className="p-6 text-sm text-white/70">Loading the editor…</p>,
});

/** The editor needs room for the file tree, the code and the teacher side by side. */
const WIDE = "(min-width: 1024px)";

function useWide(): boolean | null {
  return useSyncExternalStore(
    (onChange) => { const query = matchMedia(WIDE); query.addEventListener("change", onChange); return () => query.removeEventListener("change", onChange); },
    () => matchMedia(WIDE).matches,
    () => null,
  );
}

export function Ide(props: IdeProps) {
  const wide = useWide();
  return (
    <div className="h-[calc(100svh-7.5rem)] min-h-[32rem] bg-[#1e1e1e]">
      {wide === false && (
        <div role="note" className="mx-auto max-w-md p-8 text-center text-white/80">
          <h1 className="mb-2 text-lg font-semibold text-white">The code editor needs a larger screen</h1>
          <p className="text-sm">Open this lesson on a laptop or desktop to write the fix. On this device you can still follow the lesson with the teacher.</p>
        </div>
      )}
      {wide && <Workbench {...props} />}
    </div>
  );
}
