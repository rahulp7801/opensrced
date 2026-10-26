// The app's top-level routes, for the middleware: a page path outside them has
// no route, so it goes on to the real not-found page instead of a sign-in wall
// (a mistyped link shouldn't ask for an invite, and crawlers should see a 404).
// lib/__tests__/app-routes.test.ts keeps this in step with the folders in app/.

/** Folders under app/. */
export const APP_FOLDERS = ["admin", "api", "crucible", "demo", "discover", "dispatches", "explore", "fix", "graph", "issues", "join", "login", "privacy", "prs", "repos", "stats", "trigger"] as const;

/** Routes the Auth0 SDK serves from the middleware (/auth/*, and /me/*, /my-org/* it refuses). */
const SDK_SEGMENTS = ["auth", "me", "my-org"];

const KNOWN = new Set<string>([...APP_FOLDERS, ...SDK_SEGMENTS]);

/** True for a path whose first segment no route serves. "/" is the landing page, never unknown.
 *  Fails closed: the segment is percent-decoded and lowercased before the
 *  check, and one that will not decode counts as known, so an encoded or
 *  re-cased spelling of a gated route (/%61pi/…, /API/…) still meets the gate. */
export function unknownRoute(pathname: string): boolean {
  const raw = pathname.split("/")[1] ?? "";
  if (raw === "") return false;
  let segment: string;
  try { segment = decodeURIComponent(raw).toLowerCase(); } catch { return false; }
  return !KNOWN.has(segment);
}
