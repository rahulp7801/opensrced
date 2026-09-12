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

export const SHARED_FIX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
