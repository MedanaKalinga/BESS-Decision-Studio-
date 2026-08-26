import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  LANDING_WORKFLOW_STEPS,
  authModeForLandingAction,
  openWorkspaceDestination,
  shouldShowPublicLanding,
} from "../src/lib/landingRouting.ts";
import { createSignedOutShellState, type ProjectSummary } from "../src/lib/authProjects.ts";

const activeProject: ProjectSummary = {
  project_id: "project-a",
  owner_user_id: "user-a",
  name: "Campus BESS",
  description: null,
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  last_opened_at: null,
  schema_version: 1,
};

test("unauthenticated root uses the public landing surface", () => {
  assert.equal(shouldShowPublicLanding("unauthenticated", "landing"), true);
  assert.equal(shouldShowPublicLanding("unauthenticated", "app"), true);
});

test("the internal application shell is available only to authenticated users", () => {
  assert.equal(shouldShowPublicLanding("authenticated", "app"), false);
  assert.equal(shouldShowPublicLanding("loading", "app"), true);
});

test("Login opens login mode", () => {
  assert.equal(authModeForLandingAction("login"), "login");
});

test("Sign Up opens registration mode", () => {
  assert.equal(authModeForLandingAction("sign-up"), "register");
});

test("Get Started opens registration mode", () => {
  assert.equal(authModeForLandingAction("get-started"), "register");
});

test("authenticated landing remains public until Open Workspace is selected", () => {
  assert.equal(shouldShowPublicLanding("authenticated", "landing"), true);
});

test("Open Workspace restores a valid active project", () => {
  assert.deepEqual(openWorkspaceDestination([activeProject], "project-a"), {
    page: "Dashboard",
    projectId: "project-a",
  });
});

test("Open Workspace falls back to My Projects without a valid active project", () => {
  assert.deepEqual(openWorkspaceDestination([activeProject], "missing"), {
    page: "My Projects",
    projectId: null,
  });
});

test("logout clears authenticated shell state for the landing page", () => {
  const state = createSignedOutShellState();
  assert.equal(state.authState.status, "unauthenticated");
  assert.equal(state.activeProjectId, null);
  assert.deepEqual(state.projects, []);
});

test("workflow wording keeps GA sizing, AHP weighting, and PROMETHEE ranking separate", () => {
  const ga = LANDING_WORKFLOW_STEPS.find((step) => step.title.includes("GA"));
  const ahp = LANDING_WORKFLOW_STEPS.find((step) => step.title.includes("AHP"));
  const promethee = LANDING_WORKFLOW_STEPS.find((step) => step.title.includes("PROMETHEE"));
  assert.equal(LANDING_WORKFLOW_STEPS.length, 5);
  assert.match(ga?.detail ?? "", /GA optimizes each battery alternative/);
  assert.match(ahp?.detail ?? "", /AHP determines the five decision-criterion weights/);
  assert.match(promethee?.detail ?? "", /PROMETHEE II ranks feasible GA-optimized alternatives/);
});

test("landing cards keep a semantic heading hierarchy", () => {
  const source = readFileSync(new URL("../src/pages/LandingPage.tsx", import.meta.url), "utf8");

  assert.match(source, /component="h3"\s+variant="subtitle1"/);
  assert.match(source, /component="h3"\s+variant="h6"/);
  assert.match(source, /component="span"\s+variant="subtitle2"/);
});

test("landing hero uses an aligned indicator grid without a loading-line animation", () => {
  const source = readFileSync(new URL("../src/pages/LandingPage.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /energyPulse/);
  assert.match(source, /gridTemplateColumns: \{ xs: "repeat\(2, minmax\(0, 1fr\)\)", sm: "repeat\(4, minmax\(0, 1fr\)\)" \}/);
  assert.match(source, /placeItems: "center"/);
});

test("authentication dialog has a concise label and ordered form heading", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const authSource = readFileSync(new URL("../src/pages/AuthPage.tsx", import.meta.url), "utf8");

  assert.match(appSource, /<DialogTitle[^>]*component="div"/);
  assert.match(appSource, /id="authentication-dialog-title"[^>]*component="h2"/);
  assert.match(authSource, /component=\{embedded \? "h3" : "h1"\}/);
});
