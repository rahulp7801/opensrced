import { test } from "node:test";
import assert from "node:assert/strict";
import { INTERESTS, OnboardingInputError, parseOnboarding } from "../onboarding";

test("valid answers are kept, trimmed and de-duplicated", () => {
  assert.deepEqual(parseOnboarding({}), {});
  assert.deepEqual(parseOnboarding({ languages: [], interests: [] }), { languages: [], interests: [] });
  assert.deepEqual(
    parseOnboarding({ languages: [" Python ", "python", "C++", "C#", "Objective-C"], interests: ["Tests", "Tests", INTERESTS[0]], experience: "some" }),
    { languages: ["Python", "C++", "C#", "Objective-C"], interests: ["Tests", INTERESTS[0]], experience: "some" },
  );
  for (const experience of ["new", "some", "regular"]) assert.equal(parseOnboarding({ experience }).experience, experience);
});

test("anything else is refused", () => {
  const bad: unknown[] = [
    null, undefined, "x", 1, [], [{}],
    { languages: "Python" },
    { languages: [""] },
    { languages: ["   "] },
    { languages: [1] },
    { languages: ["a".repeat(41)] },
    { languages: ["Py<script>"] },
    { languages: Array.from({ length: 31 }, (_, i) => `L${i}`) },
    { interests: ["Crypto"] },
    { interests: [null] },
    { experience: "expert" },
    { experience: null },
    { experience: 2 },
    { level: 3 },
    { languages: [], admin: true },
  ];
  for (const body of bad) assert.throws(() => parseOnboarding(body), OnboardingInputError, JSON.stringify(body));
});

test("the limits are inclusive", () => {
  assert.equal(parseOnboarding({ languages: Array.from({ length: 30 }, (_, i) => `L${i}`) }).languages?.length, 30);
  assert.equal(parseOnboarding({ languages: ["a".repeat(40)] }).languages?.[0].length, 40);
});
