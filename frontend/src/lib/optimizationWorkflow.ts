import type {
  ComparisonRunPhase,
  SingleOptimizationRunPhase,
  WorkspaceDatasetSummary,
} from "../types/workspace";

export type ActiveOptimizationMode = "single" | "comparison" | null;

const ACTIVE_RUN_PHASES = ["submitting", "queued", "running", "cancelling"] as const;

export function activeOptimizationMode(
  singlePhase: SingleOptimizationRunPhase,
  comparisonPhase: ComparisonRunPhase,
): ActiveOptimizationMode {
  if (ACTIVE_RUN_PHASES.includes(singlePhase as (typeof ACTIVE_RUN_PHASES)[number])) return "single";
  if (ACTIVE_RUN_PHASES.includes(comparisonPhase as (typeof ACTIVE_RUN_PHASES)[number])) return "comparison";
  return null;
}

export function activeOptimizationMessage(mode: ActiveOptimizationMode): string | null {
  if (mode === "single") return "Single optimization is already running.";
  if (mode === "comparison") return "Battery comparison is already running.";
  return null;
}

export type SingleOptimizationStep =
  | "mode-selection"
  | "single-configuration"
  | "single-setup"
  | "single-run";

export interface ComparisonAvailabilityInput {
  projectId: string | null;
  projectLoading: boolean;
  dataset: WorkspaceDatasetSummary | null;
  runPhase: ComparisonRunPhase;
}

export function comparisonDisabledReason({
  projectId,
  projectLoading,
  dataset,
  runPhase,
}: ComparisonAvailabilityInput): string | null {
  if (projectLoading) return "Loading project data…";
  if (!projectId) return "Open a project first.";
  if (!dataset) return "Select or upload an active dataset first.";
  if (dataset.status === "expired") return "The active dataset is unavailable.";
  if (["submitting", "queued", "running", "cancelling"].includes(runPhase)) {
    return "Comparison is already running.";
  }
  return null;
}

export function previousComparisonStep(step: number): number {
  return Math.max(0, Math.min(6, step) - 1);
}

export function nextComparisonStep(step: number): number {
  return Math.min(5, Math.max(0, step) + 1);
}

export function initialComparisonStep(
  runPhase: ComparisonRunPhase,
  savedStep: number | undefined = 0,
): number {
  if (runPhase !== "ready") return 6;
  if (!Number.isInteger(savedStep) || savedStep < 0 || savedStep > 5) return 0;
  return savedStep;
}

const STEP_ERROR_PREFIXES: Record<number, string[]> = {
  0: ["Battery ", "Enable at least two"],
  1: ["Minimum BESS", "Maximum BESS", "Minimum peak", "Maximum peak"],
  2: ["Population", "Generations", "Mutation", "Elite", "Random seed"],
  3: ["Project life", "Discount", "Export tariff", "Annual O&M", "Replacement cost"],
  4: ["Select or upload", "The active dataset", "The modified dispatch"],
};

export function comparisonErrorsForStep(
  allErrors: string[],
  step: number,
): string[] {
  if (step === 5) return allErrors;
  const prefixes = STEP_ERROR_PREFIXES[step] ?? [];
  return allErrors.filter((error) => prefixes.some((prefix) => error.startsWith(prefix)));
}

export function canVisitComparisonStep(
  targetStep: number,
  currentStep: number,
  completedSteps: ReadonlySet<number>,
): boolean {
  return targetStep < currentStep || completedSteps.has(targetStep);
}

export function comparisonStepAfterSave(
  currentStep: number,
  returnToReview: boolean,
): number {
  return returnToReview ? 5 : nextComparisonStep(currentStep);
}

export function canStartComparison(
  step: number,
  active: boolean,
  errors: string[],
): boolean {
  return step === 5 && !active && errors.length === 0;
}

export function optimizationStepForSurface(
  surface: string,
): SingleOptimizationStep | null {
  if (surface === "single-configuration") return "single-configuration";
  if (surface === "single-setup") return "single-setup";
  if (surface === "single-run") return "single-run";
  if (surface === "optimization") return "mode-selection";
  return null;
}
