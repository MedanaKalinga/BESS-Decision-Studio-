import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import BatteryChargingFullRoundedIcon from "@mui/icons-material/BatteryChargingFullRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import CancelRoundedIcon from "@mui/icons-material/CancelRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import CloudOffRoundedIcon from "@mui/icons-material/CloudOffRounded";
import CurrencyRupeeRoundedIcon from "@mui/icons-material/CurrencyRupeeRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
import LoopRoundedIcon from "@mui/icons-material/LoopRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import ScienceRoundedIcon from "@mui/icons-material/ScienceRounded";
import TimerRoundedIcon from "@mui/icons-material/TimerRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import type {
  SingleBatteryConfigurationSnapshot,
  SingleOptimizationFinalResult,
  SingleOptimizationJobResponse,
  SingleOptimizationRunError,
  SingleOptimizationRunWorkspaceState,
  SingleOptimizationSetupSnapshot,
  WorkspaceDatasetSummary,
  WorkspaceDispatchStrategy,
} from "../types/workspace";
import { batteryTypeLabel } from "../lib/batteryCatalogue";

const POLL_INTERVAL_MS = 900;
const steps = ["Battery", "Bounds", "GA Settings", "Economics", "Dispatch", "Review", "Run", "Result"];
const OperationalProfiles = lazy(() => import("./OperationalProfiles"));

const currencyFormatter = new Intl.NumberFormat("en-LK", {
  style: "currency",
  currency: "LKR",
  maximumFractionDigits: 0,
});
const numberFormatter = new Intl.NumberFormat("en-LK", { maximumFractionDigits: 2 });
const integerFormatter = new Intl.NumberFormat("en-LK", { maximumFractionDigits: 0 });

interface SingleOptimizationRunProps {
  projectId: string;
  battery: SingleBatteryConfigurationSnapshot;
  dataset: WorkspaceDatasetSummary | null;
  dispatchStrategy: WorkspaceDispatchStrategy;
  setup: SingleOptimizationSetupSnapshot;
  runState: SingleOptimizationRunWorkspaceState;
  setRunState: Dispatch<SetStateAction<SingleOptimizationRunWorkspaceState>>;
  onBackToSetup: () => void;
  onAdjustSearchBounds: () => void;
  startBlockedReason?: string | null;
  onViewActiveRun?: () => void;
  onViewResults?: () => void;
  operationalProfileDate: string | null;
  onOperationalProfileDateChange: (date: string | null) => void;
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function percent(value: number) {
  return `${numberFormatter.format(value)}%`;
}

function efficiencyPercent(value: number) {
  return percent(value <= 1 ? value * 100 : value);
}

function createRequest(
  battery: SingleBatteryConfigurationSnapshot,
  dataset: WorkspaceDatasetSummary,
  dispatchStrategy: WorkspaceDispatchStrategy,
  setup: SingleOptimizationSetupSnapshot,
) {
  return {
    dataset_id: dataset.datasetId,
    battery: {
      name: battery.batteryName,
      price_rs_per_kwh: battery.priceRsPerKwh,
      rated_cycle_life: battery.ratedCycleLife,
      eta_ch: battery.etaCh,
      eta_dis: battery.etaDis,
      weight_density_kg_per_kwh: battery.weightDensityKgPerKwh,
      warranty_years: battery.warrantyYears,
    },
    economic_settings: {
      project_life_years: setup.projectLifeYears,
      discount_rate: setup.discountRate,
      export_tariff_rs_per_kwh: setup.exportTariffRsPerKwh,
      annual_om_fraction: setup.annualOmFraction,
      replacement_cost_fraction: setup.replacementCostFraction,
      residual_value_enabled: setup.residualValueEnabled,
    },
    dispatch_strategy_status: dispatchStrategy.status,
    minimum_bess_capacity_kwh: setup.minimumBessCapacityKwh,
    maximum_bess_capacity_kwh: setup.maximumBessCapacityKwh,
    minimum_peak_support_pct: setup.minimumPeakSupportPct,
    maximum_peak_support_pct: setup.maximumPeakSupportPct,
    ga_settings: {
      population_size: setup.populationSize,
      generations: setup.generations,
      mutation_probability: setup.mutationProbability,
      elite_count: setup.eliteCount,
      random_seed: setup.randomSeed,
    },
  };
}

async function apiError(response: Response): Promise<SingleOptimizationRunError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { message: `The backend returned HTTP ${response.status}.` };
  }

  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (detail && typeof detail === "object") {
      const record = detail as { code?: unknown; message?: unknown };
      if (typeof record.message === "string") {
        return {
          code: typeof record.code === "string" ? record.code : undefined,
          message: record.message,
        };
      }
    }
    if (typeof detail === "string") return { message: detail };
    if (Array.isArray(detail)) {
      return {
        code: "INVALID_SETTINGS",
        message: detail
          .map((item) => {
            if (!item || typeof item !== "object") return "Invalid input.";
            const record = item as { loc?: unknown; msg?: unknown };
            const location = Array.isArray(record.loc) ? record.loc.slice(1).join(" → ") : "Input";
            return `${location}: ${String(record.msg ?? "Invalid value")}`;
          })
          .join(" "),
      };
    }
  }
  return { message: `The backend rejected the request with HTTP ${response.status}.` };
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 0, p: 1.55, borderRadius: "15px", bgcolor: "rgba(255,255,255,.025)", border: "1px solid", borderColor: "divider" }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ mt: 0.45, fontWeight: 830, overflowWrap: "anywhere" }}>{value}</Typography>
    </Box>
  );
}

function MetricCard({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "teal" | "blue" | "amber" }) {
  const palette = {
    neutral: ["rgba(148,166,186,0.07)", "#AFC0D2", "rgba(148,166,186,0.2)"],
    teal: ["rgba(45,212,191,0.08)", "#5EEAD4", "rgba(45,212,191,0.26)"],
    blue: ["rgba(76,141,255,0.09)", "#82ACFF", "rgba(76,141,255,0.28)"],
    amber: ["rgba(245,167,66,0.09)", "#F8BD69", "rgba(245,167,66,0.3)"],
  }[tone];
  return (
    <Paper elevation={0} sx={{ p: 1.65, borderRadius: "17px", bgcolor: palette[0], border: `1px solid ${palette[2]}` }}>
      <Typography variant="caption" sx={{ color: palette[1], fontWeight: 760 }}>{label}</Typography>
      <Typography variant="h6" sx={{ mt: 0.4, color: "text.primary", fontWeight: 880, fontSize: { xs: 18, sm: 20 }, overflowWrap: "anywhere" }}>{value}</Typography>
    </Paper>
  );
}

function ConstraintStatus({ label, value, threshold, passed }: { label: string; value: number; threshold: number; passed: boolean }) {
  return (
    <Paper elevation={0} sx={{ p: 1.7, borderRadius: "17px", bgcolor: passed ? "rgba(45,212,191,0.08)" : "rgba(245,167,66,0.09)", border: `1px solid ${passed ? "rgba(45,212,191,0.28)" : "rgba(245,167,66,0.3)"}` }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Box>
          <Typography variant="caption" sx={{ color: passed ? "#5EEAD4" : "#F8BD69", fontWeight: 800 }}>{label}</Typography>
          <Typography variant="body1" sx={{ mt: 0.35, fontWeight: 850 }}>{percent(value)} <Typography component="span" variant="caption" color="text.secondary">≥ {percent(threshold)}</Typography></Typography>
        </Box>
        <Chip size="small" icon={passed ? <CheckCircleRoundedIcon /> : <WarningAmberRoundedIcon />} label={passed ? "Passed" : "Failed"} sx={{ bgcolor: passed ? "#dcfce7" : "#fef3c7", color: passed ? "#166534" : "#92400e", fontWeight: 820 }} />
      </Stack>
    </Paper>
  );
}

function ResultMetrics({ result }: { result: SingleOptimizationFinalResult }) {
  const replacements = result.replacement_years.length
    ? `${result.replacement_years.length} · years ${result.replacement_years.map((year) => numberFormatter.format(year)).join(", ")}`
    : "0 · none within project life";
  const metrics = [
    ["Cycle-based life", `${numberFormatter.format(result.cycle_based_life_years)} years`],
    ["Equivalent cycles / year", numberFormatter.format(result.equivalent_cycles_per_year)],
    ["Replacements", replacements],
    ["Grid import", `${numberFormatter.format(result.annual_grid_import_kwh)} kWh`],
    ["PV export", `${numberFormatter.format(result.annual_pv_export_kwh)} kWh`],
    ["BESS charge energy", `${numberFormatter.format(result.annual_bess_charge_kwh)} kWh`],
    ["BESS discharge energy", `${numberFormatter.format(result.annual_bess_discharge_kwh)} kWh`],
    ["Round-trip efficiency", efficiencyPercent(result.round_trip_efficiency)],
    ["Annual lifecycle cost", currencyFormatter.format(result.annualized_bess_lifecycle_cost_rs)],
    ["Annual O&M", currencyFormatter.format(result.annual_om_cost_rs)],
    ["Annual grid cost", currencyFormatter.format(result.annual_grid_cost_rs)],
    ["Export revenue", currencyFormatter.format(result.annual_export_revenue_rs)],
    ["Runtime", formatDuration(result.runtime_seconds)],
    ["Total evaluations", integerFormatter.format(result.total_fitness_evaluations)],
  ];
  return <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" }, gap: 1.25 }}>{metrics.map(([label, value]) => <ReviewItem key={label} label={label} value={value} />)}</Box>;
}

export default function SingleOptimizationRun({ projectId, battery, dataset, dispatchStrategy, setup, runState, setRunState, onBackToSetup, onAdjustSearchBounds, startBlockedReason = null, onViewActiveRun, onViewResults, operationalProfileDate, onOperationalProfileDateChange }: SingleOptimizationRunProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const pollFailures = useRef(0);
  const pollActive = ["queued", "running", "cancelling"].includes(runState.phase) && Boolean(runState.jobId);

  useEffect(() => {
    if (!runState.startedAt) { setElapsedSeconds(0); return; }
    const tick = () => setElapsedSeconds(((runState.finishedAt ?? Date.now()) - runState.startedAt!) / 1000);
    tick();
    if (runState.finishedAt) return;
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [runState.startedAt, runState.finishedAt]);

  useEffect(() => {
    if (!pollActive || !runState.jobId) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/single-optimization/jobs/${encodeURIComponent(runState.jobId!)}`, { credentials: "include" });
        if (!response.ok) throw new Error((await apiError(response)).message);
        const job = await response.json() as SingleOptimizationJobResponse;
        if (stopped) return;
        pollFailures.current = 0;
        const terminal = ["completed", "failed", "cancelled"].includes(job.status);
        setRunState((current) => ({
          ...current,
          phase: job.status,
          latestJob: job,
          error: job.status === "failed" ? { message: job.error ?? "The optimization job failed." } : current.phase === "cancelling" && !terminal ? current.error : null,
          reconnecting: false,
          finishedAt: terminal ? Date.now() : null,
        }));
        if (!terminal) timer = window.setTimeout(poll, POLL_INTERVAL_MS);
      } catch (error) {
        if (stopped) return;
        pollFailures.current += 1;
        setRunState((current) => ({ ...current, reconnecting: true, error: { code: "POLLING_RECONNECT", message: `Connection to the optimization job was interrupted. Reconnecting (attempt ${pollFailures.current})…` } }));
        timer = window.setTimeout(poll, Math.min(900 + pollFailures.current * 500, 4000));
      }
    };
    void poll();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [pollActive, runState.jobId, setRunState]);

  const latest = runState.latestJob;
  const result = latest?.final_result ?? null;
  const estimatedEvaluations = setup.populationSize * setup.generations;

  async function startOptimization() {
    if (startBlockedReason) return;
    if (!dataset) {
      setRunState((current) => ({ ...current, phase: "failed", error: { code: "MISSING_DATASET", message: "No validated dataset is available. Return to Data Upload before starting the optimization." }, finishedAt: Date.now() }));
      return;
    }
    setRunState({ phase: "submitting", jobId: null, latestJob: null, error: null, startedAt: Date.now(), finishedAt: null, reconnecting: false });
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/single-optimization/run`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(createRequest(battery, dataset, dispatchStrategy, setup)) });
      if (!response.ok) {
        const error = await apiError(response);
        setRunState((current) => ({ ...current, phase: "failed", error, finishedAt: Date.now() }));
        return;
      }
      const accepted = await response.json() as { job_id: string; status: "queued" };
      pollFailures.current = 0;
      setRunState((current) => ({ ...current, phase: "queued", jobId: accepted.job_id, error: null }));
    } catch {
      setRunState((current) => ({ ...current, phase: "failed", error: { code: "BACKEND_UNAVAILABLE", message: "The optimization backend is unavailable. Check that FastAPI is running, then start a new submission when ready." }, finishedAt: Date.now() }));
    }
  }

  async function cancelOptimization() {
    if (!runState.jobId) return;
    setRunState((current) => ({ ...current, phase: "cancelling", error: null }));
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/single-optimization/jobs/${encodeURIComponent(runState.jobId)}/cancel`, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error((await apiError(response)).message);
      const job = await response.json() as SingleOptimizationJobResponse;
      const terminal = job.status === "cancelled";
      setRunState((current) => ({ ...current, phase: terminal ? "cancelled" : "cancelling", latestJob: job, finishedAt: terminal ? Date.now() : null }));
    } catch (error) {
      setRunState((current) => ({ ...current, phase: current.latestJob?.status === "running" ? "running" : "queued", error: { code: "CANCEL_FAILED", message: error instanceof Error ? error.message : "Cancellation could not be requested." } }));
    }
  }

  const active = ["submitting", "queued", "running", "cancelling"].includes(runState.phase);
  const progress = latest?.progress_percent ?? 0;
  const headerStatus = runState.phase === "cancelling" ? "Cancellation requested" : runState.phase.charAt(0).toUpperCase() + runState.phase.slice(1);

  return (
    <Stack spacing={2.5}>
      <Paper elevation={0} sx={{ position: "relative", overflow: "hidden", px: { xs: 2.5, sm: 3.5 }, py: { xs: 2.8, sm: 3.5 }, borderRadius: "28px", border: "1px solid", borderColor: "divider", background: "linear-gradient(118deg,#0D1D2D,#12263A)", boxShadow: "0 22px 52px rgba(0,0,0,.24)" }}>
        <Box sx={{ position: "relative", zIndex: 1 }}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ justifyContent: "space-between", alignItems: { md: "flex-end" } }}>
            <Box sx={{ maxWidth: 760 }}><Typography variant="overline" sx={{ color: "#a7f3d0", fontWeight: 850, letterSpacing: "0.12em" }}>SINGLE BATTERY OPTIMIZATION</Typography><Typography variant="h3" sx={{ mt: 0.3, fontSize: { xs: 30, sm: 39 }, fontWeight: 880, letterSpacing: "-0.035em" }}>Run the genetic search</Typography><Typography sx={{ mt: 1, color: "rgba(255,255,255,0.79)", lineHeight: 1.65 }}>Monitor feasibility, cost, and convergence for {batteryTypeLabel(battery.batteryName)}.</Typography></Box>
            <Chip icon={active ? <LoopRoundedIcon /> : runState.phase === "completed" ? <FactCheckRoundedIcon /> : <ScienceRoundedIcon />} label={headerStatus} sx={{ color: "#fff", bgcolor: "rgba(255,255,255,0.14)", fontWeight: 800, "& .MuiChip-icon": { color: "#99f6e4" } }} />
          </Stack>
          <Box sx={{ mt: 3, display: "grid", gridTemplateColumns: "repeat(8,minmax(72px,1fr))", gap: { xs: 0.6, sm: 1 }, overflowX: "auto" }}>{steps.map((step, index) => { const completed = runState.phase === "completed" ? index < 7 : index < 6; const activeStep = runState.phase === "completed" ? index === 7 : runState.phase === "ready" ? index === 5 : index === 6; return <Stack key={step} spacing={0.75} sx={{ minWidth: 68 }}><Box sx={{ height: 4, borderRadius: 99, bgcolor: completed || activeStep ? activeStep ? "#9BEF4A" : "rgba(155,239,74,.55)" : "rgba(255,255,255,0.12)" }} /><Stack direction="row" spacing={0.65} sx={{ alignItems: "center" }}><Box sx={{ width: 22, height: 22, display: "grid", placeItems: "center", borderRadius: "50%", bgcolor: completed ? "rgba(155,239,74,.5)" : activeStep ? "#9BEF4A" : "rgba(255,255,255,0.08)", color: completed || activeStep ? "#07111D" : "text.secondary", fontSize: 11, fontWeight: 900 }}>{completed ? <CheckCircleRoundedIcon sx={{ fontSize: 15 }} /> : index + 1}</Box><Typography variant="caption" sx={{ color: completed || activeStep ? "text.primary" : "text.secondary", fontWeight: activeStep ? 850 : 680 }}>{step}</Typography></Stack></Stack>; })}</Box>
        </Box>
      </Paper>

      {runState.error && <Alert severity={runState.error.code === "POLLING_RECONNECT" ? "warning" : "error"} icon={runState.error.code === "BACKEND_UNAVAILABLE" ? <CloudOffRoundedIcon /> : undefined} sx={{ borderRadius: "17px" }}><Typography variant="subtitle2" sx={{ fontWeight: 850 }}>{runState.error.code ?? "Optimization error"}</Typography><Typography variant="body2">{runState.error.message}</Typography></Alert>}
      {runState.phase === "cancelling" && <Alert severity="warning" icon={<CancelRoundedIcon />} sx={{ borderRadius: "17px" }}><Typography variant="subtitle2" sx={{ fontWeight: 850 }}>Cancellation requested</Typography><Typography variant="body2">The current generation may finish before the optimization stops.</Typography></Alert>}
      {runState.phase === "cancelled" && <Alert severity="info" icon={<CancelRoundedIcon />} sx={{ borderRadius: "17px", border: "1px solid #bfd9e6" }}><Typography variant="subtitle2" sx={{ fontWeight: 850 }}>Optimization cancelled</Typography><Typography variant="body2">The job stopped safely between generations. No result has been presented as optimal.</Typography></Alert>}

      {runState.phase === "ready" && (
        <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: "25px", borderColor: "divider", bgcolor: "#0D1D2D", boxShadow: "0 18px 45px rgba(0,0,0,0.18)" }}>
          <Box sx={{ p: { xs: 2.2, sm: 2.8 }, background: "linear-gradient(120deg, rgba(155,239,74,0.07), rgba(76,141,255,0.08))", borderBottom: "1px solid", borderColor: "divider" }}><Stack direction="row" spacing={1.2} sx={{ alignItems: "center" }}><BatteryChargingFullRoundedIcon sx={{ color: "#9BEF4A" }} /><Box><Typography variant="h5" sx={{ color: "text.primary", fontWeight: 880 }}>Final run review</Typography><Typography variant="body2" color="text.secondary">Values submitted to the GA backend.</Typography></Box></Stack></Box>
          <Box sx={{ p: { xs: 2.2, sm: 2.8 }, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" }, gap: 1.25 }}>
            <ReviewItem label="Selected battery" value={batteryTypeLabel(battery.batteryName)} /><ReviewItem label="Battery price" value={`${currencyFormatter.format(battery.priceRsPerKwh)} / kWh`} /><ReviewItem label="Selected dataset" value={dataset?.filename ?? "No dataset selected"} /><ReviewItem label="Capacity bounds" value={`${numberFormatter.format(setup.minimumBessCapacityKwh)}–${numberFormatter.format(setup.maximumBessCapacityKwh)} kWh`} /><ReviewItem label="Peak-support bounds" value={`${percent(setup.minimumPeakSupportPct)}–${percent(setup.maximumPeakSupportPct)}`} /><ReviewItem label="Population / generations" value={`${setup.populationSize} / ${setup.generations}`} /><ReviewItem label="Estimated evaluations" value={integerFormatter.format(estimatedEvaluations)} /><ReviewItem label="Discount rate" value={percent(setup.discountRate * 100)} /><ReviewItem label="Dispatch strategy" value={dispatchStrategy.status} />
          </Box>
          {startBlockedReason ? <Alert severity="info" action={onViewActiveRun ? <Button color="inherit" onClick={onViewActiveRun}>View Running Optimization</Button> : undefined} sx={{ mx: { xs: 2.2, sm: 2.8 }, mt: 1.5, borderRadius: "15px" }}>{startBlockedReason} Wait for it to finish or cancel it first.</Alert> : null}
          <Divider /><Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ p: { xs: 2.2, sm: 2.8 }, justifyContent: "space-between" }}><Button startIcon={<ArrowBackRoundedIcon />} onClick={onBackToSetup}>Back to Setup</Button><Button variant="contained" startIcon={<PlayArrowRoundedIcon />} disabled={!dataset || Boolean(startBlockedReason)} onClick={startOptimization} sx={{ px: 3, py: 1.2, borderRadius: "13px", background: "linear-gradient(100deg, #0f766e, #2563eb)" }}>Start Optimization</Button></Stack>
        </Paper>
      )}

      {active && (
        <>
          <Paper elevation={0} sx={{ p: { xs: 2.2, sm: 2.8 }, borderRadius: "25px", border: "1px solid", borderColor: "divider", color: "text.primary", background: "linear-gradient(135deg, #0D1D2D, #102438)", boxShadow: "0 18px 45px rgba(0,0,0,0.22)" }}>
            <Stack direction={{ xs: "column", lg: "row" }} spacing={2.5} sx={{ alignItems: { lg: "center" } }}><Box sx={{ position: "relative", display: "inline-flex", alignSelf: { xs: "center", lg: "auto" } }}><CircularProgress variant={runState.phase === "submitting" || runState.phase === "queued" ? "indeterminate" : "determinate"} value={progress} size={116} thickness={4.2} sx={{ color: runState.phase === "cancelling" ? "#F5A742" : "#9BEF4A" }} />{runState.phase !== "submitting" && runState.phase !== "queued" && <Box sx={{ inset: 0, position: "absolute", display: "grid", placeItems: "center" }}><Typography variant="h6" sx={{ color: "text.primary", fontWeight: 900 }}>{integerFormatter.format(progress)}%</Typography></Box>}</Box><Box sx={{ flex: 1, minWidth: 0 }}><Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}><Box><Typography variant="overline" sx={{ color: "#9BEF4A", fontWeight: 850 }}>{runState.reconnecting ? "RECONNECTING" : headerStatus.toUpperCase()}</Typography><Typography variant="h5" sx={{ color: "text.primary", fontWeight: 880 }}>{runState.phase === "submitting" ? "Submitting the configured study" : runState.phase === "queued" ? "Waiting for the optimization worker" : runState.phase === "cancelling" ? "Stopping safely between generations" : "Exploring the search space"}</Typography></Box><Chip icon={<TimerRoundedIcon />} label={formatDuration(elapsedSeconds)} sx={{ color: "text.primary", bgcolor: "rgba(148,166,186,0.1)", fontWeight: 820, "& .MuiChip-icon": { color: "text.secondary" } }} /></Stack><LinearProgress variant={runState.phase === "submitting" || runState.phase === "queued" ? "indeterminate" : "determinate"} value={progress} sx={{ mt: 2, height: 9, borderRadius: 99, bgcolor: "rgba(148,166,186,0.16)", "& .MuiLinearProgress-bar": { borderRadius: 99, background: "linear-gradient(90deg, #9BEF4A, #4C8DFF)" } }} /><Box sx={{ mt: 2, display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" }, gap: 1 }}><ReviewItem label="Generation" value={`${latest?.current_generation ?? 0} / ${latest?.total_generations ?? setup.generations}`} /><ReviewItem label="Evaluations" value={`${latest?.evaluations_completed ?? 0} / ${latest?.estimated_total_evaluations ?? estimatedEvaluations}`} /><ReviewItem label="Best capacity" value={latest?.current_best_capacity_kwh == null ? "Pending" : `${numberFormatter.format(latest.current_best_capacity_kwh)} kWh`} /><ReviewItem label="Best peak support" value={latest?.current_best_peak_support_pct == null ? "Pending" : percent(latest.current_best_peak_support_pct)} /></Box></Box></Stack>
            <Box sx={{ mt: 2, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" }, gap: 1.2 }}><MetricCard label="Current best raw annual cost" value={latest?.current_best_total_annual_cost_rs == null ? "Pending" : currencyFormatter.format(latest.current_best_total_annual_cost_rs)} tone="blue" /><MetricCard label="Current best feasibility" value={latest?.current_best_is_feasible == null ? "Pending" : latest.current_best_is_feasible ? "Feasible" : "Infeasible"} tone={latest?.current_best_is_feasible ? "teal" : "amber"} /></Box>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ mt: 2, justifyContent: "flex-end" }}><Button color="warning" variant="outlined" startIcon={<CancelRoundedIcon />} disabled={runState.phase === "submitting" || runState.phase === "cancelling" || !runState.jobId} onClick={cancelOptimization}>Cancel Optimization</Button></Stack>
          </Paper>
        </>
      )}

      {runState.phase === "failed" && <Paper variant="outlined" sx={{ p: { xs: 2.2, sm: 2.8 }, borderRadius: "24px", borderColor: "rgba(240,100,100,0.4)", bgcolor: "rgba(240,100,100,0.07)" }}><Stack direction="row" spacing={1.3}><ErrorOutlineRoundedIcon sx={{ color: "#F06464", fontSize: 30 }} /><Box><Typography variant="h6" sx={{ color: "text.primary", fontWeight: 870 }}>Optimization could not continue</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Not retried automatically. Check the backend and settings before retrying.</Typography></Box></Stack><Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ mt: 2 }}><Button startIcon={<ArrowBackRoundedIcon />} onClick={onBackToSetup}>Return to Setup</Button><Button variant="outlined" startIcon={<RestartAltRoundedIcon />} onClick={() => setRunState({ phase: "ready", jobId: null, latestJob: null, error: null, startedAt: null, finishedAt: null, reconnecting: false })}>Review and try again</Button></Stack></Paper>}

      {runState.phase === "cancelled" && <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}><Button startIcon={<ArrowBackRoundedIcon />} onClick={onBackToSetup}>Return to Setup</Button><Button variant="outlined" startIcon={<RestartAltRoundedIcon />} onClick={() => setRunState({ phase: "ready", jobId: null, latestJob: null, error: null, startedAt: null, finishedAt: null, reconnecting: false })}>Prepare another run</Button></Stack>}

      {runState.phase === "completed" && result && (
        <>
          {result.solution_status === "feasible_solution" ? (<>
            <Paper elevation={0} sx={{ overflow: "hidden", borderRadius: "27px", border: "1px solid #aee2d1", boxShadow: "0 22px 54px rgba(13,148,136,0.11)" }}><Box sx={{ p: { xs: 2.3, sm: 3 }, color: "#fff", background: "linear-gradient(115deg, #0f766e, #0d9488 55%, #2563eb 125%)" }}><Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ justifyContent: "space-between", alignItems: { md: "center" } }}><Box><Stack direction="row" spacing={1} sx={{ alignItems: "center" }}><CheckCircleRoundedIcon /><Typography variant="overline" sx={{ color: "#c8fff2", fontWeight: 850 }}>FEASIBLE SOLUTION</Typography></Stack><Typography variant="h4" sx={{ mt: 0.5, fontWeight: 900 }}>Optimization completed successfully</Typography><Typography sx={{ mt: 0.8, color: "rgba(255,255,255,0.8)" }}>{result.solution_message}</Typography></Box><Chip label={`${integerFormatter.format(result.total_fitness_evaluations)} evaluations · ${formatDuration(result.runtime_seconds)}`} sx={{ color: "#fff", bgcolor: "rgba(255,255,255,0.14)", fontWeight: 800 }} /></Stack></Box><Box sx={{ p: { xs: 2.3, sm: 3 } }}><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" }, gap: 1.25 }}><MetricCard label="Best BESS capacity" value={`${numberFormatter.format(result.best_bess_capacity_kwh)} kWh`} tone="teal" /><MetricCard label="Best peak-support" value={percent(result.best_peak_support_pct)} tone="teal" /><MetricCard label="Raw total annual cost" value={currencyFormatter.format(result.total_annual_cost_rs)} tone="blue" /></Box><Box sx={{ mt: 1.6, display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, gap: 1.25 }}><ConstraintStatus label="Peak-support success" value={result.peak_support_success_pct} threshold={result.peak_support_threshold_pct} passed={result.peak_support_constraint_passed} /><ConstraintStatus label="PV self-consumption" value={result.pv_self_consumption_pct} threshold={result.pv_self_consumption_threshold_pct} passed={result.pv_self_consumption_constraint_passed} /></Box><Divider sx={{ my: 2 }} /><ResultMetrics result={result} />{onViewResults ? <Button sx={{ mt: 2 }} variant="contained" onClick={onViewResults}>View Project Results</Button> : null}</Box></Paper>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ justifyContent: "flex-end" }}><Button variant="outlined" startIcon={<TuneRoundedIcon />} onClick={onAdjustSearchBounds}>Adjust Search Bounds</Button><Button startIcon={<ArrowBackRoundedIcon />} onClick={onBackToSetup}>Return to Setup</Button></Stack></>
          ) : (
            <Paper elevation={0} sx={{ overflow: "hidden", borderRadius: "27px", border: "1px solid rgba(245,167,66,.42)", bgcolor: "#0D1D2D", boxShadow: "0 22px 54px rgba(0,0,0,0.2)" }}><Box sx={{ p: { xs: 2.3, sm: 3 }, background: "linear-gradient(120deg, rgba(245,167,66,.12), rgba(245,167,66,.04))", borderBottom: "1px solid rgba(245,167,66,.25)" }}><Stack direction="row" spacing={1.2}><WarningAmberRoundedIcon sx={{ color: "#F5A742", fontSize: 34 }} /><Box><Typography variant="overline" sx={{ color: "#F8BD69", fontWeight: 850 }}>DIAGNOSTIC RESULT · NOT A FEASIBLE OPTIMUM</Typography><Typography variant="h5" sx={{ mt: 0.35, color: "text.primary", fontWeight: 900 }}>No candidate within the selected search bounds satisfied all technical constraints.</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.7 }}>The best penalized candidate is shown only to help you adjust the search region.</Typography></Box></Stack></Box><Box sx={{ p: { xs: 2.3, sm: 3 } }}><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(5, minmax(0, 1fr))" }, gap: 1.2 }}><MetricCard label="Diagnostic capacity" value={`${numberFormatter.format(result.best_bess_capacity_kwh)} kWh`} /><MetricCard label="Diagnostic peak support" value={percent(result.best_peak_support_pct)} /><MetricCard label="Raw annual cost" value={currencyFormatter.format(result.total_annual_cost_rs)} tone="blue" /><MetricCard label="Technical penalty" value={currencyFormatter.format(result.total_penalty_rs)} tone="amber" /><MetricCard label="Penalized fitness" value={currencyFormatter.format(result.fitness_rs)} tone="amber" /></Box><Box sx={{ mt: 1.5, display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, gap: 1.2 }}><ConstraintStatus label="Peak-support success" value={result.peak_support_success_pct} threshold={result.peak_support_threshold_pct} passed={result.peak_support_constraint_passed} /><ConstraintStatus label="PV self-consumption" value={result.pv_self_consumption_pct} threshold={result.pv_self_consumption_threshold_pct} passed={result.pv_self_consumption_constraint_passed} /></Box><Alert severity="warning" sx={{ mt: 1.5, borderRadius: "15px" }}>Failed constraints: {[!result.peak_support_constraint_passed && "peak-support success", !result.pv_self_consumption_constraint_passed && "PV self-consumption"].filter(Boolean).join(" and ")}.</Alert><Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ mt: 2 }}><Button variant="contained" startIcon={<TuneRoundedIcon />} onClick={onAdjustSearchBounds} sx={{ background: "linear-gradient(100deg, #b45309, #d97706)" }}>Adjust Search Bounds</Button><Button startIcon={<ArrowBackRoundedIcon />} onClick={onBackToSetup}>Return to Setup</Button></Stack></Box></Paper>
          )}
          <Suspense fallback={<Paper variant="outlined" sx={{ p: 3, borderRadius: "24px" }}><Stack direction="row" spacing={1.2} sx={{ alignItems: "center" }}><CircularProgress size={22} /><Typography color="text.secondary">Loading operational profile workspace…</Typography></Stack></Paper>}>
            <OperationalProfiles projectId={projectId} jobId={runState.jobId} dataset={dataset} result={result} selectedDate={operationalProfileDate} onDateChange={onOperationalProfileDateChange} />
          </Suspense>
        </>
      )}

      {runState.phase === "submitting" && !latest && <Stack spacing={1}><Skeleton variant="rounded" height={90} /><Skeleton variant="rounded" height={220} /></Stack>}
      <Stack direction="row" spacing={1} sx={{ justifyContent: "center", alignItems: "center", color: "text.secondary" }}><CurrencyRupeeRoundedIcon fontSize="small" /><Typography variant="caption">Annual cost excludes penalties; fitness includes them.</Typography><BoltRoundedIcon fontSize="small" /></Stack>
    </Stack>
  );
}
