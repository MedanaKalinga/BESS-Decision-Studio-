import type { ProjectSummary } from "./authProjects.ts";
import type { ProjectDatasetRecord } from "./projectDatasets.ts";
import type { WorkspaceDatasetSummary } from "../types/workspace.ts";

const numberValue = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export function projectDatasetToWorkspace(
  record: ProjectDatasetRecord,
): WorkspaceDatasetSummary {
  const columns = record.detected_columns;
  const durationDays = record.row_count > 0 && record.row_count % 96 === 0
    ? record.row_count / 96
    : null;
  const datasetType = record.row_count === 35_040
    ? "normal_year"
    : record.row_count === 35_136
      ? "leap_year"
      : "partial";
  return {
    datasetId: record.dataset_id,
    filename: record.filename,
    rowCount: record.row_count,
    datasetType,
    status: record.status === "expired" ? "expired" : "ready",
    startDate: record.start_date,
    endDate: record.end_date,
    annualPvEnergyKwh: numberValue(record.summary.annual_pv_energy_kwh),
    annualEvEnergyKwh: numberValue(record.summary.annual_ev_energy_kwh),
    pvPeakKw: numberValue(record.summary.pv_peak_kw),
    evPeakKw: numberValue(record.summary.ev_peak_kw),
    intervalMinutes: 15,
    durationDays,
    timestampsGenerated: false,
    notice: null,
    detectedColumns: {
      timestamp: typeof columns?.timestamp === "string" ? columns.timestamp : null,
      pv: typeof columns?.pv === "string" ? columns.pv : "PV",
      ev: typeof columns?.ev === "string" ? columns.ev : "EV",
      tariff: typeof columns?.tariff === "string" ? columns.tariff : null,
    },
  };
}

export function resolveActiveProjectDataset(
  project: ProjectSummary,
  datasets: ProjectDatasetRecord[],
  workspaceDataset: WorkspaceDatasetSummary | null,
  workspaceActiveDatasetId: string | null,
): WorkspaceDatasetSummary | null {
  const activeDatasetId = project.active_dataset_id ?? workspaceActiveDatasetId;
  if (!activeDatasetId) return null;
  if (workspaceDataset?.datasetId === activeDatasetId) return workspaceDataset;
  const record = datasets.find((dataset) => dataset.dataset_id === activeDatasetId);
  return record ? projectDatasetToWorkspace(record) : null;
}
