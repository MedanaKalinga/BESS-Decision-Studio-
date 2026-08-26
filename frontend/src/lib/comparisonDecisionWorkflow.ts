import {
  comparisonRankingEligibility,
  isAHPCurrent,
  isComparisonCurrent,
  isPrometheeResultStale,
  type ComparisonScientificContext,
} from "./comparisonResults.ts";
import type {
  ComparisonAHPWorkspaceState,
  ComparisonOptimizationWorkspaceState,
  PrometheeWorkspaceState,
} from "../types/workspace";

export type ComparisonDecisionStage =
  | "dataset_required"
  | "comparison_required"
  | "comparison_running"
  | "ahp_required"
  | "ahp_inconsistent"
  | "ahp_accepted"
  | "promethee_calculating"
  | "promethee_retry_required"
  | "recommendation_current"
  | "recommendation_stale"
  | "insufficient_feasible_alternatives"
  | "no_feasible_alternatives";

export interface ComparisonDecisionWorkflowInput {
  comparison: ComparisonOptimizationWorkspaceState | null;
  ahp: ComparisonAHPWorkspaceState | null;
  promethee: PrometheeWorkspaceState | null;
  context: ComparisonScientificContext;
  comparisonRunning?: boolean;
  prometheeCalculating?: boolean;
  prometheeError?: boolean;
}

export function deriveComparisonDecisionStage(
  input: ComparisonDecisionWorkflowInput,
): ComparisonDecisionStage {
  if (!input.context.datasetId) return "dataset_required";
  if (input.comparisonRunning) return "comparison_running";
  if (!isComparisonCurrent(input.comparison, input.context)) {
    return input.promethee ? "recommendation_stale" : "comparison_required";
  }

  const eligibility = comparisonRankingEligibility(input.comparison);
  if (eligibility === "no_feasible_alternatives") return "no_feasible_alternatives";
  if (eligibility === "insufficient_feasible_alternatives") {
    return "insufficient_feasible_alternatives";
  }

  if (input.ahp?.calculation && input.ahp.calculation.status !== "ACCEPTABLE") {
    return "ahp_inconsistent";
  }
  if (!isAHPCurrent(input.ahp, input.comparison, input.context)) return "ahp_required";
  if (input.prometheeCalculating) return "promethee_calculating";
  if (input.prometheeError) return "promethee_retry_required";
  if (!input.promethee) return "ahp_accepted";
  if (isPrometheeResultStale(
    input.promethee,
    input.comparison,
    input.ahp,
    input.context,
  )) return "recommendation_stale";
  return input.promethee.result.scientific_status === "ranking_completed"
    ? "recommendation_current"
    : input.promethee.result.scientific_status;
}

export type ComparisonDecisionDestination =
  | "comparison"
  | "comparison-ahp"
  | "comparison-recommendation"
  | "comparison-results";

export function destinationForComparisonDecisionStage(
  stage: ComparisonDecisionStage,
  detailedResults = false,
): ComparisonDecisionDestination {
  if (stage === "ahp_required") return "comparison-ahp";
  if (stage === "ahp_inconsistent") return "comparison-ahp";
  if (stage === "recommendation_current") {
    return detailedResults ? "comparison-results" : "comparison-recommendation";
  }
  if ([
    "ahp_accepted",
    "promethee_calculating",
    "promethee_retry_required",
    "insufficient_feasible_alternatives",
    "no_feasible_alternatives",
  ].includes(stage)) return "comparison-recommendation";
  return "comparison";
}

export function decisionStageActionLabel(stage: ComparisonDecisionStage): string {
  if (stage === "dataset_required") return "Select an Active Dataset";
  if (stage === "ahp_required") return "Continue to AHP";
  if (stage === "ahp_inconsistent") return "Review AHP Judgments";
  if (stage === "ahp_accepted") return "Continue Final Ranking";
  if (stage === "promethee_calculating") return "Calculating Final Ranking";
  if (stage === "promethee_retry_required") return "Retry Final Ranking";
  if (stage === "recommendation_current") return "View Final Recommendation";
  if (stage === "recommendation_stale") return "Ranking Outdated";
  if (stage === "comparison_running") return "View Comparison Run";
  if (stage === "insufficient_feasible_alternatives") return "View Feasible Alternative";
  if (stage === "no_feasible_alternatives") return "Review Comparison";
  return "Configure Battery Comparison";
}

export function recommendationAnimationEnabled(prefersReducedMotion: boolean): boolean {
  return !prefersReducedMotion;
}
