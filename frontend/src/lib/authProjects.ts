export interface AuthUser {
  user_id: string;
  email: string;
  display_name: string;
  role: "user" | "admin";
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface ProjectSummary {
  project_id: string;
  owner_user_id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
  active_dataset_id?: string | null;
  schema_version: number;
}

export type AuthState =
  | { status: "loading"; user: null }
  | { status: "unauthenticated"; user: null }
  | { status: "authenticated"; user: AuthUser };

export interface SignedOutShellState {
  authState: Extract<AuthState, { status: "unauthenticated" }>;
  projects: ProjectSummary[];
  activeProjectId: null;
}

const ACTIVE_PROJECT_STORAGE_KEY = "bess-studio-active-project-id";
export const API_REQUEST_TIMEOUT_MS = 10_000;
export const API_REQUEST_TIMEOUT_MESSAGE =
  "The server did not respond within 10 seconds. Check the backend and database connection, then try again.";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

async function responsePayload(response: Response): Promise<unknown> {
  return response.status === 204 ? null : response.json().catch(() => null);
}

export async function fetchWithApiTimeout(
  input: string | URL | Request,
  init: RequestInit,
  fetchImpl: FetchLike = fetch,
  timeoutMs = API_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const suppliedSignal = init.signal;
  const abortFromSuppliedSignal = () => controller.abort();
  suppliedSignal?.addEventListener("abort", abortFromSuppliedSignal, { once: true });

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      fetchImpl(input, { ...init, signal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error(API_REQUEST_TIMEOUT_MESSAGE));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    suppliedSignal?.removeEventListener("abort", abortFromSuppliedSignal);
  }
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (Array.isArray(detail)) {
      const messages = detail
        .map((item) => item && typeof item === "object" && "msg" in item ? (item as { msg: unknown }).msg : null)
        .filter((message): message is string => typeof message === "string");
      if (messages.length > 0) return messages.join(" ");
    }
    if (typeof detail === "string") {
      if (detail.toLowerCase() === "authentication is temporarily unavailable.") {
        return "Cannot connect to the authentication service. Check the backend and database connection, then try again.";
      }
      return detail;
    }
  }
  return fallback;
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<T> {
  const response = await fetchWithApiTimeout(
    url,
    { credentials: "include", ...init },
    fetchImpl,
  );
  const payload = await responsePayload(response);
  if (!response.ok) throw new Error(errorMessage(payload, `Request failed with HTTP ${response.status}.`));
  return payload as T;
}

export async function restoreAuthenticatedUser(fetchImpl: FetchLike = fetch): Promise<AuthUser | null> {
  const response = await fetchWithApiTimeout("/api/auth/me", {
    headers: { Accept: "application/json" },
    credentials: "include",
  }, fetchImpl);
  if (response.status === 401 || response.status === 403) return null;
  const payload = await responsePayload(response);
  if (!response.ok) throw new Error(errorMessage(payload, "Authentication is unavailable."));
  return payload as AuthUser;
}

export function loginUser(email: string, password: string, fetchImpl: FetchLike = fetch): Promise<AuthUser> {
  return requestJson<AuthUser>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  }, fetchImpl);
}

export function registerUser(
  displayName: string,
  email: string,
  password: string,
  fetchImpl: FetchLike = fetch,
): Promise<AuthUser> {
  return requestJson<AuthUser>("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ display_name: displayName, email, password }),
  }, fetchImpl);
}

export async function logoutUser(fetchImpl: FetchLike = fetch): Promise<void> {
  await requestJson<null>("/api/auth/logout", { method: "POST" }, fetchImpl);
}

export function listProjects(fetchImpl: FetchLike = fetch): Promise<ProjectSummary[]> {
  return requestJson<ProjectSummary[]>("/api/projects", { headers: { Accept: "application/json" } }, fetchImpl);
}

export function getProject(projectId: string, fetchImpl: FetchLike = fetch): Promise<ProjectSummary> {
  return requestJson<ProjectSummary>(
    `/api/projects/${encodeURIComponent(projectId)}`,
    { headers: { Accept: "application/json" } },
    fetchImpl,
  );
}

export function createProject(
  name: string,
  description: string,
  fetchImpl: FetchLike = fetch,
): Promise<ProjectSummary> {
  return requestJson<ProjectSummary>("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ name, description: description.trim() || null }),
  }, fetchImpl);
}

export function updateProject(
  projectId: string,
  updates: { name?: string; description?: string | null; status?: "active" | "archived" },
  fetchImpl: FetchLike = fetch,
): Promise<ProjectSummary> {
  return requestJson<ProjectSummary>(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(updates),
  }, fetchImpl);
}

export function archiveProject(projectId: string, fetchImpl: FetchLike = fetch): Promise<ProjectSummary> {
  return requestJson<ProjectSummary>(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  }, fetchImpl);
}

export function getActiveProjectStorageKey(): string {
  return ACTIVE_PROJECT_STORAGE_KEY;
}

export function readActiveProjectId(storage: Storage | null): string | null {
  return storage?.getItem(ACTIVE_PROJECT_STORAGE_KEY) ?? null;
}

export function writeActiveProjectId(storage: Storage | null, projectId: string | null): void {
  if (!storage) return;
  if (projectId) storage.setItem(ACTIVE_PROJECT_STORAGE_KEY, projectId);
  else storage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
}

export function selectValidActiveProject(
  projects: ProjectSummary[],
  savedProjectId: string | null,
): ProjectSummary | null {
  return projects.find(
    (project) => project.project_id === savedProjectId && project.status === "active",
  ) ?? null;
}

export function createSignedOutShellState(): SignedOutShellState {
  return {
    authState: { status: "unauthenticated", user: null },
    projects: [],
    activeProjectId: null,
  };
}

export function projectListState(
  projects: ProjectSummary[],
  loading: boolean,
  error: string | null,
): "loading" | "error" | "empty" | "ready" {
  if (loading) return "loading";
  if (error) return "error";
  return projects.length === 0 ? "empty" : "ready";
}

export function replaceProject(projects: ProjectSummary[], changed: ProjectSummary): ProjectSummary[] {
  const existing = projects.some((project) => project.project_id === changed.project_id);
  const next = existing
    ? projects.map((project) => project.project_id === changed.project_id ? changed : project)
    : [changed, ...projects];
  return next.sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
}
