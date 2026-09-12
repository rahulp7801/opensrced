import { parseRunTarget } from "./run-target";

export type SharedFix = {
  id: string;
  repo: string;
  pr_number: number | null;
  comment_body: string | null;
  fix_response: string;
  diff: string | null;
  explainer: string | null;
  created_at: string;
};

function nullableString(value: unknown, max: number): value is string | null {
  return value === null || (typeof value === "string" && value.length <= max);
}

export function validSharedFix(value: unknown, id: string): value is SharedFix {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fix = value as Partial<SharedFix>;
  let canonicalRepo = "";
  try { canonicalRepo = parseRunTarget(fix.repo).repo; }
  catch { return false; }
  return fix.id === id && fix.repo === canonicalRepo &&
    (fix.pr_number === null || (Number.isSafeInteger(fix.pr_number) && fix.pr_number! > 0)) &&
    nullableString(fix.comment_body, 500) &&
    typeof fix.fix_response === "string" && fix.fix_response.length > 0 && fix.fix_response.length <= 10_000 &&
    nullableString(fix.diff, 10_000) && nullableString(fix.explainer, 2_000) &&
    typeof fix.created_at === "string" && Number.isFinite(Date.parse(fix.created_at));
}
