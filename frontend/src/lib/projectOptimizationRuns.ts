import type {
  ComparisonOptimizationFinalResult,
  SingleOptimizationFinalResult,
} from "../types/workspace";

export interface ProjectOptimizationRun {
  run_id: string;
  job_id: string;
  project_id: string;
  dataset_id: string | null;
  mode: "single" | "comparison";
  lifecycle_status: string;
  scientific_status: string | null;
  submitted_configuration: Record<string, unknown> | null;
  result: SingleOptimizationFinalResult | ComparisonOptimizationFinalResult | null;
  created_at: number | string | null;
  completed_at: number | string | null;
  updated_at: number | string | null;
  error: Record<string, unknown> | string | null;
}

type FetchLike = typeof fetch;

export async function listProjectOptimizationRuns(
  projectId: string,
  mode?: "single" | "comparison",
  fetchImpl: FetchLike = fetch,
): Promise<ProjectOptimizationRun[]> {
  const query = new URLSearchParams({ limit: "50" });
  if (mode) query.set("mode", mode);
  const response = await fetchImpl(
    `/api/projects/${encodeURIComponent(projectId)}/optimization-runs?${query.toString()}`,
    { credentials: "include", headers: { Accept: "application/json" } },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
    throw new Error(typeof payload?.detail === "string" ? payload.detail : `Results could not be loaded (HTTP ${response.status}).`);
  }
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("The results service returned an invalid response.");
  return payload as ProjectOptimizationRun[];
}

export function isSingleRunResult(
  result: ProjectOptimizationRun["result"],
): result is SingleOptimizationFinalResult {
  return Boolean(result && "battery_name" in result && "best_bess_capacity_kwh" in result && "solution_status" in result);
}

export function formatRunTimestamp(value: number | string | null): string {
  if (value == null) return "Date unavailable";
  const date = new Date(typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString("en-LK");
}
