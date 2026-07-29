import type {
  AHPCalculationResult,
  ComparisonAHPWorkspaceState,
} from "../types/workspace";

export const AHP_CRITERIA = [
  { id: "total_annual_cost_rs", label: "Total Annual Cost", direction: "Minimize" },
  { id: "cycle_based_life_years", label: "Cycle-Based Service Life", direction: "Maximize" },
  { id: "round_trip_efficiency", label: "Round-Trip Efficiency", direction: "Maximize" },
  { id: "weight_density_kg_per_kwh", label: "Weight Density", direction: "Minimize" },
  { id: "annual_om_cost_rs", label: "Annual O&M Cost", direction: "Minimize" },
  { id: "warranty_years", label: "Warranty Period", direction: "Maximize" },
] as const;

export const DEFAULT_AHP_MATRIX: number[][] = [
  [1, 1, 4, 3, 4, 5],
  [1, 1, 4, 2, 2, 3],
  [1 / 4, 1 / 4, 1, 1, 1 / 2, 1],
  [1 / 3, 1 / 2, 1, 1, 1, 2],
  [1 / 4, 1 / 2, 2, 1, 1, 1],
  [1 / 5, 1 / 3, 1, 1 / 2, 1, 1],
];

export const SAATY_SCALE_VALUES = [
  1 / 9, 1 / 8, 1 / 7, 1 / 6, 1 / 5, 1 / 4, 1 / 3, 1 / 2,
  1, 2, 3, 4, 5, 6, 7, 8, 9,
] as const;

export function cloneMatrix(matrix: number[][]): number[][] {
  return matrix.map((row) => [...row]);
}

export function resetAHPMatrix(): number[][] {
  return cloneMatrix(DEFAULT_AHP_MATRIX);
}

export function isValidAHPMatrix(value: unknown): value is number[][] {
  if (!Array.isArray(value) || value.length !== AHP_CRITERIA.length) return false;
  const matrix = value as unknown[][];
  if (!matrix.every((row) => Array.isArray(row) && row.length === AHP_CRITERIA.length)) return false;
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

export function isValidAHPCalculation(value: unknown): value is AHPCalculationResult {
  if (!value || typeof value !== "object") return false;
  const result = value as AHPCalculationResult;
  return isFiniteArray(result.columnSums, 6)
    && Array.isArray(result.normalizedMatrix)
    && result.normalizedMatrix.length === 6
    && result.normalizedMatrix.every((row) => isFiniteArray(row, 6))
    && isFiniteArray(result.weights, 6)
    && Math.abs(result.weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-5
    && [result.lambdaMax, result.consistencyIndex, result.randomIndex, result.consistencyRatio]
      .every((entry) => typeof entry === "number" && Number.isFinite(entry))
    && (result.status === "ACCEPTABLE" || result.status === "REVIEW REQUIRED");
}

export function sanitizeComparisonAHPState(value: unknown): ComparisonAHPWorkspaceState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as ComparisonAHPWorkspaceState;
  if (!isValidAHPMatrix(state.matrix)) return null;
  if (state.calculation !== null && !isValidAHPCalculation(state.calculation)) return null;
  if (typeof state.accepted !== "boolean" || !Number.isInteger(state.revision) || state.revision < 0) return null;
  if (state.calculatedAt !== null && typeof state.calculatedAt !== "string") return null;
  if (state.accepted && (!state.calculation || state.calculation.status !== "ACCEPTABLE")) return null;
  return {
    ...state,
    matrix: cloneMatrix(state.matrix),
    calculation: state.calculation ? { ...state.calculation } : null,
  };
}

export function canContinueWithAHP(
  calculation: AHPCalculationResult | null,
  pending: boolean,
  error: string | null,
): boolean {
  return !pending && !error && calculation?.status === "ACCEPTABLE";
}
