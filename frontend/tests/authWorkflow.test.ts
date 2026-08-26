import assert from "node:assert/strict";
import test from "node:test";

import { ACCOUNT_CREATED_MESSAGE, registrationCompletion } from "../src/lib/authWorkflow.ts";
import { authenticatedEntryPath, parseApplicationRoute } from "../src/lib/appRouting.ts";

test("successful registration transitions to login and preserves normalized email", () => {
  assert.deepEqual(registrationCompletion("  Researcher@Example.COM "), {
    mode: "login",
    email: "researcher@example.com",
    message: ACCOUNT_CREATED_MESSAGE,
  });
});

test("successful registration provides clear sign-in guidance", () => {
  assert.equal(ACCOUNT_CREATED_MESSAGE, "Account created successfully. Sign in to continue.");
});

test("authenticated login and registration routes continue to My Projects", () => {
  assert.equal(authenticatedEntryPath(parseApplicationRoute("/login")), "/projects");
  assert.equal(authenticatedEntryPath(parseApplicationRoute("/register")), "/projects");
  assert.equal(authenticatedEntryPath(parseApplicationRoute("/")), null);
});
