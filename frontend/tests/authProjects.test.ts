import assert from "node:assert/strict";
import test from "node:test";

import {
  createProject,
  createSignedOutShellState,
  fetchWithApiTimeout,
  getActiveProjectStorageKey,
  listProjects,
  projectListState,
  readActiveProjectId,
  registerUser,
  restoreAuthenticatedUser,
  selectValidActiveProject,
  writeActiveProjectId,
  type AuthUser,
  type ProjectSummary,
} from "../src/lib/authProjects.ts";

const user: AuthUser = {
  user_id: "11111111-1111-4111-8111-111111111111",
  email: "researcher@example.com",
  display_name: "Researcher",
  role: "user",
  is_active: true,
  created_at: "2026-07-20T00:00:00Z",
  updated_at: "2026-07-20T00:00:00Z",
  last_login_at: null,
};

const project: ProjectSummary = {
  project_id: "22222222-2222-4222-8222-222222222222",
  owner_user_id: user.user_id,
  name: "Campus BESS",
  description: "Research project",
  status: "active",
  created_at: "2026-07-20T00:00:00Z",
  updated_at: "2026-07-20T01:00:00Z",
  last_opened_at: null,
  schema_version: 1,
};

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

test("unauthenticated session restoration returns the login state", async () => {
  const restored = await restoreAuthenticatedUser(async () => new Response(null, { status: 401 }));
  assert.equal(restored, null);
});

test("successful session restoration uses the HttpOnly cookie session", async () => {
  let credentials: RequestCredentials | undefined;
  const restored = await restoreAuthenticatedUser(async (_input, init) => {
    credentials = init?.credentials;
    return new Response(JSON.stringify(user), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  assert.deepEqual(restored, user);
  assert.equal(credentials, "include");
});

test("authentication service failures provide an actionable connection message", async () => {
  await assert.rejects(
    restoreAuthenticatedUser(async () => new Response(
      JSON.stringify({ detail: "Authentication is temporarily unavailable." }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    )),
    /Check the backend and database connection/,
  );
});

test("a stalled authentication request ends with a visible timeout error", async () => {
  await assert.rejects(
    fetchWithApiTimeout(
      "/api/auth/login",
      { method: "POST", credentials: "include" },
      async () => new Promise<Response>(() => undefined),
      5,
    ),
    /server did not respond.*backend and database connection/i,
  );
});

test("registration validation errors expose the backend field message", async () => {
  await assert.rejects(
    registerUser("Researcher", "researcher@example.com", "short", async () => new Response(
      JSON.stringify({ detail: [{ loc: ["body", "password"], msg: "String should have at least 8 characters", type: "string_too_short" }] }),
      { status: 422, headers: { "Content-Type": "application/json" } },
    )),
    /at least 8 characters/,
  );
});

test("logout state removes authenticated UI data", () => {
  assert.deepEqual(createSignedOutShellState(), {
    authState: { status: "unauthenticated", user: null },
    projects: [],
    activeProjectId: null,
  });
});

test("project list response maps directly to owned project cards", async () => {
  const projects = await listProjects(async () =>
    new Response(JSON.stringify([project]), { status: 200, headers: { "Content-Type": "application/json" } }));
  assert.equal(projects[0].name, "Campus BESS");
  assert.equal(projects[0].owner_user_id, user.user_id);
  assert.equal(projectListState(projects, false, null), "ready");
});

test("create project sends only name and optional description", async () => {
  let submitted: unknown;
  const created = await createProject("Campus BESS", "Research project", async (_input, init) => {
    submitted = JSON.parse(String(init?.body));
    return new Response(JSON.stringify(project), { status: 201, headers: { "Content-Type": "application/json" } });
  });
  assert.deepEqual(submitted, { name: "Campus BESS", description: "Research project" });
  assert.equal(created.project_id, project.project_id);
});

test("active project selection persists only a lightweight project ID", () => {
  const storage = memoryStorage();
  writeActiveProjectId(storage, project.project_id);
  const saved = readActiveProjectId(storage);
  assert.equal(saved, project.project_id);
  assert.equal(storage.getItem(getActiveProjectStorageKey()), project.project_id);
  assert.equal(selectValidActiveProject([project], saved)?.project_id, project.project_id);
  assert.equal(selectValidActiveProject([{ ...project, status: "archived" }], saved), null);
});

test("no projects produces the clean empty state", () => {
  assert.equal(projectListState([], false, null), "empty");
});
