import { test } from "node:test";
import assert from "node:assert/strict";
import { assertTurnsLeft, budgetNote, budgetState, DEFAULT_TURNS, LOW_TURNS, turnBudget, TurnBudgetError } from "../lesson/budget";

test("each provider has a budget, Copilot Free's the smallest; env knobs override valid values only", () => {
  assert.equal(turnBudget("copilot", {}), 15);
  assert.ok(DEFAULT_TURNS.copilot < DEFAULT_TURNS["anthropic-key"]);
  assert.equal(turnBudget("copilot", { OPENSRCER_LESSON_TURNS_COPILOT: "20" }), 20);
  assert.equal(turnBudget("anthropic-key", { OPENSRCER_LESSON_TURNS_ANTHROPIC: "90" }), 90);
  assert.equal(turnBudget("openrouter-key", { OPENSRCER_LESSON_TURNS_OPENROUTER: "5" }), 5);
  for (const bad of ["0", "-3", "1.5", "lots", "100000"]) assert.equal(turnBudget("copilot", { OPENSRCER_LESSON_TURNS_COPILOT: bad }), 15, bad);
});

test("the state says how many are left and when to go dense", () => {
  assert.deepEqual(budgetState("copilot", 0, {}), { limit: 15, used: 0, left: 15, low: false, exhausted: false });
  assert.equal(budgetState("copilot", 15 - LOW_TURNS, {}).low, true);
  assert.deepEqual(budgetState("copilot", 99, {}), { limit: 15, used: 99, left: 0, low: true, exhausted: true });
  assert.equal(budgetState("copilot", -4, {}).left, 15, "a negative count cannot add turns");
  assert.equal(budgetNote(budgetState("copilot", 0, {})), "");
  assert.match(budgetNote(budgetState("copilot", 13, {})), /Only 2 AI turns are left/);
  assert.match(budgetNote(budgetState("copilot", 14, {})), /Only 1 AI turn is left/);
});

test("assertTurnsLeft refuses a call that would go over", () => {
  assert.equal(assertTurnsLeft("copilot", 13, 2, {}).left, 2);
  assert.throws(() => assertTurnsLeft("copilot", 14, 2, {}), TurnBudgetError);
  assert.throws(() => assertTurnsLeft("copilot", 15, 1, {}), (e: TurnBudgetError) => e.state.exhausted && /used all 15 AI turns/.test(e.message));
});
