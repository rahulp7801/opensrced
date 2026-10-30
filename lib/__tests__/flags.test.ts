import { test } from "node:test";
import assert from "node:assert/strict";
import { FLAGS, flagEnabled, type Flag } from "../flags";

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally { process.env = saved; }
}

const flags = Object.keys(FLAGS) as Flag[];

test("every flag is off by default and for anything but exactly 1", () => {
  for (const flag of flags) {
    for (const value of [undefined, "", "0", "true", "yes", " 1", "on"]) {
      assert.equal(withEnv({ [FLAGS[flag]]: value }, () => flagEnabled(flag)), false, `${flag}=${String(value)}`);
    }
  }
});

test("each flag turns on with its own env var only", () => {
  for (const flag of flags) {
    const on = withEnv({ ...Object.fromEntries(Object.values(FLAGS).map((name) => [name, undefined])), [FLAGS[flag]]: "1" }, () => flags.filter(flagEnabled));
    assert.deepEqual(on, [flag]);
  }
});

test("the env var names are the ones in the plan", () => {
  assert.deepEqual(Object.values(FLAGS).sort(), ["OPENSRCER_ENV_RECIPES", "OPENSRCER_FORK_CI", "OPENSRCER_IDE", "OPENSRCER_LESSONS", "OPENSRCER_LEVELS"]);
});

test("an unknown flag throws instead of reading as off", () => {
  for (const bad of ["nope", "toString", ""]) assert.throws(() => flagEnabled(bad as Flag), /Unknown feature flag/, bad);
});
