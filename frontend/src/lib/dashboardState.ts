import { canEnterComparisonResults, isPrometheeResultStale } from "./comparisonResults.ts";
import { batteryTypeLabel } from "./batteryCatalogue.ts";
import {
  decisionStageActionLabel,
  deriveComparisonDecisionStage,
  type ComparisonDecisionStage,
} from "./comparisonDecisionWorkflow.ts";
import type {
  ComparisonAHPWorkspaceState,
  ComparisonOptimizationWorkspaceState,
  ComparisonRunWorkspaceState,
  PrometheeWorkspaceState,
  SingleOptimizationRunWorkspaceState,
  WorkspaceDatasetSummary,
} from "../types/workspace";

export type DashboardQuickAction =
  | "dataset"
  | "single"
  | "comparison"
  | "ahp"
  | "results";

export const DASHBOARD_ACTION_TARGETS = {
  dataset: "Data Upload",
  single: "Optimization",
  comparison: "Comparison Mode",
  ahp: "Optimization",
  results: "Comparison Mode",
} as const satisfies Record<DashboardQuickAction, string>;

export interface DashboardWorkspaceInput {
  projectId?: string | null;
  activeDatasetId?: string | null;
  dataset: WorkspaceDatasetSummary | null;
  singleRun: SingleOptimizationRunWorkspaceState | null;
  comparisonRun: ComparisonRunWorkspaceState | null;
  comparison: ComparisonOptimizationWorkspaceState | null;
  ahp: ComparisonAHPWorkspaceState | null;
  promethee: PrometheeWorkspaceState | null;
  restoredFromMongo: boolean;
  persistenceStatus: "idle" | "saving" | "saved" | "failed";
}

export interface DashboardStatusCard {
  status: string;
  tone: "neutral" | "info" | "success" | "warning" | "error";
}

export interface DashboardActiveJob {
  mode: "Single Optimization" | "Battery Comparison";
  status: string;
  currentBattery: string | null;
  currentGeneration: number;
  totalGenerations: number;
  progressPercent: number;
  recovered: boolean;
  blockedReason: string | null;
}

export interface DashboardRecommendation {
  batteryName: string;
  rank: number;
  netFlow: number;
  capacityKwh: number;
  peakSupportPct: number;
  totalAnnualCostRs: number;
  cycleBasedLifeYears: number;
}

export interface DashboardRecentResult {
  mode: "Single" | "Comparison";
  completedAt: string;
  status: string;
  summary: string;
}

export interface DashboardModel {
  dataset: DashboardStatusCard & {
    summary: WorkspaceDatasetSummary | null;
  };
  single: DashboardStatusCard & {
    batteryName: string | null;
    capacityKwh: number | null;
    totalAnnualCostRs: number | null;
    feasible: boolean | null;
  };
  comparison: DashboardStatusCard & {
    completedBatteries: number;
    totalBatteries: number;
    feasibleBatteries: number;
    infeasibleBatteries: number;
    progressPercent: number;
  };
  ahp: DashboardStatusCard & {
    consistencyRatio: number | null;
    accepted: boolean;
  };
  promethee: DashboardStatusCard & {
    recommendedBattery: string | null;
    netFlow: number | null;
    rank: number | null;
    stale: boolean;
    decisionStage: ComparisonDecisionStage;
    actionLabel: string;
  };
  recommendation: DashboardRecommendation | null;
  staleRecommendationBattery: string | null;
  activeJob: DashboardActiveJob | null;
  capacityOverview: Array<{
    batteryName: string;
    capacityKwh: number;
    feasible: boolean;
  }>;
  recentResults: DashboardRecentResult[];
  persistenceUnavailable: boolean;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function recoveryBlockReason(
  error: { code?: string; message?: string } | null | undefined,
): string | null {
  if (!error) return null;
  const combined = `${error.code ?? ""} ${error.message ?? ""}`;
  if (!/RECOVERY_BLOCKED|resume[_ ]blocked/i.test(combined)) return null;
  return (error.message ?? error.code ?? "Recovery validation failed.")
    .replace(/^RECOVERY_BLOCKED\s*[:\-]?\s*/i, "")
    .trim();
}

function runTone(status: string): DashboardStatusCard["tone"] {
  if (["Completed", "Accepted", "Current", "Available"].includes(status)) return "success";
  if (["Running", "Resuming", "Ready"].includes(status)) return "info";
  if (["Failed", "Resume blocked", "Expired"].includes(status)) return "error";
  if (["Cancelled", "Cancelling", "Stale"].includes(status)) return "warning";
  return "neutral";
}

function singleStatus(
  run: SingleOptimizationRunWorkspaceState | null,
  restoredFromMongo: boolean,
): string {
  if (!run) return "Not started";
  if (recoveryBlockReason(run.error)) return "Resume blocked";
  if (run.phase === "completed" && run.latestJob?.final_result) return "Completed";
  if (["submitting", "queued", "running"].includes(run.phase)) {
    return restoredFromMongo ? "Resuming" : "Running";
  }
  if (run.phase === "cancelling") return "Cancelling";
  if (run.phase === "failed") return "Failed";
  if (run.phase === "cancelled") return "Cancelled";
  return "Not started";
}

function comparisonStatus(
  run: ComparisonRunWorkspaceState | null,
  comparison: ComparisonOptimizationWorkspaceState | null,
  restoredFromMongo: boolean,
): string {
  if (recoveryBlockReason(run?.error)) return "Resume blocked";
  if (run && ["submitting", "queued", "running"].includes(run.phase)) {
    return restoredFromMongo ? "Resuming" : "Running";
  }
  if (run?.phase === "cancelling") return "Cancelling";
  if (comparison?.stale) return "Stale";
  if (comparison?.finalResult || run?.phase === "completed") return "Completed";
  if (run?.phase === "failed" || run?.phase === "expired") return "Failed";
  if (run?.phase === "cancelled") return "Cancelled";
  return "Not started";
}

export function buildDashboardModel(input: DashboardWorkspaceInput): DashboardModel {
  const projectLinkMismatch = Boolean(
    input.projectId && (
      (input.comparison?.projectId && input.comparison.projectId !== input.projectId)
      || (input.promethee?.projectId && input.promethee.projectId !== input.projectId)
      || (input.ahp?.projectId && input.ahp.projectId !== input.projectId)
    ),
  );
  const datasetLinkMismatch = Boolean(
    input.activeDatasetId && (
      (input.comparison?.datasetId && input.comparison.datasetId !== input.activeDatasetId)
      || (input.promethee?.datasetId && input.promethee.datasetId !== input.activeDatasetId)
      || (input.ahp?.linkedDatasetId && input.ahp.linkedDatasetId !== input.activeDatasetId)
    ),
  );
  const datasetStatus = input.dataset
    ? input.dataset.status === "expired"
      ? "Expired"
      : "Available"
    : "Not available";

  const singleStatusLabel = singleStatus(input.singleRun, input.restoredFromMongo);
  const singleResult = input.singleRun?.latestJob?.final_result ?? null;
  const comparisonStatusLabel = comparisonStatus(
    input.comparisonRun,
    input.comparison,
    input.restoredFromMongo,
  );
  const comparisonResult = input.comparison?.finalResult ?? null;
  const comparisonResults = comparisonResult?.battery_results ?? [];
  const comparisonTotal =
    input.comparisonRun?.latestJob?.total_batteries ?? comparisonResults.length;
  const comparisonCompleted =
    input.comparisonRun?.latestJob?.completed_battery_count ?? comparisonResults.length;

  const ahpStale = Boolean((input.comparison?.stale || projectLinkMismatch || datasetLinkMismatch) && input.ahp?.calculation);
  const ahpAccepted = Boolean(
    input.ahp?.accepted && input.ahp.calculation?.status === "ACCEPTABLE" && !ahpStale,
  );
  const ahpStatus = !input.ahp?.calculation
    ? "Not configured"
    : ahpStale
      ? "Stale"
      : ahpAccepted
        ? "Accepted"
        : input.ahp.calculation.status === "ACCEPTABLE"
          ? "Ready"
          : "Stale";

  const prometheeStale = Boolean(
    input.promethee?.result &&
      (projectLinkMismatch || datasetLinkMismatch || !input.comparison ||
        !input.ahp ||
        isPrometheeResultStale(input.promethee, input.comparison, input.ahp)),
  );
  const currentPromethee = Boolean(
    input.promethee?.result?.scientific_status === "ranking_completed" && !prometheeStale,
  );
  const prometheeReady = canEnterComparisonResults(input.comparison, input.ahp);
  const decisionStage = deriveComparisonDecisionStage({
    comparison: input.comparison,
    ahp: input.ahp,
    promethee: input.promethee,
    context: {
      projectId: input.projectId ?? input.comparison?.projectId ?? "",
      datasetId: input.activeDatasetId ?? input.dataset?.datasetId ?? null,
    },
    comparisonRunning: Boolean(
      input.comparisonRun
      && ["submitting", "queued", "running", "cancelling"].includes(input.comparisonRun.phase),
    ),
  });
  const prometheeStatus = currentPromethee
    ? "Current"
    : prometheeStale
      ? "Stale"
      : prometheeReady
        ? "Ready"
        : "Not calculated";
  const recommendedName = input.promethee?.result?.recommended_battery ?? null;
  const recommendedRank = input.promethee?.result?.ordered_ranking.find(
    (item) => item.battery_name === recommendedName,
  );
  const recommendedAlternative = comparisonResults.find(
    (item) => item.battery_name === recommendedName,
  );
  const recommendation =
    currentPromethee && recommendedName && recommendedRank && recommendedAlternative
      ? {
          batteryName: recommendedName,
          rank: recommendedRank.rank,
          netFlow: recommendedRank.net_flow,
          capacityKwh: recommendedAlternative.best_bess_capacity_kwh,
          peakSupportPct: recommendedAlternative.best_peak_support_pct,
          totalAnnualCostRs: recommendedAlternative.best_total_annual_cost_rs,
          cycleBasedLifeYears: recommendedAlternative.cycle_based_life_years,
        }
      : null;

  const singleBlocked = recoveryBlockReason(input.singleRun?.error);
  const comparisonBlocked = recoveryBlockReason(input.comparisonRun?.error);
  const singleActive = Boolean(
    input.singleRun &&
      (["submitting", "queued", "running", "cancelling"].includes(input.singleRun.phase) ||
        singleBlocked),
  );
  const comparisonActive = Boolean(
    input.comparisonRun &&
      (["submitting", "queued", "running", "cancelling"].includes(
        input.comparisonRun.phase,
      ) || comparisonBlocked),
  );
  let activeJob: DashboardActiveJob | null = null;
  if (comparisonActive && input.comparisonRun) {
    const job = input.comparisonRun.latestJob;
    activeJob = {
      mode: "Battery Comparison",
      status: comparisonBlocked ? "Resume blocked" : comparisonStatusLabel,
      currentBattery: job?.current_battery_name ?? null,
      currentGeneration: job?.current_generation ?? 0,
      totalGenerations: job?.total_generations ?? 0,
      progressPercent: job?.overall_progress_percent ?? 0,
      recovered: input.restoredFromMongo && !comparisonBlocked,
      blockedReason: comparisonBlocked,
    };
  } else if (singleActive && input.singleRun) {
    const job = input.singleRun.latestJob;
    activeJob = {
      mode: "Single Optimization",
      status: singleBlocked ? "Resume blocked" : singleStatusLabel,
      currentBattery: job?.final_result?.battery_name ?? null,
      currentGeneration: job?.current_generation ?? 0,
      totalGenerations: job?.total_generations ?? 0,
      progressPercent: job?.progress_percent ?? 0,
      recovered: input.restoredFromMongo && !singleBlocked,
      blockedReason: singleBlocked,
    };
  }

  const recentResults: DashboardRecentResult[] = [];
  if (singleResult && input.singleRun?.finishedAt) {
    recentResults.push({
      mode: "Single",
      completedAt: new Date(input.singleRun.finishedAt).toISOString(),
      status: singleResult.solution_status,
      summary: `${batteryTypeLabel(singleResult.battery_name)} · ${singleResult.best_bess_capacity_kwh.toLocaleString()} kWh`,
    });
  }
  if (comparisonResult && input.comparison?.completedAt) {
    recentResults.push({
      mode: "Comparison",
      completedAt: input.comparison.completedAt,
      status: comparisonResult.comparison_solution_status,
      summary: `${comparisonResult.feasible_battery_count} feasible of ${comparisonResults.length}`,
    });
  }
  recentResults.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));

  return {
    dataset: {
      status: datasetStatus,
      tone: runTone(datasetStatus),
      summary: input.dataset,
    },
    single: {
      status: singleStatusLabel,
      tone: runTone(singleStatusLabel),
      batteryName: singleResult?.battery_name ?? null,
      capacityKwh: finiteNumber(singleResult?.best_bess_capacity_kwh),
      totalAnnualCostRs: finiteNumber(singleResult?.best_total_annual_cost_rs),
      feasible: singleResult ? singleResult.solution_status === "feasible_solution" : null,
    },
    comparison: {
      status: comparisonStatusLabel,
      tone: runTone(comparisonStatusLabel),
      completedBatteries: comparisonCompleted,
      totalBatteries: comparisonTotal,
      feasibleBatteries: comparisonResult?.feasible_battery_count ?? 0,
      infeasibleBatteries: comparisonResult?.infeasible_battery_count ?? 0,
      progressPercent: input.comparisonRun?.latestJob?.overall_progress_percent ?? 0,
    },
    ahp: {
      status: ahpStatus,
      tone: runTone(ahpStatus),
      consistencyRatio: finiteNumber(input.ahp?.calculation?.consistencyRatio),
      accepted: ahpAccepted,
    },
    promethee: {
      status: prometheeStatus,
      tone: runTone(prometheeStatus),
      recommendedBattery: currentPromethee ? recommendedName : null,
      netFlow: currentPromethee ? finiteNumber(recommendedRank?.net_flow) : null,
      rank: currentPromethee ? recommendedRank?.rank ?? null : null,
      stale: prometheeStale,
      decisionStage,
      actionLabel: decisionStageActionLabel(decisionStage),
    },
    recommendation,
    staleRecommendationBattery: prometheeStale ? recommendedName : null,
    activeJob,
    capacityOverview: comparisonResults.map((item) => ({
      batteryName: item.battery_name,
      capacityKwh: item.best_bess_capacity_kwh,
      feasible: item.is_feasible,
    })),
    recentResults: recentResults.slice(0, 5),
    persistenceUnavailable: input.persistenceStatus === "failed",
  };
}
