"use client";

// The project map (PLAN §9.4) where the user meets it: on /account (ProjectMaps,
// each repository's areas plus the recoloured graph), at the start of a lesson
// in a repository they have been to (MapNote), and markExplored, which the code
// viewer and the IDE call when a file is opened. All of it is the caller's own,
// from /api/record/map, behind OPENSRCER_RECORD: with the flag off the API
// answers 404 and these render nothing.

import { useEffect, useState } from "react";

type Level = "explored" | "explained" | "changed";
type RepoMap = {
  repo: string;
  counts: Record<Level, number>;
  coverage: { areas: Array<{ name: string; level: Level | null }>; known: string[]; total: number } | null;
};

/** The overlay's colours (lib/graph-html.ts MAP_COLORS), for the area chips. */
const LEVEL_COLOR: Record<Level, string> = { explored: "#4E79A7", explained: "#59A14F", changed: "#EDC948" };

// One POST per file per page; after a 404 (flag off) none at all.
const sent = new Set<string>();
let mapOff = false;

/** A file was opened in the code viewer or the IDE: its nodes become explored. */
export function markExplored(repo: string, file: string): void {
  const key = `${repo}\n${file}`;
  if (mapOff || sent.has(key)) return;
  sent.add(key);
  void fetch("/api/record/map", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repo, file }) })
    .then((r) => {
      if (r.status === 404) mapOff = true;
      else if (!r.ok) console.warn(`[map] could not mark ${file} explored (${r.status})`);
    }, (error: Error) => console.warn(`[map] could not mark ${file} explored: ${error.message}`));
}

const list = (names: string[]) => names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

export function ProjectMaps() {
  const [maps, setMaps] = useState<RepoMap[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/record/map", { cache: "no-store" })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as { maps?: RepoMap[]; error?: string };
        if (!r.ok || !body.maps) throw new Error(body.error ?? "Could not load your project map.");
        setMaps(body.maps);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p role="alert" className="mt-3 text-[14px] text-alert">{error}</p>;
  if (!maps) return null;
  if (!maps.length) return <p className="mt-3 text-[14px] text-paper-muted">Your project map fills in as you open code in a lesson, explain it, and get PRs merged.</p>;
  return (
    <ul className="mt-4 space-y-3">
      {maps.map((map) => (
        <li key={map.repo} className="card px-5 py-4">
          <p className="text-[15px] text-paper">
            {map.coverage
              ? <>You know {map.coverage.known.length} of {map.repo}&apos;s {map.coverage.total} areas{map.coverage.known.length > 0 && <>: {list(map.coverage.known.slice(0, 5))}</>}.</>
              : <>{map.repo}: there is no code graph to count areas in yet.</>}
          </p>
          <p className="meta mt-1">
            <span>{map.counts.explored} explored</span><span>{map.counts.explained} explained</span><span>{map.counts.changed} changed</span>
          </p>
          {map.coverage && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`Areas of ${map.repo}`}>
              {map.coverage.areas.map((area) => (
                // .tag's dot, in the overlay's colour for the area's level.
                <li key={area.name} className="tag before:!bg-[var(--dot)]" style={{ ["--dot" as string]: area.level ? LEVEL_COLOR[area.level] : "#4b4b4b" }}>
                  {area.name}<span className="sr-only">: {area.level ?? "not seen yet"}</span>
                </li>
              ))}
            </ul>
          )}
          <details className="mt-3">
            <summary className="text-link cursor-pointer text-[14px]">Show the map</summary>
            {/* Sandboxed like /graph's viz: the HTML is built from repository content. */}
            <iframe sandbox="allow-scripts" loading="lazy" src={`/api/graph/${map.repo}/viz?map=1`} title={`Your map of ${map.repo}`} className="mt-3 h-[340px] w-full rounded-md border-0" />
          </details>
        </li>
      ))}
    </ul>
  );
}

type Note = { known: string[]; total: number; nearChanged: string | null };

/** "You've been here before" at the top of a lesson in a repository the user knows. */
export function MapNote({ repo, issue }: { repo: string; issue: number }) {
  const [note, setNote] = useState<Note | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/record/map?repo=${encodeURIComponent(repo)}&issue=${issue}`, { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        // 404: the record is off. Anything else that fails only costs the note.
        if (r.status === 404) return;
        if (!r.ok) throw new Error(`status ${r.status}`);
        setNote(((await r.json()) as { note: Note | null }).note);
      })
      .catch((e: Error) => { if (!controller.signal.aborted) console.warn(`[map] lesson note unavailable: ${e.message}`); });
    return () => controller.abort();
  }, [repo, issue]);

  if (!note) return null;
  return (
    <p className="callout mt-4 text-[15px]" data-tone="info">
      <span className="font-semibold text-paper">You&apos;ve been here before. </span>
      {note.total > 0 && <>You know {note.known.length} of {repo}&apos;s {note.total} areas{note.known.length > 0 && <> ({list(note.known.slice(0, 4))})</>}. </>}
      {note.nearChanged !== null && <>This issue is next to code you changed{note.nearChanged ? <> in {note.nearChanged}</> : null}.</>}
    </p>
  );
}
