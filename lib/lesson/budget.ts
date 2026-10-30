// Model calls per lesson, by provider (PLAN §7.3, §0.5.2). Copilot Free's
// allowance is small, so a lesson must work in few calls: every model call
// (teacher reply, grade, leak-forced regeneration) spends one turn. When few
// are left the teacher switches to fewer, denser hints and says so.
//
// Every number is a knob: OPENSRCER_LESSON_TURNS_<PROVIDER> overrides it
// (e.g. OPENSRCER_LESSON_TURNS_COPILOT=20).

/** Environment variables; a plain object in tests. */
export type Env = Record<string, string | undefined>;

export type TeacherProvider = "copilot" | "anthropic-key" | "openrouter-key";

export const DEFAULT_TURNS: Record<TeacherProvider, number> = {
  copilot: 15,
  "anthropic-key": 60,
  "openrouter-key": 60,
};

/** At or below this many turns left, the teacher goes dense. */
export const LOW_TURNS = 4;

export function turnBudget(provider: TeacherProvider, env: Env = process.env): number {
  const raw = env[`OPENSRCER_LESSON_TURNS_${provider.replace(/-key$/, "").toUpperCase()}`];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 1000 ? parsed : DEFAULT_TURNS[provider];
}

export type BudgetState = { limit: number; used: number; left: number; low: boolean; exhausted: boolean };

export function budgetState(provider: TeacherProvider, used: number, env: Env = process.env): BudgetState {
  const limit = turnBudget(provider, env);
  const left = Math.max(0, limit - Math.max(0, used));
  return { limit, used, left, low: left <= LOW_TURNS, exhausted: left === 0 };
}

export class TurnBudgetError extends Error {
  constructor(readonly state: BudgetState) {
    super(`This lesson has used all ${state.limit} AI turns for this provider. Hints and your answers still work; grading and the teacher chat do not.`);
    this.name = "TurnBudgetError";
  }
}

/** Throws TurnBudgetError when `need` more turns would go over the budget. */
export function assertTurnsLeft(provider: TeacherProvider, used: number, need = 1, env: Env = process.env): BudgetState {
  const state = budgetState(provider, used, env);
  if (state.left < need) throw new TurnBudgetError(state);
  return state;
}

/** One line for the teacher's system message when turns run low. */
export function budgetNote(state: BudgetState): string {
  if (!state.low) return "";
  return `Only ${state.left} AI ${state.left === 1 ? "turn is" : "turns are"} left in this lesson. Give fewer, denser hints, and tell the contributor that turns are running low.`;
}
