import { useEffect, useMemo, useState } from "react";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import BadgeRoundedIcon from "@mui/icons-material/BadgeRounded";
import BatteryChargingFullRoundedIcon from "@mui/icons-material/BatteryChargingFullRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import CurrencyRupeeRoundedIcon from "@mui/icons-material/CurrencyRupeeRounded";
import LoopRoundedIcon from "@mui/icons-material/LoopRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import ScaleRoundedIcon from "@mui/icons-material/ScaleRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { SvgIconComponent } from "@mui/icons-material";

import type { SingleBatteryConfigurationSnapshot } from "../types/workspace";
import { batteryTypeLabel } from "../lib/batteryCatalogue";


const CONFIG_DEFAULTS_ENDPOINT = "/api/config/defaults";

interface CatalogueBattery {
  name: string;
  price_rs_per_kwh: number;
  rated_cycle_life: number;
  eta_ch: number;
  eta_dis: number;
  weight_density_kg_per_kwh: number;
  warranty_years: number;
}

interface BatteryDraft {
  price_rs_per_kwh: string;
  rated_cycle_life: string;
  eta_ch: string;
  eta_dis: string;
  weight_density_kg_per_kwh: string;
  warranty_years: string;
}

type BatteryField = keyof BatteryDraft;
type DraftErrors = Partial<Record<BatteryField, string>>;

interface ParameterDefinition {
  field: BatteryField;
  label: string;
  helper: string;
  icon: SvgIconComponent;
  step: string;
  min: string;
  max?: string;
}

const ACTIVE_PARAMETERS: ParameterDefinition[] = [
  {
    field: "price_rs_per_kwh",
    label: "Battery price in LKR/kWh",
    helper: "Used directly in investment and annual-cost calculations.",
    icon: CurrencyRupeeRoundedIcon,
    step: "100",
    min: "0",
  },
  {
    field: "rated_cycle_life",
    label: "Rated cycle life",
    helper: "Defines the catalogue cycle-life basis used by the optimization.",
    icon: LoopRoundedIcon,
    step: "1",
    min: "0",
  },
  {
    field: "eta_ch",
    label: "Charge efficiency",
    helper: "Fraction of charging energy retained by the battery.",
    icon: BatteryChargingFullRoundedIcon,
    step: "0.001",
    min: "0",
    max: "1",
  },
  {
    field: "eta_dis",
    label: "Discharge efficiency",
    helper: "Fraction of stored energy delivered during discharge.",
    icon: BoltRoundedIcon,
    step: "0.001",
    min: "0",
    max: "1",
  },
];

const INFORMATION_PARAMETERS: ParameterDefinition[] = [
  {
    field: "weight_density_kg_per_kwh",
    label: "Weight density in kg/kWh",
    helper: "Reference information for later physical-design comparisons.",
    icon: ScaleRoundedIcon,
    step: "0.1",
    min: "0",
  },
  {
    field: "warranty_years",
    label: "Manufacturer warranty in years",
    helper: "Catalogue warranty information; it is not calculated battery life.",
    icon: VerifiedRoundedIcon,
    step: "0.1",
    min: "0",
  },
];

const priceFormatter = new Intl.NumberFormat("en-LK", {
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("en-LK", {
  maximumFractionDigits: 3,
});

function toDraft(battery: CatalogueBattery): BatteryDraft {
  return {
    price_rs_per_kwh: String(battery.price_rs_per_kwh),
    rated_cycle_life: String(battery.rated_cycle_life),
    eta_ch: String(battery.eta_ch),
    eta_dis: String(battery.eta_dis),
    weight_density_kg_per_kwh: String(battery.weight_density_kg_per_kwh),
    warranty_years: String(battery.warranty_years),
  };
}

function isCatalogueResponse(value: unknown): value is { battery_types: CatalogueBattery[] } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { battery_types?: unknown };
  return Array.isArray(candidate.battery_types);
}

function parsedDraft(draft: BatteryDraft): Record<BatteryField, number> {
  return {
    price_rs_per_kwh: Number(draft.price_rs_per_kwh),
    rated_cycle_life: Number(draft.rated_cycle_life),
    eta_ch: Number(draft.eta_ch),
    eta_dis: Number(draft.eta_dis),
    weight_density_kg_per_kwh: Number(draft.weight_density_kg_per_kwh),
    warranty_years: Number(draft.warranty_years),
  };
}

function validateDraft(draft: BatteryDraft): DraftErrors {
  const values = parsedDraft(draft);
  const errors: DraftErrors = {};
  const empty = (field: BatteryField) => draft[field].trim() === "";
  const invalid = (field: BatteryField) => empty(field) || !Number.isFinite(values[field]);

  if (invalid("price_rs_per_kwh") || values.price_rs_per_kwh <= 0) {
    errors.price_rs_per_kwh = "Price must be greater than 0.";
  }
  if (invalid("rated_cycle_life") || values.rated_cycle_life <= 0) {
    errors.rated_cycle_life = "Rated cycle life must be greater than 0.";
  }
  if (invalid("eta_ch") || values.eta_ch <= 0 || values.eta_ch > 1) {
    errors.eta_ch = "Charge efficiency must be greater than 0 and no more than 1.";
  }
  if (invalid("eta_dis") || values.eta_dis <= 0 || values.eta_dis > 1) {
    errors.eta_dis = "Discharge efficiency must be greater than 0 and no more than 1.";
  }
  if (
    invalid("weight_density_kg_per_kwh") ||
    values.weight_density_kg_per_kwh <= 0
  ) {
    errors.weight_density_kg_per_kwh = "Weight density must be greater than 0.";
  }
  if (invalid("warranty_years") || values.warranty_years < 0) {
    errors.warranty_years = "Manufacturer warranty cannot be negative.";
  }

  return errors;
}

function ParameterInput({
  definition,
  value,
  error,
  active,
  onChange,
}: {
  definition: ParameterDefinition;
  value: string;
  error?: string;
  active: boolean;
  onChange: (value: string) => void;
}) {
  const Icon = definition.icon;

  return (
    <Paper
      variant="outlined"
      sx={{
        height: "100%",
        p: 1.75,
        borderRadius: "18px",
        borderColor: error ? "#ef9a9a" : active ? "#b7e4dc" : "#dfe6ec",
        bgcolor: active ? "rgba(155,239,74,.055)" : "#0D1D2D",
        transition: "border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease",
        "&:focus-within": {
          transform: "translateY(-2px)",
          borderColor: error ? "#dc2626" : active ? "#0f766e" : "#2563eb",
          boxShadow: active
            ? "0 12px 28px rgba(15,118,110,0.1)"
            : "0 12px 28px rgba(37,99,235,0.08)",
        },
        "@media (prefers-reduced-motion: reduce)": {
          transition: "none",
          "&:focus-within": { transform: "none" },
        },
      }}
    >
      <Stack direction="row" spacing={1.2} sx={{ mb: 1.45, alignItems: "flex-start" }}>
        <Box
          sx={{
            display: "grid",
            placeItems: "center",
            width: 38,
            height: 38,
            flexShrink: 0,
            borderRadius: "12px",
            color: active ? "#0f766e" : "#2563eb",
            bgcolor: active ? "#ccfbf1" : "#dbeafe",
          }}
        >
          <Icon fontSize="small" />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 820, lineHeight: 1.3 }}>
            {definition.label}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.3, lineHeight: 1.4 }}>
            {definition.helper}
          </Typography>
        </Box>
      </Stack>
      <TextField
        fullWidth
        size="small"
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        error={Boolean(error)}
        helperText={error ?? " "}
        slotProps={{
          htmlInput: {
            step: definition.step,
            min: definition.min,
            max: definition.max,
            "aria-label": definition.label,
          },
        }}
        sx={{
          "& .MuiOutlinedInput-root": { bgcolor: "#081522", borderRadius: "12px" },
          "& .MuiFormHelperText-root": { mx: 0.25, minHeight: 19 },
        }}
      />
    </Paper>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" spacing={2} sx={{ justifyContent: "space-between", alignItems: "baseline" }}>
      <Typography variant="caption" sx={{ color: "#94a3b8" }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ color: "#f8fafc", fontWeight: 780, textAlign: "right" }}>
        {value}
      </Typography>
    </Stack>
  );
}

export default function SingleBatteryConfiguration({
  batteryName,
  onBack,
  onContinue,
  initialConfiguration,
}: {
  batteryName: string;
  onBack: (configuration?: SingleBatteryConfigurationSnapshot) => void;
  onContinue: (configuration: SingleBatteryConfigurationSnapshot) => void;
  initialConfiguration?: SingleBatteryConfigurationSnapshot | null;
}) {
  const [catalogueBattery, setCatalogueBattery] = useState<CatalogueBattery | null>(null);
  const [draft, setDraft] = useState<BatteryDraft | null>(null);
  const [customName, setCustomName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCatalogueBattery() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(CONFIG_DEFAULTS_ENDPOINT, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Backend returned HTTP ${response.status}.`);
        }
        const payload: unknown = await response.json();
        if (!isCatalogueResponse(payload)) {
          throw new Error("The backend returned an unexpected catalogue format.");
        }
        const selected = payload.battery_types.find((battery) => battery.name === batteryName);
        if (!selected) {
          throw new Error(`Catalogue values for ${batteryName} were not found.`);
        }
        const immutableCopy = { ...selected };
        setCatalogueBattery(immutableCopy);
        if (initialConfiguration?.catalogueName === batteryName) {
          setDraft({
            price_rs_per_kwh: String(initialConfiguration.priceRsPerKwh),
            rated_cycle_life: String(initialConfiguration.ratedCycleLife),
            eta_ch: String(initialConfiguration.etaCh),
            eta_dis: String(initialConfiguration.etaDis),
            weight_density_kg_per_kwh: String(initialConfiguration.weightDensityKgPerKwh),
            warranty_years: String(initialConfiguration.warrantyYears),
          });
          setCustomName(
            initialConfiguration.batteryName === batteryName
              ? ""
              : initialConfiguration.batteryName,
          );
        } else {
          setDraft(toDraft(immutableCopy));
          setCustomName("");
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setCatalogueBattery(null);
          setDraft(null);
          setError(loadError instanceof Error ? loadError.message : "Unable to load the battery catalogue.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadCatalogueBattery();
    return () => controller.abort();
  }, [batteryName, initialConfiguration, requestVersion]);

  const errors = useMemo(() => (draft ? validateDraft(draft) : {}), [draft]);
  const values = useMemo(() => (draft ? parsedDraft(draft) : null), [draft]);
  const hasErrors = Object.keys(errors).length > 0;
  const effectiveName = customName.trim() || catalogueBattery?.name || batteryName;
  const roundTripEfficiency = values
    ? values.eta_ch * values.eta_dis
    : Number.NaN;
  const roundTripIsValid =
    !errors.eta_ch &&
    !errors.eta_dis &&
    Number.isFinite(roundTripEfficiency);

  function currentSnapshot(): SingleBatteryConfigurationSnapshot | undefined {
    if (!catalogueBattery || !values || hasErrors) return undefined;
    return {
      catalogueName: catalogueBattery.name,
      batteryName: effectiveName,
      priceRsPerKwh: values.price_rs_per_kwh,
      ratedCycleLife: values.rated_cycle_life,
      etaCh: values.eta_ch,
      etaDis: values.eta_dis,
      weightDensityKgPerKwh: values.weight_density_kg_per_kwh,
      warrantyYears: values.warranty_years,
      modifiedFromCatalogue: isModified,
    };
  }

  const isModified = useMemo(() => {
    if (!catalogueBattery || !draft) {
      return false;
    }
    const original = toDraft(catalogueBattery);
    const valueChanged = (Object.keys(draft) as BatteryField[]).some(
      (field) => Number(draft[field]) !== Number(original[field]) || draft[field].trim() === "",
    );
    const nameChanged = customName.trim() !== "" && customName.trim() !== catalogueBattery.name;
    return valueChanged || nameChanged;
  }, [catalogueBattery, customName, draft]);

  function updateField(field: BatteryField, value: string) {
    setDraft((current) => current ? { ...current, [field]: value } : current);
  }

  function restoreCatalogueValues() {
    if (!catalogueBattery) {
      return;
    }
    setDraft(toDraft(catalogueBattery));
    setCustomName("");
  }

  if (isLoading) {
    return (
      <Stack spacing={2.5}>
        <Skeleton variant="rounded" height={190} sx={{ borderRadius: "26px" }} />
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "2fr 1fr" }, gap: 2.5 }}>
          <Skeleton variant="rounded" height={560} sx={{ borderRadius: "24px" }} />
          <Skeleton variant="rounded" height={440} sx={{ borderRadius: "24px" }} />
        </Box>
      </Stack>
    );
  }

  if (error || !catalogueBattery || !draft || !values) {
    return (
      <Stack spacing={2}>
        <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => onBack()} sx={{ alignSelf: "flex-start" }}>
          Back to mode selection
        </Button>
        <Alert
          severity="error"
          action={<Button color="inherit" onClick={() => setRequestVersion((value) => value + 1)}>Retry</Button>}
          sx={{ borderRadius: "18px" }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 820 }}>Battery catalogue could not be loaded</Typography>
          <Typography variant="body2">{error ?? "Selected battery data is unavailable."}</Typography>
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack spacing={2.5}>
      <Paper
        elevation={0}
        sx={{
          position: "relative",
          overflow: "hidden",
          p: { xs: 2.5, sm: 3.5 },
          borderRadius: "28px",
          color: "#fff",
          background: "linear-gradient(118deg,#0D1D2D,#12263A)",
          boxShadow: "0 20px 48px rgba(7,62,73,0.2)",
          "&::after": {
            content: '\"\"',
            position: "absolute",
            width: 260,
            height: 260,
            right: -90,
            top: -145,
            borderRadius: "50%",
            bgcolor: "rgba(255,255,255,0.08)",
          },
        }}
      >
        <Box sx={{ position: "relative", zIndex: 1 }}>
          <Button
            color="inherit"
            size="small"
            startIcon={<ArrowBackRoundedIcon />}
            onClick={() => onBack(currentSnapshot())}
            sx={{ mb: 2, bgcolor: "rgba(255,255,255,0.1)", borderRadius: "11px" }}
          >
            Back to mode selection
          </Button>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ justifyContent: "space-between", alignItems: { sm: "flex-end" } }}>
            <Box sx={{ maxWidth: 760 }}>
              <Typography variant="overline" sx={{ color: "#a7f3d0", fontWeight: 850, letterSpacing: "0.12em" }}>
                SINGLE BATTERY CONFIGURATION
              </Typography>
              <Typography variant="h3" sx={{ mt: 0.35, fontSize: { xs: 30, sm: 39 }, fontWeight: 850, letterSpacing: "-0.035em" }}>
                Configure {batteryTypeLabel(effectiveName)}
              </Typography>
              <Typography sx={{ mt: 1, color: "rgba(255,255,255,0.8)", lineHeight: 1.65 }}>
                Select and edit one battery alternative.
              </Typography>
            </Box>
            <Chip label="Step 1 · Battery Alternative" sx={{ color: "primary.main", bgcolor: "rgba(155,239,74,.08)", fontWeight: 750 }} />
          </Stack>
        </Box>
      </Paper>

      <Paper
        variant="outlined"
        sx={{ p: { xs: 2, sm: 2.25 }, borderRadius: "20px", borderColor: isModified ? "warning.main" : "divider", bgcolor: isModified ? "rgba(245,167,66,.06)" : "rgba(155,239,74,.045)" }}
      >
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
            <CheckCircleRoundedIcon sx={{ color: isModified ? "#d97706" : "#0f766e" }} />
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
                {isModified ? "Modified from catalogue default" : "Catalogue values loaded"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Catalogue: {catalogueBattery.name}. Changes stay local.
              </Typography>
            </Box>
          </Stack>
          <Button
            variant="outlined"
            startIcon={<RestartAltRoundedIcon />}
            disabled={!isModified}
            onClick={restoreCatalogueValues}
            sx={{ borderRadius: "12px", alignSelf: { xs: "stretch", sm: "center" } }}
          >
            Restore Catalogue Values
          </Button>
        </Stack>
      </Paper>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", xl: "minmax(0, 2fr) minmax(310px, 0.82fr)" }, gap: 2.5, alignItems: "start" }}>
        <Stack spacing={2.5}>
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: "22px", borderColor: "divider", background: "linear-gradient(135deg,rgba(255,255,255,.02),rgba(155,239,74,.035))" }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
              <Box sx={{ display: "grid", placeItems: "center", width: 42, height: 42, borderRadius: "13px", color: "#0f766e", bgcolor: "#ccfbf1" }}>
                <BadgeRoundedIcon />
              </Box>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>Optional custom battery name</Typography>
                <Typography variant="caption" color="text.secondary">Leave blank to keep the catalogue name.</Typography>
              </Box>
            </Stack>
            <TextField
              fullWidth
              size="small"
              label="Custom battery name (optional)"
              value={customName}
              onChange={(event) => setCustomName(event.target.value)}
              placeholder={catalogueBattery.name}
              sx={{ mt: 1.8, maxWidth: 560, "& .MuiOutlinedInput-root": { bgcolor: "#081522", borderRadius: "12px" } }}
            />
          </Paper>

          <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: "24px", borderColor: "#b7e4dc", boxShadow: "0 14px 36px rgba(15,118,110,0.06)" }}>
            <Box sx={{ p: { xs: 2, sm: 2.5 }, borderBottom: "1px solid", borderColor: "divider", background: "linear-gradient(120deg,rgba(155,239,74,.05),rgba(76,141,255,.04))" }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}>
                <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
                  <Box sx={{ display: "grid", placeItems: "center", width: 44, height: 44, borderRadius: "14px", color: "#fff", background: "linear-gradient(135deg, #0f766e, #0ea5a6)" }}>
                    <TuneRoundedIcon />
                  </Box>
                  <Box>
                    <Typography variant="h6">GA-active parameters</Typography>
                    <Typography variant="body2" color="text.secondary">Used directly by the single-battery GA.</Typography>
                  </Box>
                </Stack>
                <Chip label="Affects GA" size="small" sx={{ alignSelf: { xs: "flex-start", sm: "center" }, bgcolor: "#0f766e", color: "#fff", fontWeight: 800 }} />
              </Stack>
            </Box>
            <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, gap: 1.5 }}>
                {ACTIVE_PARAMETERS.map((definition) => (
                  <ParameterInput
                    key={definition.field}
                    definition={definition}
                    value={draft[definition.field]}
                    error={errors[definition.field]}
                    active
                    onChange={(value) => updateField(definition.field, value)}
                  />
                ))}
              </Box>
              <Paper elevation={0} sx={{ mt: 1.75, p: 1.8, borderRadius: "17px", bgcolor: "#0f2733", color: "#fff" }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}>
                  <Box>
                    <Typography variant="caption" sx={{ color: "#94a3b8", fontWeight: 750 }}>AUTOMATIC CALCULATION</Typography>
                    <Typography variant="subtitle1" sx={{ mt: 0.25, fontWeight: 850 }}>
                      {"Round-trip efficiency = eta_ch \u00d7 eta_dis"}
                    </Typography>
                  </Box>
                  <Box sx={{ textAlign: { sm: "right" } }}>
                    <Typography variant="h5" sx={{ color: "#5eead4", fontWeight: 850 }}>
                      {roundTripIsValid ? `${(roundTripEfficiency * 100).toFixed(2)}%` : "--"}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "#94a3b8" }}>
                      {roundTripIsValid ? roundTripEfficiency.toFixed(4) : "Invalid efficiencies"}
                    </Typography>
                  </Box>
                </Stack>
              </Paper>
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: "24px", borderColor: "#dbe4eb" }}>
            <Box sx={{ p: { xs: 2, sm: 2.5 }, borderBottom: "1px solid", borderColor: "divider", background: "rgba(76,141,255,.04)" }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}>
                <Box>
                  <Typography variant="h6">Additional battery information</Typography>
                  <Typography variant="body2" color="text.secondary">Not used by the current GA objective.</Typography>
                </Box>
                <Chip label="Reference only" size="small" variant="outlined" sx={{ alignSelf: { xs: "flex-start", sm: "center" }, fontWeight: 750 }} />
              </Stack>
            </Box>
            <Box sx={{ p: { xs: 2, sm: 2.5 }, display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, gap: 1.5 }}>
              {INFORMATION_PARAMETERS.map((definition) => (
                <ParameterInput
                  key={definition.field}
                  definition={definition}
                  value={draft[definition.field]}
                  error={errors[definition.field]}
                  active={false}
                  onChange={(value) => updateField(definition.field, value)}
                />
              ))}
            </Box>
          </Paper>
        </Stack>

        <Paper
          component="aside"
          elevation={0}
          sx={{ position: { xl: "sticky" }, top: { xl: 92 }, overflow: "hidden", borderRadius: "24px", bgcolor: "#081522", border: "1px solid", borderColor: "divider", boxShadow: "0 20px 48px rgba(0,0,0,.2)" }}
        >
          <Box sx={{ p: 2.5, borderBottom: "1px solid rgba(255,255,255,0.09)", background: "linear-gradient(135deg, rgba(20,184,166,0.18), rgba(37,99,235,0.14))" }}>
            <Typography variant="overline" sx={{ color: "#5eead4", fontWeight: 850, letterSpacing: "0.11em" }}>CONFIGURATION SUMMARY</Typography>
            <Typography variant="h5" sx={{ mt: 0.35, fontWeight: 850 }}>{batteryTypeLabel(effectiveName)}</Typography>
            <Typography variant="caption" sx={{ color: "#94a3b8" }}>Based on {catalogueBattery.name} catalogue type</Typography>
            <Chip
              size="small"
              label={isModified ? "Modified from catalogue default" : "Catalogue default"}
              sx={{ mt: 1.5, color: isModified ? "#fde68a" : "#99f6e4", bgcolor: "rgba(255,255,255,0.08)", fontWeight: 750 }}
            />
          </Box>
          <Stack spacing={1.25} sx={{ p: 2.5 }}>
            <SummaryRow label="Price" value={errors.price_rs_per_kwh ? "--" : `LKR ${priceFormatter.format(values.price_rs_per_kwh)} / kWh`} />
            <SummaryRow label="Rated cycles" value={errors.rated_cycle_life ? "--" : numberFormatter.format(values.rated_cycle_life)} />
            <SummaryRow label="Charge efficiency" value={errors.eta_ch ? "--" : numberFormatter.format(values.eta_ch)} />
            <SummaryRow label="Discharge efficiency" value={errors.eta_dis ? "--" : numberFormatter.format(values.eta_dis)} />
            <SummaryRow label="Round-trip efficiency" value={roundTripIsValid ? `${(roundTripEfficiency * 100).toFixed(2)}%` : "--"} />
            <Box sx={{ borderTop: "1px solid rgba(255,255,255,0.09)", my: 0.5 }} />
            <SummaryRow label="Weight density" value={errors.weight_density_kg_per_kwh ? "--" : `${numberFormatter.format(values.weight_density_kg_per_kwh)} kg/kWh`} />
            <SummaryRow label="Warranty" value={errors.warranty_years ? "--" : `${numberFormatter.format(values.warranty_years)} years`} />
          </Stack>
          <Box sx={{ p: 2.5, pt: 0 }}>
            {hasErrors && (
              <Alert severity="error" sx={{ mb: 1.5, borderRadius: "14px" }}>
                Correct the highlighted values before continuing.
              </Alert>
            )}
            <Button
              fullWidth
              variant="contained"
              endIcon={<ArrowForwardRoundedIcon />}
              disabled={hasErrors}
              onClick={() => {
                const snapshot = currentSnapshot();
                if (snapshot) onContinue(snapshot);
              }}
              sx={{ py: 1.25, borderRadius: "13px", background: "linear-gradient(100deg, #14b8a6, #2563eb)", fontWeight: 820 }}
            >
              Continue to Optimization Setup
            </Button>
            <Typography variant="caption" sx={{ display: "block", mt: 1.1, color: "#94a3b8", textAlign: "center" }}>
              Saves locally; does not run the GA.
            </Typography>
          </Box>
        </Paper>
      </Box>
    </Stack>
  );
}
