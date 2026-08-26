import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveProject,
  getProject,
  restoreAuthenticatedUser,
  type ProjectSummary,
} from "../src/lib/authProjects.ts";
import {
  parseApplicationRoute,
  projectApplicationPath,
} from "../src/lib/appRouting.ts";
import {
  comparisonRunEndpoint,
  createDefaultComparisonConfiguration,
  mapComparisonRunRequest,
  validateComparisonConfiguration,
} from "../src/lib/comparisonOptimization.ts";
import { fetchDatasetDay } from "../src/lib/datasetWorkspace.ts";
import {
  listProjectDatasets,
  type ProjectDatasetRecord,
} from "../src/lib/projectDatasets.ts";
import {
  getProjectAHPState,
  getProjectPrometheeState,
  getProjectWorkspace,
  ProjectWorkspaceRevisionConflictError,
  saveProjectWorkspace,
} from "../src/lib/projectWorkspacePersistence.ts";
import {
  projectDatasetToWorkspace,
  resolveActiveProjectDataset,
} from "../src/lib/projectWorkflow.ts";

const project: ProjectSummary = {
  project_id: "22222222-2222-4222-8222-222222222222",
  owner_user_id: "11111111-1111-4111-8111-111111111111",
  name: "Campus BESS",
  description: null,
  status: "active",
  created_at: "2026-07-20T00:00:00Z",
  updated_at: "2026-07-20T00:00:00Z",
  last_opened_at: null,
  active_dataset_id: "33333333-3333-4333-8333-333333333333",
  schema_version: 1,
};

const datasetRecord: ProjectDatasetRecord = {
  dataset_id: "33333333-3333-4333-8333-333333333333",
  project_id: project.project_id,
  filename: "annual.csv",
  label: "Annual",
  uploaded_at: "2026-07-20T00:00:00Z",
  last_used_at: null,
  row_count: 35_040,
  start_date: "2025-01-01",
  end_date: "2025-12-31",
  summary: {
    annual_pv_energy_kwh: 7_200_000,
    annual_ev_energy_kwh: 8_900_000,
    pv_peak_kw: 1_240,
    ev_peak_kw: 1_510,
  },
  detected_columns: { timestamp: "timestamp", pv: "pv_kw", ev: "ev_kw", tariff: null },
  status: "ready",
};

const batteries = ["Low-cost", "Medium-low"].map((name, index) => ({
  name,
  price_rs_per_kwh: 44_000 + index * 4_000,
  rated_cycle_life: 3_000 + index * 500,
  eta_ch: 0.92,
  eta_dis: 0.92,
  weight_density_kg_per_kwh: 8.5,
  warranty_years: 5,
}));

test("Open Project maps directly to the selected project URL", () => {
  const path = projectApplicationPath(project.project_id);
  assert.equal(path, `/projects/${project.project_id}`);
  assert.deepEqual(parseApplicationRoute(path), {
    kind: "project",
    projectId: project.project_id,
    surface: "dashboard",
  });
});

test("public, project-list, and authentication routes are stable", () => {
  assert.deepEqual(parseApplicationRoute("/"), { kind: "landing" });
  assert.deepEqual(parseApplicationRoute("/login"), { kind: "login" });
  assert.deepEqual(parseApplicationRoute("/register"), { kind: "register" });
  assert.deepEqual(parseApplicationRoute("/projects"), { kind: "projects" });
});

test("project workspace pages have stable refresh-safe URLs", () => {
  const datasetPath = projectApplicationPath(project.project_id, "dataset");
  const dispatchPath = projectApplicationPath(project.project_id, "dispatch");
  assert.equal(datasetPath, `/projects/${project.project_id}/dataset`);
  assert.equal(dispatchPath, `/projects/${project.project_id}/dispatch`);
  assert.deepEqual(parseApplicationRoute(datasetPath), {
    kind: "project",
    projectId: project.project_id,
    surface: "dataset",
  });
  assert.deepEqual(parseApplicationRoute(dispatchPath), {
    kind: "project",
    projectId: project.project_id,
    surface: "dispatch",
  });
});

test("project authorization request includes the session cookie", async () => {
  let url = "";
  let credentials: RequestCredentials | undefined;
  const restored = await getProject(project.project_id, async (input, init) => {
    url = String(input);
    credentials = init?.credentials;
    return new Response(JSON.stringify(project), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  assert.equal(url, `/api/projects/${project.project_id}`);
  assert.equal(credentials, "include");
  assert.equal(restored.project_id, project.project_id);
});

test("empty project workspace hydrates successfully", async () => {
  const snapshot = await getProjectWorkspace(project.project_id, async (_input, init) => {
    assert.equal(init?.credentials, "include");
    return new Response(JSON.stringify({
      project_id: project.project_id,
      schema_version: 1,
      revision: 0,
      created_at: "2026-07-20T00:00:00Z",
      updated_at: "2026-07-20T00:00:00Z",
      state: { version: 1, projectId: project.project_id, activeDatasetId: null },
      persistence_status: "available",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  assert.equal(snapshot.revision, 0);
});

test("project hydration can recover dedicated accepted AHP and PROMETHEE state", async () => {
  const requested: string[] = [];
  const fetchState = async (input: string | URL | Request, init?: RequestInit) => {
    requested.push(String(input));
    assert.equal(init?.credentials, "include");
    return new Response(JSON.stringify({ accepted: true, revision: 7 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  assert.equal((await getProjectAHPState(project.project_id, fetchState)).accepted, true);
  assert.equal((await getProjectPrometheeState(project.project_id, fetchState)).revision, 7);
  assert.deepEqual(requested, [
    `/api/projects/${project.project_id}/ahp-state`,
    `/api/projects/${project.project_id}/promethee-state`,
  ]);
});

test("missing projected scientific state is an empty state and revision conflicts are typed", async () => {
  assert.equal(await getProjectAHPState(
    project.project_id,
    async () => new Response(null, { status: 404 }),
  ), null);
  await assert.rejects(
    saveProjectWorkspace(
      project.project_id,
      { version: 1, projectId: project.project_id } as never,
      3,
      async () => new Response(null, { status: 409 }),
    ),
    ProjectWorkspaceRevisionConflictError,
  );
});

test("project dataset metadata reconstructs the canonical active dataset", () => {
  const restored = resolveActiveProjectDataset(project, [datasetRecord], null, null);
  assert.equal(restored?.datasetId, datasetRecord.dataset_id);
  assert.equal(restored?.annualPvEnergyKwh, 7_200_000);
  assert.equal(restored?.datasetType, "normal_year");
});

test("switching projects cannot reuse another project's dataset", () => {
  const projectB = { ...project, project_id: "44444444-4444-4444-8444-444444444444", active_dataset_id: null };
  const workspaceDataset = projectDatasetToWorkspace(datasetRecord);
  assert.equal(resolveActiveProjectDataset(projectB, [], workspaceDataset, null), null);
});

test("project dataset list request includes credentials", async () => {
  let credentials: RequestCredentials | undefined;
  const result = await listProjectDatasets(project.project_id, async (_input, init) => {
    credentials = init?.credentials;
    return new Response(JSON.stringify([datasetRecord]), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  assert.equal(credentials, "include");
  assert.equal(result[0].dataset_id, datasetRecord.dataset_id);
});

test("selected day refetch uses the project-scoped endpoint and restores graph points", async () => {
  let requestedUrl = "";
  const day = await fetchDatasetDay(datasetRecord.dataset_id, "2025-06-12", undefined, async (input, init) => {
    requestedUrl = String(input);
    assert.equal(init?.credentials, "include");
    return new Response(JSON.stringify({
      dataset_id: datasetRecord.dataset_id,
      date: "2025-06-12",
      interval_minutes: 15,
      points: [{ timestamp: "2025-06-12T00:00:00", pv_kw: 1, ev_kw: 2, tariff_rs_per_kwh: null }],
      summary: { pv_energy_kwh: 0.25, ev_energy_kwh: 0.5, surplus_energy_kwh: 0, deficit_energy_kwh: 0.25, pv_peak_kw: 1, ev_peak_kw: 2 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }, project.project_id);
  assert.equal(requestedUrl, `/api/projects/${project.project_id}/datasets/${datasetRecord.dataset_id}/day?date=2025-06-12`);
  assert.equal(day.points.length, 1);
});

test("archive uses authenticated DELETE and returns archived status", async () => {
  let method = "";
  let credentials: RequestCredentials | undefined;
  const archived = await archiveProject(project.project_id, async (_input, init) => {
    method = String(init?.method);
    credentials = init?.credentials;
    return new Response(JSON.stringify({ ...project, status: "archived" }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  assert.equal(method, "DELETE");
  assert.equal(credentials, "include");
  assert.equal(archived.status, "archived");
});

test("comparison request carries the current dataset through the project endpoint", () => {
  const dataset = projectDatasetToWorkspace(datasetRecord);
  const configuration = createDefaultComparisonConfiguration(batteries);
  const request = mapComparisonRunRequest(configuration, dataset, { status: "Reference Strategy", periods: [] });
  assert.equal(comparisonRunEndpoint(project.project_id), `/api/projects/${project.project_id}/comparison-optimization/run`);
  assert.equal(request.dataset_id, datasetRecord.dataset_id);
  assert.equal(request.batteries.length, 2);
});

test("comparison is blocked without an active dataset or when it is expired", () => {
  const configuration = createDefaultComparisonConfiguration(batteries);
  const dispatch = { status: "Reference Strategy" as const, periods: [] };
  assert.match(validateComparisonConfiguration(configuration, null, dispatch).join(" "), /active dataset/i);
  const expired = { ...projectDatasetToWorkspace(datasetRecord), status: "expired" as const };
  assert.match(validateComparisonConfiguration(configuration, expired, dispatch).join(" "), /unavailable/i);
});

test("auth me 401 remains the normal logged-out state", async () => {
  const restored = await restoreAuthenticatedUser(async () => new Response(null, { status: 401 }));
  assert.equal(restored, null);
});
