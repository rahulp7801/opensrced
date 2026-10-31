// Feature flags for the teacher plan (PLAN.md §4.2 F4). Every new phase ships
// dark behind one of these, and each is read here and nowhere else, so turning
// a feature on or off is one env var. Off unless the value is exactly "1",
// matching the repo's other gates (OPENSRCER_HOSTED_EXEC and friends).

export const FLAGS = {
  lessons: "OPENSRCER_LESSONS",
  envRecipes: "OPENSRCER_ENV_RECIPES",
  forkCi: "OPENSRCER_FORK_CI",
  ide: "OPENSRCER_IDE",
  levels: "OPENSRCER_LEVELS",
  recs: "OPENSRCER_RECS",
  // Contribution record, levels and level-aware PR caps (PLAN §9.1-9.3).
  record: "OPENSRCER_RECORD",
} as const;

export type Flag = keyof typeof FLAGS;

/** Read at call time, not import time, so tests and a redeploy see the current env. */
export function flagEnabled(flag: Flag): boolean {
  if (!Object.hasOwn(FLAGS, flag)) throw new Error(`Unknown feature flag: ${String(flag)}`);
  return process.env[FLAGS[flag]] === "1";
}
