import type {
  AHPCalculationResult,
  ComparisonAHPWorkspaceState,
} from "../types/workspace";

export const AHP_CRITERIA = [
  { id: "total_annual_cost_Rs", label: "Annualized total cost", direction: "Minimize" },
  { id: "cycle_based_life_years", label: "Cycle-based life", direction: "Maximize" },
  { id: "round_trip_efficiency", label: "Round-trip efficiency", direction: "Maximize" },
  { id: "weight_density_kg_per_kwh", label: "Weight density (kg/kWh)", direction: "Minimize" },
  { id: "warranty_years", label: "Warranty period", direction: "Maximize" },
] as const;

export const SCIENTIFIC_CONFIGURATION_VERSION = 3;
export const LEGACY_AHP_INCOMPATIBILITY_MESSAGE =
  "AHP configuration must be recalculated using the current five-criterion model.";

export const DEFAULT_AHP_MATRIX: number[][] = [
  [1, 1, 4, 3, 5],
  [1, 1, 4, 2, 3],
  [1 / 4, 1 / 4, 1, 1, 1],
  [1 / 3, 1 / 2, 1, 1, 2],
  [1 / 5, 1 / 3, 1, 1 / 2, 1],
];

export const SAATY_SCALE_VALUES = [
  1 / 9, 1 / 8, 1 / 7, 1 / 6, 1 / 5, 1 / 4, 1 / 3, 1 / 2,
  1, 2, 3, 4, 5, 6, 7, 8, 9,
] as const;

export interface ComparisonAHPLinkage {
  projectId: string;
  datasetId: string | null;
  comparisonRevision: string;
}

export function linkAHPStateToComparison(
  state: ComparisonAHPWorkspaceState,
  linkage: ComparisonAHPLinkage,
): ComparisonAHPWorkspaceState {
  return {
    ...state,
    projectId: linkage.projectId,
    linkedDatasetId: linkage.datasetId,
    linkedComparisonRevision: linkage.comparisonRevision,
    scientificConfigurationVersion: SCIENTIFIC_CONFIGURATION_VERSION,
    incompatible: false,
    incompatibilityReason: null,
  };
}

export function cloneMatrix(matrix: number[][]): number[][] {
  return matrix.map((row) => [...row]);
}

export function resetAHPMatrix(): number[][] {
  return cloneMatrix(DEFAULT_AHP_MATRIX);
}

function isValidReciprocalMatrix(value: unknown, size: number): value is number[][] {
  if (!Array.isArray(value) || value.length !== size) return false;
  const matrix = value as unknown[][];
  if (!matrix.every((row) => Array.isArray(row) && row.length === size)) return false;
  for (let row = 0; row < matrix.length; row += 1) {
    for (let column = 0; column < matrix.length; column += 1) {
      const entry = matrix[row][column];
      if (typeof entry !== "number" || !Number.isFinite(entry) || entry <= 0) return false;
      if (row === column && Math.abs(entry - 1) > 1e-9) return false;
      const reciprocal = matrix[column][row];
      if (typeof reciprocal !== "number" || Math.abs(entry * reciprocal - 1) > 1e-5) return false;
    }
  }
  return true;
}

export function isValidAHPMatrix(value: unknown): value is number[][] {
  return isValidReciprocalMatrix(value, AHP_CRITERIA.length);
}

export function updatePairwiseJudgment(
  matrix: number[][],
  row: number,
  column: number,
  value: number,
): number[][] {
  if (!isValidAHPMatrix(matrix) || row < 0 || column < 0 || row >= column || column >= matrix.length) {
    throw new Error("A pairwise judgment must target the upper triangle of a valid AHP matrix.");
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("A pairwise judgment must be a positive finite number.");
  }
  const updated = cloneMatrix(matrix);
  updated[row][column] = value;
  updated[column][row] = 1 / value;
  updated.forEach((matrixRow, index) => { matrixRow[index] = 1; });
  return updated;
}

function isFiniteArray(value: unknown, size: number): value is number[] {
  return Array.isArray(value)
    && value.length === size
    && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function isValidAHPCalculationSize(value: unknown, size: number): value is AHPCalculationResult {
  if (!value || typeof value !== "object") return false;
  const result = value as AHPCalculationResult;
  return isFiniteArray(result.columnSums, size)
    && Array.isArray(result.normalizedMatrix)
    && result.normalizedMatrix.length === size
    && result.normalizedMatrix.every((row) => isFiniteArray(row, size))
    && isFiniteArray(result.weights, size)
    && Math.abs(result.weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-5
    && [result.lambdaMax, result.consistencyIndex, result.randomIndex, result.consistencyRatio]
      .every((entry) => typeof entry === "number" && Number.isFinite(entry))
    && (result.status === "ACCEPTABLE" || result.status === "REVIEW REQUIRED");
}

export function isValidAHPCalculation(value: unknown): value is AHPCalculationResult {
  return isValidAHPCalculationSize(value, AHP_CRITERIA.length);
}

export function sanitizeComparisonAHPState(value: unknown): ComparisonAHPWorkspaceState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as ComparisonAHPWorkspaceState;
  if (isValidReciprocalMatrix(state.matrix, 6)) {
    const legacyCalculation = state.calculation !== null
      && isValidAHPCalculationSize(state.calculation, 6)
      ? state.calculation
      : null;
    return {
      ...state,
      matrix: cloneMatrix(state.matrix),
      calculation: legacyCalculation ? { ...legacyCalculation } : null,
      accepted: false,
      scientificConfigurationVersion: state.scientificConfigurationVersion ?? 2,
      incompatible: true,
      incompatibilityReason: LEGACY_AHP_INCOMPATIBILITY_MESSAGE,
    };
  }
  if (!isValidAHPMatrix(state.matrix)) return null;
  if (state.calculation !== null && !isValidAHPCalculation(state.calculation)) return null;
  if (typeof state.accepted !== "boolean" || !Number.isInteger(state.revision) || state.revision < 0) return null;
  if (state.calculatedAt !== null && typeof state.calculatedAt !== "string") return null;
  if (state.acceptedAt !== undefined
    && state.acceptedAt !== null
    && typeof state.acceptedAt !== "string") return null;
  if (state.accepted && (!state.calculation || state.calculation.status !== "ACCEPTABLE")) return null;
  return {
    ...state,
    matrix: cloneMatrix(state.matrix),
    calculation: state.calculation ? { ...state.calculation } : null,
    scientificConfigurationVersion: SCIENTIFIC_CONFIGURATION_VERSION,
    incompatible: false,
    incompatibilityReason: null,
  };
}

export function canContinueWithAHP(
  calculation: AHPCalculationResult | null,
  pending: boolean,
  error: string | null,
): boolean {
  return !pending && !error && calculation?.status === "ACCEPTABLE";
}
