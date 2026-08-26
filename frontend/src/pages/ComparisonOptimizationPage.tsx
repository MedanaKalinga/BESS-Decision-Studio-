import { useEffect, useMemo, useRef, useState } from "react";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import BatteryChargingFullRoundedIcon from "@mui/icons-material/BatteryChargingFullRounded";
import CancelRoundedIcon from "@mui/icons-material/CancelRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import SettingsSuggestRoundedIcon from "@mui/icons-material/SettingsSuggestRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  LinearProgress,
  Paper,
  Stack,
  Step,
  StepButton,
  Stepper,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type {
  ComparisonAHPWorkspaceState,
  ComparisonBatteryConfiguration,
  ComparisonOptimizationConfiguration,
  ComparisonOptimizationWorkspaceState,
  ComparisonRunWorkspaceState,
  PrometheeWorkspaceState,
  WorkspaceDatasetSummary,
  WorkspaceDispatchStrategy,
} from "../types/workspace";
import { batteryTypeLabel } from "../lib/batteryCatalogue";
import {
  INITIAL_COMPARISON_RUN_STATE,
  buildCompletedComparisonSnapshot,
  buildComparisonInputSignature,
  comparisonRunEndpoint,
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
import {
  canStartComparison,
  canVisitComparisonStep,
  comparisonStepAfterSave,
  comparisonErrorsForStep,
  initialComparisonStep,
  previousComparisonStep,
} from "../lib/optimizationWorkflow";
import {
  isAHPCurrent,
  isComparisonCurrent,
  isPrometheeResultStale,
} from "../lib/comparisonResults";
import {
  decisionStageActionLabel,
  deriveComparisonDecisionStage,
} from "../lib/comparisonDecisionWorkflow";

const STEPS = [
  "Battery Alternatives",
  "Search Bounds",
  "GA Settings",
  "Economic Settings",
  "Dispatch and Constraints",
  "Review",
  "Run",
  "Comparison Summary",
];
const POLL_INTERVAL_MS = 1000;
const currency = new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("en-LK", { maximumFractionDigits: 2 });

interface Props {
  projectId: string;
  open?: boolean;
  configuration: ComparisonOptimizationConfiguration;
  dataset: WorkspaceDatasetSummary | null;
  dispatchStrategy: WorkspaceDispatchStrategy;
  runState: ComparisonRunWorkspaceState;
  completedComparison: ComparisonOptimizationWorkspaceState | null;
  ahpState: ComparisonAHPWorkspaceState | null;
  prometheeState: PrometheeWorkspaceState | null;
  onConfigurationChange: (configuration: ComparisonOptimizationConfiguration) => void;
  onRunStateChange: Dispatch<SetStateAction<ComparisonRunWorkspaceState>>;
  onCompleted: (comparison: ComparisonOptimizationWorkspaceState) => void;
  onInvalidateScientificState: () => void;
  onOpenAHP: () => void;
  onOpenResults: () => void;
  onOpenDetailedResults: () => void;
  onBackToModes?: () => void;
  onViewDashboard?: () => void;
  startBlockedReason?: string | null;
  onViewActiveRun?: () => void;
  onClose?: () => void;
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
  return <Paper variant="outlined" sx={{ p: 1.5, borderRadius: "16px", borderColor: "divider", bgcolor: "rgba(255,255,255,.025)" }}><Typography variant="caption" color="text.secondary" sx={{ fontWeight: 750 }}>{label}</Typography><Typography variant="subtitle2" sx={{ mt: .35, color: "text.primary", fontWeight: 850 }}>{value}</Typography></Paper>;
}

function ReviewSection({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: "19px", borderColor: "#d7e5e9" }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>{title}</Typography>
        <Button size="small" startIcon={<EditRoundedIcon />} onClick={onEdit}>Edit</Button>
      </Stack>
      <Box sx={{ mt: 1.2 }}>{children}</Box>
    </Paper>
  );
}

function NumericField({ label, value, onChange, suffix, error }: { label: string; value: number; onChange: (value: number) => void; suffix?: string; error?: boolean }) {
  return <TextField type="number" label={label} value={Number.isNaN(value) ? "" : value} onChange={(event) => onChange(event.target.value === "" ? Number.NaN : Number(event.target.value))} error={error} helperText={suffix} fullWidth slotProps={{ htmlInput: { step: "any" } }} />;
}

export default function ComparisonOptimizationPage({
  projectId,
  configuration,
  dataset,
  dispatchStrategy,
  runState,
  completedComparison,
  ahpState,
  prometheeState,
  onConfigurationChange,
  onRunStateChange,
  onCompleted,
  onInvalidateScientificState,
  onOpenAHP,
  onOpenResults,
  onOpenDetailedResults,
  onBackToModes,
  onViewDashboard,
  startBlockedReason = null,
  onViewActiveRun,
  onClose,
}: Props) {
  const leaveToModes = onBackToModes ?? onClose ?? (() => undefined);
  const leaveToDashboard = onViewDashboard ?? leaveToModes;
  const [step, setStep] = useState(() => initialComparisonStep(runState.phase, configuration.workflowStep));
  const [returnToReview, setReturnToReview] = useState(false);
  const [editingBattery, setEditingBattery] = useState<string | null>(null);
  const pollFailures = useRef(0);
  const active = isActiveComparisonRun(runState);
  const errors = useMemo(() => validateComparisonConfiguration(configuration, dataset, dispatchStrategy), [configuration, dataset, dispatchStrategy]);
  const enabledCount = enabledBatteryCount(configuration);
  const estimate = estimatedComparisonEvaluations(configuration);
  const latest = runState.latestJob;
  const displayProgress = Math.max(runState.maximumObservedProgressPercent, latest?.overall_progress_percent ?? 0);
  const scientificContext = { projectId, datasetId: dataset?.datasetId ?? null };
  const comparisonCurrent = isComparisonCurrent(completedComparison, scientificContext);
  const ahpCurrent = isAHPCurrent(ahpState, completedComparison, scientificContext);
  const rankingReady = Boolean(
    prometheeState
    && !isPrometheeResultStale(
      prometheeState,
      completedComparison,
      ahpState,
      scientificContext,
    ),
  );
  const decisionStage = deriveComparisonDecisionStage({
    comparison: completedComparison,
    ahp: ahpState,
    promethee: prometheeState,
    context: scientificContext,
    comparisonRunning: active,
  });

  useEffect(() => {
    if (active) {
      setStep(6);
    }
  }, [active]);

  const goToStep = (nextStep: number) => {
    const normalizedStep = Math.max(0, Math.min(6, nextStep));
    setStep(normalizedStep);
    onConfigurationChange({ ...configuration, workflowStep: normalizedStep });
  };

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
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/comparison-optimization/jobs/${encodeURIComponent(runState.jobId!)}`, { credentials: "include", headers: { Accept: "application/json" } });
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
    if (startBlockedReason || !canStartComparison(step, active, errors)) return;
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
    goToStep(6);
    try {
      const response = await fetch(comparisonRunEndpoint(projectId), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(request) });
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
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/comparison-optimization/jobs/${encodeURIComponent(runState.jobId)}/cancel`, { method: "POST", credentials: "include", headers: { Accept: "application/json" } });
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
    <Alert severity={enabledCount >= 2 ? "info" : "warning"}>Enable at least two alternatives. Warranty is manufacturer data; GA calculates service life.</Alert>
    {configuration.batteries.map((option) => {
      const editing = editingBattery === option.id;
      const battery = option.battery;
      const updateBattery = (patch: Partial<ComparisonBatteryConfiguration>) => changeConfiguration(reviseComparisonConfiguration(configuration, { batteries: configuration.batteries.map((entry) => entry.id === option.id ? { ...entry, battery: { ...entry.battery, ...patch } } : entry) }, true));
      return <Paper key={option.id} variant="outlined" sx={{ p: 2, borderRadius: "20px", borderColor: option.enabled ? "primary.main" : "divider", background: option.enabled ? "rgba(155,239,74,.055)" : "rgba(255,255,255,.02)" }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { xs: "stretch", sm: "center" } }}><BatteryChargingFullRoundedIcon color={option.enabled ? "primary" : "disabled"} /><Box sx={{ flex: 1 }}><Typography variant="h6" sx={{ fontWeight: 850 }}>{batteryTypeLabel(battery.name)}</Typography><Typography variant="body2" color="text.secondary">Round-trip efficiency {(battery.eta_ch * battery.eta_dis * 100).toFixed(2)}% · Warranty {number.format(battery.warranty_years)} years</Typography></Box><FormControlLabel control={<Switch checked={option.enabled} onChange={(event) => changeConfiguration(reviseComparisonConfiguration(configuration, { batteries: configuration.batteries.map((entry) => entry.id === option.id ? { ...entry, enabled: event.target.checked } : entry) }, true))} />} label={option.enabled ? "Enabled" : "Disabled"} /><Button startIcon={<EditRoundedIcon />} onClick={() => setEditingBattery(editing ? null : option.id)}>{editing ? "Done" : "Edit"}</Button></Stack>
        {editing && <Box sx={{ mt: 2, pt: 2, borderTop: "1px solid #d8e7e7", display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2,minmax(0,1fr))" }, gap: 1.5 }}><TextField label="Battery name" value={battery.name} onChange={(event) => updateBattery({ name: event.target.value })} /><NumericField label="Price" value={battery.price_rs_per_kwh} suffix="LKR/kWh" onChange={(value) => updateBattery({ price_rs_per_kwh: value })} /><NumericField label="Rated cycle life" value={battery.rated_cycle_life} onChange={(value) => updateBattery({ rated_cycle_life: value })} /><NumericField label="Charge efficiency" value={battery.eta_ch} suffix="Decimal, up to 1" onChange={(value) => updateBattery({ eta_ch: value })} /><NumericField label="Discharge efficiency" value={battery.eta_dis} suffix="Decimal, up to 1" onChange={(value) => updateBattery({ eta_dis: value })} /><NumericField label="Weight density" value={battery.weight_density_kg_per_kwh} suffix="kg/kWh" onChange={(value) => updateBattery({ weight_density_kg_per_kwh: value })} /><NumericField label="Manufacturer warranty" value={battery.warranty_years} suffix="years" onChange={(value) => updateBattery({ warranty_years: value })} /></Box>}
      </Paper>;
    })}
  </Stack>;

  const boundsContent = <Stack spacing={2}>
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2,minmax(0,1fr))" }, gap: 2 }}>
      <NumericField label="Minimum BESS capacity" suffix="kWh" value={configuration.minimumBessCapacityKwh} onChange={(value) => changeConfiguration(reviseComparisonConfiguration(configuration, { minimumBessCapacityKwh: value }))} />
      <NumericField label="Maximum BESS capacity" suffix="kWh" value={configuration.maximumBessCapacityKwh} onChange={(value) => changeConfiguration(reviseComparisonConfiguration(configuration, { maximumBessCapacityKwh: value }))} />
      <NumericField label="Minimum peak support" suffix="%" value={configuration.minimumPeakSupportPct} onChange={(value) => changeConfiguration(reviseComparisonConfiguration(configuration, { minimumPeakSupportPct: value }))} />
      <NumericField label="Maximum peak support" suffix="%" value={configuration.maximumPeakSupportPct} onChange={(value) => changeConfiguration(reviseComparisonConfiguration(configuration, { maximumPeakSupportPct: value }))} />
    </Box>
  </Stack>;

  const gaContent = <Stack spacing={2}><Alert severity="info" icon={<SettingsSuggestRoundedIcon />}>GA search settings; the backend computes fitness.</Alert><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2,minmax(0,1fr))" }, gap: 2 }}>{([ ["Population size", "populationSize"], ["Generations", "generations"], ["Mutation probability", "mutationProbability"], ["Elite count", "eliteCount"], ["Random seed", "randomSeed"] ] as const).map(([label, key]) => <NumericField key={key} label={label} value={configuration.gaSettings[key]} onChange={(value) => changeConfiguration(reviseComparisonConfiguration(configuration, { gaSettings: { ...configuration.gaSettings, [key]: value } }))} />)}</Box><Paper variant="outlined" sx={{ p: 2, borderRadius: "18px", borderColor: "divider", bgcolor: "rgba(155,239,74,.055)" }}><Typography variant="overline" color="primary.main" sx={{ fontWeight: 850 }}>Estimated fitness evaluations</Typography><Typography variant="h4" sx={{ color: "text.primary", fontWeight: 880 }}>{estimate.toLocaleString()}</Typography><Typography variant="body2" color="text.secondary">{enabledCount} batteries × {configuration.gaSettings.populationSize} population × {configuration.gaSettings.generations} generations</Typography></Paper></Stack>;

  const economicContent = <Stack spacing={2}><Alert severity="info">Discount rate is used directly; no inflation conversion.</Alert><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2,minmax(0,1fr))" }, gap: 2 }}><NumericField label="Project life" suffix="years" value={configuration.economicSettings.projectLifeYears} onChange={(value) => changeConfiguration(reviseComparisonConfiguration(configuration, { economicSettings: { ...configuration.economicSettings, projectLifeYears: value } }))} /><NumericField label="Discount rate" suffix="%" value={configuration.economicSettings.discountRate * 100} onChange={(value) => changeConfiguration(reviseComparisonConfiguration(configuration, { economicSettings: { ...configuration.economicSettings, discountRate: value / 100 } }))} /><NumericField label="Export tariff" suffix="LKR/kWh" value={configuration.economicSettings.exportTariffRsPerKwh} onChange={(value) => changeConfiguration(reviseComparisonConfiguration(configuration, { economicSettings: { ...configuration.economicSettings, exportTariffRsPerKwh: value } }))} /><NumericField label="Annual O&M" suffix="% of CAPEX" value={configuration.economicSettings.annualOmFraction * 100} onChange={(value) => changeConfiguration(reviseComparisonConfiguration(configuration, { economicSettings: { ...configuration.economicSettings, annualOmFraction: value / 100 } }))} /><NumericField label="Replacement cost" suffix="% of CAPEX" value={configuration.economicSettings.replacementCostFraction * 100} onChange={(value) => changeConfiguration(reviseComparisonConfiguration(configuration, { economicSettings: { ...configuration.economicSettings, replacementCostFraction: value / 100 } }))} /><FormControlLabel control={<Switch checked={configuration.economicSettings.residualValueEnabled} onChange={(event) => changeConfiguration(reviseComparisonConfiguration(configuration, { economicSettings: { ...configuration.economicSettings, residualValueEnabled: event.target.checked } }))} />} label="Residual value enabled" /></Box></Stack>;

  const dispatchContent = <Stack spacing={2}>
    <Alert severity={dataset?.status === "ready" ? "success" : "warning"}>
      {dataset
        ? `${dataset.filename} · ${dataset.rowCount.toLocaleString()} rows · ${dataset.startDate} to ${dataset.endDate}`
        : "Select or upload an active dataset before starting Comparison Mode."}
    </Alert>
    <Paper variant="outlined" sx={{ p: 2, borderRadius: "19px" }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>Dispatch strategy</Typography>
      <Chip
        label={dispatchStrategy.status}
        size="small"
        color={dispatchStrategy.status === "Reference Strategy" ? "success" : "warning"}
        sx={{ mt: 1 }}
      />
      <Box sx={{ mt: 1.4, display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(4,minmax(0,1fr))" }, gap: 1 }}>
        {dispatchStrategy.periods.slice(0, 4).map((period) => (
          <Stat key={period.name} label={period.name} value={`${period.start}–${period.end}`} />
        ))}
      </Box>
    </Paper>

    <Paper variant="outlined" sx={{ p: 2, borderRadius: "19px", bgcolor: "rgba(255,255,255,.025)" }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>Technical constraints</Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1 }}>
        <Chip label="Peak-support success ≥ 95%" variant="outlined" />
        <Chip label="PV self-consumption ≥ 40%" variant="outlined" />
      </Stack>
    </Paper>
  </Stack>;

  const editReviewSection = (targetStep: number) => {
    setReturnToReview(true);
    goToStep(targetStep);
  };

  const reviewContent = <Stack spacing={2}>
    {errors.length > 0 && <Alert severity="warning"><Typography variant="subtitle2" sx={{ fontWeight: 850 }}>Resolve before starting</Typography>{errors.map((error) => <Typography key={error} variant="body2">• {error}</Typography>)}</Alert>}
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "repeat(2,minmax(0,1fr))" }, gap: 1.5 }}>
      <ReviewSection title="Battery Alternatives" onEdit={() => editReviewSection(0)}>
        <Typography variant="body2">{configuration.batteries.filter((entry) => entry.enabled).map((entry) => batteryTypeLabel(entry.battery.name)).join(", ")}</Typography>
      </ReviewSection>
      <ReviewSection title="Search Bounds" onEdit={() => editReviewSection(1)}>
        <Typography variant="body2">{number.format(configuration.minimumBessCapacityKwh)}–{number.format(configuration.maximumBessCapacityKwh)} kWh · {number.format(configuration.minimumPeakSupportPct)}–{number.format(configuration.maximumPeakSupportPct)}% peak support</Typography>
      </ReviewSection>
      <ReviewSection title="GA Settings" onEdit={() => editReviewSection(2)}>
        <Typography variant="body2">{configuration.gaSettings.populationSize} population · {configuration.gaSettings.generations} generations · {estimate.toLocaleString()} evaluations</Typography>
      </ReviewSection>
      <ReviewSection title="Economic Settings" onEdit={() => editReviewSection(3)}>
        <Typography variant="body2">{configuration.economicSettings.projectLifeYears} years · {number.format(configuration.economicSettings.discountRate * 100)}% discount · {number.format(configuration.economicSettings.exportTariffRsPerKwh)} LKR/kWh export</Typography>
      </ReviewSection>
      <ReviewSection title="Dispatch and Constraints" onEdit={() => editReviewSection(4)}>
        <Typography variant="body2">{dispatchStrategy.status} · 95% peak support · 40% PV self-consumption</Typography>
      </ReviewSection>
      <ReviewSection title="Dataset and Project" onEdit={() => editReviewSection(4)}>
        <Typography variant="body2">{dataset?.filename ?? "No active dataset"} · Project {projectId}</Typography>
      </ReviewSection>
    </Box>
  </Stack>;

  const partialResults = latest?.partial_results ?? [];
  const progressContent = <Stack id="comparison-summary" spacing={2}>{runState.error && <Alert severity={runState.error.code === "POLLING_RECONNECT" ? "warning" : "error"} icon={<ErrorOutlineRoundedIcon />}><Typography variant="subtitle2" sx={{ fontWeight: 850 }}>{runState.error.code ?? "Comparison error"}</Typography><Typography variant="body2">{runState.error.message}</Typography></Alert>}{runState.phase === "cancelling" && <Alert severity="warning">Cancellation requested. The current generation may finish before stopping; later batteries will not start.</Alert>}{runState.phase === "cancelled" && <Alert severity="info">Comparison cancelled. Completed batteries remain below as partial results and no final comparison is presented.</Alert>}{runState.phase === "expired" && <Alert severity="warning">Comparison job expired. The submitted configuration remains available.</Alert>}<Paper variant="outlined" sx={{ p: 2.3, borderRadius: "22px", borderColor: "divider", background: "linear-gradient(120deg,rgba(155,239,74,.06),rgba(76,141,255,.07))" }}><Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}><Box><Typography variant="overline" color="primary.main" sx={{ fontWeight: 850 }}>{runState.reconnecting ? "RESUMING / RECONNECTING" : runState.phase.toUpperCase()}</Typography><Typography variant="h5" sx={{ color: "text.primary", fontWeight: 880 }}>{latest?.current_battery_name ? batteryTypeLabel(latest.current_battery_name) : (active ? "Preparing comparison" : "Comparison summary")}</Typography></Box><Chip label={`${number.format(displayProgress)}%`} color={runState.phase === "failed" ? "error" : "primary"} /></Stack><LinearProgress variant={runState.phase === "submitting" || runState.phase === "queued" ? "indeterminate" : "determinate"} value={displayProgress} sx={{ mt: 2, height: 10, borderRadius: 99, bgcolor: "rgba(148,166,186,.16)" }} /><Box sx={{ mt: 2, display: "grid", gridTemplateColumns: { xs: "repeat(2,minmax(0,1fr))", md: "repeat(4,minmax(0,1fr))" }, gap: 1 }}><Stat label="Battery" value={`${latest ? Math.min(latest.current_battery_index + 1, latest.total_batteries) : 0} / ${latest?.total_batteries ?? enabledCount}`} /><Stat label="Completed batteries" value={`${latest?.completed_battery_count ?? 0} / ${latest?.total_batteries ?? enabledCount}`} /><Stat label="Generation" value={`${latest?.current_generation ?? 0} / ${latest?.total_generations ?? configuration.gaSettings.generations}`} /><Stat label="Total evaluations" value={`${latest?.total_evaluations_completed ?? 0} / ${latest?.total_estimated_evaluations ?? estimate}`} /><Stat label="Best capacity" value={latest?.current_best_capacity_kwh == null ? "Pending" : `${number.format(latest.current_best_capacity_kwh)} kWh`} /><Stat label="Best peak support" value={latest?.current_best_peak_support_pct == null ? "Pending" : `${number.format(latest.current_best_peak_support_pct)}%`} /><Stat label="Best fitness" value={latest?.current_best_fitness_rs == null ? "Pending" : currency.format(latest.current_best_fitness_rs)} /></Box></Paper>{completedComparison && !completedComparison.stale && <Alert severity={completedComparison.finalResult.comparison_solution_status === "completed_all_batteries" ? "success" : "warning"} icon={<CheckCircleRoundedIcon />}><Typography variant="subtitle2" sx={{ fontWeight: 850 }}>{completedComparison.finalResult.comparison_solution_status === "completed_all_batteries" ? "Stage 1 ready · all alternatives feasible" : "Stage 1 ready with infeasible alternatives"}</Typography><Typography variant="body2">{completedComparison.finalResult.feasible_battery_count} feasible · {completedComparison.finalResult.infeasible_battery_count} infeasible.</Typography></Alert>}{partialResults.length > 0 && <Box><Typography variant="h6" sx={{ mb: 1.2 }}>Completed battery results</Typography><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2,minmax(0,1fr))" }, gap: 1.5 }}>{partialResults.map((result) => <Paper key={result.battery_name} variant="outlined" sx={{ p: 2, borderRadius: "18px", borderColor: "divider", bgcolor: "rgba(255,255,255,.025)" }}><Stack direction="row" sx={{ justifyContent: "space-between" }}><Typography variant="h6" sx={{ color: "text.primary", fontWeight: 850 }}>{batteryTypeLabel(result.battery_name)}</Typography><Chip size="small" label={result.is_feasible ? "Feasible" : "Infeasible"} color={result.is_feasible ? "success" : "warning"} /></Stack><Typography variant="body2" color="text.secondary" sx={{ mt: .7 }}>{number.format(result.best_bess_capacity_kwh)} kWh · {number.format(result.best_peak_support_pct)}% peak support</Typography></Paper>)}</Box></Box>}</Stack>;

  const content = [batteryContent, boundsContent, gaContent, economicContent, dispatchContent, reviewContent, progressContent][step];
  const canConfigureAHP = comparisonCurrent;
  const summaryResults = completedComparison?.finalResult.battery_results ?? [];
  const ahpStatus = ahpCurrent
    ? "Accepted"
    : ahpState
      ? ahpState.accepted
        ? "Stale"
        : ahpState.calculation
          ? "In progress"
          : "Not configured"
      : "Not configured";
  const prometheeStatus = rankingReady
    ? "Current"
    : prometheeState
      ? "Stale"
      : ahpCurrent
        ? "Ready"
        : "Waiting for AHP";
  const recommendationStatus = rankingReady ? "Current" : prometheeState ? "Stale" : "Not available";

  const postComparisonContent = step === 6 ? (
    <Stack spacing={2.25}>
      {!completedComparison && !active && (
        <Alert severity="info">
          No comparison results yet.
          <Button size="small" onClick={prepareNewComparison}>Configure Battery Comparison</Button>
        </Alert>
      )}
      {active && (
        <Alert severity="info">
          Battery comparison is running. Completed alternatives appear as the run progresses.
        </Alert>
      )}
      {completedComparison?.stale && (
        <Alert severity="warning">
          The comparison result is outdated because the dataset or configuration changed.
        </Alert>
      )}
      {comparisonCurrent && completedComparison && (
        <>
          <Paper
            id="comparison-summary-table"
            variant="outlined"
            sx={{ p: { xs: 2, md: 2.5 }, borderRadius: "22px", borderColor: "#cfe2e4" }}
          >
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{ alignItems: { sm: "center" }, justifyContent: "space-between", mb: 2 }}
            >
              <Box>
                <Typography variant="h5" sx={{ fontWeight: 880 }}>Comparison Summary</Typography>
                <Typography variant="body2" color="text.secondary">
                  Canonical GA results for every enabled battery.
                </Typography>
              </Box>
              <Chip
                label={`${completedComparison.finalResult.feasible_battery_count} feasible · ${completedComparison.finalResult.infeasible_battery_count} infeasible`}
                color={completedComparison.finalResult.infeasible_battery_count > 0 ? "warning" : "success"}
                variant="outlined"
              />
            </Stack>
            <Box sx={{ overflowX: "auto" }}>
              <Box
                role="table"
                aria-label="Comparison optimized battery results"
                sx={{
                  display: "grid",
                  gridTemplateColumns: "minmax(150px,1.3fr) repeat(8,minmax(145px,1fr))",
                  minWidth: 1320,
                  gap: "1px",
                  bgcolor: "#20364A",
                  border: "1px solid #20364A",
                }}
              >
                {[
                  "Battery",
                  "Optimized Capacity",
                  "Peak Support",
                  "Annual Cost",
                  "Service Life",
                  "Round-Trip Efficiency",
                  "Equivalent Cycles",
                  "PV Self-Consumption",
                  "Peak-Support Success",
                ].map((heading) => (
                  <Box key={heading} role="columnheader" sx={{ p: 1.2, bgcolor: "#12263A", fontSize: 12, fontWeight: 850 }}>
                    {heading}
                  </Box>
                ))}
                {summaryResults.flatMap((result) => [
                  <Box key={`${result.battery_name}-name`} role="rowheader" sx={{ p: 1.2, bgcolor: "#0D1D2D" }}>
                    <Typography variant="body2" sx={{ fontWeight: 850 }}>{batteryTypeLabel(result.battery_name)}</Typography>
                    <Chip
                      label={result.is_feasible ? "Feasible" : "Infeasible"}
                      color={result.is_feasible ? "success" : "warning"}
                      size="small"
                      variant="outlined"
                      sx={{ mt: .6 }}
                    />
                  </Box>,
                  <Box key={`${result.battery_name}-capacity`} role="cell" sx={{ p: 1.2, bgcolor: "#0D1D2D", fontWeight: 800 }}>
                    {number.format(result.best_bess_capacity_kwh)} kWh
                  </Box>,
                  <Box key={`${result.battery_name}-peak`} role="cell" sx={{ p: 1.2, bgcolor: "#0D1D2D" }}>
                    {number.format(result.best_peak_support_pct)}%
                  </Box>,
                  <Box key={`${result.battery_name}-cost`} role="cell" sx={{ p: 1.2, bgcolor: "#0D1D2D" }}>
                    {currency.format(result.best_total_annual_cost_rs)}
                  </Box>,
                  <Box key={`${result.battery_name}-life`} role="cell" sx={{ p: 1.2, bgcolor: "#0D1D2D" }}>
                    {number.format(result.cycle_based_life_years)} years
                  </Box>,
                  <Box key={`${result.battery_name}-efficiency`} role="cell" sx={{ p: 1.2, bgcolor: "#0D1D2D" }}>
                    {(result.round_trip_efficiency * 100).toFixed(2)}%
                  </Box>,
                  <Box key={`${result.battery_name}-cycles`} role="cell" sx={{ p: 1.2, bgcolor: "#0D1D2D" }}>
                    {result.equivalent_cycles_per_year == null ? "—" : number.format(result.equivalent_cycles_per_year)}
                  </Box>,
                  <Box key={`${result.battery_name}-self`} role="cell" sx={{ p: 1.2, bgcolor: "#0D1D2D" }}>
                    {number.format(result.pv_self_consumption_pct)}%
                  </Box>,
                  <Box key={`${result.battery_name}-success`} role="cell" sx={{ p: 1.2, bgcolor: "#0D1D2D" }}>
                    {number.format(result.peak_support_success_pct)}%
                  </Box>,
                ])}
              </Box>
            </Box>
          </Paper>

          <Paper
            variant="outlined"
            sx={{ p: { xs: 2, md: 2.5 }, borderRadius: "22px", background: "linear-gradient(120deg,rgba(155,239,74,.05),rgba(76,141,255,.045))" }}
          >
            <Typography variant="h6" sx={{ fontWeight: 880 }}>Next scientific steps</Typography>
            <Box sx={{ mt: 1.5, display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(4,minmax(0,1fr))" }, gap: 1 }}>
              {[
                ["1", "GA Comparison", "Completed"],
                ["2", "AHP Criteria Weighting", ahpStatus],
                ["3", "PROMETHEE II Ranking", prometheeStatus],
                ["4", "Final Recommendation", recommendationStatus],
              ].map(([index, label, status]) => (
                <Paper key={index} variant="outlined" sx={{ p: 1.5, borderRadius: "16px", bgcolor: "#0D1D2D" }}>
                  <Chip label={`Step ${index}`} size="small" />
                  <Typography variant="subtitle2" sx={{ mt: 1, fontWeight: 850 }}>{label}</Typography>
                  <Typography variant="body2" color="text.secondary">{status}</Typography>
                </Paper>
              ))}
            </Box>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.1} sx={{ mt: 2 }}>
              <Button
                variant="contained"
                onClick={decisionStage === "ahp_required" ? onOpenAHP : onOpenResults}
                disabled={decisionStage === "recommendation_stale"}
              >
                {decisionStageActionLabel(decisionStage)}
              </Button>
              {ahpCurrent && <Button variant="outlined" onClick={onOpenAHP}>Revise AHP</Button>}
              {rankingReady && <Button variant="outlined" onClick={onOpenDetailedResults}>View Detailed Results</Button>}
            </Stack>
            {!ahpCurrent && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.2 }}>
                GA optimization is complete. Configure AHP criteria weights to continue.
              </Typography>
            )}
            {ahpCurrent && !rankingReady && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.2 }}>
                AHP weights are accepted. Calculate PROMETHEE II to rank the feasible alternatives.
              </Typography>
            )}
          </Paper>
        </>
      )}
    </Stack>
  ) : null;

  const currentErrors = comparisonErrorsForStep(errors, step);
  const furthestStep = Math.max(configuration.workflowStep ?? 0, step, returnToReview ? 5 : 0);
  const completedSteps = new Set(Array.from({ length: Math.min(furthestStep, 6) }, (_, index) => index));

  const saveAndContinue = () => {
    if (currentErrors.length > 0) return;
    const nextStep = comparisonStepAfterSave(step, returnToReview);
    setReturnToReview(false);
    setStep(nextStep);
    onConfigurationChange({ ...configuration, workflowStep: nextStep, savedAt: new Date().toISOString() });
  };

  function prepareNewComparison() {
    onRunStateChange(INITIAL_COMPARISON_RUN_STATE);
    setReturnToReview(false);
    goToStep(0);
  }

  return <Stack spacing={2.25} sx={{ maxWidth: 1280, mx: "auto", pb: 12 }}>
    <Paper elevation={0} sx={{ overflow: "hidden", borderRadius: "26px", border: "1px solid", borderColor: "divider", background: "linear-gradient(112deg,#0D1D2D,#12263A)" }}>
      <Box sx={{ p: { xs: 2.25, sm: 3 } }}>
        <Button color="inherit" startIcon={<ArrowBackRoundedIcon />} onClick={leaveToModes} sx={{ mb: 1.5 }}>
          Back to Optimization Modes
        </Button>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
          <Box>
            <Typography variant="overline" sx={{ color: "primary.main", fontWeight: 850 }}>COMPARISON STAGE 1</Typography>
            <Typography component="h1" variant="h4" sx={{ fontWeight: 900 }}>Battery Comparison</Typography>
            <Typography sx={{ mt: .6, color: "text.secondary" }}>Configure and optimize the enabled battery alternatives.</Typography>
          </Box>
          <Chip label={runState.phase.replaceAll("_", " ")} sx={{ color: "#fff", bgcolor: "rgba(255,255,255,.15)", fontWeight: 800 }} />
        </Stack>
      </Box>
      <Box sx={{ px: { xs: 1, sm: 2 }, py: 1.5, bgcolor: "#081522", overflowX: "auto" }}>
        <Stepper activeStep={step === 6 && completedComparison && !active ? 7 : step} alternativeLabel sx={{ minWidth: { xs: 900, lg: 0 } }}>
          {STEPS.map((label, index) => (
            <Step key={label} completed={index < step || completedSteps.has(index)}>
              <StepButton
                onClick={() => {
                  if (canVisitComparisonStep(index, step, completedSteps) && index < 6) {
                    setReturnToReview(step === 5);
                    goToStep(index);
                  }
                }}
                disabled={index > furthestStep || index === 6}
              >
                {label}
              </StepButton>
            </Step>
          ))}
        </Stepper>
      </Box>
    </Paper>

    {startBlockedReason ? (
      <Alert
        severity="info"
        action={onViewActiveRun ? <Button color="inherit" onClick={onViewActiveRun}>View Running Optimization</Button> : undefined}
        sx={{ borderRadius: "18px", alignItems: "center" }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>{startBlockedReason}</Typography>
        <Typography variant="body2">Wait for it to finish or cancel it before starting this comparison.</Typography>
      </Alert>
    ) : null}

    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, minHeight: 360, borderRadius: "24px", borderColor: "divider", bgcolor: "background.paper" }}>
          <Typography variant="h5" sx={{ mb: 2, fontWeight: 880 }}>{step === 6 && completedComparison && !active ? "Comparison Summary" : STEPS[step]}</Typography>
          {content}
          {postComparisonContent}
      {step < 5 && currentErrors.length > 0 && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          {currentErrors.map((error) => <Typography key={error} variant="body2">• {error}</Typography>)}
        </Alert>
      )}
    </Paper>

    <Paper
      elevation={4}
      sx={{
        position: "sticky",
        bottom: 12,
        zIndex: 5,
        p: 1.5,
        borderRadius: "18px",
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "rgba(8,21,34,.96)",
        backdropFilter: "blur(12px)",
      }}
    >
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between" }}>
        {step === 0 ? (
          <Button startIcon={<ArrowBackRoundedIcon />} onClick={leaveToModes}>Cancel / Back to Modes</Button>
        ) : step < 6 ? (
          <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => goToStep(previousComparisonStep(step))}>Back</Button>
        ) : (
          <Button onClick={leaveToDashboard}>Leave Page / View Dashboard</Button>
        )}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          {step < 5 && <Button variant="contained" endIcon={<ArrowForwardRoundedIcon />} disabled={currentErrors.length > 0} onClick={saveAndContinue}>{returnToReview ? "Save & Return to Review" : "Save & Continue"}</Button>}
          {step === 5 && <Button variant="contained" startIcon={<PlayArrowRoundedIcon />} onClick={() => void startComparison()} disabled={Boolean(startBlockedReason) || !canStartComparison(step, active, errors)}>Start Comparison</Button>}
          {step === 6 && active && <Button color="warning" variant="outlined" startIcon={<CancelRoundedIcon />} onClick={() => void cancelComparison()} disabled={runState.phase === "submitting" || runState.phase === "cancelling"}>Cancel Run</Button>}
          {step === 6 && !active && completedComparison && <Button onClick={() => document.getElementById("comparison-summary")?.scrollIntoView({ behavior: "smooth" })}>View Comparison Summary</Button>}
              {step === 6 && canConfigureAHP && !ahpCurrent && <Button variant="contained" onClick={onOpenAHP}>Continue to AHP</Button>}
              {step === 6 && ahpCurrent && <Button variant="contained" onClick={onOpenResults}>{rankingReady ? "View Final Recommendation" : "Continue Final Ranking"}</Button>}
          {step === 6 && !active && ["completed", "failed", "cancelled", "expired"].includes(runState.phase) && <Button startIcon={<RestartAltRoundedIcon />} onClick={prepareNewComparison}>Start New Comparison</Button>}
        </Stack>
      </Stack>
    </Paper>
  </Stack>;
}
