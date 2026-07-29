import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import BalanceRoundedIcon from "@mui/icons-material/BalanceRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";

import {
  AHP_CRITERIA,
  SAATY_SCALE_VALUES,
  canContinueWithAHP,
  cloneMatrix,
  isValidAHPCalculation,
  isValidAHPMatrix,
  resetAHPMatrix,
  sanitizeComparisonAHPState,
  updatePairwiseJudgment,
} from "../lib/comparisonAhp";
import type {
  AHPCalculationResult,
  ComparisonAHPWorkspaceState,
} from "../types/workspace";

const AHP_ENDPOINT = "/api/ahp/calculate";
const REQUEST_TIMEOUT_MS = 8_000;
const DEBOUNCE_MS = 350;

interface BackendAHPResponse {
  column_sums: number[];
  normalized_matrix: number[][];
  weights: number[];
  lambda_max: number;
  consistency_index: number;
  random_index: number;
  consistency_ratio: number;
  status: "ACCEPTABLE" | "REVIEW REQUIRED";
}

interface PairwiseControl {
  row: number;
  column: number;
}

const PAIRWISE_CONTROLS: PairwiseControl[] = AHP_CRITERIA.flatMap((_, row) =>
  AHP_CRITERIA.slice(row + 1).map((__, offset) => ({
    row,
    column: row + offset + 1,
  })),
);

function scaleLabel(value: number): string {
  if (value < 1) return `1/${Math.round(1 / value)}`;
  return String(value);
}

function importancePhrase(strength: number): string {
  if (strength === 1) return "equally important as";
  if (strength === 3) return "moderately more important than";
  if (strength === 5) return "strongly more important than";
  if (strength === 7) return "very strongly more important than";
  if (strength === 9) return "extremely more important than";
  if (strength === 2) return "slightly more important than as a compromise judgment";
  return "more important than at an intermediate compromise judgment";
}

function judgmentExplanation(row: number, column: number, value: number): string {
  const first = AHP_CRITERIA[row].label;
  const second = AHP_CRITERIA[column].label;
  if (value === 1) return `${first} is equally important as ${second}.`;
  if (value > 1) return `${first} is ${importancePhrase(value)} ${second}.`;
  return `${second} is ${importancePhrase(Math.round(1 / value))} ${first}.`;
}

function convertResponse(payload: unknown): AHPCalculationResult | null {
  if (!payload || typeof payload !== "object") return null;
  const response = payload as BackendAHPResponse;
  const converted: AHPCalculationResult = {
    columnSums: response.column_sums,
    normalizedMatrix: response.normalized_matrix,
    weights: response.weights,
    lambdaMax: response.lambda_max,
    consistencyIndex: response.consistency_index,
    randomIndex: response.random_index,
    consistencyRatio: response.consistency_ratio,
    status: response.status,
  };
  return isValidAHPCalculation(converted) ? converted : null;
}

function metric(value: number | undefined, digits = 4): string {
  return value === undefined ? "—" : value.toFixed(digits);
}

export default function ComparisonAHPConfiguration({
  workspaceState,
  onWorkspaceStateChange,
  onBack,
  onContinue,
}: {
  workspaceState: ComparisonAHPWorkspaceState | null;
  onWorkspaceStateChange: (state: ComparisonAHPWorkspaceState) => void;
  onBack: () => void;
  onContinue: (state: ComparisonAHPWorkspaceState) => void;
}) {
  const restored = useMemo(
    () => sanitizeComparisonAHPState(workspaceState),
    [workspaceState],
  );
  const [matrix, setMatrix] = useState<number[][]>(() =>
    restored ? cloneMatrix(restored.matrix) : resetAHPMatrix(),
  );
  const [calculation, setCalculation] = useState<AHPCalculationResult | null>(
    restored?.calculation ?? null,
  );
  const [accepted, setAccepted] = useState(restored?.accepted ?? false);
  const [revision, setRevision] = useState(restored?.revision ?? 0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipInitialCalculation = useRef(Boolean(restored?.calculation));
  const activeRequest = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const stateChangeRef = useRef(onWorkspaceStateChange);

  useEffect(() => {
    stateChangeRef.current = onWorkspaceStateChange;
  }, [onWorkspaceStateChange]);

  const calculate = useCallback(async (
    matrixSnapshot: number[][],
    revisionSnapshot: number,
    preserveAccepted: boolean,
  ) => {
    if (!isValidAHPMatrix(matrixSnapshot)) {
      setCalculation(null);
      setAccepted(false);
      setError("The pairwise matrix is invalid. Reset it or revise the judgments.");
      return;
    }

    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    setPending(true);
    setError(null);

    try {
      const response = await fetch(AHP_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ matrix: matrixSnapshot }),
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload && typeof payload === "object" && "detail" in payload
          ? String((payload as { detail: unknown }).detail)
          : `Backend returned HTTP ${response.status}.`;
        throw new Error(detail);
      }
      const result = convertResponse(payload);
      if (!result) throw new Error("The backend returned an invalid AHP response.");
      if (sequence !== requestSequence.current) return;

      const nextAccepted = preserveAccepted && result.status === "ACCEPTABLE";
      const nextState: ComparisonAHPWorkspaceState = {
        matrix: cloneMatrix(matrixSnapshot),
        calculation: result,
        accepted: nextAccepted,
        revision: revisionSnapshot,
        calculatedAt: new Date().toISOString(),
      };
      setCalculation(result);
      setAccepted(nextAccepted);
      stateChangeRef.current(nextState);
    } catch (requestError) {
      if (sequence !== requestSequence.current) return;
      const message = controller.signal.aborted
        ? "The AHP calculation timed out. Your judgments have been preserved."
        : requestError instanceof TypeError
          ? "The AHP backend is unavailable. Your judgments have been preserved."
          : requestError instanceof Error
            ? requestError.message
            : "The AHP calculation failed. Your judgments have been preserved.";
      setCalculation(null);
      setAccepted(false);
      setError(message);
      stateChangeRef.current({
        matrix: cloneMatrix(matrixSnapshot),
        calculation: null,
        accepted: false,
        revision: revisionSnapshot,
        calculatedAt: null,
      });
    } finally {
      window.clearTimeout(timeout);
      if (sequence === requestSequence.current) setPending(false);
    }
  }, []);

  useEffect(() => {
    if (skipInitialCalculation.current) {
      skipInitialCalculation.current = false;
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void calculate(cloneMatrix(matrix), revision, false);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [calculate, matrix, revision]);

  useEffect(() => () => activeRequest.current?.abort(), []);

  function replaceJudgment(row: number, column: number, value: number) {
    const updated = updatePairwiseJudgment(matrix, row, column, value);
    const nextRevision = revision + 1;
    setMatrix(updated);
    setRevision(nextRevision);
    setCalculation(null);
    setAccepted(false);
    setError(null);
    stateChangeRef.current({
      matrix: cloneMatrix(updated),
      calculation: null,
      accepted: false,
      revision: nextRevision,
      calculatedAt: null,
    });
  }

  function reset() {
    const defaults = resetAHPMatrix();
    const nextRevision = revision + 1;
    setMatrix(defaults);
    setRevision(nextRevision);
    setCalculation(null);
    setAccepted(false);
    setError(null);
    stateChangeRef.current({
      matrix: cloneMatrix(defaults),
      calculation: null,
      accepted: false,
      revision: nextRevision,
      calculatedAt: null,
    });
  }

  function continueWorkflow() {
    if (!canContinueWithAHP(calculation, pending, error) || !calculation) return;
    const nextState: ComparisonAHPWorkspaceState = {
      matrix: cloneMatrix(matrix),
      calculation,
      accepted: true,
      revision,
      calculatedAt: new Date().toISOString(),
    };
    setAccepted(true);
    stateChangeRef.current(nextState);
    onContinue(nextState);
  }

  const rankedWeights = calculation
    ? calculation.weights
      .map((weight, index) => ({ ...AHP_CRITERIA[index], weight, index }))
      .sort((left, right) => right.weight - left.weight)
    : [];
  const isConsistent = calculation?.status === "ACCEPTABLE";
  const continueEnabled = canContinueWithAHP(calculation, pending, error);

  return (
    <Stack spacing={2.5}>
      <Paper elevation={0} sx={{ p: { xs: 2.5, md: 3.5 }, borderRadius: "28px", color: "#fff", background: "linear-gradient(118deg, #073e49 0%, #08766f 58%, #1669a9 125%)", boxShadow: "0 20px 48px rgba(7,62,73,.2)" }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ justifyContent: "space-between", alignItems: { md: "center" } }}>
          <Box sx={{ maxWidth: 780 }}>
            <Typography variant="overline" sx={{ fontWeight: 850, letterSpacing: ".13em", color: "#a7f3d0" }}>Comparison Mode · AHP</Typography>
            <Typography variant="h4" sx={{ mt: .5, fontSize: { xs: 28, md: 36 } }}>Configure criteria importance</Typography>
            <Typography sx={{ mt: 1.2, color: "rgba(255,255,255,.82)", lineHeight: 1.7 }}>
              Express 15 unique judgments. Reciprocal values and criterion weights are generated automatically by the verified backend calculation.
            </Typography>
          </Box>
          <Chip icon={accepted ? <CheckCircleRoundedIcon /> : <BalanceRoundedIcon />} label={accepted ? "AHP weights ready" : "15 pairwise judgments"} sx={{ bgcolor: "rgba(255,255,255,.14)", color: "#fff", fontWeight: 800, "& .MuiChip-icon": { color: "#a7f3d0" } }} />
        </Stack>
      </Paper>

      {error && <Alert severity="error" sx={{ borderRadius: "18px" }}><strong>Calculation unavailable.</strong> {error}</Alert>}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", xl: "minmax(0,1.55fr) minmax(340px,.75fr)" }, gap: 2.5, alignItems: "start" }}>
        <Paper elevation={0} sx={{ p: { xs: 2, md: 2.75 }, borderRadius: "24px", border: "1px solid #dbe7ea" }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between", mb: 2.25 }}>
            <Box>
              <Typography variant="h6">Pairwise judgments</Typography>
              <Typography variant="body2" color="text.secondary">Select how strongly one criterion should influence the decision relative to another.</Typography>
            </Box>
            <Chip label={`${PAIRWISE_CONTROLS.length} unique comparisons`} size="small" variant="outlined" />
          </Stack>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2,minmax(0,1fr))" }, gap: 1.5 }}>
            {PAIRWISE_CONTROLS.map(({ row, column }, index) => {
              const value = matrix[row][column];
              return (
                <Paper key={`${row}-${column}`} variant="outlined" sx={{ p: 1.75, borderRadius: "18px", borderColor: "#dce8ea", transition: "transform .18s ease, box-shadow .18s ease", "&:hover": { transform: "translateY(-2px)", boxShadow: "0 10px 24px rgba(17,94,89,.08)" } }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.4 }}>
                    <Chip label={String(index + 1).padStart(2, "0")} size="small" sx={{ bgcolor: "#e7f8f4", color: "#0f766e", fontWeight: 850 }} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 820 }}>{AHP_CRITERIA[row].label}</Typography>
                    <Typography variant="caption" color="text.secondary">vs</Typography>
                    <Typography variant="subtitle2" sx={{ fontWeight: 820 }}>{AHP_CRITERIA[column].label}</Typography>
                  </Stack>
                  <FormControl fullWidth size="small">
                    <InputLabel id={`judgment-${row}-${column}`}>Saaty judgment</InputLabel>
                    <Select labelId={`judgment-${row}-${column}`} label="Saaty judgment" value={value} onChange={(event) => replaceJudgment(row, column, Number(event.target.value))}>
                      {SAATY_SCALE_VALUES.map((option) => (
                        <MenuItem key={option} value={option}>
                          {scaleLabel(option)} — {option === 1 ? "Equal importance" : option < 1 ? "Second criterion preferred" : `${importancePhrase(option).replace(" than", "")}`}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.15, lineHeight: 1.55 }}>
                    {judgmentExplanation(row, column, value)}
                  </Typography>
                </Paper>
              );
            })}
          </Box>
        </Paper>

        <Stack spacing={2.5} sx={{ position: { xl: "sticky" }, top: { xl: 96 } }}>
          <Paper elevation={0} sx={{ overflow: "hidden", borderRadius: "24px", border: "1px solid #dbe7ea" }}>
            <Box sx={{ p: 2.25, background: "linear-gradient(120deg,#ecfdf8,#eff6ff)" }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
                <Box><Typography variant="h6">Calculated weights</Typography><Typography variant="caption" color="text.secondary">Backend-derived importance ranking</Typography></Box>
                {pending && <CircularProgress size={24} aria-label="Calculating AHP weights" />}
              </Stack>
            </Box>
            {pending && <LinearProgress />}
            <Stack spacing={1.7} sx={{ p: 2.25 }}>
              {rankedWeights.length ? rankedWeights.map((criterion, rank) => (
                <Box key={criterion.id}>
                  <Stack direction="row" sx={{ justifyContent: "space-between", mb: .6 }}>
                    <Typography variant="body2" sx={{ fontWeight: 780 }}>{rank + 1}. {criterion.label}</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 850, color: "#0f766e" }}>{(criterion.weight * 100).toFixed(2)}%</Typography>
                  </Stack>
                  <LinearProgress variant="determinate" value={criterion.weight * 100} aria-label={`${criterion.label} weight ${(criterion.weight * 100).toFixed(2)} percent`} sx={{ height: 8, borderRadius: 8, bgcolor: "#e8eff2", "& .MuiLinearProgress-bar": { borderRadius: 8, background: "linear-gradient(90deg,#0f766e,#2584bd)" } }} />
                </Box>
              )) : <Typography variant="body2" color="text.secondary">Weights will appear after the backend calculation completes.</Typography>}
            </Stack>
          </Paper>

          <Paper elevation={0} sx={{ p: 2.25, borderRadius: "24px", border: "1px solid #dbe7ea" }}>
            <Stack direction="row" spacing={1.2} sx={{ alignItems: "center", mb: 2 }}>
              {isConsistent ? <CheckCircleRoundedIcon color="success" /> : <ErrorOutlineRoundedIcon color={calculation ? "warning" : "disabled"} />}
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>{calculation ? (isConsistent ? "Consistent judgments" : "Judgments require revision") : "Consistency pending"}</Typography>
                <Typography variant="caption" color="text.secondary">Continue requires CR ≤ 0.10</Typography>
              </Box>
            </Stack>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 1 }}>
              {[ ["λ max", metric(calculation?.lambdaMax)], ["Consistency index", metric(calculation?.consistencyIndex)], ["Random index", metric(calculation?.randomIndex, 2)], ["Consistency ratio", calculation ? `${(calculation.consistencyRatio * 100).toFixed(2)}%` : "—"] ].map(([label, value]) => (
                <Box key={label} sx={{ p: 1.25, borderRadius: "14px", bgcolor: "#f7fafb" }}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="subtitle2" sx={{ fontWeight: 850 }}>{value}</Typography></Box>
              ))}
            </Box>
          </Paper>
        </Stack>
      </Box>

      <Accordion disableGutters elevation={0} sx={{ border: "1px solid #dbe7ea", borderRadius: "18px !important", overflow: "hidden", "&::before": { display: "none" } }}>
        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography variant="subtitle2" sx={{ fontWeight: 820 }}>View complete matrix</Typography></AccordionSummary>
        <AccordionDetails sx={{ overflowX: "auto" }}>
          <Box role="table" aria-label="Complete reciprocal AHP matrix" sx={{ display: "grid", gridTemplateColumns: "minmax(150px,1.5fr) repeat(6,minmax(82px,1fr))", minWidth: 760, gap: "1px", bgcolor: "#dfe8eb", border: "1px solid #dfe8eb" }}>
            {["Criterion", ...AHP_CRITERIA.map((criterion) => criterion.label)].map((heading) => <Box key={heading} role="columnheader" sx={{ p: 1, bgcolor: "#edf7f6", fontSize: 12, fontWeight: 820 }}>{heading}</Box>)}
            {matrix.flatMap((rowValues, row) => [
              <Box key={`label-${row}`} role="rowheader" sx={{ p: 1, bgcolor: "#fff", fontSize: 12, fontWeight: 760 }}>{AHP_CRITERIA[row].label}</Box>,
              ...rowValues.map((value, column) => <Box key={`${row}-${column}`} role="cell" sx={{ p: 1, bgcolor: "#fff", fontSize: 12 }}>{Number(value.toFixed(4))}</Box>),
            ])}
          </Box>
        </AccordionDetails>
      </Accordion>

      <Paper elevation={0} sx={{ p: 2, borderRadius: "22px", border: "1px solid #dbe7ea" }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.25} sx={{ alignItems: { md: "center" }, justifyContent: "space-between" }}>
          <Button startIcon={<ArrowBackRoundedIcon />} onClick={onBack}>Back</Button>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.1}>
            <Button startIcon={<RestartAltRoundedIcon />} onClick={reset} disabled={pending}>Reset to Default Matrix</Button>
            <Button startIcon={<RefreshRoundedIcon />} variant="outlined" onClick={() => void calculate(cloneMatrix(matrix), revision, accepted)} disabled={pending}>Recalculate</Button>
            <Button endIcon={<ArrowForwardRoundedIcon />} variant="contained" onClick={continueWorkflow} disabled={!continueEnabled} sx={{ minWidth: 130, background: "linear-gradient(100deg,#0f766e,#1677ad)" }}>Continue</Button>
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}
