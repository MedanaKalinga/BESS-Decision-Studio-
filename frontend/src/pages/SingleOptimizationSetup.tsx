import { useEffect, useMemo, useState } from "react";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import BatteryChargingFullRoundedIcon from "@mui/icons-material/BatteryChargingFullRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import CloudUploadRoundedIcon from "@mui/icons-material/CloudUploadRounded";
import CurrencyRupeeRoundedIcon from "@mui/icons-material/CurrencyRupeeRounded";
import DataUsageRoundedIcon from "@mui/icons-material/DataUsageRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import FlagRoundedIcon from "@mui/icons-material/FlagRounded";
import HubRoundedIcon from "@mui/icons-material/HubRounded";
import InsightsRoundedIcon from "@mui/icons-material/InsightsRounded";
import LoopRoundedIcon from "@mui/icons-material/LoopRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import RouteRoundedIcon from "@mui/icons-material/RouteRounded";
import SavingsRoundedIcon from "@mui/icons-material/SavingsRounded";
import ScienceRoundedIcon from "@mui/icons-material/ScienceRounded";
import SettingsSuggestRoundedIcon from "@mui/icons-material/SettingsSuggestRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  Paper,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import type { SvgIconComponent } from "@mui/icons-material";
import type {
  SingleBatteryConfigurationSnapshot,
  SingleOptimizationSetupSnapshot,
  WorkspaceDatasetSummary,
  WorkspaceDispatchStrategy,
} from "../types/workspace";

interface SingleOptimizationSetupProps {
  battery: SingleBatteryConfigurationSnapshot;
  initialSetup?: SingleOptimizationSetupSnapshot | null;
  dataset: WorkspaceDatasetSummary | null;
  dispatchStrategy: WorkspaceDispatchStrategy;
  onBack: () => void;
  onGoToDataUpload: () => void;
  onReviewDispatchStrategy: () => void;
  onReadyToRun: (setup: SingleOptimizationSetupSnapshot) => void;
}

interface SetupDraft {
  minCapacity: string;
  maxCapacity: string;
  minPeakSupport: string;
  maxPeakSupport: string;
  populationSize: string;
  generations: string;
  mutationProbability: string;
  eliteCount: string;
  randomSeed: string;
  projectLife: string;
  discountRate: string;
  exportTariff: string;
  annualOmPercentage: string;
  replacementCostPercentage: string;
  residualValueEnabled: boolean;
}

type NumericDraftField = Exclude<keyof SetupDraft, "residualValueEnabled">;
type DraftErrors = Partial<Record<NumericDraftField, string>>;

const RECOMMENDED_SETTINGS: SetupDraft = {
  minCapacity: "0",
  maxCapacity: "10000",
  minPeakSupport: "20",
  maxPeakSupport: "50",
  populationSize: "100",
  generations: "50",
  mutationProbability: "0.15",
  eliteCount: "5",
  randomSeed: "42",
  projectLife: "25",
  discountRate: "10",
  exportTariff: "21",
  annualOmPercentage: "1",
  replacementCostPercentage: "80",
  residualValueEnabled: false,
};

export function setupSnapshotToDraft(
  setup: SingleOptimizationSetupSnapshot | null | undefined,
): SetupDraft {
  if (!setup) return { ...RECOMMENDED_SETTINGS };
  return {
    minCapacity: String(setup.minimumBessCapacityKwh),
    maxCapacity: String(setup.maximumBessCapacityKwh),
    minPeakSupport: String(setup.minimumPeakSupportPct),
    maxPeakSupport: String(setup.maximumPeakSupportPct),
    populationSize: String(setup.populationSize),
    generations: String(setup.generations),
    mutationProbability: String(setup.mutationProbability),
    eliteCount: String(setup.eliteCount),
    randomSeed: String(setup.randomSeed),
    projectLife: String(setup.projectLifeYears),
    discountRate: String(setup.discountRate * 100),
    exportTariff: String(setup.exportTariffRsPerKwh),
    annualOmPercentage: String(setup.annualOmFraction * 100),
    replacementCostPercentage: String(setup.replacementCostFraction * 100),
    residualValueEnabled: setup.residualValueEnabled,
  };
}

const steps = ["Battery", "Bounds", "GA Settings", "Economics", "Dispatch", "Review", "Run", "Result"];

const energyFormatter = new Intl.NumberFormat("en-LK", {
  maximumFractionDigits: 1,
});

const integerFormatter = new Intl.NumberFormat("en-LK", {
  maximumFractionDigits: 0,
});

function numberValue(value: string) {
  return value.trim() === "" ? Number.NaN : Number(value);
}

function validateDraft(draft: SetupDraft): DraftErrors {
  const errors: DraftErrors = {};
  const minCapacity = numberValue(draft.minCapacity);
  const maxCapacity = numberValue(draft.maxCapacity);
  const minPeak = numberValue(draft.minPeakSupport);
  const maxPeak = numberValue(draft.maxPeakSupport);
  const population = numberValue(draft.populationSize);
  const generations = numberValue(draft.generations);
  const mutation = numberValue(draft.mutationProbability);
  const elite = numberValue(draft.eliteCount);
  const seed = numberValue(draft.randomSeed);
  const projectLife = numberValue(draft.projectLife);
  const discountRate = numberValue(draft.discountRate);
  const exportTariff = numberValue(draft.exportTariff);
  const annualOm = numberValue(draft.annualOmPercentage);
  const replacement = numberValue(draft.replacementCostPercentage);

  if (!Number.isFinite(minCapacity) || minCapacity < 0) {
    errors.minCapacity = "Minimum capacity must be 0 kWh or greater.";
  }
  if (!Number.isFinite(maxCapacity) || maxCapacity <= minCapacity) {
    errors.maxCapacity = "Maximum capacity must be greater than the minimum.";
  }
  if (!Number.isFinite(minPeak) || minPeak < 0 || minPeak > 100) {
    errors.minPeakSupport = "Minimum peak support must be between 0% and 100%.";
  }
  if (!Number.isFinite(maxPeak) || maxPeak < 0 || maxPeak > 100 || maxPeak <= minPeak) {
    errors.maxPeakSupport = "Maximum peak support must be greater than the minimum and no more than 100%.";
  }
  if (!Number.isInteger(population) || population < 4) {
    errors.populationSize = "Population size must be a whole number of at least 4.";
  }
  if (!Number.isInteger(generations) || generations <= 0) {
    errors.generations = "Generations must be a positive whole number.";
  }
  if (!Number.isFinite(mutation) || mutation < 0 || mutation > 1) {
    errors.mutationProbability = "Mutation probability must be between 0 and 1.";
  }
  if (!Number.isInteger(elite) || elite < 1 || (Number.isFinite(population) && elite >= population)) {
    errors.eliteCount = "Elite count must be at least 1 and below the population size.";
  }
  if (!Number.isInteger(seed)) {
    errors.randomSeed = "Random seed must be a whole number.";
  }
  if (!Number.isInteger(projectLife) || projectLife <= 0) {
    errors.projectLife = "Project life must be a positive whole number.";
  }
  if (!Number.isFinite(discountRate) || discountRate < 0 || discountRate > 100) {
    errors.discountRate = "Discount rate must be between 0% and 100%.";
  }
  if (!Number.isFinite(exportTariff) || exportTariff < 0) {
    errors.exportTariff = "Export tariff cannot be negative.";
  }
  if (!Number.isFinite(annualOm) || annualOm < 0 || annualOm > 100) {
    errors.annualOmPercentage = "Annual O&M percentage must be between 0% and 100%.";
  }
  if (!Number.isFinite(replacement) || replacement < 0 || replacement > 100) {
    errors.replacementCostPercentage = "Replacement percentage must be between 0% and 100%.";
  }

  return errors;
}

function SectionTitle({
  icon: Icon,
  eyebrow,
  title,
  description,
  accent = "teal",
}: {
  icon: SvgIconComponent;
  eyebrow: string;
  title: string;
  description: string;
  accent?: "teal" | "blue" | "amber";
}) {
  const palette = {
    teal: { color: "#0f766e", background: "#ccfbf1" },
    blue: { color: "#2563eb", background: "#dbeafe" },
    amber: { color: "#b45309", background: "#fef3c7" },
  }[accent];

  return (
    <Stack direction="row" spacing={1.4} sx={{ alignItems: "flex-start" }}>
      <Box
        sx={{
          width: 44,
          height: 44,
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          borderRadius: "14px",
          color: palette.color,
          bgcolor: palette.background,
        }}
      >
        <Icon />
      </Box>
      <Box>
        <Typography
          variant="caption"
          sx={{ color: palette.color, fontWeight: 850, letterSpacing: "0.09em" }}
        >
          {eyebrow.toUpperCase()}
        </Typography>
        <Typography variant="h6" sx={{ mt: 0.1, fontWeight: 850 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.3, lineHeight: 1.55 }}>
          {description}
        </Typography>
      </Box>
    </Stack>
  );
}

function SetupInput({
  label,
  value,
  error,
  helper,
  suffix,
  step = "1",
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  helper?: string;
  suffix?: string;
  step?: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextField
      fullWidth
      size="small"
      type="number"
      label={label}
      value={value}
      error={Boolean(error)}
      helperText={error ?? helper ?? " "}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{
        htmlInput: { step },
        input: suffix ? { endAdornment: <Typography variant="caption" color="text.secondary">{suffix}</Typography> } : undefined,
      }}
      sx={{
        "& .MuiOutlinedInput-root": {
          borderRadius: "13px",
          bgcolor: "rgba(7,17,29,0.72)",
          color: "text.primary",
          transition: "box-shadow 180ms ease, transform 180ms ease",
          "& .MuiOutlinedInput-notchedOutline": {
            borderColor: "rgba(148,166,186,0.32)",
          },
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: "rgba(155,239,74,0.5)",
          },
          "&.Mui-focused": {
            boxShadow: "0 8px 24px rgba(155,239,74,0.1)",
            transform: "translateY(-1px)",
          },
        },
        "& .MuiInputBase-input": {
          color: "#F4F8FC",
          WebkitTextFillColor: "#F4F8FC",
          fontWeight: 700,
          colorScheme: "dark",
        },
        "& .MuiInputLabel-root": { color: "#94A6BA" },
        "& .MuiInputLabel-root.Mui-focused": { color: "#9BEF4A" },
        "& .MuiInputLabel-root.Mui-error": { color: "error.main" },
        "& .MuiInputAdornment-root, & .MuiInputAdornment-root .MuiTypography-root": {
          color: "#94A6BA",
        },
        "& .MuiFormHelperText-root": { mx: 0.3, minHeight: 20 },
        "@media (prefers-reduced-motion: reduce)": {
          "& .MuiOutlinedInput-root": { transition: "none", "&.Mui-focused": { transform: "none" } },
        },
      }}
    />
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" spacing={2} sx={{ justifyContent: "space-between", alignItems: "baseline" }}>
      <Typography variant="caption" sx={{ color: "#94a3b8" }}>{label}</Typography>
      <Typography variant="body2" sx={{ color: "#f8fafc", fontWeight: 800, textAlign: "right" }}>{value}</Typography>
    </Stack>
  );
}

export default function SingleOptimizationSetup({
  battery,
  initialSetup,
  dataset,
  dispatchStrategy,
  onBack,
  onGoToDataUpload,
  onReviewDispatchStrategy,
  onReadyToRun,
}: SingleOptimizationSetupProps) {
  const [draft, setDraft] = useState<SetupDraft>(() => setupSnapshotToDraft(initialSetup));
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [readyConfirmed, setReadyConfirmed] = useState(false);

  useEffect(() => {
    setReadyConfirmed(false);
  }, [battery, dataset, dispatchStrategy]);

  const errors = useMemo(() => validateDraft(draft), [draft]);
  const hasErrors = Object.keys(errors).length > 0;
  const population = numberValue(draft.populationSize);
  const generations = numberValue(draft.generations);
  const evaluationCount = !errors.populationSize && !errors.generations
    ? population * generations
    : Number.NaN;
  const minCapacity = numberValue(draft.minCapacity);
  const maxCapacity = numberValue(draft.maxCapacity);
  const minPeak = numberValue(draft.minPeakSupport);
  const maxPeak = numberValue(draft.maxPeakSupport);

  function update(field: NumericDraftField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setReadyConfirmed(false);
  }

  function restoreRecommended() {
    setDraft({ ...RECOMMENDED_SETTINGS });
    setAdvancedExpanded(false);
    setReadyConfirmed(false);
  }

  function updateCapacitySlider(value: number | number[]) {
    if (!Array.isArray(value)) return;
    setDraft((current) => ({ ...current, minCapacity: String(value[0]), maxCapacity: String(value[1]) }));
    setReadyConfirmed(false);
  }

  function updatePeakSlider(value: number | number[]) {
    if (!Array.isArray(value)) return;
    setDraft((current) => ({ ...current, minPeakSupport: String(value[0]), maxPeakSupport: String(value[1]) }));
    setReadyConfirmed(false);
  }

  function confirmSetup() {
    if (!canConfirm) return;
    setReadyConfirmed(true);
    onReadyToRun({
      minimumBessCapacityKwh: minCapacity,
      maximumBessCapacityKwh: maxCapacity,
      minimumPeakSupportPct: minPeak,
      maximumPeakSupportPct: maxPeak,
      populationSize: population,
      generations,
      mutationProbability: numberValue(draft.mutationProbability),
      eliteCount: numberValue(draft.eliteCount),
      randomSeed: numberValue(draft.randomSeed),
      projectLifeYears: numberValue(draft.projectLife),
      discountRate: numberValue(draft.discountRate) / 100,
      exportTariffRsPerKwh: numberValue(draft.exportTariff),
      annualOmFraction: numberValue(draft.annualOmPercentage) / 100,
      replacementCostFraction: numberValue(draft.replacementCostPercentage) / 100,
      residualValueEnabled: draft.residualValueEnabled,
    });
  }

  const canUseCapacitySlider = !errors.minCapacity && !errors.maxCapacity && minCapacity <= 10000 && maxCapacity <= 10000;
  const canUsePeakSlider = !errors.minPeakSupport && !errors.maxPeakSupport;
  const canConfirm = Boolean(dataset) && !hasErrors;
  const datasetEnergyLabel = dataset?.datasetType === "partial" ? "Dataset" : "Annual";

  return (
    <Stack spacing={2.5}>
      <Paper
        elevation={0}
        sx={{
          position: "relative",
          overflow: "hidden",
          px: { xs: 2.5, sm: 3.5 },
          py: { xs: 2.75, sm: 3.5 },
          borderRadius: "28px",
          color: "#fff",
          background: "linear-gradient(118deg,#0D1D2D,#12263A)",
          boxShadow: "0 22px 52px rgba(7,62,73,0.2)",
          "&::after": {
            content: '\"\"',
            position: "absolute",
            width: 300,
            height: 300,
            right: -110,
            top: -175,
            borderRadius: "50%",
            bgcolor: "rgba(255,255,255,0.08)",
          },
        }}
      >
        <Box sx={{ position: "relative", zIndex: 1 }}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ justifyContent: "space-between", alignItems: { md: "flex-end" } }}>
            <Box sx={{ maxWidth: 760 }}>
              <Typography variant="overline" sx={{ color: "#a7f3d0", fontWeight: 850, letterSpacing: "0.12em" }}>
                SINGLE BATTERY OPTIMIZATION
              </Typography>
              <Typography variant="h3" sx={{ mt: 0.3, fontSize: { xs: 30, sm: 39 }, fontWeight: 880, letterSpacing: "-0.035em" }}>
                Prepare the optimization run
              </Typography>
              <Typography sx={{ mt: 1, color: "rgba(255,255,255,0.79)", lineHeight: 1.65 }}>
                Set inputs, bounds, and assumptions for {battery.batteryName}.
              </Typography>
            </Box>
            <Chip icon={<ScienceRoundedIcon />} label="Setup only · React state" sx={{ color: "#fff", bgcolor: "rgba(255,255,255,0.13)", fontWeight: 780, "& .MuiChip-icon": { color: "#99f6e4" } }} />
          </Stack>

          <Box sx={{ mt: 3, display: "grid", gridTemplateColumns: "repeat(8,minmax(72px,1fr))", gap: { xs: 0.6, sm: 1 }, overflowX: "auto" }}>
            {steps.map((step, index) => {
              const completed = index < 5;
              const active = index === 5;
              return (
                <Stack key={step} spacing={0.75} sx={{ minWidth: 62 }}>
                  <Box sx={{ height: 4, borderRadius: 99, bgcolor: completed || active ? active ? "#5eead4" : "#a7f3d0" : "rgba(255,255,255,0.18)" }} />
                  <Stack direction="row" spacing={0.65} sx={{ alignItems: "center" }}>
                    <Box sx={{ width: 22, height: 22, flexShrink: 0, display: "grid", placeItems: "center", borderRadius: "50%", bgcolor: completed ? "#a7f3d0" : active ? "#5eead4" : "rgba(255,255,255,0.12)", color: completed || active ? "#07565a" : "rgba(255,255,255,0.58)", fontSize: 11, fontWeight: 900 }}>
                      {completed ? <CheckCircleRoundedIcon sx={{ fontSize: 15 }} /> : index + 1}
                    </Box>
                    <Typography variant="caption" sx={{ color: completed || active ? "#fff" : "rgba(255,255,255,0.55)", fontWeight: active ? 850 : 680, whiteSpace: "nowrap" }}>
                      {step}
                    </Typography>
                  </Stack>
                </Stack>
              );
            })}
          </Box>
        </Box>
      </Paper>

      {readyConfirmed && (
        <Alert severity="success" icon={<CheckCircleRoundedIcon />} sx={{ borderRadius: "18px" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>Optimization setup confirmed in React state</Typography>
          <Typography variant="body2">Ready for the Run step; no backend request was sent.</Typography>
        </Alert>
      )}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", xl: "minmax(0, 1.8fr) minmax(330px, 0.78fr)" }, gap: 2.5, alignItems: "start" }}>
        <Stack spacing={2.5}>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" }, gap: 2.5 }}>
            <Paper variant="outlined" sx={{ p: { xs: 2.1, sm: 2.5 }, borderRadius: "24px", borderColor: dataset ? "rgba(155,239,74,.36)" : "warning.main", background: dataset ? "rgba(155,239,74,.04)" : "rgba(245,167,66,.045)" }}>
              <SectionTitle icon={DataUsageRoundedIcon} eyebrow="Study input" title="Dataset" description="PV and EV input data." accent={dataset ? "teal" : "amber"} />
              {dataset ? (
                <Stack spacing={1.15} sx={{ mt: 2.25 }}>
                  <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "center" }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 850, overflowWrap: "anywhere" }}>{dataset.filename}</Typography>
                    <Chip size="small" label="Available" color="success" variant="outlined" />
                  </Stack>
                  <Divider />
                  <Stack direction="row" sx={{ justifyContent: "space-between" }}><Typography variant="caption" color="text.secondary">Rows</Typography><Typography variant="body2" sx={{ fontWeight: 800 }}>{integerFormatter.format(dataset.rowCount)}</Typography></Stack>
                  <Stack direction="row" sx={{ justifyContent: "space-between" }}><Typography variant="caption" color="text.secondary">Date range</Typography><Typography variant="body2" sx={{ fontWeight: 800, textAlign: "right" }}>{dataset.startDate} → {dataset.endDate}</Typography></Stack>
                  <Stack direction="row" sx={{ justifyContent: "space-between" }}><Typography variant="caption" color="text.secondary">{datasetEnergyLabel} PV energy</Typography><Typography variant="body2" sx={{ fontWeight: 800 }}>{energyFormatter.format(dataset.annualPvEnergyKwh)} kWh</Typography></Stack>
                  <Stack direction="row" sx={{ justifyContent: "space-between" }}><Typography variant="caption" color="text.secondary">{datasetEnergyLabel} EV energy</Typography><Typography variant="body2" sx={{ fontWeight: 800 }}>{energyFormatter.format(dataset.annualEvEnergyKwh)} kWh</Typography></Stack>
                </Stack>
              ) : (
                <Alert severity="warning" sx={{ mt: 2, borderRadius: "15px" }}>
                  No uploaded dataset is available. Add a validated PV and EV dataset before confirming this setup.
                </Alert>
              )}
              <Button fullWidth={!dataset} variant={dataset ? "text" : "contained"} startIcon={<CloudUploadRoundedIcon />} onClick={onGoToDataUpload} sx={{ mt: 2, borderRadius: "12px" }}>
                Go to Data Upload
              </Button>
            </Paper>

            <Paper variant="outlined" sx={{ p: { xs: 2.1, sm: 2.5 }, borderRadius: "24px", borderColor: dispatchStrategy.status === "Modified Strategy" ? "warning.main" : "rgba(76,141,255,.36)", background: "rgba(76,141,255,.04)" }}>
              <SectionTitle icon={RouteRoundedIcon} eyebrow="Control policy" title="Dispatch Strategy" description="Candidate dispatch rules." accent="blue" />
              <Chip size="small" icon={dispatchStrategy.status === "Reference Strategy" ? <CheckCircleRoundedIcon /> : <TuneRoundedIcon />} label={dispatchStrategy.status} sx={{ mt: 1.8, fontWeight: 800, bgcolor: dispatchStrategy.status === "Reference Strategy" ? "#dcfce7" : "#fef3c7", color: dispatchStrategy.status === "Reference Strategy" ? "#166534" : "#92400e" }} />
              <Box sx={{ mt: 1.5, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 }}>
                {dispatchStrategy.periods.slice(0, 4).map((period) => (
                  <Paper key={`${period.name}-${period.start}`} elevation={0} sx={{ p: 1.15, borderRadius: "13px", bgcolor: "rgba(255,255,255,.025)", border: "1px solid", borderColor: "divider" }}>
                    <Typography variant="caption" sx={{ display: "block", color: "#1d4ed8", fontWeight: 850 }}>{period.name}</Typography>
                    <Typography variant="body2" sx={{ mt: 0.25, fontWeight: 780 }}>{period.start}–{period.end}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {period.evSupplyPriority.join(" → ")}
                    </Typography>
                  </Paper>
                ))}
              </Box>
              <Button startIcon={<HubRoundedIcon />} onClick={onReviewDispatchStrategy} sx={{ mt: 1.7, borderRadius: "12px" }}>
                Review Dispatch Strategy
              </Button>
            </Paper>
          </Box>

          <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: "24px", borderColor: "#cce5df", boxShadow: "0 14px 36px rgba(15,118,110,0.05)" }}>
            <Box sx={{ p: { xs: 2.1, sm: 2.5 }, borderBottom: "1px solid", borderColor: "divider", background: "linear-gradient(120deg,rgba(155,239,74,.05),rgba(76,141,255,.04))" }}>
              <SectionTitle icon={InsightsRoundedIcon} eyebrow="GA search space" title="Optimization Search Bounds" description="Capacity and peak-support ranges." />
            </Box>
            <Box sx={{ p: { xs: 2.1, sm: 2.5 } }}>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" }, gap: 1.5 }}>
                <SetupInput label="Minimum BESS capacity" value={draft.minCapacity} error={errors.minCapacity} suffix="kWh" onChange={(value) => update("minCapacity", value)} />
                <SetupInput label="Maximum BESS capacity" value={draft.maxCapacity} error={errors.maxCapacity} suffix="kWh" onChange={(value) => update("maxCapacity", value)} />
              </Box>
              <Box sx={{ px: 1.2, mt: 0.2, mb: 1.4 }}>
                <Typography variant="caption" color="text.secondary">Capacity search window</Typography>
                <Slider value={canUseCapacitySlider ? [minCapacity, maxCapacity] : [0, 10000]} onChange={(_, value) => updateCapacitySlider(value)} disabled={!canUseCapacitySlider} min={0} max={10000} step={100} disableSwap valueLabelDisplay="auto" aria-label="BESS capacity search range" sx={{ color: "#0f766e" }} />
              </Box>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" }, gap: 1.5 }}>
                <SetupInput label="Minimum peak-support" value={draft.minPeakSupport} error={errors.minPeakSupport} suffix="%" step="0.1" onChange={(value) => update("minPeakSupport", value)} />
                <SetupInput label="Maximum peak-support" value={draft.maxPeakSupport} error={errors.maxPeakSupport} suffix="%" step="0.1" onChange={(value) => update("maxPeakSupport", value)} />
              </Box>
              <Box sx={{ px: 1.2, mt: 0.2 }}>
                <Typography variant="caption" color="text.secondary">Peak-support search window</Typography>
                <Slider value={canUsePeakSlider ? [minPeak, maxPeak] : [20, 50]} onChange={(_, value) => updatePeakSlider(value)} disabled={!canUsePeakSlider} min={0} max={100} step={1} disableSwap valueLabelDisplay="auto" aria-label="Peak-support percentage search range" sx={{ color: "#2563eb" }} />
              </Box>
            </Box>
          </Paper>

          <Accordion expanded={advancedExpanded} onChange={(_, expanded) => setAdvancedExpanded(expanded)} disableGutters elevation={0} sx={{ border: "1px solid #d9e3eb", borderRadius: "24px !important", overflow: "hidden", "&::before": { display: "none" } }}>
            <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} sx={{ px: { xs: 2.1, sm: 2.5 }, py: 1.2, background: "rgba(76,141,255,.035)", "& .MuiAccordionSummary-content": { my: 1 } }}>
              <SectionTitle icon={SettingsSuggestRoundedIcon} eyebrow="Advanced controls" title="Advanced Genetic Algorithm Settings" description="Recommended search controls are preloaded." accent="blue" />
            </AccordionSummary>
            <AccordionDetails sx={{ p: { xs: 2.1, sm: 2.5 }, borderTop: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
              <Alert severity="info" sx={{ mb: 2, borderRadius: "14px" }}>These parameters change GA search behavior, not the scientific objective definition.</Alert>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" }, gap: 1.5 }}>
                <SetupInput label="Population size" value={draft.populationSize} error={errors.populationSize} onChange={(value) => update("populationSize", value)} />
                <SetupInput label="Number of generations" value={draft.generations} error={errors.generations} onChange={(value) => update("generations", value)} />
                <SetupInput label="Mutation probability" value={draft.mutationProbability} error={errors.mutationProbability} helper="Enter a decimal from 0 to 1." step="0.01" onChange={(value) => update("mutationProbability", value)} />
                <SetupInput label="Elite count" value={draft.eliteCount} error={errors.eliteCount} onChange={(value) => update("eliteCount", value)} />
                <SetupInput label="Random seed" value={draft.randomSeed} error={errors.randomSeed} helper="Makes future GA runs reproducible." onChange={(value) => update("randomSeed", value)} />
              </Box>
              <Paper elevation={0} sx={{ mt: 1.5, p: 1.6, borderRadius: "15px", bgcolor: "#eef2ff", color: "#3730a3" }}>
                <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "center" }}>
                  <Typography variant="body2" sx={{ fontWeight: 750 }}>Estimated candidate evaluations</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 880 }}>{Number.isFinite(evaluationCount) ? integerFormatter.format(evaluationCount) : "—"}</Typography>
                </Stack>
              </Paper>
            </AccordionDetails>
          </Accordion>

          <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: "24px", borderColor: "#ecd9ac" }}>
            <Box sx={{ p: { xs: 2.1, sm: 2.5 }, borderBottom: "1px solid", borderColor: "divider", background: "linear-gradient(120deg,rgba(245,167,66,.045),rgba(155,239,74,.03))" }}>
              <SectionTitle icon={SavingsRoundedIcon} eyebrow="Financial assumptions" title="Economic Settings" description="Project and lifecycle-cost assumptions." accent="amber" />
            </Box>
            <Box sx={{ p: { xs: 2.1, sm: 2.5 } }}>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" }, gap: 1.5 }}>
                <SetupInput label="Project life" value={draft.projectLife} error={errors.projectLife} suffix="years" onChange={(value) => update("projectLife", value)} />
                <SetupInput label="Discount rate" value={draft.discountRate} error={errors.discountRate} helper="Enter as a percentage, e.g. 10 for 10%." suffix="%" step="0.1" onChange={(value) => update("discountRate", value)} />
                <SetupInput label="Export tariff" value={draft.exportTariff} error={errors.exportTariff} suffix="LKR/kWh" step="0.1" onChange={(value) => update("exportTariff", value)} />
                <SetupInput label="Annual O&M percentage" value={draft.annualOmPercentage} error={errors.annualOmPercentage} suffix="%" step="0.1" onChange={(value) => update("annualOmPercentage", value)} />
                <SetupInput label="Replacement cost percentage" value={draft.replacementCostPercentage} error={errors.replacementCostPercentage} suffix="%" step="0.1" onChange={(value) => update("replacementCostPercentage", value)} />
              </Box>
              <Box sx={{ mt: 1, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "minmax(260px, 1fr) minmax(240px, 0.8fr)" }, gap: 1.5 }}>
                <Paper elevation={0} sx={{ p: 1.5, borderRadius: "16px", bgcolor: "rgba(245,167,66,.04)", border: "1px solid", borderColor: "rgba(245,167,66,.25)" }}>
                  <FormControlLabel
                    control={<Switch checked={draft.residualValueEnabled} onChange={(event) => { setDraft((current) => ({ ...current, residualValueEnabled: event.target.checked })); setReadyConfirmed(false); }} color="success" />}
                    label={<Box><Typography variant="body2" sx={{ fontWeight: 820 }}>Residual value enabled</Typography><Typography variant="caption" color="text.secondary">Include residual value in the future economic calculation.</Typography></Box>}
                    sx={{ m: 0, alignItems: "center" }}
                  />
                </Paper>
                <Paper elevation={0} sx={{ p: 1.5, borderRadius: "16px", color: "#fff", background: "linear-gradient(135deg, #0f766e, #0e7490)" }}>
                  <Typography variant="caption" sx={{ color: "#a7f3d0", fontWeight: 800 }}>DIRECT DISCOUNT RATE</Typography>
                  <Typography variant="h5" sx={{ mt: 0.35, fontWeight: 880 }}>{!errors.discountRate ? `${draft.discountRate}%` : "—"}</Typography>
                  <Typography variant="caption" sx={{ display: "block", mt: 0.35, color: "rgba(255,255,255,0.78)", lineHeight: 1.45 }}>
                    Used directly for present value and annualization.
                  </Typography>
                </Paper>
              </Box>
            </Box>
          </Paper>
        </Stack>

        <Paper component="aside" elevation={0} sx={{ position: { xl: "sticky" }, top: { xl: 92 }, overflow: "hidden", borderRadius: "24px", bgcolor: "#081522", border: "1px solid", borderColor: "divider", boxShadow: "0 22px 52px rgba(0,0,0,.24)" }}>
          <Box sx={{ p: 2.5, borderBottom: "1px solid rgba(255,255,255,0.09)", background: "linear-gradient(135deg, rgba(20,184,166,0.18), rgba(37,99,235,0.15))" }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <AutoAwesomeRoundedIcon sx={{ color: "#5eead4" }} />
              <Typography variant="overline" sx={{ color: "#5eead4", fontWeight: 850, letterSpacing: "0.11em" }}>RUN REVIEW</Typography>
            </Stack>
            <Typography variant="h5" sx={{ mt: 0.55, fontWeight: 880 }}>Ready-check summary</Typography>
            <Typography variant="caption" sx={{ color: "#94a3b8" }}>Review before running.</Typography>
          </Box>
          <Stack spacing={1.2} sx={{ p: 2.5 }}>
            <SummaryRow label="Selected battery" value={battery.batteryName} />
            <SummaryRow label="Edited battery price" value={`LKR ${integerFormatter.format(battery.priceRsPerKwh)} / kWh`} />
            <SummaryRow label="Dataset" value={dataset?.filename ?? "Not selected"} />
            <SummaryRow label="Dispatch" value={dispatchStrategy.status} />
            <Divider sx={{ borderColor: "rgba(255,255,255,0.09)", my: 0.3 }} />
            <SummaryRow label="Capacity range" value={!errors.minCapacity && !errors.maxCapacity ? `${energyFormatter.format(minCapacity)}–${energyFormatter.format(maxCapacity)} kWh` : "Invalid"} />
            <SummaryRow label="Peak-support range" value={!errors.minPeakSupport && !errors.maxPeakSupport ? `${energyFormatter.format(minPeak)}–${energyFormatter.format(maxPeak)}%` : "Invalid"} />
            <SummaryRow label="Project life" value={!errors.projectLife ? `${draft.projectLife} years` : "Invalid"} />
            <SummaryRow label="GA evaluations" value={Number.isFinite(evaluationCount) ? integerFormatter.format(evaluationCount) : "Invalid"} />
          </Stack>
          <Box sx={{ px: 2.5, pb: 2.5 }}>
            {!dataset && <Alert severity="warning" sx={{ mb: 1.5, borderRadius: "14px" }}>Upload a dataset to make this setup ready.</Alert>}
            {hasErrors && <Alert severity="error" sx={{ mb: 1.5, borderRadius: "14px" }}>Correct the highlighted setup values before continuing.</Alert>}
            <Button fullWidth variant="contained" startIcon={<FlagRoundedIcon />} disabled={!canConfirm} onClick={confirmSetup} sx={{ py: 1.25, borderRadius: "13px", background: "linear-gradient(100deg, #14b8a6, #2563eb)", fontWeight: 830 }}>
              Ready to Run Optimization
            </Button>
            <Typography variant="caption" sx={{ display: "block", mt: 1.1, color: "#94a3b8", textAlign: "center", lineHeight: 1.45 }}>
              Confirms locally; no GA request is sent.
            </Typography>
          </Box>
        </Paper>
      </Box>

      <Paper variant="outlined" sx={{ position: "sticky", bottom: 12, zIndex: 4, p: { xs: 1.5, sm: 1.8 }, borderRadius: "20px", borderColor: "divider", bgcolor: "rgba(8,21,34,.96)", backdropFilter: "blur(12px)" }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ justifyContent: "space-between" }}>
          <Button startIcon={<ArrowBackRoundedIcon />} onClick={onBack} sx={{ borderRadius: "12px" }}>Back</Button>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}>
            <Button variant="outlined" startIcon={<RestartAltRoundedIcon />} onClick={restoreRecommended} sx={{ borderRadius: "12px" }}>Restore Recommended Settings</Button>
            <Button variant="contained" endIcon={<ArrowForwardRoundedIcon />} disabled={!canConfirm} onClick={confirmSetup} sx={{ borderRadius: "12px", background: "linear-gradient(100deg, #0f766e, #2563eb)" }}>Start Optimization</Button>
          </Stack>
        </Stack>
      </Paper>

      <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "center", color: "text.secondary" }}>
        <BatteryChargingFullRoundedIcon fontSize="small" />
        <Typography variant="caption">Setup only; no calculations run.</Typography>
        <BoltRoundedIcon fontSize="small" />
        <CurrencyRupeeRoundedIcon fontSize="small" />
        <LoopRoundedIcon fontSize="small" />
      </Stack>
    </Stack>
  );
}
