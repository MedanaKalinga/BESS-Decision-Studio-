export interface ProjectDatasetRecord {
  dataset_id: string;
  project_id: string;
  filename: string;
  label: string | null;
  uploaded_at: string;
  last_used_at: string | null;
  row_count: number;
  start_date: string;
  end_date: string;
  summary: Record<string, number>;
  detected_columns?: {
    timestamp?: string | null;
    pv?: string;
    ev?: string;
    tariff?: string | null;
  } | null;
  fingerprint?: string | null;
  status: string;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function listProjectDatasets(projectId: string, fetchImpl: FetchLike = fetch): Promise<ProjectDatasetRecord[]> {
  const response = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}/datasets`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const detail = payload && typeof payload === "object" && "detail" in payload
      ? (payload as { detail: unknown }).detail
      : null;
    throw new Error(typeof detail === "string" ? detail : `Project datasets request failed with HTTP ${response.status}.`);
  }
  const value: unknown = await response.json();
  return Array.isArray(value) ? value as ProjectDatasetRecord[] : [];
}

export async function activateProjectDataset(projectId: string, datasetId: string, fetchImpl: FetchLike = fetch): Promise<void> {
  const response = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(datasetId)}/active`, {
    method: "PUT",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Dataset could not be activated.");
}

export async function removeProjectDataset(projectId: string, datasetId: string, fetchImpl: FetchLike = fetch): Promise<void> {
  const response = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(datasetId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Dataset could not be removed from the project.");
}
