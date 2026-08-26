import type { WorkspaceDatasetSummary } from "../types/workspace";

export interface DatasetDayPoint {
  timestamp: string;
  pv_kw: number;
  ev_kw: number;
  tariff_rs_per_kwh: number | null;
}

export interface DatasetDayResponse {
  dataset_id: string;
  date: string;
  interval_minutes: number;
  points: DatasetDayPoint[];
  summary: {
    pv_energy_kwh: number;
    ev_energy_kwh: number;
    surplus_energy_kwh: number;
    deficit_energy_kwh: number;
    pv_peak_kw: number;
    ev_peak_kw: number;
  };
}

export const DATASET_EXPIRED_MESSAGE =
  "The backend dataset is no longer available. Upload the dataset again.";

export class DatasetExpiredError extends Error {
  constructor() {
    super(DATASET_EXPIRED_MESSAGE);
    this.name = "DatasetExpiredError";
  }
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function sanitizeWorkspaceDataset(value: unknown): WorkspaceDatasetSummary | null {
  if (!value || typeof value !== "object") return null;
  const dataset = value as Partial<WorkspaceDatasetSummary>;
  if (
    typeof dataset.datasetId !== "string"
    || typeof dataset.filename !== "string"
    || !finiteNumber(dataset.rowCount)
    || typeof dataset.datasetType !== "string"
    || typeof dataset.startDate !== "string"
    || typeof dataset.endDate !== "string"
    || !finiteNumber(dataset.annualPvEnergyKwh)
    || !finiteNumber(dataset.annualEvEnergyKwh)
  ) return null;

  const columns = dataset.detectedColumns;
  return {
    datasetId: dataset.datasetId,
    filename: dataset.filename,
    rowCount: dataset.rowCount,
    datasetType: dataset.datasetType,
    status: dataset.status === "expired" ? "expired" : "ready",
    startDate: dataset.startDate,
    endDate: dataset.endDate,
    annualPvEnergyKwh: dataset.annualPvEnergyKwh,
    annualEvEnergyKwh: dataset.annualEvEnergyKwh,
    pvPeakKw: finiteNumber(dataset.pvPeakKw) ? dataset.pvPeakKw : 0,
    evPeakKw: finiteNumber(dataset.evPeakKw) ? dataset.evPeakKw : 0,
    intervalMinutes: finiteNumber(dataset.intervalMinutes) ? dataset.intervalMinutes : 15,
    durationDays: finiteNumber(dataset.durationDays) ? dataset.durationDays : null,
    timestampsGenerated: dataset.timestampsGenerated === true,
    notice: typeof dataset.notice === "string" ? dataset.notice : null,
    detectedColumns: {
      timestamp: typeof columns?.timestamp === "string" ? columns.timestamp : null,
      pv: typeof columns?.pv === "string" ? columns.pv : "PV",
      ev: typeof columns?.ev === "string" ? columns.ev : "EV",
      tariff: typeof columns?.tariff === "string" ? columns.tariff : null,
    },
  };
}

export function resolveDatasetExplorerDate(
  dataset: WorkspaceDatasetSummary | null,
  savedDate: string | null,
): string | null {
  if (!dataset) return null;
  if (savedDate && savedDate >= dataset.startDate && savedDate <= dataset.endDate) return savedDate;
  return dataset.startDate;
}

function isDatasetDayResponse(value: unknown): value is DatasetDayResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DatasetDayResponse>;
  return typeof candidate.dataset_id === "string"
    && typeof candidate.date === "string"
    && finiteNumber(candidate.interval_minutes)
    && Array.isArray(candidate.points)
    && candidate.points.every((point) => Boolean(point)
      && typeof point === "object"
      && typeof point.timestamp === "string"
      && finiteNumber(point.pv_kw)
      && finiteNumber(point.ev_kw))
    && Boolean(candidate.summary);
}

export async function fetchDatasetDay(
  datasetId: string,
  date: string,
  signal?: AbortSignal,
  request: typeof fetch = fetch,
  projectId?: string,
): Promise<DatasetDayResponse> {
  const endpoint = projectId
    ? `/api/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(datasetId)}/day`
    : `/api/datasets/${encodeURIComponent(datasetId)}/day`;
  const response = await request(
    `${endpoint}?date=${encodeURIComponent(date)}`,
    { credentials: "include", headers: { Accept: "application/json" }, signal },
  );
  const payload: unknown = await response.json().catch(() => null);
  if (response.status === 404) throw new DatasetExpiredError();
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "detail" in payload
      ? (payload as { detail: unknown }).detail
      : null;
    throw new Error(typeof detail === "string" ? detail : `Day data request failed with HTTP ${response.status}.`);
  }
  if (!isDatasetDayResponse(payload)) {
    throw new Error("The backend returned an unexpected day-data format.");
  }
  return payload;
}
