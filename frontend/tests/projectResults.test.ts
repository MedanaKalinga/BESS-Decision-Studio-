import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseApplicationRoute, projectApplicationPath } from "../src/lib/appRouting.ts";
import { listProjectOptimizationRuns } from "../src/lib/projectOptimizationRuns.ts";

test("project Results is a direct authenticated project route", () => {
  assert.equal(projectApplicationPath("project-a", "results"), "/projects/project-a/results");
  assert.deepEqual(parseApplicationRoute("/projects/project-a/results"), {
    kind: "project",
    projectId: "project-a",
    surface: "results",
  });
});

test("saved optimization history uses the owner-scoped API with credentials", async () => {
  let requestUrl = "";
  let requestCredentials: RequestCredentials | undefined;
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    requestUrl = String(input);
    requestCredentials = init?.credentials;
    return new Response(JSON.stringify([{ run_id: "run-1", job_id: "run-1", project_id: "project-a", dataset_id: "dataset-a", mode: "single", lifecycle_status: "completed", scientific_status: "feasible_solution", submitted_configuration: null, result: null, created_at: null, completed_at: null, updated_at: null, error: null }]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const runs = await listProjectOptimizationRuns("project-a", "single", fetchImpl as typeof fetch);
  assert.equal(requestUrl, "/api/projects/project-a/optimization-runs?limit=50&mode=single");
  assert.equal(requestCredentials, "include");
  assert.equal(runs.length, 1);
});

test("Results hub separates Single GA runs from Decision results", () => {
  const source = readFileSync(new URL("../src/pages/ProjectResultsPage.tsx", import.meta.url), "utf8");
  assert.match(source, /Single GA Runs/);
  assert.match(source, /Decision Results/);
  assert.match(source, /effectiveRuns\.map/);
  assert.match(source, /Open Detailed Decision Results/);
});

test("Single run hides normal penalized fitness and convergence panels", () => {
  const source = readFileSync(new URL("../src/pages/SingleOptimizationRun.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Current best penalized fitness/);
  assert.equal((source.match(/<ConvergenceChart/g) ?? []).length, 0);
  assert.match(source, /View Project Results/);
});

test("Operational Profiles and Comparison progress use dark surfaces", () => {
  const profiles = readFileSync(new URL("../src/pages/OperationalProfiles.tsx", import.meta.url), "utf8");
  const comparison = readFileSync(new URL("../src/pages/ComparisonOptimizationPage.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(profiles, /linear-gradient\(120deg, #f0fdfa, #eff6ff 70%, #fff\)/);
  assert.doesNotMatch(profiles, /linear-gradient\(145deg, #fff, #f8fbfc\)/);
  assert.match(profiles, /bgcolor: "#0D1D2D"/);
  assert.doesNotMatch(comparison, /background: "linear-gradient\(120deg,#f0fdfa,#eff6ff\)"/);
  assert.match(comparison, /bgcolor: "rgba\(255,255,255,\.025\)"/);
});
