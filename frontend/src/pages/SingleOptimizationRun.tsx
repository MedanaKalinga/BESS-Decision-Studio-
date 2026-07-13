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
import QueryStatsRoundedIcon from "@mui/icons-material/QueryStatsRounded";
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
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import type {
  SingleBatteryConfigurationSnapshot,
  SingleOptimizationConvergencePoint,
  SingleOptimizationFinalResult,
  SingleOptimizationJobResponse,
  SingleOptimizationRunError,
  SingleOptimizationRunWorkspaceState,
  SingleOptimizationSetupSnapshot,
  WorkspaceDatasetSummary,
  WorkspaceDispatchStrategy,
} from "../types/workspace";

const POLL_INTERVAL_MS = 900;
const steps = ["Mode", "Battery", "Setup", "Run", "Results"];
const OperationalProfiles = lazy(() => import("./OperationalProfiles"));

const currencyFormatter = new Intl.NumberFormat("en-LK", {
  style: "currency",
  currency: "LKR",
  maximumFractionDigits: 0,
});
const numberFormatter = new Intl.NumberFormat("en-LK", { maximumFractionDigits: 2 });
const integerFormatter = new Intl.NumberFormat("en-LK", { maximumFractionDigits: 0 });

type ChartMetric = "best_fitness_rs" | "best_total_annual_cost_rs" | "average_fitness_rs";

interface SingleOptimizationRunProps {
  battery: SingleBatteryConfigurationSnapshot;
  dataset: WorkspaceDatasetSummary | null;
  dispatchStrategy: WorkspaceDispatchStrategy;
  setup: SingleOptimizationSetupSnapshot;
  runState: SingleOptimizationRunWorkspaceState;
  setRunState: Dispatch<SetStateAction<SingleOptimizationRunWorkspaceState>>;
  onBackToSetup: () => void;
  onAdjustSearchBounds: () => void;
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
    <Box sx={{ minWidth: 0, p: 1.55, borderRadius: "15px", bgcolor: "#f8fafc", border: "1px solid #e7edf1" }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ mt: 0.45, fontWeight: 830, overflowWrap: "anywhere" }}>{value}</Typography>
    </Box>
  );
}

function MetricCard({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "teal" | "blue" | "amber" }) {
  const palette = {
    neutral: ["#f8fafc", "#334155", "#e2e8f0"],
    teal: ["#ecfdf8", "#0f766e", "#bce9df"],
    blue: ["#eff6ff", "#1d4ed8", "#cbdffd"],
    amber: ["#fffbeb", "#a16207", "#fde3a7"],
  }[tone];
  return (
    <Paper elevation={0} sx={{ p: 1.65, borderRadius: "17px", bgcolor: palette[0], border: `1px solid ${palette[2]}` }}>
      <Typography variant="caption" sx={{ color: palette[1], fontWeight: 760 }}>{label}</Typography>
      <Typography variant="h6" sx={{ mt: 0.4, color: "#183846", fontWeight: 880, fontSize: { xs: 18, sm: 20 }, overflowWrap: "anywhere" }}>{value}</Typography>
    </Paper>
  );
}

function ConstraintStatus({ label, value, threshold, passed }: { label: string; value: number; threshold: number; passed: boolean }) {
  return (
    <Paper elevation={0} sx={{ p: 1.7, borderRadius: "17px", bgcolor: passed ? "#f0fdf7" : "#fff8e7", border: `1px solid ${passed ? "#b7e8d4" : "#f2cf86"}` }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Box>
          <Typography variant="caption" sx={{ color: passed ? "#0f766e" : "#9a6700", fontWeight: 800 }}>{label}</Typography>
          <Typography variant="body1" sx={{ mt: 0.35, fontWeight: 850 }}>{percent(value)} <Typography component="span" variant="caption" color="text.secondary">≥ {percent(threshold)}</Typography></Typography>
        </Box>
        <Chip size="small" icon={passed ? <CheckCircleRoundedIcon /> : <WarningAmberRoundedIcon />} label={passed ? "Passed" : "Failed"} sx={{ bgcolor: passed ? "#dcfce7" : "#fef3c7", color: passed ? "#166534" : "#92400e", fontWeight: 820 }} />
      </Stack>
    </Paper>
  );
}

function ConvergenceChart({ history }: { history: SingleOptimizationConvergencePoint[] }) {
  const [metric, setMetric] = useState<ChartMetric>("best_fitness_rs");
  const [activePoint, setActivePoint] = useState<SingleOptimizationConvergencePoint | null>(null);
  const values = history.map((point) => point[metric]);
  const minValue = values.length ? Math.min(...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 1;
  const spread = Math.max(maxValue - minValue, Math.max(Math.abs(maxValue), 1) * 0.02);
  const width = 900;
  const height = 270;
  const left = 58;
  const right = 22;
  const top = 24;
  const bottom = 46;
  const x = (index: number) => left + (history.length <= 1 ? 0 : index * ((width - left - right) / (history.length - 1)));
  const y = (value: number) => top + ((maxValue + spread * 0.12 - value) / (spread * 1.24)) * (height - top - bottom);
  const line = history.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point[metric])}`).join(" ");
  const metricLabel = {
    best_fitness_rs: "Best fitness",
    best_total_annual_cost_rs: "Best raw annual cost",
    average_fitness_rs: "Average fitness",
  }[metric];

  return (
    <Paper component="section" aria-labelledby="convergence-title" variant="outlined" sx={{ overflow: "hidden", borderRadius: "24px", borderColor: "#d8e7eb" }}>
      <Box sx={{ px: { xs: 2, sm: 2.5 }, py: 2, background: "linear-gradient(120deg, #ecfdf8, #eff6ff)" }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} sx={{ justifyContent: "space-between", alignItems: { md: "center" } }}>
          <Box>
            <Typography id="convergence-title" variant="h6" sx={{ fontWeight: 870 }}>Live convergence</Typography>
            <Typography variant="body2" color="text.secondary">Select a cost series and inspect each generation.</Typography>
          </Box>
          <ToggleButtonGroup exclusive size="small" value={metric} onChange={(_, value: ChartMetric | null) => value && setMetric(value)} aria-label="Convergence chart metric" sx={{ flexWrap: "wrap" }}>
            <ToggleButton value="best_fitness_rs">Best fitness</ToggleButton>
            <ToggleButton value="best_total_annual_cost_rs">Raw cost</ToggleButton>
            <ToggleButton value="average_fitness_rs">Average fitness</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </Box>
      <Box sx={{ p: { xs: 1.5, sm: 2.3 } }}>
        {history.length === 0 ? (
          <Stack spacing={1} sx={{ py: 5, alignItems: "center" }}><QueryStatsRoundedIcon sx={{ color: "#94a3b8", fontSize: 36 }} /><Typography color="text.secondary">Convergence points appear after the first generation.</Typography></Stack>
        ) : (
          <>
            <Box role="img" tabIndex={0} aria-label={`${metricLabel} convergence chart with ${history.length} generations. Use Tab to inspect generation points.`} sx={{ width: "100%", overflowX: "auto", outline: "none", "&:focus-visible": { borderRadius: 2, boxShadow: "0 0 0 3px rgba(13,148,136,0.18)" } }}>
              <Box component="svg" viewBox={`0 0 ${width} ${height}`} sx={{ display: "block", width: "100%", minWidth: 560, height: "auto" }}>
                <defs><linearGradient id="convergenceArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#14b8a6" stopOpacity="0.24" /><stop offset="100%" stopColor="#14b8a6" stopOpacity="0.02" /></linearGradient></defs>
                {[0, 0.5, 1].map((ratio) => <line key={ratio} x1={left} x2={width - right} y1={top + ratio * (height - top - bottom)} y2={top + ratio * (height - top - bottom)} stroke="#e2e8f0" strokeDasharray="5 6" />)}
                <path d={`${line} L ${x(history.length - 1)} ${height - bottom} L ${x(0)} ${height - bottom} Z`} fill="url(#convergenceArea)" />
                <path d={line} fill="none" stroke="#0d9488" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                {history.map((point, index) => (
                  <circle key={point.generation} cx={x(index)} cy={y(point[metric])} r="6" fill={point.best_is_feasible ? "#0d9488" : "#f59e0b"} stroke="#fff" strokeWidth="3" tabIndex={0} role="button" aria-label={`Generation ${point.generation}: ${metricLabel} ${currencyFormatter.format(point[metric])}; ${point.feasible_candidate_count} feasible candidates; best is ${point.best_is_feasible ? "feasible" : "infeasible"}.`} onMouseEnter={() => setActivePoint(point)} onMouseLeave={() => setActivePoint(null)} onFocus={() => setActivePoint(point)} onBlur={() => setActivePoint(null)} style={{ cursor: "pointer", outline: "none" }}><title>{`Generation ${point.generation} · ${currencyFormatter.format(point[metric])}`}</title></circle>
                ))}
                <text x={left} y={height - 14} fill="#64748b" fontSize="13">Generation 1</text>
                <text x={width - right} y={height - 14} textAnchor="end" fill="#64748b" fontSize="13">Generation {history.at(-1)?.generation}</text>
              </Box>
            </Box>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1.2, justifyContent: "space-between", alignItems: { sm: "center" } }}>
              <Typography variant="caption" color="text.secondary"><Box component="span" sx={{ display: "inline-block", width: 9, height: 9, mr: 0.6, borderRadius: "50%", bgcolor: "#0d9488" }} />Feasible best <Box component="span" sx={{ display: "inline-block", width: 9, height: 9, mx: 0.6, borderRadius: "50%", bgcolor: "#f59e0b" }} />Infeasible best</Typography>
              {activePoint && <Chip size="small" label={`Gen ${activePoint.generation} · ${currencyFormatter.format(activePoint[metric])} · ${activePoint.feasible_candidate_count} feasible`} sx={{ fontWeight: 780, bgcolor: "#f0fdfa", color: "#0f766e" }} />}
            </Stack>
          </>
        )}
      </Box>
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

export default function SingleOptimizationRun({ battery, dataset, dispatchStrategy, setup, runState, setRunState, onBackToSetup, onAdjustSearchBounds }: SingleOptimizationRunProps) {
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
        const response = await fetch(`/api/single-optimization/jobs/${encodeURIComponent(runState.jobId!)}`);
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
  const history = result?.convergence_history ?? [];
  const estimatedEvaluations = setup.populationSize * setup.generations;

  async function startOptimization() {
    if (!dataset) {
      setRunState((current) => ({ ...current, phase: "failed", error: { code: "MISSING_DATASET", message: "No validated dataset is available. Return to Data Upload before starting the optimization." }, finishedAt: Date.now() }));
      return;
    }
    setRunState({ phase: "submitting", jobId: null, latestJob: null, error: null, startedAt: Date.now(), finishedAt: null, reconnecting: false });
    try {
      const response = await fetch("/api/single-optimization/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(createRequest(battery, dataset, dispatchStrategy, setup)) });
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
      const response = await fetch(`/api/single-optimization/jobs/${encodeURIComponent(runState.jobId)}/cancel`, { method: "POST" });
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
      <Paper elevation={0} sx={{ position: "relative", overflow: "hidden", px: { xs: 2.5, sm: 3.5 }, py: { xs: 2.8, sm: 3.5 }, borderRadius: "28px", color: "#fff", background: "linear-gradient(118deg, #073e49 0%, #08766f 52%, #1669a9 125%)", boxShadow: "0 22px 52px rgba(7,62,73,0.2)", "&::after": { content: '\"\"', position: "absolute", width: 320, height: 320, right: -110, top: -190, borderRadius: "50%", border: "55px solid rgba(255,255,255,0.055)" } }}>
        <Box sx={{ position: "relative", zIndex: 1 }}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ justifyContent: "space-between", alignItems: { md: "flex-end" } }}>
            <Box sx={{ maxWidth: 760 }}><Typography variant="overline" sx={{ color: "#a7f3d0", fontWeight: 850, letterSpacing: "0.12em" }}>SINGLE BATTERY OPTIMIZATION</Typography><Typography variant="h3" sx={{ mt: 0.3, fontSize: { xs: 30, sm: 39 }, fontWeight: 880, letterSpacing: "-0.035em" }}>Run the genetic search</Typography><Typography sx={{ mt: 1, color: "rgba(255,255,255,0.79)", lineHeight: 1.65 }}>Track technical feasibility and economic convergence for {battery.batteryName} without losing sight of the unpenalized cost.</Typography></Box>
            <Chip icon={active ? <LoopRoundedIcon /> : runState.phase === "completed" ? <FactCheckRoundedIcon /> : <ScienceRoundedIcon />} label={headerStatus} sx={{ color: "#fff", bgcolor: "rgba(255,255,255,0.14)", fontWeight: 800, "& .MuiChip-icon": { color: "#99f6e4" } }} />
          </Stack>
          <Box sx={{ mt: 3, display: "grid", gridTemplateColumns: "repeat(5, minmax(64px, 1fr))", gap: { xs: 0.6, sm: 1.25 }, overflowX: "auto" }}>{steps.map((step, index) => { const completed = index < 3 || (index === 3 && runState.phase === "completed"); const activeStep = index === 3 && runState.phase !== "completed" || index === 4 && runState.phase === "completed"; return <Stack key={step} spacing={0.75} sx={{ minWidth: 62 }}><Box sx={{ height: 4, borderRadius: 99, bgcolor: completed || activeStep ? activeStep ? "#5eead4" : "#a7f3d0" : "rgba(255,255,255,0.18)" }} /><Stack direction="row" spacing={0.65} sx={{ alignItems: "center" }}><Box sx={{ width: 22, height: 22, display: "grid", placeItems: "center", borderRadius: "50%", bgcolor: completed ? "#a7f3d0" : activeStep ? "#5eead4" : "rgba(255,255,255,0.12)", color: completed || activeStep ? "#07565a" : "rgba(255,255,255,0.58)", fontSize: 11, fontWeight: 900 }}>{completed ? <CheckCircleRoundedIcon sx={{ fontSize: 15 }} /> : index + 1}</Box><Typography variant="caption" sx={{ color: completed || activeStep ? "#fff" : "rgba(255,255,255,0.55)", fontWeight: activeStep ? 850 : 680 }}>{step}</Typography></Stack></Stack>; })}</Box>
        </Box>
      </Paper>

      {runState.error && <Alert severity={runState.error.code === "POLLING_RECONNECT" ? "warning" : "error"} icon={runState.error.code === "BACKEND_UNAVAILABLE" ? <CloudOffRoundedIcon /> : undefined} sx={{ borderRadius: "17px" }}><Typography variant="subtitle2" sx={{ fontWeight: 850 }}>{runState.error.code ?? "Optimization error"}</Typography><Typography variant="body2">{runState.error.message}</Typography></Alert>}
      {runState.phase === "cancelling" && <Alert severity="warning" icon={<CancelRoundedIcon />} sx={{ borderRadius: "17px" }}><Typography variant="subtitle2" sx={{ fontWeight: 850 }}>Cancellation requested</Typography><Typography variant="body2">The current generation may finish before the optimization stops.</Typography></Alert>}
      {runState.phase === "cancelled" && <Alert severity="info" icon={<CancelRoundedIcon />} sx={{ borderRadius: "17px", border: "1px solid #bfd9e6" }}><Typography variant="subtitle2" sx={{ fontWeight: 850 }}>Optimization cancelled</Typography><Typography variant="body2">The job stopped safely between generations. No result has been presented as optimal.</Typography></Alert>}

      {runState.phase === "ready" && (
        <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: "25px", borderColor: "#cfe4e3", boxShadow: "0 18px 45px rgba(15,65,77,0.07)" }}>
          <Box sx={{ p: { xs: 2.2, sm: 2.8 }, background: "linear-gradient(120deg, #ecfdf8, #eff6ff)" }}><Stack direction="row" spacing={1.2} sx={{ alignItems: "center" }}><BatteryChargingFullRoundedIcon sx={{ color: "#0f766e" }} /><Box><Typography variant="h5" sx={{ fontWeight: 880 }}>Final run review</Typography><Typography variant="body2" color="text.secondary">These exact values will be submitted to the existing GA backend.</Typography></Box></Stack></Box>
          <Box sx={{ p: { xs: 2.2, sm: 2.8 }, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" }, gap: 1.25 }}>
            <ReviewItem label="Selected battery" value={battery.batteryName} /><ReviewItem label="Battery price" value={`${currencyFormatter.format(battery.priceRsPerKwh)} / kWh`} /><ReviewItem label="Selected dataset" value={dataset?.filename ?? "No dataset selected"} /><ReviewItem label="Capacity bounds" value={`${numberFormatter.format(setup.minimumBessCapacityKwh)}–${numberFormatter.format(setup.maximumBessCapacityKwh)} kWh`} /><ReviewItem label="Peak-support bounds" value={`${percent(setup.minimumPeakSupportPct)}–${percent(setup.maximumPeakSupportPct)}`} /><ReviewItem label="Population / generations" value={`${setup.populationSize} / ${setup.generations}`} /><ReviewItem label="Estimated evaluations" value={integerFormatter.format(estimatedEvaluations)} /><ReviewItem label="Discount rate" value={percent(setup.discountRate * 100)} /><ReviewItem label="Dispatch strategy" value={dispatchStrategy.status} />
          </Box>
          <Divider /><Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ p: { xs: 2.2, sm: 2.8 }, justifyContent: "space-between" }}><Button startIcon={<ArrowBackRoundedIcon />} onClick={onBackToSetup}>Back to Setup</Button><Button variant="contained" startIcon={<PlayArrowRoundedIcon />} disabled={!dataset} onClick={startOptimization} sx={{ px: 3, py: 1.2, borderRadius: "13px", background: "linear-gradient(100deg, #0f766e, #2563eb)" }}>Start Optimization</Button></Stack>
        </Paper>
      )}

      {active && (
        <>
          <Paper elevation={0} sx={{ p: { xs: 2.2, sm: 2.8 }, borderRadius: "25px", border: "1px solid #cfe5e3", background: "linear-gradient(135deg, #fff, #f3fffc)", boxShadow: "0 18px 45px rgba(15,65,77,0.07)" }}>
            <Stack direction={{ xs: "column", lg: "row" }} spacing={2.5} sx={{ alignItems: { lg: "center" } }}><Box sx={{ position: "relative", display: "inline-flex", alignSelf: { xs: "center", lg: "auto" } }}><CircularProgress variant={runState.phase === "submitting" || runState.phase === "queued" ? "indeterminate" : "determinate"} value={progress} size={116} thickness={4.2} sx={{ color: runState.phase === "cancelling" ? "#f59e0b" : "#0d9488" }} />{runState.phase !== "submitting" && runState.phase !== "queued" && <Box sx={{ inset: 0, position: "absolute", display: "grid", placeItems: "center" }}><Typography variant="h6" sx={{ fontWeight: 900 }}>{integerFormatter.format(progress)}%</Typography></Box>}</Box><Box sx={{ flex: 1, minWidth: 0 }}><Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}><Box><Typography variant="overline" sx={{ color: "#0f766e", fontWeight: 850 }}>{runState.reconnecting ? "RECONNECTING" : headerStatus.toUpperCase()}</Typography><Typography variant="h5" sx={{ fontWeight: 880 }}>{runState.phase === "submitting" ? "Submitting the configured study" : runState.phase === "queued" ? "Waiting for the optimization worker" : runState.phase === "cancelling" ? "Stopping safely between generations" : "Exploring the search space"}</Typography></Box><Chip icon={<TimerRoundedIcon />} label={formatDuration(elapsedSeconds)} sx={{ fontWeight: 820 }} /></Stack><LinearProgress variant={runState.phase === "submitting" || runState.phase === "queued" ? "indeterminate" : "determinate"} value={progress} sx={{ mt: 2, height: 9, borderRadius: 99, bgcolor: "#dcefeb", "& .MuiLinearProgress-bar": { borderRadius: 99, background: "linear-gradient(90deg, #14b8a6, #2563eb)" } }} /><Box sx={{ mt: 2, display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" }, gap: 1 }}><ReviewItem label="Generation" value={`${latest?.current_generation ?? 0} / ${latest?.total_generations ?? setup.generations}`} /><ReviewItem label="Evaluations" value={`${latest?.evaluations_completed ?? 0} / ${latest?.estimated_total_evaluations ?? estimatedEvaluations}`} /><ReviewItem label="Best capacity" value={latest?.current_best_capacity_kwh == null ? "Pending" : `${numberFormatter.format(latest.current_best_capacity_kwh)} kWh`} /><ReviewItem label="Best peak support" value={latest?.current_best_peak_support_pct == null ? "Pending" : percent(latest.current_best_peak_support_pct)} /></Box></Box></Stack>
            <Box sx={{ mt: 2, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" }, gap: 1.2 }}><MetricCard label="Current best raw annual cost" value={latest?.current_best_total_annual_cost_rs == null ? "Pending" : currencyFormatter.format(latest.current_best_total_annual_cost_rs)} tone="blue" /><Box sx={{ position: "relative" }}><MetricCard label="Current best penalized fitness" value={latest?.current_best_fitness_rs == null ? "Pending" : currencyFormatter.format(latest.current_best_fitness_rs)} tone="amber" /><Tooltip title="Fitness equals annual cost plus technical-constraint penalties."><Box component="button" type="button" aria-label="Explain penalized fitness" sx={{ position: "absolute", right: 10, top: 8, border: 0, bgcolor: "transparent", color: "#a16207", cursor: "help", fontWeight: 900 }}>?</Box></Tooltip></Box><MetricCard label="Current best feasibility" value={latest?.current_best_is_feasible == null ? "Pending" : latest.current_best_is_feasible ? "Feasible" : "Infeasible"} tone={latest?.current_best_is_feasible ? "teal" : "amber"} /></Box>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ mt: 2, justifyContent: "flex-end" }}><Button color="warning" variant="outlined" startIcon={<CancelRoundedIcon />} disabled={runState.phase === "submitting" || runState.phase === "cancelling" || !runState.jobId} onClick={cancelOptimization}>Cancel Optimization</Button></Stack>
          </Paper>
          <ConvergenceChart history={history} />
        </>
      )}

      {runState.phase === "failed" && <Paper variant="outlined" sx={{ p: { xs: 2.2, sm: 2.8 }, borderRadius: "24px", borderColor: "#f2b8b5", background: "linear-gradient(135deg, #fff, #fff5f5)" }}><Stack direction="row" spacing={1.3}><ErrorOutlineRoundedIcon sx={{ color: "#c2413a", fontSize: 30 }} /><Box><Typography variant="h6" sx={{ fontWeight: 870 }}>Optimization could not continue</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>The failed submission is not retried automatically. Review the message above, confirm the backend and settings, then return to setup.</Typography></Box></Stack><Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ mt: 2 }}><Button startIcon={<ArrowBackRoundedIcon />} onClick={onBackToSetup}>Return to Setup</Button><Button variant="outlined" startIcon={<RestartAltRoundedIcon />} onClick={() => setRunState({ phase: "ready", jobId: null, latestJob: null, error: null, startedAt: null, finishedAt: null, reconnecting: false })}>Review and try again</Button></Stack></Paper>}

      {runState.phase === "cancelled" && <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}><Button startIcon={<ArrowBackRoundedIcon />} onClick={onBackToSetup}>Return to Setup</Button><Button variant="outlined" startIcon={<RestartAltRoundedIcon />} onClick={() => setRunState({ phase: "ready", jobId: null, latestJob: null, error: null, startedAt: null, finishedAt: null, reconnecting: false })}>Prepare another run</Button></Stack>}

      {runState.phase === "completed" && result && (
        <>
          <ConvergenceChart history={history} />
          {result.solution_status === "feasible_solution" ? (<>
            <Paper elevation={0} sx={{ overflow: "hidden", borderRadius: "27px", border: "1px solid #aee2d1", boxShadow: "0 22px 54px rgba(13,148,136,0.11)" }}><Box sx={{ p: { xs: 2.3, sm: 3 }, color: "#fff", background: "linear-gradient(115deg, #0f766e, #0d9488 55%, #2563eb 125%)" }}><Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ justifyContent: "space-between", alignItems: { md: "center" } }}><Box><Stack direction="row" spacing={1} sx={{ alignItems: "center" }}><CheckCircleRoundedIcon /><Typography variant="overline" sx={{ color: "#c8fff2", fontWeight: 850 }}>FEASIBLE SOLUTION</Typography></Stack><Typography variant="h4" sx={{ mt: 0.5, fontWeight: 900 }}>Optimization completed successfully</Typography><Typography sx={{ mt: 0.8, color: "rgba(255,255,255,0.8)" }}>{result.solution_message}</Typography></Box><Chip label={`${integerFormatter.format(result.total_fitness_evaluations)} evaluations · ${formatDuration(result.runtime_seconds)}`} sx={{ color: "#fff", bgcolor: "rgba(255,255,255,0.14)", fontWeight: 800 }} /></Stack></Box><Box sx={{ p: { xs: 2.3, sm: 3 } }}><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" }, gap: 1.25 }}><MetricCard label="Best BESS capacity" value={`${numberFormatter.format(result.best_bess_capacity_kwh)} kWh`} tone="teal" /><MetricCard label="Best peak-support" value={percent(result.best_peak_support_pct)} tone="teal" /><MetricCard label="Raw total annual cost" value={currencyFormatter.format(result.total_annual_cost_rs)} tone="blue" /><MetricCard label="Penalized fitness" value={currencyFormatter.format(result.fitness_rs)} tone="amber" /></Box><Box sx={{ mt: 1.6, display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, gap: 1.25 }}><ConstraintStatus label="Peak-support success" value={result.peak_support_success_pct} threshold={result.peak_support_threshold_pct} passed={result.peak_support_constraint_passed} /><ConstraintStatus label="PV self-consumption" value={result.pv_self_consumption_pct} threshold={result.pv_self_consumption_threshold_pct} passed={result.pv_self_consumption_constraint_passed} /></Box><Divider sx={{ my: 2 }} /><ResultMetrics result={result} /></Box></Paper>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ justifyContent: "flex-end" }}><Button variant="outlined" startIcon={<TuneRoundedIcon />} onClick={onAdjustSearchBounds}>Adjust Search Bounds</Button><Button startIcon={<ArrowBackRoundedIcon />} onClick={onBackToSetup}>Return to Setup</Button></Stack></>
          ) : (
            <Paper elevation={0} sx={{ overflow: "hidden", borderRadius: "27px", border: "1px solid #efc46d", boxShadow: "0 22px 54px rgba(180,83,9,0.1)" }}><Box sx={{ p: { xs: 2.3, sm: 3 }, background: "linear-gradient(120deg, #fff7df, #fffaf0)" }}><Stack direction="row" spacing={1.2}><WarningAmberRoundedIcon sx={{ color: "#b45309", fontSize: 34 }} /><Box><Typography variant="overline" sx={{ color: "#9a6700", fontWeight: 850 }}>DIAGNOSTIC RESULT · NOT A FEASIBLE OPTIMUM</Typography><Typography variant="h5" sx={{ mt: 0.35, fontWeight: 900 }}>No candidate within the selected search bounds satisfied all technical constraints.</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.7 }}>The best penalized candidate is shown only to help you adjust the search region.</Typography></Box></Stack></Box><Box sx={{ p: { xs: 2.3, sm: 3 } }}><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(5, minmax(0, 1fr))" }, gap: 1.2 }}><MetricCard label="Diagnostic capacity" value={`${numberFormatter.format(result.best_bess_capacity_kwh)} kWh`} /><MetricCard label="Diagnostic peak support" value={percent(result.best_peak_support_pct)} /><MetricCard label="Raw annual cost" value={currencyFormatter.format(result.total_annual_cost_rs)} tone="blue" /><MetricCard label="Technical penalty" value={currencyFormatter.format(result.total_penalty_rs)} tone="amber" /><MetricCard label="Penalized fitness" value={currencyFormatter.format(result.fitness_rs)} tone="amber" /></Box><Box sx={{ mt: 1.5, display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, gap: 1.2 }}><ConstraintStatus label="Peak-support success" value={result.peak_support_success_pct} threshold={result.peak_support_threshold_pct} passed={result.peak_support_constraint_passed} /><ConstraintStatus label="PV self-consumption" value={result.pv_self_consumption_pct} threshold={result.pv_self_consumption_threshold_pct} passed={result.pv_self_consumption_constraint_passed} /></Box><Alert severity="warning" sx={{ mt: 1.5, borderRadius: "15px" }}>Failed constraints: {[!result.peak_support_constraint_passed && "peak-support success", !result.pv_self_consumption_constraint_passed && "PV self-consumption"].filter(Boolean).join(" and ")}.</Alert><Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ mt: 2 }}><Button variant="contained" startIcon={<TuneRoundedIcon />} onClick={onAdjustSearchBounds} sx={{ background: "linear-gradient(100deg, #b45309, #d97706)" }}>Adjust Search Bounds</Button><Button startIcon={<ArrowBackRoundedIcon />} onClick={onBackToSetup}>Return to Setup</Button></Stack></Box></Paper>
          )}
          <Suspense fallback={<Paper variant="outlined" sx={{ p: 3, borderRadius: "24px" }}><Stack direction="row" spacing={1.2} sx={{ alignItems: "center" }}><CircularProgress size={22} /><Typography color="text.secondary">Loading operational profile workspace…</Typography></Stack></Paper>}>
            <OperationalProfiles jobId={runState.jobId} dataset={dataset} result={result} />
          </Suspense>
        </>
      )}

      {runState.phase === "submitting" && !latest && <Stack spacing={1}><Skeleton variant="rounded" height={90} /><Skeleton variant="rounded" height={220} /></Stack>}
      <Stack direction="row" spacing={1} sx={{ justifyContent: "center", alignItems: "center", color: "text.secondary" }}><CurrencyRupeeRoundedIcon fontSize="small" /><Typography variant="caption">Raw annual cost remains separate from technical-constraint penalties and penalized fitness.</Typography><BoltRoundedIcon fontSize="small" /></Stack>
    </Stack>
  );
}
