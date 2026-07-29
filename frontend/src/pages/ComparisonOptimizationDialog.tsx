import { useEffect, useMemo, useRef, useState } from "react";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import BatteryChargingFullRoundedIcon from "@mui/icons-material/BatteryChargingFullRounded";
import CancelRoundedIcon from "@mui/icons-material/CancelRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import ScienceRoundedIcon from "@mui/icons-material/ScienceRounded";
import SettingsSuggestRoundedIcon from "@mui/icons-material/SettingsSuggestRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Step,
  StepButton,
  Stepper,
  Switch,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import type { Dispatch, SetStateAction } from "react";
import type {
  ComparisonBatteryConfiguration,
  ComparisonOptimizationConfiguration,
  ComparisonOptimizationWorkspaceState,
  ComparisonRunWorkspaceState,
  WorkspaceDatasetSummary,
  WorkspaceDispatchStrategy,
} from "../types/workspace";
import {
  buildCompletedComparisonSnapshot,
  buildComparisonInputSignature,
  enabledBatteryCount,
  estimatedComparisonEvaluations,
  expireComparisonRun,
  isActiveComparisonRun,
  isValidComparisonJobResponse,
  mapComparisonRunRequest,
  mergeComparisonJobProgress,
  reviseComparisonConfiguration,
  validateComparisonConfiguration,
} from "../lib/comparisonOptimization.ts";

const STEPS = ["Batteries", "Search Bounds", "GA Settings", "Economic Settings", "Review and Run", "Progress and Results"];
const POLL_INTERVAL_MS = 1000;
const currency = new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("en-LK", { maximumFractionDigits: 2 });

interface Props {
  open: boolean;
  configuration: ComparisonOptimizationConfiguration;
  dataset: WorkspaceDatasetSummary | null;
  dispatchStrategy: WorkspaceDispatchStrategy;
  runState: ComparisonRunWorkspaceState;
  completedComparison: ComparisonOptimizationWorkspaceState | null;
  rankingReady: boolean;
  onConfigurationChange: (configuration: ComparisonOptimizationConfiguration) => void;
  onRunStateChange: Dispatch<SetStateAction<ComparisonRunWorkspaceState>>;
  onCompleted: (comparison: ComparisonOptimizationWorkspaceState) => void;
  onInvalidateScientificState: () => void;
  onOpenAHP: () => void;
  onOpenResults: () => void;
  onClose: () => void;
}

async function responseError(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((entry) => typeof entry === "object" && entry && "msg" in entry ? String(entry.msg) : String(entry)).join(" ");
  }
  return `Backend returned HTTP ${response.status}.`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <Paper variant="outlined" sx={{ p: 1.5, borderRadius: "16px", borderColor: "#d7e7e8", bgcolor: "rgba(255,255,255,.85)" }}><Typography variant="caption" color="text.secondary" sx={{ fontWeight: 750 }}>{label}</Typography><Typography variant="subtitle2" sx={{ mt: .35, fontWeight: 850 }}>{value}</Typography></Paper>;
}

function NumericField({ label, value, onChange, suffix, error }: { label: string; value: number; onChange: (value: number) => void; suffix?: string; error?: boolean }) {
  return <TextField type="number" label={label} value={Number.isNaN(value) ? "" : value} onChange={(event) => onChange(event.target.value === "" ? Number.NaN : Number(event.target.value))} error={error} helperText={suffix} fullWidth slotProps={{ htmlInput: { step: "any" } }} />;
}

export default function ComparisonOptimizationDialog({
  open,
  configuration,
  dataset,
  dispatchStrategy,
  runState,
  completedComparison,
  rankingReady,
  onConfigurationChange,
  onRunStateChange,
  onCompleted,
  onInvalidateScientificState,
  onOpenAHP,
  onOpenResults,
  onClose,
}: Props) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [step, setStep] = useState(0);
  const [editingBattery, setEditingBattery] = useState<string | null>(null);
  const pollFailures = useRef(0);
  const active = isActiveComparisonRun(runState);
  const errors = useMemo(() => validateComparisonConfiguration(configuration, dataset, dispatchStrategy), [configuration, dataset, dispatchStrategy]);
  const enabledCount = enabledBatteryCount(configuration);
  const estimate = estimatedComparisonEvaluations(configuration);
  const latest = runState.latestJob;
  const displayProgress = Math.max(runState.maximumObservedProgressPercent, latest?.overall_progress_percent ?? 0);

  const changeConfiguration = (next: ComparisonOptimizationConfiguration) => {
    onConfigurationChange(next);
    onInvalidateScientificState();
  };

  useEffect(() => {
    if (!runState.jobId || !["queued", "running", "cancelling"].includes(runState.phase)) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/comparison-optimization/jobs/${encodeURIComponent(runState.jobId!)}`, { headers: { Accept: "application/json" } });
        if (response.status === 404) {
          if (!stopped) onRunStateChange((current) => expireComparisonRun(current));
          return;
        }
        if (!response.ok) throw new Error(await responseError(response));
        const payload: unknown = await response.json();
        if (!isValidComparisonJobResponse(payload)) throw new Error("The comparison backend returned a malformed progress response.");
        if (stopped) return;
        pollFailures.current = 0;
        const job = mergeComparisonJobProgress(runState.latestJob, payload);
        const terminal = ["completed", "failed", "cancelled"].includes(job.status);
        const nextState: ComparisonRunWorkspaceState = {
          ...runState,
          phase: job.status,
          latestJob: job,
          maximumObservedProgressPercent: Math.max(runState.maximumObservedProgressPercent, job.overall_progress_percent),
          error: job.status === "failed" ? { code: "COMPARISON_FAILED", message: job.error ?? "The comparison job failed." } : null,
          reconnecting: false,
          finishedAt: terminal ? Date.now() : null,
        };
        onRunStateChange(nextState);
        if (job.status === "completed" && job.final_result) onCompleted(buildCompletedComparisonSnapshot(job, nextState));
        if (!terminal) timer = window.setTimeout(poll, POLL_INTERVAL_MS);
      } catch (error) {
        if (stopped) return;
        pollFailures.current += 1;
        onRunStateChange((current) => ({ ...current, reconnecting: true, error: { code: "POLLING_RECONNECT", message: `Connection interrupted. Reconnecting (attempt ${pollFailures.current})…` } }));
        timer = window.setTimeout(poll, Math.min(1000 + pollFailures.current * 500, 4000));
      }
    };
    void poll();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [onCompleted, onRunStateChange, runState]);

  async function startComparison() {
    if (active) return;
    let request;
    try {
      request = mapComparisonRunRequest(configuration, dataset, dispatchStrategy);
    } catch (error) {
      onRunStateChange((current) => ({ ...current, phase: "failed", error: { code: "INVALID_CONFIGURATION", message: error instanceof Error ? error.message : "The comparison configuration is invalid." }, finishedAt: Date.now() }));
      return;
    }
    const submittedInputSignature = buildComparisonInputSignature(configuration, dataset, dispatchStrategy);
    const startedAt = Date.now();
    onRunStateChange({ phase: "submitting", jobId: null, submittedConfigurationRevision: configuration.revision, submittedBatteryConfigurationRevision: configuration.batteryConfigurationRevision, submittedInputSignature, latestJob: null, maximumObservedProgressPercent: 0, error: null, startedAt, finishedAt: null, reconnecting: false });
    setStep(5);
    try {
      const response = await fetch("/api/comparison-optimization/run", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(request) });
      if (!response.ok) throw new Error(await responseError(response));
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || typeof (payload as { job_id?: unknown }).job_id !== "string" || (payload as { status?: unknown }).status !== "queued") throw new Error("The comparison backend returned an invalid submission response.");
      const jobId = (payload as { job_id: string }).job_id;
      onRunStateChange((current) => ({ ...current, phase: "queued", jobId, error: null }));
    } catch (error) {
      onRunStateChange((current) => ({ ...current, phase: "failed", error: { code: error instanceof TypeError ? "BACKEND_UNAVAILABLE" : "SUBMISSION_FAILED", message: error instanceof Error ? error.message : "The comparison could not be submitted." }, finishedAt: Date.now() }));
    }
  }

  async function cancelComparison() {
    if (!runState.jobId || !active) return;
    onRunStateChange((current) => ({ ...current, phase: "cancelling", error: null }));
    try {
      const response = await fetch(`/api/comparison-optimization/jobs/${encodeURIComponent(runState.jobId)}/cancel`, { method: "POST", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(await responseError(response));
      const payload: unknown = await response.json();
      if (!isValidComparisonJobResponse(payload)) throw new Error("The backend returned an invalid cancellation response.");
      const job = mergeComparisonJobProgress(runState.latestJob, payload);
      onRunStateChange((current) => ({ ...current, phase: job.status === "cancelled" ? "cancelled" : "cancelling", latestJob: job, maximumObservedProgressPercent: Math.max(current.maximumObservedProgressPercent, job.overall_progress_percent), finishedAt: job.status === "cancelled" ? Date.now() : null, error: null }));
    } catch (error) {
      onRunStateChange((current) => ({ ...current, phase: current.latestJob?.status === "running" ? "running" : "queued", error: { code: "CANCEL_FAILED", message: error instanceof Error ? error.message : "Cancellation could not be requested." } }));
    }
  }

  const batteryContent = <Stack spacing={2}>
    <Alert severity={enabledCount >= 2 ? "info" : "warning"}>Enable at least two alternatives. Warranty remains manufacturer information; calculated service life is produced by the GA evaluator.</Alert>
    {configuration.batteries.map((option) => {
      const editing = editingBattery === option.id;
      const battery = option.battery;
      const updateBattery = (patch: Partial<ComparisonBatteryConfiguration>) => changeConfiguration(reviseComparisonConfiguration(configuration, { batteries: configuration.batteries.map((entry) => entry.id === option.id ? { ...entry, battery: { ...entry.battery, ...patch } } : entry) }, true));
      return <Paper key={option.id} variant="outlined" sx={{ p: 2, borderRadius: "20px", borderColor: option.enabled ? "#9ed7d0" : "#d8e1e4", background: option.enabled ? "linear-gradient(120deg,#f0fdfa,#f7fbff)" : "#f7f8f9" }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}><BatteryChargingFullRoundedIcon color={option.enabled ? "primary" : "disabled"} /><Box sx={{ flex: 1 }}><Typography variant="h6" sx={{ fontWeight: 850 }}>{battery.name}</Typography><Typography variant="body2" color="text.secondary">Round-trip efficiency {(battery.eta_ch * battery.eta_dis * 100).toFixed(2)}% · Warranty {number.format(battery.warranty_years)} years</Typography></Box><FormControlLabel control={<Switch checked={option.enabled} onChange={(event) => changeConfiguration(reviseComparisonConfiguration(configuration, { batteries: configuration.batteries.map((entry) => entry.id === option.id ? { ...entry, enabled: event.target.checked } : entry) }, true))} />} label={option.enabled ? "Enabled" : "Disabled"} /><Button startIcon={<EditRoundedIcon />} onClick={() => setEditingBattery(editing ? null : option.id)}>{editing ? "Done" : "Edit"}</Button></Stack>
        {editing && <Box sx={{ mt: 2, pt: 2, borderTop: "1px solid #d8e7e7", display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2,minmax(0,1fr))" }, gap: 1.5 }}><TextField label="Battery name" value={battery.name} onChange={(event) => updateBattery({ name: event.target.value })} /><NumericField label="Price" value={battery.price_rs_per_kwh} suffix="LKR/kWh" onChange={(value) => updateBattery({ price_rs_per_kwh: value })} /><NumericField label="Rated cycle life" value={battery.rated_cycle_life} onChange={(value) => updateBattery({ rated_cycle_life: value })} /><NumericField label="Charge efficiency" value={battery.eta_ch} suffix="Decimal, up to 1" onChange={(value) => updateBattery({ eta_ch: value })} /><NumericField label="Discharge efficiency" value={battery.eta_dis} suffix="Decimal, up to 1" onChange={(value) => updateBattery({ eta_dis: value })} /><NumericField label="Weight density" value={battery.weight_density_kg_per_kwh} suffix="kg/kWh" onChange={(value) => updateBattery({ weight_density_kg_per_kwh: value })} /><NumericField label="Manufacturer warranty" value={battery.warranty_years} suffix="years" onChange={(value) => updateBattery({ warranty_years: value })} /></Box>}
      </Paper>;
    })}
  </Stack>;

  const boundsContent = <Stack spacing={2}><Alert severity={dataset ? "success" : "warning"}>{dataset ? `${dataset.filename} · ${dataset.rowCount.toLocaleString()} rows · ${dataset.startDate} to ${dataset.endDate} · ID ${dataset.datasetId}` : "No dataset is available. Upload and validate a dataset before starting."}</Alert>{dispatchStrategy.status === "Modified Strategy" && <Alert severity="warning">The modified dispatch strategy will be supported after scientific parity validation.</Alert>}<Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2,minmax(0,1fr))" }, gap: 2 }}><NumericField label="Minimum BESS capacity" suffix="kWh" value={configuration.minimumBessCapacityKwh} onChange={(value) => changeConfiguration(reviseComparisonConfiguration(configuration, { minimumBessCapacityKwh: value }))} /><NumericField label="Maximum BESS capacity" suffix="kWh" value={configuration.maximumBessCapacityKwh} onChange={(value) => changeConfiguration(reviseComparisonConfiguration(configuration, { maximumBessCapacityKwh: value }))} /><NumericField label="Minimum peak support" suffix="%" value={configuration.minimumPeakSupportPct} onChange={(value) => changeConfiguration(reviseComparisonConfiguration(configuration, { minimumPeakSupportPct: value }))} /><NumericField label="Maximum peak support" suffix="%" value={configuration.maximumPeakSupportPct} onChange={(value) => changeConfiguration(reviseComparisonConfiguration(configuration, { maximumPeakSupportPct: value }))} /></Box></Stack>;

  const gaContent = <Stack spacing={2}><Alert severity="info" icon={<SettingsSuggestRoundedIcon />}>Advanced settings control the existing backend GA. Fitness is calculated only by the backend.</Alert><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2,minmax(0,1fr))" }, gap: 2 }}>{([ ["Population size", "populationSize"], ["Generations", "generations"], ["Mutation probability", "mutationProbability"], ["Elite count", "eliteCount"], ["Random seed", "randomSeed"] ] as const).map(([label, key]) => <NumericField key={key} label={label} value={configuration.gaSettings[key]} onChange={(value) => changeConfiguration(reviseComparisonConfiguration(configuration, { gaSettings: { ...configuration.gaSettings, [key]: value } }))} />)}</Box><Paper variant="outlined" sx={{ p: 2, borderRadius: "18px", bgcolor: "#f0fdfa" }}><Typography variant="overline" color="primary.main" sx={{ fontWeight: 850 }}>Estimated fitness evaluations</Typography><Typography variant="h4" sx={{ fontWeight: 880 }}>{estimate.toLocaleString()}</Typography><Typography variant="body2" color="text.secondary">{enabledCount} batteries × {configuration.gaSettings.populationSize} population × {configuration.gaSettings.generations} generations</Typography></Paper></Stack>;

  const economicContent = <Stack spacing={2}><Alert severity="info">The discount rate is submitted directly for present-value and annualization calculations. No inflation or real-rate conversion is used.</Alert><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2,minmax(0,1fr))" }, gap: 2 }}><NumericField label="Project life" suffix="years" value={configuration.economicSettings.projectLifeYears} onChange={(value) => changeConfiguration(reviseComparisonConfiguration(configuration, { economicSettings: { ...configuration.economicSettings, projectLifeYears: value } }))} /><NumericField label="Discount rate" suffix="%" value={configuration.economicSettings.discountRate * 100} onChange={(value) => changeConfiguration(reviseComparisonConfiguration(configuration, { economicSettings: { ...configuration.economicSettings, discountRate: value / 100 } }))} /><NumericField label="Export tariff" suffix="LKR/kWh" value={configuration.economicSettings.exportTariffRsPerKwh} onChange={(value) => changeConfiguration(reviseComparisonConfiguration(configuration, { economicSettings: { ...configuration.economicSettings, exportTariffRsPerKwh: value } }))} /><NumericField label="Annual O&M" suffix="% of CAPEX" value={configuration.economicSettings.annualOmFraction * 100} onChange={(value) => changeConfiguration(reviseComparisonConfiguration(configuration, { economicSettings: { ...configuration.economicSettings, annualOmFraction: value / 100 } }))} /><NumericField label="Replacement cost" suffix="% of CAPEX" value={configuration.economicSettings.replacementCostFraction * 100} onChange={(value) => changeConfiguration(reviseComparisonConfiguration(configuration, { economicSettings: { ...configuration.economicSettings, replacementCostFraction: value / 100 } }))} /><FormControlLabel control={<Switch checked={configuration.economicSettings.residualValueEnabled} onChange={(event) => changeConfiguration(reviseComparisonConfiguration(configuration, { economicSettings: { ...configuration.economicSettings, residualValueEnabled: event.target.checked } }))} />} label="Residual value enabled" /></Box></Stack>;

  const reviewContent = <Stack spacing={2}>{errors.length > 0 && <Alert severity="warning"><Typography variant="subtitle2" sx={{ fontWeight: 850 }}>Resolve before starting</Typography>{errors.map((error) => <Typography key={error} variant="body2">• {error}</Typography>)}</Alert>}<Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2,minmax(0,1fr))", lg: "repeat(3,minmax(0,1fr))" }, gap: 1.5 }}><Stat label="Dataset" value={dataset?.filename ?? "Missing"} /><Stat label="Dispatch" value={dispatchStrategy.status} /><Stat label="Enabled batteries" value={`${enabledCount} of ${configuration.batteries.length}`} /><Stat label="Capacity range" value={`${number.format(configuration.minimumBessCapacityKwh)}–${number.format(configuration.maximumBessCapacityKwh)} kWh`} /><Stat label="Peak-support range" value={`${number.format(configuration.minimumPeakSupportPct)}–${number.format(configuration.maximumPeakSupportPct)}%`} /><Stat label="Estimated evaluations" value={estimate.toLocaleString()} /><Stat label="Project life" value={`${configuration.economicSettings.projectLifeYears} years`} /><Stat label="Discount rate" value={`${number.format(configuration.economicSettings.discountRate * 100)}%`} /><Stat label="Configuration revision" value={`#${configuration.revision}`} /></Box></Stack>;

  const partialResults = latest?.partial_results ?? [];
  const progressContent = <Stack spacing={2}>{runState.error && <Alert severity={runState.error.code === "POLLING_RECONNECT" ? "warning" : "error"} icon={<ErrorOutlineRoundedIcon />}><Typography variant="subtitle2" sx={{ fontWeight: 850 }}>{runState.error.code ?? "Comparison error"}</Typography><Typography variant="body2">{runState.error.message}</Typography></Alert>}{runState.phase === "cancelling" && <Alert severity="warning">Cancellation requested. The current generation may finish before stopping; later batteries will not start.</Alert>}{runState.phase === "cancelled" && <Alert severity="info">Comparison cancelled. Completed batteries remain below as partial results and no final comparison is presented.</Alert>}{runState.phase === "expired" && <Alert severity="warning">Comparison job expired. The backend’s in-memory job was lost, but the submitted configuration remains available for rerun.</Alert>}<Paper variant="outlined" sx={{ p: 2.3, borderRadius: "22px", background: "linear-gradient(120deg,#f0fdfa,#eff6ff)" }}><Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}><Box><Typography variant="overline" color="primary.main" sx={{ fontWeight: 850 }}>{runState.reconnecting ? "RECONNECTING" : runState.phase.toUpperCase()}</Typography><Typography variant="h5" sx={{ fontWeight: 880 }}>{latest?.current_battery_name ?? (active ? "Preparing comparison" : "Comparison summary")}</Typography></Box><Chip label={`${number.format(displayProgress)}%`} color={runState.phase === "failed" ? "error" : "primary"} /></Stack><LinearProgress variant={runState.phase === "submitting" || runState.phase === "queued" ? "indeterminate" : "determinate"} value={displayProgress} sx={{ mt: 2, height: 10, borderRadius: 99 }} /><Box sx={{ mt: 2, display: "grid", gridTemplateColumns: { xs: "repeat(2,minmax(0,1fr))", md: "repeat(4,minmax(0,1fr))" }, gap: 1 }}><Stat label="Battery" value={`${latest ? Math.min(latest.current_battery_index + 1, latest.total_batteries) : 0} / ${latest?.total_batteries ?? enabledCount}`} /><Stat label="Completed batteries" value={`${latest?.completed_battery_count ?? 0} / ${latest?.total_batteries ?? enabledCount}`} /><Stat label="Generation" value={`${latest?.current_generation ?? 0} / ${latest?.total_generations ?? configuration.gaSettings.generations}`} /><Stat label="Current evaluations" value={`${latest?.current_battery_evaluations_completed ?? 0} / ${latest?.current_battery_estimated_evaluations ?? configuration.gaSettings.populationSize * configuration.gaSettings.generations}`} /><Stat label="Total evaluations" value={`${latest?.total_evaluations_completed ?? 0} / ${latest?.total_estimated_evaluations ?? estimate}`} /><Stat label="Best capacity" value={latest?.current_best_capacity_kwh == null ? "Pending" : `${number.format(latest.current_best_capacity_kwh)} kWh`} /><Stat label="Best peak support" value={latest?.current_best_peak_support_pct == null ? "Pending" : `${number.format(latest.current_best_peak_support_pct)}%`} /><Stat label="Best fitness" value={latest?.current_best_fitness_rs == null ? "Pending" : currency.format(latest.current_best_fitness_rs)} /></Box></Paper>{completedComparison && !completedComparison.stale && <Alert severity={completedComparison.finalResult.comparison_solution_status === "completed_all_batteries" ? "success" : "warning"} icon={<CheckCircleRoundedIcon />}><Typography variant="subtitle2" sx={{ fontWeight: 850 }}>{completedComparison.finalResult.comparison_solution_status === "completed_all_batteries" ? "Stage 1 ready · all alternatives feasible" : "Stage 1 ready with infeasible alternatives"}</Typography><Typography variant="body2">{completedComparison.finalResult.feasible_battery_count} feasible · {completedComparison.finalResult.infeasible_battery_count} infeasible. {completedComparison.finalResult.feasible_battery_count < 2 ? "At least two feasible alternatives are required for PROMETHEE." : "The result is ready for AHP and PROMETHEE."}</Typography></Alert>}{partialResults.length > 0 && <Box><Typography variant="h6" sx={{ mb: 1.2 }}>Completed battery results <Chip label="Partial until the full job completes" size="small" sx={{ ml: 1 }} /></Typography><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2,minmax(0,1fr))" }, gap: 1.5 }}>{partialResults.map((result) => <Paper key={result.battery_name} variant="outlined" sx={{ p: 2, borderRadius: "18px" }}><Stack direction="row" sx={{ justifyContent: "space-between" }}><Typography variant="h6" sx={{ fontWeight: 850 }}>{result.battery_name}</Typography><Chip size="small" label={result.is_feasible ? "Feasible" : "Infeasible"} color={result.is_feasible ? "success" : "warning"} /></Stack><Typography variant="body2" color="text.secondary" sx={{ mt: .7 }}>{number.format(result.best_bess_capacity_kwh)} kWh · {number.format(result.best_peak_support_pct)}% peak support</Typography><Typography variant="subtitle2" sx={{ mt: 1 }}>{currency.format(result.best_total_annual_cost_rs)} raw annual cost</Typography></Paper>)}</Box></Box>}</Stack>;

  const content = [batteryContent, boundsContent, gaContent, economicContent, reviewContent, progressContent][step];
  const canConfigureAHP = Boolean(completedComparison && !completedComparison.stale && completedComparison.finalResult.feasible_battery_count >= 2);

  return <Dialog open={open} onClose={active ? undefined : onClose} fullScreen={fullScreen} fullWidth maxWidth="xl" aria-labelledby="comparison-runner-title" slotProps={{ paper: { sx: { height: fullScreen ? "100%" : "calc(100vh - 32px)", maxHeight: fullScreen ? "100%" : 980, borderRadius: fullScreen ? 0 : "26px", overflow: "hidden", "@media (prefers-reduced-motion: reduce)": { transition: "none" } } } }}>
    <DialogTitle id="comparison-runner-title" sx={{ p: 0 }}><Box sx={{ px: { xs: 2, md: 3 }, py: 2, color: "#fff", background: "linear-gradient(112deg,#073e49,#0f766e 60%,#1769a8)" }}><Stack direction="row" spacing={2} sx={{ alignItems: "center" }}><ScienceRoundedIcon /><Box sx={{ flex: 1 }}><Typography variant="overline" sx={{ color: "#a7f3d0", fontWeight: 850 }}>Comparison Stage 1</Typography><Typography variant="h5" sx={{ fontWeight: 880 }}>Configure and run fixed-type optimization</Typography></Box><Chip label={runState.phase.replaceAll("_", " ")} sx={{ color: "#fff", bgcolor: "rgba(255,255,255,.15)", fontWeight: 800 }} /><IconButton aria-label="Close comparison runner" onClick={onClose} disabled={active} sx={{ color: "#fff" }}><CloseRoundedIcon /></IconButton></Stack></Box><Box sx={{ px: { xs: 1, md: 3 }, py: 1.5, borderBottom: "1px solid #dce7e9", overflowX: "auto" }}><Stepper nonLinear activeStep={step} alternativeLabel={!fullScreen}>{STEPS.map((label, index) => <Step key={label}><StepButton onClick={() => setStep(index)}>{label}</StepButton></Step>)}</Stepper></Box></DialogTitle>
    <DialogContent sx={{ px: { xs: 2, md: 3 }, py: 2.5, bgcolor: "#f7f9fa" }}>{content}</DialogContent>
    <DialogActions sx={{ px: { xs: 2, md: 3 }, py: 1.5, borderTop: "1px solid #dce7e9", justifyContent: "space-between" }}><Button startIcon={<ArrowBackRoundedIcon />} onClick={() => step > 0 ? setStep(step - 1) : onClose()} disabled={active && step === 0}>{step > 0 ? "Back" : "Close"}</Button><Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", justifyContent: "flex-end" }}>{!active && <Button startIcon={<SaveRoundedIcon />} onClick={() => onConfigurationChange({ ...configuration, savedAt: new Date().toISOString() })}>Save Configuration</Button>}{active && <Button color="warning" variant="outlined" startIcon={<CancelRoundedIcon />} onClick={() => void cancelComparison()} disabled={runState.phase === "submitting" || runState.phase === "cancelling"}>Cancel Run</Button>}{["failed", "cancelled", "expired"].includes(runState.phase) && <Button startIcon={<RestartAltRoundedIcon />} onClick={() => void startComparison()} disabled={errors.length > 0}>Retry</Button>}{canConfigureAHP && <Button onClick={onOpenAHP}>View AHP</Button>}{rankingReady && <Button onClick={onOpenResults}>Open Results</Button>}{step < 4 && <Button variant="contained" endIcon={<ArrowForwardRoundedIcon />} onClick={() => setStep(step + 1)}>Continue</Button>}{step === 4 && <Button variant="contained" startIcon={<PlayArrowRoundedIcon />} onClick={() => void startComparison()} disabled={errors.length > 0 || active}>Start Comparison</Button>}</Stack></DialogActions>
  </Dialog>;
}
