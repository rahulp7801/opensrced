import { test } from "node:test";
import assert from "node:assert/strict";
import { hasAccess, invitedGithubIds, inviteOnly } from "../access";

function withAccess<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.OPENSRCER_ACCESS;
  if (value === undefined) delete process.env.OPENSRCER_ACCESS;
  else process.env.OPENSRCER_ACCESS = value;
  try { return run(); }
  finally {
    if (previous === undefined) delete process.env.OPENSRCER_ACCESS;
    else process.env.OPENSRCER_ACCESS = previous;
  }
}

test("the app is open unless OPENSRCER_ACCESS is exactly 'invite'", () => {
  for (const value of [undefined, "", "open", "Invite", "invite "]) {
    withAccess(value, () => {
      assert.equal(inviteOnly(), false, String(value));
      assert.equal(hasAccess("github|1", new Set()), true, String(value));
      assert.equal(hasAccess(undefined, new Set()), true, String(value));
    });
  }
  withAccess("invite", () => assert.equal(inviteOnly(), true));
});

test("invites are numeric GitHub ids, written bare or as Auth0 subjects", () => {
  assert.deepEqual([...invitedGithubIds("76501505, github|42\n7 octocat github|x 1e3 ")].sort(), ["42", "7", "76501505"]);
  assert.deepEqual([...invitedGithubIds("")], []);
});

test("in invite mode only invited GitHub subjects pass, and an empty list admits nobody", () => {
  withAccess("invite", () => {
    const invited = invitedGithubIds("76501505");
    assert.equal(hasAccess("github|76501505", invited), true);
    for (const sub of ["github|765015050", "github|7650150", "google-oauth2|76501505", "76501505", "github|76501505 ", "", null, undefined]) {
      assert.equal(hasAccess(sub, invited), false, String(sub));
    }
    assert.equal(hasAccess("github|76501505", invitedGithubIds("")), false, "fails closed");
  });
});
