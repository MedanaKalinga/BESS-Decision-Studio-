import { useEffect, useMemo, useState } from "react";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import AutoGraphRoundedIcon from "@mui/icons-material/AutoGraphRounded";
import BatteryChargingFullRoundedIcon from "@mui/icons-material/BatteryChargingFullRounded";
import EmojiEventsRoundedIcon from "@mui/icons-material/EmojiEventsRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { PageHeader } from "../components/ui";
import {
  decisionStageActionLabel,
  deriveComparisonDecisionStage,
} from "../lib/comparisonDecisionWorkflow";
import {
  formatRunTimestamp,
  isSingleRunResult,
  listProjectOptimizationRuns,
  type ProjectOptimizationRun,
} from "../lib/projectOptimizationRuns";
import type {
  ComparisonAHPWorkspaceState,
  ComparisonOptimizationWorkspaceState,
  PrometheeWorkspaceState,
  SingleOptimizationRunWorkspaceState,
} from "../types/workspace";

const currency = new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("en-LK", { maximumFractionDigits: 2 });

function ResultMetric({ label, value }: { label: string; value: string }) {
  return <Paper variant="outlined" sx={{ p: 1.6, borderRadius: "16px", bgcolor: "rgba(255,255,255,.025)", borderColor: "divider" }}>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography variant="subtitle1" sx={{ mt: .35, fontWeight: 850, overflowWrap: "anywhere" }}>{value}</Typography>
  </Paper>;
}

export default function ProjectResultsPage({
  projectId,
  activeDatasetId,
  singleRun,
  comparison,
  ahp,
  promethee,
  onViewSingleRun,
  onContinueDecision,
  onOpenDetailedDecision,
}: {
  projectId: string;
  activeDatasetId: string | null;
  singleRun: SingleOptimizationRunWorkspaceState;
  comparison: ComparisonOptimizationWorkspaceState | null;
  ahp: ComparisonAHPWorkspaceState | null;
  promethee: PrometheeWorkspaceState | null;
  onViewSingleRun: () => void;
  onContinueDecision: () => void;
  onOpenDetailedDecision: () => void;
}) {
  const [tab, setTab] = useState(0);
  const [runs, setRuns] = useState<ProjectOptimizationRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listProjectOptimizationRuns(projectId, "single")
      .then((loaded) => {
        if (cancelled) return;
        setRuns(loaded);
        setSelectedRunId((current) => current && loaded.some((run) => run.run_id === current) ? current : loaded[0]?.run_id ?? null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Single optimization history could not be loaded.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, requestVersion]);

  const currentResult = singleRun.latestJob?.final_result ?? null;
  const effectiveRuns = useMemo(() => {
    if (!singleRun.jobId || !currentResult || runs.some((run) => run.run_id === singleRun.jobId)) return runs;
    return [{
      run_id: singleRun.jobId,
      job_id: singleRun.jobId,
      project_id: projectId,
      dataset_id: activeDatasetId,
      mode: "single" as const,
      lifecycle_status: singleRun.phase,
      scientific_status: currentResult.solution_status,
      submitted_configuration: null,
      result: currentResult,
      created_at: singleRun.startedAt,
      completed_at: singleRun.finishedAt,
      updated_at: singleRun.finishedAt,
      error: singleRun.error,
    }, ...runs];
  }, [activeDatasetId, currentResult, projectId, runs, singleRun]);
  const selectedRun = effectiveRuns.find((run) => run.run_id === selectedRunId) ?? effectiveRuns[0] ?? null;
  const selectedResult = selectedRun && isSingleRunResult(selectedRun.result) ? selectedRun.result : null;
  const singleActive = ["submitting", "queued", "running", "cancelling"].includes(singleRun.phase);

  const context = { projectId, datasetId: activeDatasetId };
  const decisionStage = deriveComparisonDecisionStage({ comparison, ahp, promethee, context });
  const decisionCurrent = decisionStage === "recommendation_current";
  const winnerName = decisionCurrent ? promethee?.result.recommended_battery ?? null : null;
  const winner = winnerName ? comparison?.finalResult.battery_results.find((item) => item.battery_name === winnerName) ?? null : null;

  return <Stack spacing={2.5}>
    <PageHeader eyebrow="PROJECT RESULTS" title="Results" subtitle="Single GA runs and final decision results." />
    <Paper variant="outlined" sx={{ borderRadius: "22px", overflow: "hidden", borderColor: "divider", bgcolor: "#0D1D2D" }}>
      <Tabs value={tab} onChange={(_, value: number) => setTab(value)} variant="fullWidth" aria-label="Project result type">
        <Tab icon={<AutoGraphRoundedIcon />} iconPosition="start" label="Single GA Runs" />
        <Tab icon={<EmojiEventsRoundedIcon />} iconPosition="start" label="Decision Results" />
      </Tabs>
    </Paper>

    {tab === 0 ? <Stack spacing={2}>
      {singleActive ? <Alert severity="info" action={<Button color="inherit" onClick={onViewSingleRun}>View Running Optimization</Button>} sx={{ borderRadius: "16px" }}>A Single optimization is running. Its completed result will be added here automatically.</Alert> : null}
      {error ? <Alert severity="error" action={<Button color="inherit" startIcon={<RefreshRoundedIcon />} onClick={() => setRequestVersion((value) => value + 1)}>Retry</Button>} sx={{ borderRadius: "16px" }}>{error}</Alert> : null}
      {loading ? <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}><CircularProgress size={20} /><Typography color="text.secondary">Loading saved runs…</Typography></Stack> : null}
      {!loading && effectiveRuns.length === 0 ? <Paper variant="outlined" sx={{ p: 4, textAlign: "center", borderRadius: "22px", borderColor: "divider" }}><BatteryChargingFullRoundedIcon sx={{ fontSize: 38, color: "text.secondary" }} /><Typography variant="h6" sx={{ mt: 1, fontWeight: 850 }}>No Single GA results yet</Typography><Button sx={{ mt: 2 }} variant="contained" onClick={onViewSingleRun}>Start Single Optimization</Button></Paper> : null}
      {effectiveRuns.length > 0 ? <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(260px, .7fr) minmax(0, 1.6fr)" }, gap: 2 }}>
        <Stack spacing={1}>
          {effectiveRuns.map((run, index) => {
            const result = isSingleRunResult(run.result) ? run.result : null;
            const selected = run.run_id === (selectedRun?.run_id ?? effectiveRuns[0]?.run_id);
            return <Paper key={run.run_id} component="button" type="button" onClick={() => setSelectedRunId(run.run_id)} variant="outlined" sx={{ width: "100%", p: 1.7, textAlign: "left", color: "inherit", cursor: "pointer", borderRadius: "17px", borderColor: selected ? "primary.main" : "divider", bgcolor: selected ? "rgba(155,239,74,.06)" : "#0D1D2D", font: "inherit" }}>
              <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "center" }}><Typography sx={{ fontWeight: 850 }}>Run {effectiveRuns.length - index}</Typography><Chip size="small" label={run.lifecycle_status} color={run.lifecycle_status === "completed" ? "success" : run.lifecycle_status === "failed" ? "error" : "default"} /></Stack>
              <Typography variant="body2" sx={{ mt: .55 }}>{result?.battery_name ?? "Result unavailable"}</Typography>
              <Typography variant="caption" color="text.secondary">{formatRunTimestamp(run.completed_at ?? run.updated_at)}</Typography>
            </Paper>;
          })}
        </Stack>
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: "22px", borderColor: "divider", bgcolor: "#0D1D2D" }}>
          {selectedResult ? <>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}><Box><Typography variant="overline" color="primary.main" sx={{ fontWeight: 850 }}>SINGLE GA RESULT</Typography><Typography variant="h5" sx={{ fontWeight: 900 }}>{selectedResult.battery_name}</Typography></Box><Chip label={selectedResult.is_feasible ? "Feasible" : "Infeasible"} color={selectedResult.is_feasible ? "success" : "warning"} /></Stack>
            <Box sx={{ mt: 2, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2,minmax(0,1fr))" }, gap: 1.2 }}>
              <ResultMetric label="Optimized capacity" value={`${number.format(selectedResult.best_bess_capacity_kwh)} kWh`} />
              <ResultMetric label="Peak support" value={`${number.format(selectedResult.best_peak_support_pct)}%`} />
              <ResultMetric label="Annualized total cost" value={currency.format(selectedResult.total_annual_cost_rs)} />
              <ResultMetric label="Cycle-based life" value={`${number.format(selectedResult.cycle_based_life_years)} years`} />
              <ResultMetric label="Round-trip efficiency" value={`${number.format(selectedResult.round_trip_efficiency * 100)}%`} />
              <ResultMetric label="Completed" value={formatRunTimestamp(selectedRun?.completed_at ?? null)} />
            </Box>
          </> : <Typography color="text.secondary">This run has no completed scientific result.</Typography>}
        </Paper>
      </Box> : null}
    </Stack> : null}

    {tab === 1 ? <Paper variant="outlined" sx={{ p: { xs: 2.2, sm: 3 }, borderRadius: "24px", borderColor: "divider", bgcolor: "#0D1D2D" }}>
      {decisionCurrent && winner ? <>
        <Typography variant="overline" color="primary.main" sx={{ fontWeight: 850 }}>CURRENT FINAL DECISION</Typography>
        <Typography variant="h4" sx={{ mt: .4, fontWeight: 900 }}>{winner.battery_name}</Typography>
        <Typography color="text.secondary" sx={{ mt: .5 }}>Recommended from the GA-optimized feasible alternatives.</Typography>
        <Box sx={{ mt: 2, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3,minmax(0,1fr))" }, gap: 1.2 }}><ResultMetric label="Optimized capacity" value={`${number.format(winner.best_bess_capacity_kwh)} kWh`} /><ResultMetric label="Peak support" value={`${number.format(winner.best_peak_support_pct)}%`} /><ResultMetric label="Net flow" value={number.format(promethee?.result.ordered_ranking[0]?.net_flow ?? 0)} /></Box>
        <Button sx={{ mt: 2 }} variant="contained" endIcon={<ArrowForwardRoundedIcon />} onClick={onOpenDetailedDecision}>Open Detailed Decision Results</Button>
      </> : <>
        <Typography variant="h6" sx={{ fontWeight: 850 }}>Decision workflow</Typography>
        <Typography color="text.secondary" sx={{ mt: .6 }}>{decisionStage === "comparison_running" ? "Battery comparison is running." : decisionStage === "ahp_required" ? "Comparison is complete. Configure AHP weights next." : decisionStage === "ahp_accepted" || decisionStage === "promethee_retry_required" ? "AHP weights are ready. Continue the final ranking." : decisionStage === "recommendation_stale" ? "The previous recommendation is outdated." : "No current decision result is available."}</Typography>
        <Button sx={{ mt: 2 }} variant="contained" endIcon={<ArrowForwardRoundedIcon />} onClick={onContinueDecision}>{decisionStageActionLabel(decisionStage)}</Button>
      </>}
    </Paper> : null}
  </Stack>;
}
