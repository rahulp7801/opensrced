// The kickoff steps (PLAN §7.4), one file each. A step says what it asks,
// what context it needs, how to read the contributor's answer, and how it is
// graded: deterministically where §7.4 allows (s2, s3, s5, s6, s7, s10 and
// the copy checks need no model), otherwise by one fast-model call with a
// strict JSON reply. Whether a step is graded at all is lib/lesson/machine.ts
// isGraded (s7/s8 only against a verified answer key).

import type { StepId } from "../machine";
import type { StepDef } from "./shared";
import { s1 } from "./s1";
import { s2 } from "./s2";
import { s3 } from "./s3";
import { s4 } from "./s4";
import { s5 } from "./s5";
import { s6 } from "./s6";
import { s7 } from "./s7";
import { s8 } from "./s8";
import { explainIt } from "./explain-it";
import { s10 } from "./s10";

export * from "./shared";

const STEPS: Record<StepId, unknown> = { s1, s2, s3, s4, s5, s6, s7, s8, "explain-it": explainIt, s10 };

/** One step's definition, its answer type erased for the routes. */
export function stepDef(id: StepId): StepDef<unknown> {
  return STEPS[id] as unknown as StepDef<unknown>;
}
export { docsIssueDraft } from "./s10";
