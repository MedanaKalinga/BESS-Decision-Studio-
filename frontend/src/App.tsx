import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, ElementType, SetStateAction } from "react";
import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import ArrowDownwardRoundedIcon from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
import AssessmentRoundedIcon from "@mui/icons-material/AssessmentRounded";
import AutoGraphRoundedIcon from "@mui/icons-material/AutoGraphRounded";
import BatteryChargingFullRoundedIcon from "@mui/icons-material/BatteryChargingFullRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import CloudUploadRoundedIcon from "@mui/icons-material/CloudUploadRounded";
import CompareArrowsRoundedIcon from "@mui/icons-material/CompareArrowsRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import DashboardRoundedIcon from "@mui/icons-material/DashboardRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DoNotDisturbOnRoundedIcon from "@mui/icons-material/DoNotDisturbOnRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import LockRoundedIcon from "@mui/icons-material/LockRounded";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import RestoreRoundedIcon from "@mui/icons-material/RestoreRounded";
import ScaleRoundedIcon from "@mui/icons-material/ScaleRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import ScheduleRoundedIcon from "@mui/icons-material/ScheduleRounded";
import TrendingDownRoundedIcon from "@mui/icons-material/TrendingDownRounded";
import TrendingUpRoundedIcon from "@mui/icons-material/TrendingUpRounded";
import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Drawer,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  Switch,
  TextField,
  Toolbar,
  Typography,
} from "@mui/material";
import type {
  PersistedWorkspaceState,
  ComparisonAHPWorkspaceState,
  ComparisonOptimizationWorkspaceState,
  ComparisonOptimizationConfiguration,
  ComparisonRunWorkspaceState,
  PrometheeWorkspaceState,
  SingleBatteryConfigurationSnapshot,
  SingleOptimizationRunWorkspaceState,
  SingleOptimizationSetupSnapshot,
  WorkspaceDatasetSummary,
  WorkspaceDispatchStrategy,
} from "./types/workspace";
import {
  buildPersistedWorkspaceState,
  clearPersistedWorkspaceState,
  readPersistedWorkspaceState,
  shouldRenderOperationalProfiles,
  validatePersistedWorkspaceState,
  writePersistedWorkspaceState,
} from "./lib/workspacePersistence";
import { INITIAL_COMPARISON_RUN_STATE, buildComparisonInputSignature, createDefaultComparisonConfiguration, synchronizeComparisonSnapshot, transitionFromComparisonRunner } from "./lib/comparisonOptimization";
import { canEnterComparisonResults, isPrometheeResultStale } from "./lib/comparisonResults";


const DRAWER_WIDTH = 264;
const CONFIG_DEFAULTS_ENDPOINT = "/api/config/defaults";
const DataUploadPage = lazy(() => import("./pages/DataUploadPage"));
const OptimizationPage = lazy(() => import("./pages/OptimizationPage"));
const ComparisonResultsDialog = lazy(() => import("./pages/ComparisonResultsDialog"));
const ComparisonOptimizationDialog = lazy(() => import("./pages/ComparisonOptimizationDialog"));

const INITIAL_WORKSPACE_DISPATCH_STRATEGY: WorkspaceDispatchStrategy = {
  status: "Reference Strategy",
  periods: [
    {
      name: "Off-peak 1",
      start: "00:00",
      end: "05:30",
      evSupplyPriority: ["BESS", "Grid"],
      excessPvPriority: [],
      bessChargeAllowed: false,
      bessDischargeAllowed: true,
      exportAllowed: false,
      peakShareControlled: false,
    },
    {
      name: "Day",
      start: "05:30",
      end: "18:30",
      evSupplyPriority: ["PV", "Grid"],
      excessPvPriority: ["Charge BESS", "Export"],
      bessChargeAllowed: true,
      bessDischargeAllowed: false,
      exportAllowed: true,
      peakShareControlled: false,
    },
    {
      name: "Peak",
      start: "18:30",
      end: "22:30",
      evSupplyPriority: ["BESS", "Grid"],
      excessPvPriority: [],
      bessChargeAllowed: false,
      bessDischargeAllowed: true,
      exportAllowed: false,
      peakShareControlled: true,
    },
    {
      name: "Off-peak 2",
      start: "22:30",
      end: "24:00",
      evSupplyPriority: ["BESS", "Grid"],
      excessPvPriority: [],
      bessChargeAllowed: false,
      bessDischargeAllowed: true,
      exportAllowed: false,
      peakShareControlled: false,
    },
  ],
};

const INITIAL_SINGLE_OPTIMIZATION_RUN_STATE: SingleOptimizationRunWorkspaceState = {
  phase: "ready",
  jobId: null,
  latestJob: null,
  error: null,
  startedAt: null,
  finishedAt: null,
  reconnecting: false,
};

const INITIAL_PERSISTED_WORKSPACE_STATE: PersistedWorkspaceState = {
  version: 1,
  activePage: "Comparison Mode",
  dataset: null,
  dispatchStrategy: INITIAL_WORKSPACE_DISPATCH_STRATEGY,
  battery: null,
  setup: null,
  runState: INITIAL_SINGLE_OPTIMIZATION_RUN_STATE,
  selectedBatteryId: null,
  selectedMode: null,
  activeOptimizationStep: null,
  operationalProfileDate: null,
  comparisonAhp: null,
  comparisonConfiguration: null,
  comparisonRunState: INITIAL_COMPARISON_RUN_STATE,
  comparisonOptimization: null,
  promethee: null,
};

type BatteryTypeName = "Low-cost" | "Medium-low" | "Medium" | "Medium-high";
type CriterionDirection = "minimize" | "maximize";
type CriterionName =
  | "total_annual_cost_rs"
  | "cycle_based_life_years"
  | "round_trip_efficiency"
  | "weight_density_kg_per_kwh"
  | "annual_om_cost_rs"
  | "warranty_years";
type ActivePage = "Comparison Mode" | "Dispatch" | "Data Upload" | "Optimization";
type DispatchPeriodName = "Off-peak 1" | "Day" | "Peak" | "Off-peak 2";
type EVSupplySource = "PV" | "BESS" | "Grid";
type BackendExcessPvPriority = "BESS" | "Export";
type ExcessPvPriority = "Charge BESS" | "Export" | "Curtailment";

interface BatteryType {
  name: BatteryTypeName;
  price_rs_per_kwh: number;
  rated_cycle_life: number;
  eta_ch: number;
  eta_dis: number;
  weight_density_kg_per_kwh: number;
  warranty_years: number;
}

interface Criterion {
  name: CriterionName;
  direction: CriterionDirection;
}

interface DispatchPeriod {
  name: DispatchPeriodName;
  start: string;
  end: string;
  ev_supply_priority: EVSupplySource[];
  excess_pv_priority?: BackendExcessPvPriority[];
  bess_charge_allowed: boolean;
  bess_discharge_allowed: boolean;
  bess_discharge_control?: "peak_share";
  pv_handling?: "not_used";
  source: "reference_code_default";
  warning?: string;
}

interface EditableDispatchPeriod {
  name: DispatchPeriodName;
  start: string;
  end: string;
  ev_supply_priority: EVSupplySource[];
  excess_pv_priority: ExcessPvPriority[];
  bess_charge_allowed: boolean;
  bess_discharge_allowed: boolean;
  export_allowed: boolean;
  peak_share_controlled: boolean;
  source: "reference_code_default";
  warning?: string;
}

interface DefaultConfiguration {
  battery_types: BatteryType[];
  criteria: Criterion[];
  ahp_matrix: number[][];
  dispatch_periods: DispatchPeriod[];
}

interface NavigationItem {
  label: string;
  icon: ElementType;
  page?: ActivePage;
}

const navigationItems: NavigationItem[] = [
  { label: "Dashboard", icon: DashboardRoundedIcon },
  { label: "Data Upload", icon: CloudUploadRoundedIcon, page: "Data Upload" },
  { label: "Dispatch", icon: BoltRoundedIcon, page: "Dispatch" },
  { label: "Optimization", icon: AutoGraphRoundedIcon, page: "Optimization" },
  {
    label: "Comparison Mode",
    icon: CompareArrowsRoundedIcon,
    page: "Comparison Mode",
  },
  { label: "Results", icon: AssessmentRoundedIcon },
];

const criterionLabels: Record<CriterionName, string> = {
  total_annual_cost_rs: "Total Annual Cost",
  cycle_based_life_years: "Cycle-Based Service Life",
  round_trip_efficiency: "Round-Trip Efficiency",
  weight_density_kg_per_kwh: "Weight Density",
  annual_om_cost_rs: "Annual O&M Cost",
  warranty_years: "Warranty Period",
};

const priceFormatter = new Intl.NumberFormat("en-LK", {
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("en-LK", {
  maximumFractionDigits: 1,
});

const batteryHeaderGradient =
  "linear-gradient(135deg, #e8faf6 0%, #edf6ff 100%)";

const EV_SUPPLY_OPTIONS: EVSupplySource[] = ["PV", "BESS", "Grid"];
const EXCESS_PV_OPTIONS: ExcessPvPriority[] = [
  "Charge BESS",
  "Export",
  "Curtailment",
];

function toEditableDispatchPeriods(
  periods: DispatchPeriod[],
): EditableDispatchPeriod[] {
  return periods.map((period) => {
    const excessPvPriority = (period.excess_pv_priority ?? []).map(
      (priority): ExcessPvPriority =>
        priority === "BESS" ? "Charge BESS" : "Export",
    );

    return {
      name: period.name,
      start: period.start,
      end: period.end,
      ev_supply_priority: [...period.ev_supply_priority],
      excess_pv_priority: excessPvPriority,
      bess_charge_allowed: period.bess_charge_allowed,
      bess_discharge_allowed: period.bess_discharge_allowed,
      export_allowed: excessPvPriority.includes("Export"),
      peak_share_controlled:
        period.bess_discharge_control === "peak_share",
      source: period.source,
      warning: period.warning,
    };
  });
}

function cloneDispatchPeriods(
  periods: EditableDispatchPeriod[],
): EditableDispatchPeriod[] {
  return periods.map((period) => ({
    ...period,
    ev_supply_priority: [...period.ev_supply_priority],
    excess_pv_priority: [...period.excess_pv_priority],
  }));
}

function isEVSupplySource(value: string): value is EVSupplySource {
  return EV_SUPPLY_OPTIONS.some((source) => source === value);
}

function fromWorkspaceDispatchStrategy(
  strategy: WorkspaceDispatchStrategy | undefined,
  referencePeriods: EditableDispatchPeriod[],
): EditableDispatchPeriod[] | null {
  if (!strategy || strategy.periods.length !== 4 || referencePeriods.length !== 4) {
    return null;
  }

  const persistedByName = new Map(
    strategy.periods.map((period) => [period.name, period]),
  );
  if (persistedByName.size !== referencePeriods.length) {
    return null;
  }

  const restoredPeriods: EditableDispatchPeriod[] = [];
  for (const referencePeriod of referencePeriods) {
    const persistedPeriod = persistedByName.get(referencePeriod.name);
    if (
      !persistedPeriod ||
      persistedPeriod.evSupplyPriority.length === 0 ||
      !persistedPeriod.evSupplyPriority.every(isEVSupplySource) ||
      new Set(persistedPeriod.evSupplyPriority).size !==
        persistedPeriod.evSupplyPriority.length
    ) {
      return null;
    }

    restoredPeriods.push({
      ...referencePeriod,
      start: persistedPeriod.start,
      end: persistedPeriod.end,
      ev_supply_priority: [...persistedPeriod.evSupplyPriority],
      excess_pv_priority: [...persistedPeriod.excessPvPriority] as ExcessPvPriority[],
      bess_charge_allowed: persistedPeriod.bessChargeAllowed,
      bess_discharge_allowed: persistedPeriod.bessDischargeAllowed,
      export_allowed: persistedPeriod.exportAllowed,
      peak_share_controlled: persistedPeriod.peakShareControlled,
    });
  }

  return validateDispatchStrategy(restoredPeriods).length === 0
    ? restoredPeriods
    : null;
}

function toWorkspaceDispatchStrategy(
  periods: EditableDispatchPeriod[],
  referencePeriods: EditableDispatchPeriod[],
): WorkspaceDispatchStrategy {
  const matchesReference =
    referencePeriods.length === periods.length &&
    dispatchStrategySignature(periods) ===
      dispatchStrategySignature(referencePeriods);

  return {
    status: matchesReference ? "Reference Strategy" : "Modified Strategy",
    periods: periods.map((period) => ({
      name: period.name,
      start: period.start,
      end: period.end,
      evSupplyPriority: [...period.ev_supply_priority],
      excessPvPriority: [...period.excess_pv_priority],
      bessChargeAllowed: period.bess_charge_allowed,
      bessDischargeAllowed: period.bess_discharge_allowed,
      exportAllowed: period.export_allowed,
      peakShareControlled: period.peak_share_controlled,
    })),
  };
}

function dispatchStrategySignature(periods: EditableDispatchPeriod[]): string {
  return JSON.stringify(
    periods.map((period) => ({
      name: period.name,
      start: period.start,
      end: period.end,
      ev_supply_priority: period.ev_supply_priority,
      excess_pv_priority: period.excess_pv_priority,
      bess_charge_allowed: period.bess_charge_allowed,
      bess_discharge_allowed: period.bess_discharge_allowed,
      export_allowed: period.export_allowed,
      peak_share_controlled: period.peak_share_controlled,
    })),
  );
}

function parseDispatchTime(value: string, allowEndOfDay: boolean): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours === 24 && minutes === 0 && allowEndOfDay) {
    return 24 * 60;
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

function validateDispatchStrategy(
  periods: EditableDispatchPeriod[],
): string[] {
  const errors: string[] = [];
  const parsedPeriods: Array<{ start: number; end: number } | null> = [];

  periods.forEach((period, index) => {
    const start = parseDispatchTime(period.start, false);
    const end = parseDispatchTime(period.end, index === periods.length - 1);

    if (start === null) {
      errors.push(
        `${period.name}: start time must use HH:MM between 00:00 and 23:59.`,
      );
    }
    if (end === null) {
      errors.push(
        `${period.name}: end time is invalid; only the final period may end at 24:00.`,
      );
    }
    if (start !== null && end !== null && start >= end) {
      errors.push(`${period.name}: start time must be earlier than end time.`);
    }

    if (period.ev_supply_priority.length === 0) {
      errors.push(`${period.name}: at least one EV supply source is required.`);
    }
    if (
      new Set(period.ev_supply_priority).size !==
      period.ev_supply_priority.length
    ) {
      errors.push(`${period.name}: duplicate EV supply priorities are not allowed.`);
    }
    if (
      period.ev_supply_priority.some(
        (source) => !EV_SUPPLY_OPTIONS.includes(source),
      )
    ) {
      errors.push(`${period.name}: EV supply priority contains an invalid source.`);
    }
    if (
      new Set(period.excess_pv_priority).size !==
      period.excess_pv_priority.length
    ) {
      errors.push(`${period.name}: duplicate excess PV priorities are not allowed.`);
    }
    if (
      period.excess_pv_priority.some(
        (priority) => !EXCESS_PV_OPTIONS.includes(priority),
      )
    ) {
      errors.push(`${period.name}: excess PV priority contains an invalid action.`);
    }

    parsedPeriods.push(
      start !== null && end !== null && start < end ? { start, end } : null,
    );
  });

  if (parsedPeriods.every((period) => period !== null)) {
    const parsed = parsedPeriods as Array<{ start: number; end: number }>;

    if (parsed[0].start !== 0) {
      errors.push("All 24 hours must be covered; coverage must begin at 00:00.");
    }

    for (let index = 0; index < parsed.length - 1; index += 1) {
      const current = parsed[index];
      const next = parsed[index + 1];

      if (current.end < next.start) {
        errors.push(
          `All 24 hours must be covered; there is a gap between ${periods[index].name} and ${periods[index + 1].name}.`,
        );
      } else if (current.end > next.start) {
        errors.push(
          `${periods[index].name} and ${periods[index + 1].name} overlap.`,
        );
      }
    }

    if (parsed[parsed.length - 1].end !== 24 * 60) {
      errors.push("All 24 hours must be covered; coverage must end at 24:00.");
    }
  }

  return errors;
}

function isDefaultConfiguration(value: unknown): value is DefaultConfiguration {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<DefaultConfiguration>;
  return (
    Array.isArray(candidate.battery_types) &&
    candidate.battery_types.length === 4 &&
    Array.isArray(candidate.criteria) &&
    candidate.criteria.length === 6 &&
    Array.isArray(candidate.ahp_matrix) &&
    Array.isArray(candidate.dispatch_periods) &&
    candidate.dispatch_periods.length === 4
  );
}

function SidebarContent({
  activePage,
  onNavigate,
}: {
  activePage: ActivePage;
  onNavigate: (page: ActivePage) => void;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        color: "#d7e2ee",
      }}
    >
      <Toolbar sx={{ minHeight: "72px !important", px: 2.5 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Avatar
            variant="rounded"
            sx={{
              width: 38,
              height: 38,
              bgcolor: "#2dd4bf",
              color: "#062c2a",
              borderRadius: 2.2,
            }}
          >
            <BatteryChargingFullRoundedIcon fontSize="small" />
          </Avatar>
          <Box>
            <Typography
              variant="subtitle1"
              sx={{ color: "#ffffff", fontWeight: 800, lineHeight: 1.1 }}
            >
              BESS Studio
            </Typography>
            <Typography variant="caption" sx={{ color: "#8fa6bd" }}>
              Decision workspace
            </Typography>
          </Box>
        </Stack>
      </Toolbar>

      <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />

      <Box sx={{ px: 1.5, py: 2.5 }}>
        <Typography
          variant="overline"
          sx={{ color: "#6f879f", fontWeight: 800, letterSpacing: "0.12em", px: 1.5 }}
        >
          Workspace
        </Typography>
        <List sx={{ mt: 0.75 }}>
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const selected = item.page === activePage;

            return (
              <ListItemButton
                key={item.label}
                selected={selected}
                disabled={!item.page}
                aria-current={selected ? "page" : undefined}
                onClick={() => item.page && onNavigate(item.page)}
                sx={{
                  minHeight: 46,
                  mb: 0.5,
                  borderRadius: 2.5,
                  color: selected ? "#ffffff" : "#a8b9ca",
                  "&.Mui-selected": {
                    bgcolor: "rgba(45, 212, 191, 0.16)",
                    color: "#ffffff",
                  },
                  "&.Mui-selected:hover": {
                    bgcolor: "rgba(45, 212, 191, 0.2)",
                  },
                  "&.Mui-disabled": {
                    color: "#71869a",
                    opacity: 0.78,
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 40, color: "inherit" }}>
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography
                      component="span"
                      sx={{ fontSize: 14, fontWeight: selected ? 750 : 600 }}
                    >
                      {item.label}
                    </Typography>
                  }
                />
              </ListItemButton>
            );
          })}
        </List>
      </Box>

      <Box sx={{ mt: "auto", p: 2 }}>
        <Paper
          elevation={0}
          sx={{
            p: 1.75,
            borderRadius: 2.5,
            bgcolor: "rgba(255,255,255,0.055)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "#c6d3df",
          }}
        >
          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
            <VerifiedRoundedIcon sx={{ color: "#5eead4", fontSize: 21 }} />
            <Box>
              <Typography variant="caption" sx={{ display: "block", fontWeight: 800 }}>
                Reference defaults
              </Typography>
              <Typography variant="caption" sx={{ color: "#8198ae" }}>
                Read-only configuration
              </Typography>
            </Box>
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
}

function SpecificationItem({
  label,
  value,
  fullWidth = false,
  highlighted = false,
}: {
  label: string;
  value: string;
  fullWidth?: boolean;
  highlighted?: boolean;
}) {
  return (
    <Box
      sx={{
        gridColumn: fullWidth ? "1 / -1" : "auto",
        minWidth: 0,
        p: 1.5,
        borderRadius: "14px",
        border: "1px solid",
        borderColor: highlighted ? "#b9e8df" : "#edf0f4",
        bgcolor: highlighted ? "#f0fdfa" : "#f8fafc",
      }}
    >
      <Typography
        variant="caption"
        sx={{ color: "text.secondary", display: "block", lineHeight: 1.25 }}
      >
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          mt: 0.55,
          fontWeight: 800,
          color: highlighted ? "#0f766e" : "text.primary",
          lineHeight: 1.25,
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function BatteryCard({ battery, index }: { battery: BatteryType; index: number }) {
  const roundTripEfficiency = battery.eta_ch * battery.eta_dis * 100;

  return (
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        overflow: "hidden",
        borderColor: "#e4e9ef",
        borderRadius: "24px",
        bgcolor: "#ffffff",
        boxShadow: "0 8px 28px rgba(24, 48, 77, 0.055)",
        transition:
          "transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 240ms ease, border-color 240ms ease",
        "&:hover": {
          transform: "translateY(-6px)",
          borderColor: "#cbd9e6",
          boxShadow: "0 22px 52px rgba(20, 45, 76, 0.14)",
        },
        "&:hover .battery-card-icon": {
          transform: "rotate(-4deg) scale(1.06)",
        },
        "@media (prefers-reduced-motion: reduce)": {
          transition: "none",
          "&:hover": { transform: "none" },
        },
      }}
    >
      <Box
        sx={{
          position: "relative",
          overflow: "hidden",
          p: { xs: 2.25, sm: 2.75 },
          background: batteryHeaderGradient,
          borderBottom: "1px solid rgba(148, 163, 184, 0.16)",
          "&::after": {
            content: '""',
            position: "absolute",
            width: 150,
            height: 150,
            right: -70,
            bottom: -95,
            borderRadius: "50%",
            bgcolor: "rgba(255,255,255,0.55)",
          },
        }}
      >
        <Stack
          direction="row"
          sx={{
            position: "relative",
            zIndex: 1,
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Chip
            label={`Battery type ${String(index + 1).padStart(2, "0")}`}
            size="small"
            sx={{
              bgcolor: "rgba(255,255,255,0.72)",
              border: "1px solid rgba(148,163,184,0.2)",
              color: "#475467",
              fontWeight: 850,
              letterSpacing: "0.025em",
            }}
          />
          <Button
            type="button"
            size="small"
            startIcon={<EditRoundedIcon />}
            aria-label={`Edit ${battery.name} battery settings`}
            sx={{
              minWidth: 0,
              px: 1.35,
              color: "#344054",
              bgcolor: "rgba(255,255,255,0.66)",
              border: "1px solid rgba(148,163,184,0.2)",
              borderRadius: "12px",
              "&:hover": { bgcolor: "rgba(255,255,255,0.94)" },
            }}
          >
            Edit
          </Button>
        </Stack>

        <Stack
          direction="row"
          spacing={1.75}
          sx={{ position: "relative", zIndex: 1, mt: 2.25, alignItems: "center" }}
        >
          <Avatar
            className="battery-card-icon"
            variant="rounded"
            sx={{
              width: 54,
              height: 54,
              bgcolor: "#0f766e",
              color: "#ffffff",
              borderRadius: "16px",
              boxShadow: "0 10px 24px rgba(15, 118, 110, 0.22)",
              transition: "transform 240ms ease",
            }}
          >
            <BatteryChargingFullRoundedIcon />
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="caption"
              sx={{ color: "#667085", fontWeight: 750, letterSpacing: "0.04em" }}
            >
              BATTERY TECHNOLOGY
            </Typography>
            <Typography variant="h6" sx={{ mt: 0.15, fontSize: { xs: 20, sm: 22 } }}>
              {battery.name}
            </Typography>
          </Box>
        </Stack>

        <Box
          sx={{
            position: "relative",
            zIndex: 1,
            mt: 2.25,
            p: 1.6,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 2,
            borderRadius: "16px",
            bgcolor: "rgba(255,255,255,0.72)",
            border: "1px solid rgba(255,255,255,0.8)",
            boxShadow: "0 8px 24px rgba(51, 65, 85, 0.05)",
          }}
        >
          <Box>
            <Typography
              variant="caption"
              sx={{ color: "#667085", fontWeight: 750, letterSpacing: "0.04em" }}
            >
              PRICE
            </Typography>
            <Typography variant="h5" sx={{ mt: 0.1, fontWeight: 850, letterSpacing: "-0.025em" }}>
              Rs {priceFormatter.format(battery.price_rs_per_kwh)}
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: "#667085", fontWeight: 700, pb: 0.25 }}>
            per kWh
          </Typography>
        </Box>
      </Box>

      <CardContent sx={{ p: { xs: 2.25, sm: 2.75 }, "&:last-child": { pb: 2.75 } }}>
        <Typography
          variant="overline"
          sx={{ color: "#667085", fontWeight: 850, letterSpacing: "0.095em" }}
        >
          Specifications
        </Typography>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 1.15,
            mt: 0.8,
          }}
        >
          <SpecificationItem
            label="Rated cycle life"
            value={`${priceFormatter.format(battery.rated_cycle_life)} cycles`}
          />
          <SpecificationItem
            label="Weight density"
            value={`${numberFormatter.format(battery.weight_density_kg_per_kwh)} kg/kWh`}
          />
          <SpecificationItem
            label="Charge efficiency"
            value={`${(battery.eta_ch * 100).toFixed(1)}%`}
          />
          <SpecificationItem
            label="Discharge efficiency"
            value={`${(battery.eta_dis * 100).toFixed(1)}%`}
          />
          <SpecificationItem
            label="Round-trip efficiency"
            value={`${roundTripEfficiency.toFixed(1)}%`}
            fullWidth
            highlighted
          />
        </Box>

        <Paper
          elevation={0}
          sx={{
            mt: 1.75,
            p: 1.65,
            display: "flex",
            alignItems: "center",
            gap: 1.4,
            borderRadius: "16px",
            bgcolor: "#f0fdfa",
            border: "1px solid #cceee7",
          }}
        >
          <Avatar
            sx={{ width: 38, height: 38, bgcolor: "#ccfbf1", color: "#0f766e" }}
          >
            <VerifiedRoundedIcon fontSize="small" />
          </Avatar>
          <Box>
            <Typography
              variant="caption"
              sx={{ color: "#476a65", fontWeight: 800, letterSpacing: "0.035em" }}
            >
              Manufacturer Warranty
            </Typography>
            <Typography variant="subtitle1" sx={{ mt: 0.1, color: "#134e4a", fontWeight: 850 }}>
              {numberFormatter.format(battery.warranty_years)} years
            </Typography>
          </Box>
        </Paper>

        <Chip
          disabled
          icon={<ScheduleRoundedIcon />}
          label="Calculated service life: Available after GA"
          size="small"
          variant="outlined"
          sx={{
            mt: 1.25,
            maxWidth: "100%",
            height: "auto",
            borderRadius: "10px",
            "& .MuiChip-label": { whiteSpace: "normal", py: 0.55 },
            "&.Mui-disabled": {
              opacity: 0.72,
              color: "#667085",
              borderColor: "#d0d5dd",
            },
          }}
        />
      </CardContent>
    </Card>
  );
}

function CriterionCard({ criterion, index }: { criterion: Criterion; index: number }) {
  const isMaximized = criterion.direction === "maximize";
  const DirectionIcon = isMaximized
    ? TrendingUpRoundedIcon
    : TrendingDownRoundedIcon;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.25,
        borderRadius: 3,
        borderColor: "divider",
        display: "flex",
        alignItems: "center",
        gap: 1.75,
      }}
    >
      <Avatar
        sx={{
          width: 42,
          height: 42,
          bgcolor: isMaximized ? "#ecfdf3" : "#fff7ed",
          color: isMaximized ? "#15803d" : "#c2410c",
          fontWeight: 800,
          fontSize: 14,
        }}
      >
        {String(index + 1).padStart(2, "0")}
      </Avatar>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
          {criterionLabels[criterion.name]}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", overflowWrap: "anywhere" }}
        >
          {criterion.name}
        </Typography>
      </Box>
      <Chip
        icon={<DirectionIcon />}
        label={isMaximized ? "Maximize" : "Minimize"}
        size="small"
        sx={{
          bgcolor: isMaximized ? "#ecfdf3" : "#fff7ed",
          color: isMaximized ? "#15803d" : "#c2410c",
          fontWeight: 800,
          "& .MuiChip-icon": { color: "inherit" },
        }}
      />
    </Paper>
  );
}

function LoadingContent() {
  return (
    <Stack spacing={4} aria-label="Loading comparison defaults">
      <Box>
        <Skeleton width={190} height={34} />
        <Skeleton width={340} height={22} />
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
            gap: 2.25,
            mt: 2,
          }}
        >
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} variant="rounded" height={330} sx={{ borderRadius: 3 }} />
          ))}
        </Box>
      </Box>
      <Box>
        <Skeleton width={150} height={34} />
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", lg: "repeat(2, 1fr)" },
            gap: 2,
            mt: 2,
          }}
        >
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <Skeleton key={item} variant="rounded" height={88} sx={{ borderRadius: 3 }} />
          ))}
        </Box>
      </Box>
    </Stack>
  );
}

function PriorityFlow({
  label,
  resources,
}: {
  label: string;
  resources: string[];
}) {
  return (
    <Box>
      <Typography
        variant="caption"
        sx={{ color: "text.secondary", fontWeight: 750, letterSpacing: "0.025em" }}
      >
        {label}
      </Typography>
      <Stack
        direction="row"
        spacing={0.75}
        sx={{ mt: 0.8, flexWrap: "wrap", gap: 0.75, alignItems: "center" }}
      >
        {resources.map((resource, index) => (
          <Box
            key={`${resource}-${index}`}
            sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}
          >
            <Chip
              label={resource}
              size="small"
              sx={{ bgcolor: "#f2f7fb", color: "#344054", fontWeight: 800 }}
            />
            {index < resources.length - 1 && (
              <Typography aria-hidden="true" sx={{ color: "#98a2b3", fontWeight: 800 }}>
                →
              </Typography>
            )}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

function PriorityEditor<T extends string>({
  id,
  label,
  items,
  options,
  onChange,
}: {
  id: string;
  label: string;
  items: T[];
  options: T[];
  onChange: (items: T[]) => void;
}) {
  const remainingOptions = options.filter((option) => !items.includes(option));

  const moveItem = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= items.length) {
      return;
    }

    const reordered = [...items];
    [reordered[index], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[index],
    ];
    onChange(reordered);
  };

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
        {label}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Use the arrows to set first, second, and third priority.
      </Typography>

      <Stack spacing={0.8} sx={{ mt: 1.1 }}>
        {items.length === 0 && (
          <Paper
            elevation={0}
            sx={{
              p: 1.2,
              borderRadius: "12px",
              border: "1px dashed #d0d5dd",
              bgcolor: "#f9fafb",
            }}
          >
            <Typography variant="body2" color="text.secondary">
              No priority items selected.
            </Typography>
          </Paper>
        )}

        {items.map((item, index) => (
          <Paper
            key={item}
            elevation={0}
            sx={{
              p: 0.9,
              display: "flex",
              alignItems: "center",
              gap: 1,
              borderRadius: "12px",
              border: "1px solid #e4e7ec",
              bgcolor: "#ffffff",
            }}
          >
            <Avatar
              sx={{
                width: 27,
                height: 27,
                bgcolor: "#e8faf6",
                color: "#0f766e",
                fontSize: 12,
                fontWeight: 850,
              }}
            >
              {index + 1}
            </Avatar>
            <Typography variant="body2" sx={{ flexGrow: 1, fontWeight: 750 }}>
              {item}
            </Typography>
            <IconButton
              size="small"
              disabled={index === 0}
              aria-label={`Move ${item} up`}
              onClick={() => moveItem(index, -1)}
            >
              <ArrowUpwardRoundedIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              disabled={index === items.length - 1}
              aria-label={`Move ${item} down`}
              onClick={() => moveItem(index, 1)}
            >
              <ArrowDownwardRoundedIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              color="error"
              aria-label={`Remove ${item}`}
              onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
            >
              <DeleteOutlineRoundedIcon fontSize="small" />
            </IconButton>
          </Paper>
        ))}
      </Stack>

      <FormControl fullWidth size="small" sx={{ mt: 1.1 }}>
        <InputLabel id={`${id}-add-label`}>Add priority item</InputLabel>
        <Select
          labelId={`${id}-add-label`}
          id={`${id}-add`}
          value=""
          label="Add priority item"
          disabled={remainingOptions.length === 0}
          onChange={(event) => {
            const value = event.target.value as T;
            if (value && !items.includes(value)) {
              onChange([...items, value]);
            }
          }}
        >
          {remainingOptions.map((option) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Box>
  );
}

function DispatchControl({ label, allowed }: { label: string; allowed: boolean }) {
  const StatusIcon = allowed
    ? CheckCircleRoundedIcon
    : DoNotDisturbOnRoundedIcon;

  return (
    <Box
      sx={{
        p: 1.4,
        borderRadius: "14px",
        border: "1px solid #e8edf2",
        bgcolor: "#f8fafc",
      }}
    >
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Chip
        icon={<StatusIcon />}
        label={allowed ? "Allowed" : "Not allowed"}
        size="small"
        sx={{
          display: "flex",
          width: "fit-content",
          mt: 0.75,
          bgcolor: allowed ? "#ecfdf3" : "#f2f4f7",
          color: allowed ? "#15803d" : "#667085",
          fontWeight: 800,
          "& .MuiChip-icon": { color: "inherit" },
        }}
      />
    </Box>
  );
}

function DispatchPeriodSummaryCard({
  period,
  index,
  onEdit,
  isModified,
}: {
  period: EditableDispatchPeriod;
  index: number;
  onEdit: () => void;
  isModified: boolean;
}) {
  return (
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        overflow: "hidden",
        borderColor: "#e4e9ef",
        borderRadius: "22px",
        boxShadow: "0 8px 28px rgba(24, 48, 77, 0.05)",
      }}
    >
      <Box
        sx={{
          p: 2.25,
          background: "linear-gradient(135deg, #e8faf6 0%, #edf6ff 100%)",
          borderBottom: "1px solid #dce9ec",
        }}
      >
        <Stack
          direction="row"
          spacing={2}
          sx={{ justifyContent: "space-between", alignItems: "flex-start" }}
        >
          <Stack direction="row" spacing={1.4} sx={{ alignItems: "center" }}>
            <Avatar
              sx={{
                width: 42,
                height: 42,
                bgcolor: "#0f766e",
                color: "#ffffff",
                fontSize: 13,
                fontWeight: 850,
              }}
            >
              {String(index + 1).padStart(2, "0")}
            </Avatar>
            <Box>
              <Typography variant="caption" sx={{ color: "#667085", fontWeight: 750 }}>
                DAILY PERIOD
              </Typography>
              <Typography variant="h6" sx={{ mt: 0.1, fontSize: 19 }}>
                {period.name}
              </Typography>
            </Box>
          </Stack>
          <Stack spacing={0.8} sx={{ alignItems: "flex-end" }}>
            <Chip
              icon={<AccessTimeRoundedIcon />}
              label={`${period.start}–${period.end}`}
              size="small"
              sx={{
                bgcolor: "rgba(255,255,255,0.76)",
                color: "#344054",
                fontWeight: 800,
                "& .MuiChip-icon": { color: "#0f766e" },
              }}
            />
            <Button
              size="small"
              startIcon={<EditRoundedIcon />}
              onClick={onEdit}
              sx={{
                bgcolor: "rgba(255,255,255,0.7)",
                color: "#344054",
                borderRadius: "10px",
                "&:hover": { bgcolor: "#ffffff" },
              }}
            >
              Edit
            </Button>
          </Stack>
        </Stack>
      </Box>

      <CardContent sx={{ p: 2.25, "&:last-child": { pb: 2.25 } }}>
        <Stack spacing={2}>
          <PriorityFlow
            label="EV supply priority"
            resources={period.ev_supply_priority}
          />

          {period.excess_pv_priority.length > 0 && (
            <PriorityFlow
              label="Excess PV priority"
              resources={period.excess_pv_priority}
            />
          )}

          <Divider />

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" },
              gap: 1.1,
            }}
          >
            <DispatchControl
              label="BESS charge allowed"
              allowed={period.bess_charge_allowed}
            />
            <DispatchControl
              label="BESS discharge allowed"
              allowed={period.bess_discharge_allowed}
            />
            <DispatchControl
              label="Export allowed"
              allowed={period.export_allowed}
            />
          </Box>

          {period.name === "Peak" && (
            <Paper
              elevation={0}
              sx={{
                p: 1.5,
                borderRadius: "14px",
                bgcolor: "#eff6ff",
                border: "1px solid #dbeafe",
              }}
            >
              <Stack
                direction="row"
                spacing={1.25}
                sx={{ alignItems: "center", justifyContent: "space-between" }}
              >
                <Box>
                  <Typography variant="caption" sx={{ color: "#475569", fontWeight: 750 }}>
                    Peak-share control
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.25, fontWeight: 800, color: "#1e3a8a" }}>
                    {period.peak_share_controlled
                      ? "BESS discharge follows peak_share"
                      : "Peak-share control is disabled"}
                  </Typography>
                </Box>
                <Chip
                  label={period.peak_share_controlled ? "Enabled" : "Disabled"}
                  size="small"
                  sx={{ fontWeight: 800 }}
                />
              </Stack>
            </Paper>
          )}

          {period.warning && (
            <Alert severity="warning" variant="outlined" sx={{ borderRadius: "14px" }}>
              <Typography variant="body2">{period.warning}</Typography>
            </Alert>
          )}

          <Chip
            icon={<LockRoundedIcon />}
            label={isModified ? "Modified in this session" : "Reference code default"}
            size="small"
            variant="outlined"
            sx={{
              width: "fit-content",
              color: isModified ? "#b45309" : "#667085",
              borderColor: isModified ? "#f4c678" : "#d0d5dd",
              fontWeight: 750,
              "& .MuiChip-icon": { color: "inherit" },
            }}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}

function DispatchPeriodEditorCard({
  period,
  index,
  onChange,
  isModified,
}: {
  period: EditableDispatchPeriod;
  index: number;
  onChange: (changes: Partial<EditableDispatchPeriod>) => void;
  isModified: boolean;
}) {
  return (
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        overflow: "hidden",
        borderColor: "#5ebdb1",
        borderRadius: "22px",
        boxShadow: "0 16px 42px rgba(15, 118, 110, 0.12)",
      }}
    >
      <Box
        sx={{
          p: 2.25,
          background: "linear-gradient(135deg, #dcf8f1 0%, #e6f2ff 100%)",
          borderBottom: "1px solid #c9e4e2",
        }}
      >
        <Stack
          direction="row"
          spacing={2}
          sx={{ justifyContent: "space-between", alignItems: "center" }}
        >
          <Stack direction="row" spacing={1.4} sx={{ alignItems: "center" }}>
            <Avatar
              sx={{
                width: 42,
                height: 42,
                bgcolor: "#0f766e",
                color: "#ffffff",
                fontSize: 13,
                fontWeight: 850,
              }}
            >
              {String(index + 1).padStart(2, "0")}
            </Avatar>
            <Box>
              <Typography variant="caption" sx={{ color: "#0f766e", fontWeight: 850 }}>
                EDITING PERIOD
              </Typography>
              <Typography variant="h6" sx={{ mt: 0.1, fontSize: 19 }}>
                {period.name}
              </Typography>
            </Box>
          </Stack>
          <Chip
            icon={<EditRoundedIcon />}
            label="Local draft"
            size="small"
            sx={{
              bgcolor: "rgba(255,255,255,0.78)",
              color: "#0f766e",
              fontWeight: 800,
              "& .MuiChip-icon": { color: "inherit" },
            }}
          />
        </Stack>
      </Box>

      <CardContent sx={{ p: 2.25, "&:last-child": { pb: 2.25 } }}>
        <Stack spacing={2.1}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 1.2,
            }}
          >
            <TextField
              label="Start time"
              value={period.start}
              size="small"
              placeholder="HH:MM"
              helperText="Use 24-hour HH:MM"
              onChange={(event) => onChange({ start: event.target.value })}
            />
            <TextField
              label="End time"
              value={period.end}
              size="small"
              placeholder="HH:MM"
              helperText={index === 3 ? "24:00 is allowed here" : "Use 24-hour HH:MM"}
              onChange={(event) => onChange({ end: event.target.value })}
            />
          </Box>

          <PriorityEditor
            id={`period-${index}-ev`}
            label="EV supply priority"
            items={period.ev_supply_priority}
            options={EV_SUPPLY_OPTIONS}
            onChange={(items) => onChange({ ev_supply_priority: items })}
          />

          <PriorityEditor
            id={`period-${index}-pv`}
            label="Excess PV priority"
            items={period.excess_pv_priority}
            options={EXCESS_PV_OPTIONS}
            onChange={(items) =>
              onChange({
                excess_pv_priority: items,
                export_allowed: items.includes("Export")
                  ? true
                  : period.export_allowed,
              })
            }
          />

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
              gap: 1,
            }}
          >
            <FormControlLabel
              control={
                <Switch
                  checked={period.bess_charge_allowed}
                  onChange={(event) =>
                    onChange({ bess_charge_allowed: event.target.checked })
                  }
                />
              }
              label="BESS charge allowed"
              sx={{ m: 0, p: 1, border: "1px solid #e4e7ec", borderRadius: "12px" }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={period.bess_discharge_allowed}
                  onChange={(event) =>
                    onChange({ bess_discharge_allowed: event.target.checked })
                  }
                />
              }
              label="BESS discharge allowed"
              sx={{ m: 0, p: 1, border: "1px solid #e4e7ec", borderRadius: "12px" }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={period.export_allowed}
                  onChange={(event) => {
                    const exportAllowed = event.target.checked;
                    onChange({
                      export_allowed: exportAllowed,
                      excess_pv_priority: exportAllowed
                        ? period.excess_pv_priority
                        : period.excess_pv_priority.filter(
                            (priority) => priority !== "Export",
                          ),
                    });
                  }}
                />
              }
              label="Export allowed"
              sx={{ m: 0, p: 1, border: "1px solid #e4e7ec", borderRadius: "12px" }}
            />
            {period.name === "Peak" && (
              <FormControlLabel
                control={
                  <Switch
                    checked={period.peak_share_controlled}
                    onChange={(event) =>
                      onChange({ peak_share_controlled: event.target.checked })
                    }
                  />
                }
                label="Peak-share control"
                sx={{ m: 0, p: 1, border: "1px solid #cbdcf8", borderRadius: "12px", bgcolor: "#f5f9ff" }}
              />
            )}
          </Box>

          {period.warning && (
            <Alert severity="warning" variant="outlined" sx={{ borderRadius: "14px" }}>
              <Typography variant="body2">{period.warning}</Typography>
            </Alert>
          )}

          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}
          >
            <Typography variant="caption" color="text.secondary">
              Use the page-level Save Changes button when all period edits are complete.
            </Typography>
            <Chip
              label={isModified ? "Modified draft" : "Matches reference"}
              size="small"
              sx={{
                width: "fit-content",
                bgcolor: isModified ? "#fff7ed" : "#f2f4f7",
                color: isModified ? "#b45309" : "#667085",
                fontWeight: 800,
              }}
            />
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

function DispatchLoadingContent() {
  return (
    <Box
      aria-label="Loading dispatch strategy"
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
        gap: 2.25,
      }}
    >
      {[0, 1, 2, 3].map((item) => (
        <Skeleton key={item} variant="rounded" height={390} sx={{ borderRadius: "22px" }} />
      ))}
    </Box>
  );
}

interface DispatchStrategyPageProps {
  persistedStrategy?: WorkspaceDispatchStrategy;
  onStrategyChange?: (strategy: WorkspaceDispatchStrategy) => void;
}

function DispatchStrategyPage({
  persistedStrategy,
  onStrategyChange,
}: DispatchStrategyPageProps) {
  const [referencePeriods, setReferencePeriods] = useState<EditableDispatchPeriod[]>([]);
  const [periods, setPeriods] = useState<EditableDispatchPeriod[]>([]);
  const [draftPeriods, setDraftPeriods] = useState<EditableDispatchPeriod[]>([]);
  const [editingIndexes, setEditingIndexes] = useState<Set<number>>(
    () => new Set(),
  );
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDispatchStrategy() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(CONFIG_DEFAULTS_ENDPOINT, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Backend returned HTTP ${response.status}.`);
        }

        const payload: unknown = await response.json();
        if (!isDefaultConfiguration(payload)) {
          throw new Error("The backend returned an unexpected configuration format.");
        }

        const editablePeriods = toEditableDispatchPeriods(payload.dispatch_periods);
        const persistedPeriods = fromWorkspaceDispatchStrategy(
          persistedStrategy,
          editablePeriods,
        );
        const initialPeriods = persistedPeriods ?? editablePeriods;
        setReferencePeriods(cloneDispatchPeriods(editablePeriods));
        setPeriods(cloneDispatchPeriods(initialPeriods));
        setDraftPeriods(cloneDispatchPeriods(initialPeriods));
        setEditingIndexes(new Set());
        setValidationErrors([]);
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }

        setReferencePeriods([]);
        setPeriods([]);
        setDraftPeriods([]);
        setEditingIndexes(new Set());
        setValidationErrors([]);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load the default dispatch strategy.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadDispatchStrategy();
    return () => controller.abort();
  }, [requestVersion]);

  const isEditing = editingIndexes.size > 0;
  const visiblePeriods = isEditing ? draftPeriods : periods;
  const strategyModified =
    referencePeriods.length > 0 &&
    dispatchStrategySignature(visiblePeriods) !==
      dispatchStrategySignature(referencePeriods);

  const beginEditingPeriod = (index: number) => {
    if (!isEditing) {
      setDraftPeriods(cloneDispatchPeriods(periods));
    }
    setEditingIndexes((current) => {
      const next = new Set(current);
      next.add(index);
      return next;
    });
    setValidationErrors([]);
  };

  const updateDraftPeriod = (
    index: number,
    changes: Partial<EditableDispatchPeriod>,
  ) => {
    setDraftPeriods((current) =>
      current.map((period, periodIndex) =>
        periodIndex === index ? { ...period, ...changes } : period,
      ),
    );
    setValidationErrors([]);
  };

  const saveChanges = () => {
    const errors = validateDispatchStrategy(draftPeriods);
    setValidationErrors(errors);
    if (errors.length > 0) {
      return;
    }

    const savedPeriods = cloneDispatchPeriods(draftPeriods);
    setPeriods(savedPeriods);
    setEditingIndexes(new Set());
    onStrategyChange?.(
      toWorkspaceDispatchStrategy(savedPeriods, referencePeriods),
    );
  };

  const cancelChanges = () => {
    setDraftPeriods(cloneDispatchPeriods(periods));
    setEditingIndexes(new Set());
    setValidationErrors([]);
  };

  const restoreReferenceStrategy = () => {
    const restored = cloneDispatchPeriods(referencePeriods);
    setPeriods(restored);
    setDraftPeriods(cloneDispatchPeriods(referencePeriods));
    setEditingIndexes(new Set());
    setValidationErrors([]);
    onStrategyChange?.(
      toWorkspaceDispatchStrategy(restored, referencePeriods),
    );
  };

  const periodIsModified = (index: number) => {
    const referencePeriod = referencePeriods[index];
    const visiblePeriod = visiblePeriods[index];
    return Boolean(
      referencePeriod &&
        visiblePeriod &&
        dispatchStrategySignature([visiblePeriod]) !==
          dispatchStrategySignature([referencePeriod]),
    );
  };

  return (
    <Stack spacing={3.5}>
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2.5, sm: 3.5 },
          borderRadius: "24px",
          border: "1px solid #d8ebe8",
          background: "linear-gradient(120deg, #ecfdf9 0%, #eff6ff 100%)",
        }}
      >
        <Typography
          variant="overline"
          sx={{ color: "primary.main", fontWeight: 850, letterSpacing: "0.12em" }}
        >
          Local strategy workspace
        </Typography>
        <Typography variant="h4" sx={{ mt: 0.25, fontSize: { xs: 29, sm: 36 } }}>
          Dispatch Strategy
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1.2, maxWidth: 760, lineHeight: 1.7 }}>
          Start from the four reference periods, then edit a local working copy.
          Changes stay in React state and are not connected to the simulation
          engine or a database.
        </Typography>
        <Stack
          direction="row"
          spacing={1}
          sx={{ mt: 2.25, flexWrap: "wrap", gap: 1 }}
        >
          <Chip label="4 daily periods" size="small" sx={{ bgcolor: "#ffffff", fontWeight: 750 }} />
          <Chip
            icon={<LockRoundedIcon />}
            label="React state only"
            size="small"
            sx={{ bgcolor: "#ffffff", fontWeight: 750, "& .MuiChip-icon": { color: "#0f766e" } }}
          />
          <Button
            variant="outlined"
            size="small"
            startIcon={<RestoreRoundedIcon />}
            disabled={referencePeriods.length === 0 || !strategyModified}
            onClick={restoreReferenceStrategy}
            sx={{ bgcolor: "rgba(255,255,255,0.72)", borderRadius: "10px" }}
          >
            Restore Reference Strategy
          </Button>
        </Stack>
      </Paper>

      {strategyModified && (
        <Alert severity="warning" variant="filled" sx={{ borderRadius: "16px" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
            Strategy changed from the reference-code default
          </Typography>
          <Typography variant="body2">
            These changes exist only in React state and are not connected to the
            simulation engine or a database.
          </Typography>
        </Alert>
      )}

      {isLoading && <DispatchLoadingContent />}

      {!isLoading && error && (
        <Alert
          severity="error"
          variant="outlined"
          action={
            <Button color="inherit" size="small" onClick={() => setRequestVersion((value) => value + 1)}>
              Retry
            </Button>
          }
          sx={{ borderRadius: "16px", alignItems: "center" }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            Dispatch strategy could not be loaded
          </Typography>
          <Typography variant="body2">
            {error} Make sure the FastAPI backend is running on port 8000.
          </Typography>
        </Alert>
      )}

      {!isLoading && !error && (
        <>
          <Box
            component="section"
            aria-label="Editable dispatch periods"
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
              gap: 2.25,
            }}
          >
            {visiblePeriods.map((period, index) =>
              editingIndexes.has(index) ? (
                <DispatchPeriodEditorCard
                  key={period.name}
                  period={period}
                  index={index}
                  isModified={periodIsModified(index)}
                  onChange={(changes) => updateDraftPeriod(index, changes)}
                />
              ) : (
                <DispatchPeriodSummaryCard
                  key={period.name}
                  period={period}
                  index={index}
                  isModified={periodIsModified(index)}
                  onEdit={() => beginEditingPeriod(index)}
                />
              ),
            )}
          </Box>

          {isEditing && (
            <Paper
              elevation={8}
              sx={{
                position: "sticky",
                bottom: 16,
                zIndex: 4,
                mt: 2.5,
                p: 2,
                borderRadius: "18px",
                border: "1px solid #b8ded8",
                bgcolor: "rgba(255,255,255,0.96)",
                backdropFilter: "blur(14px)",
              }}
            >
              {validationErrors.length > 0 && (
                <Alert severity="error" sx={{ mb: 1.5, borderRadius: "13px" }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
                    Fix these strategy validation errors before saving:
                  </Typography>
                  <Box component="ul" sx={{ mt: 0.7, mb: 0, pl: 2.25 }}>
                    {validationErrors.map((validationError) => (
                      <Typography component="li" variant="body2" key={validationError}>
                        {validationError}
                      </Typography>
                    ))}
                  </Box>
                </Alert>
              )}

              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1.5}
                sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}
              >
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
                    Editing local strategy
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {editingIndexes.size} period{editingIndexes.size === 1 ? "" : "s"} open for editing
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="outlined"
                    startIcon={<CloseRoundedIcon />}
                    onClick={cancelChanges}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<SaveRoundedIcon />}
                    onClick={saveChanges}
                  >
                    Save Changes
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          )}
        </>
      )}
    </Stack>
  );
}

function ComparisonModePage({
  dataset,
  dispatchStrategy,
  comparisonConfiguration,
  comparisonRunState,
  comparisonOptimization,
  comparisonAhp,
  promethee,
  onComparisonConfigurationChange,
  onComparisonRunStateChange,
  onComparisonCompleted,
  onInvalidateScientificState,
  onOpenAHP,
  onPrometheeChange,
}: {
  dataset: WorkspaceDatasetSummary | null;
  dispatchStrategy: WorkspaceDispatchStrategy;
  comparisonConfiguration: ComparisonOptimizationConfiguration | null;
  comparisonRunState: ComparisonRunWorkspaceState;
  comparisonOptimization: ComparisonOptimizationWorkspaceState | null;
  comparisonAhp: ComparisonAHPWorkspaceState | null;
  promethee: PrometheeWorkspaceState | null;
  onComparisonConfigurationChange: (configuration: ComparisonOptimizationConfiguration) => void;
  onComparisonRunStateChange: Dispatch<SetStateAction<ComparisonRunWorkspaceState>>;
  onComparisonCompleted: (comparison: ComparisonOptimizationWorkspaceState) => void;
  onInvalidateScientificState: () => void;
  onOpenAHP: () => void;
  onPrometheeChange: (state: PrometheeWorkspaceState) => void;
}) {
  const [configuration, setConfiguration] = useState<DefaultConfiguration | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [runnerOpen, setRunnerOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDefaults() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(CONFIG_DEFAULTS_ENDPOINT, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Backend returned HTTP ${response.status}.`);
        }

        const payload: unknown = await response.json();
        if (!isDefaultConfiguration(payload)) {
          throw new Error("The backend returned an unexpected configuration format.");
        }

        setConfiguration(payload);
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }

        setConfiguration(null);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load the comparison defaults.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadDefaults();
    return () => controller.abort();
  }, [requestVersion]);

  useEffect(() => {
    if (configuration && !comparisonConfiguration) {
      onComparisonConfigurationChange(createDefaultComparisonConfiguration(configuration.battery_types));
    }
  }, [comparisonConfiguration, configuration, onComparisonConfigurationChange]);

  const rankingReady = Boolean(
    promethee
    && comparisonOptimization
    && !isPrometheeResultStale(promethee, comparisonOptimization, comparisonAhp),
  );
  const resultsEntryReady = canEnterComparisonResults(comparisonOptimization, comparisonAhp);

  return (
    <Stack spacing={3.5}>
      <Paper
        elevation={0}
        sx={{
          position: "relative",
          overflow: "hidden",
          p: { xs: 2.5, sm: 3.5 },
          borderRadius: 3.5,
          border: "1px solid #d8ebe8",
          background:
            "linear-gradient(120deg, rgba(236,253,250,1) 0%, rgba(239,246,255,1) 100%)",
          "&::after": {
            content: '""',
            position: "absolute",
            width: 220,
            height: 220,
            borderRadius: "50%",
            right: -85,
            top: -125,
            bgcolor: "rgba(45, 212, 191, 0.16)",
          },
        }}
      >
        <Box sx={{ position: "relative", zIndex: 1, maxWidth: 760 }}>
          <Typography
            variant="overline"
            sx={{ color: "primary.main", fontWeight: 850, letterSpacing: "0.12em" }}
          >
            Decision analysis
          </Typography>
          <Typography variant="h4" sx={{ mt: 0.25, fontSize: { xs: 29, sm: 36 } }}>
            Compare battery technologies
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1.25, lineHeight: 1.7 }}>
            Review the default battery catalogue and the six criteria used to
            evaluate cost, lifetime, efficiency, physical density, maintenance,
            and warranty performance.
          </Typography>
          {configuration && (
            <Stack direction="row" spacing={1} sx={{ mt: 2.25, flexWrap: "wrap", gap: 1 }}>
              <Chip
                label={`${configuration.battery_types.length} battery options`}
                size="small"
                sx={{ bgcolor: "rgba(255,255,255,0.8)", fontWeight: 750 }}
              />
              <Chip
                label={`${configuration.criteria.length} decision criteria`}
                size="small"
                sx={{ bgcolor: "rgba(255,255,255,0.8)", fontWeight: 750 }}
              />
            </Stack>
          )}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ mt: 2.25, alignItems: { sm: "center" } }}>
            <Button
              variant="contained"
              startIcon={<CompareArrowsRoundedIcon />}
              onClick={() => setRunnerOpen(true)}
              disabled={!configuration || !comparisonConfiguration}
              sx={{ alignSelf: { xs: "stretch", sm: "flex-start" }, background: "linear-gradient(100deg,#0f766e,#1769a8)" }}
            >
              Configure & Run Comparison
            </Button>
            <Button
              variant="outlined"
              startIcon={<AssessmentRoundedIcon />}
              onClick={() => setResultsOpen(true)}
              disabled={!resultsEntryReady}
              sx={{ alignSelf: { xs: "stretch", sm: "flex-start" } }}
            >
              {rankingReady ? "Open Comparison Results" : "Calculate & Open Comparison Results"}
            </Button>
            <Stack direction="row" spacing={0.8} sx={{ flexWrap: "wrap", gap: 0.8 }}>
              <Chip label={comparisonOptimization && !comparisonOptimization.stale ? "Stage 1 ready" : comparisonOptimization?.stale ? "Stage 1 stale" : "Stage 1 required"} size="small" color={comparisonOptimization && !comparisonOptimization.stale ? "success" : comparisonOptimization?.stale ? "warning" : "default"} variant="outlined" />
              <Chip label={comparisonAhp?.accepted ? "AHP ready" : "AHP required"} size="small" color={comparisonAhp?.accepted ? "success" : "default"} variant="outlined" />
              <Chip label={rankingReady ? "Ranking ready" : promethee ? "PROMETHEE stale" : "PROMETHEE pending"} size="small" color={rankingReady ? "success" : promethee ? "warning" : "default"} variant="outlined" />
            </Stack>
          </Stack>
        </Box>
      </Paper>

      {isLoading && <LoadingContent />}

      {!isLoading && error && (
        <Alert
          severity="error"
          variant="outlined"
          action={
            <Button color="inherit" size="small" onClick={() => setRequestVersion((value) => value + 1)}>
              Retry
            </Button>
          }
          sx={{ borderRadius: 3, alignItems: "center" }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            Configuration could not be loaded
          </Typography>
          <Typography variant="body2">
            {error} Make sure the FastAPI backend is running on port 8000.
          </Typography>
        </Alert>
      )}

      {!isLoading && configuration && (
        <>
          <Box component="section" aria-labelledby="battery-options-heading">
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{
                mb: 2,
                justifyContent: "space-between",
                alignItems: { xs: "flex-start", sm: "flex-end" },
              }}
            >
              <Box>
                <Typography id="battery-options-heading" variant="h6">
                  Battery options
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>
                  Default technologies available for comparison
                </Typography>
              </Box>
              <Chip
                icon={<BatteryChargingFullRoundedIcon />}
                label="Loaded from backend"
                size="small"
                variant="outlined"
                sx={{ fontWeight: 700, "& .MuiChip-icon": { color: "primary.main" } }}
              />
            </Stack>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "repeat(2, minmax(0, 1fr))",
                },
                gap: 2.5,
              }}
            >
              {configuration.battery_types.map((battery, index) => (
                <BatteryCard key={battery.name} battery={battery} index={index} />
              ))}
            </Box>
          </Box>

          <Box component="section" aria-labelledby="criteria-heading">
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{
                mb: 2,
                justifyContent: "space-between",
                alignItems: { xs: "flex-start", sm: "center" },
              }}
            >
              <Box>
                <Typography id="criteria-heading" variant="h6">
                  Decision criteria
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>
                  Optimization direction for each comparison measure
                </Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                <Chip
                  icon={<TrendingDownRoundedIcon />}
                  label="Lower is better"
                  size="small"
                  sx={{ bgcolor: "#fff7ed", color: "#c2410c", "& .MuiChip-icon": { color: "inherit" } }}
                />
                <Chip
                  icon={<TrendingUpRoundedIcon />}
                  label="Higher is better"
                  size="small"
                  sx={{ bgcolor: "#ecfdf3", color: "#15803d", "& .MuiChip-icon": { color: "inherit" } }}
                />
              </Stack>
            </Stack>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
                gap: 1.75,
              }}
            >
              {configuration.criteria.map((criterion, index) => (
                <CriterionCard key={criterion.name} criterion={criterion} index={index} />
              ))}
            </Box>
          </Box>
        </>
      )}
      <Suspense fallback={null}>
        {configuration && comparisonConfiguration && <ComparisonOptimizationDialog
          open={runnerOpen}
          configuration={comparisonConfiguration}
          dataset={dataset}
          dispatchStrategy={dispatchStrategy}
          runState={comparisonRunState}
          completedComparison={comparisonOptimization}
          rankingReady={rankingReady}
          onConfigurationChange={onComparisonConfigurationChange}
          onRunStateChange={onComparisonRunStateChange}
          onCompleted={onComparisonCompleted}
          onInvalidateScientificState={onInvalidateScientificState}
          onOpenAHP={() => transitionFromComparisonRunner(() => setRunnerOpen(false), onOpenAHP)}
          onOpenResults={() => {
            transitionFromComparisonRunner(() => setRunnerOpen(false), () => setResultsOpen(true));
          }}
          onClose={() => setRunnerOpen(false)}
        />}
        <ComparisonResultsDialog
          open={resultsOpen}
          comparison={comparisonOptimization}
          ahp={comparisonAhp}
          promethee={promethee}
          onPrometheeChange={onPrometheeChange}
          onClose={() => setResultsOpen(false)}
        />
      </Suspense>
    </Stack>
  );
}

export default function App() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activePage, setActivePage] = useState<ActivePage>(
    INITIAL_PERSISTED_WORKSPACE_STATE.activePage as ActivePage,
  );
  const [uploadedDataset, setUploadedDataset] =
    useState<WorkspaceDatasetSummary | null>(INITIAL_PERSISTED_WORKSPACE_STATE.dataset);
  const [workspaceDispatchStrategy, setWorkspaceDispatchStrategy] =
    useState<WorkspaceDispatchStrategy>(INITIAL_PERSISTED_WORKSPACE_STATE.dispatchStrategy);
  const [singleOptimizationRunState, setSingleOptimizationRunState] =
    useState<SingleOptimizationRunWorkspaceState>(INITIAL_PERSISTED_WORKSPACE_STATE.runState);
  const [selectedBatteryId, setSelectedBatteryId] = useState<string | null>(
    INITIAL_PERSISTED_WORKSPACE_STATE.selectedBatteryId,
  );
  const [selectedMode, setSelectedMode] = useState<"single" | "comparison" | null>(
    INITIAL_PERSISTED_WORKSPACE_STATE.selectedMode,
  );
  const [batteryConfiguration, setBatteryConfiguration] =
    useState<SingleBatteryConfigurationSnapshot | null>(INITIAL_PERSISTED_WORKSPACE_STATE.battery);
  const [setupConfiguration, setSetupConfiguration] =
    useState<SingleOptimizationSetupSnapshot | null>(INITIAL_PERSISTED_WORKSPACE_STATE.setup);
  const [activeOptimizationStep, setActiveOptimizationStep] = useState<string | null>(
    INITIAL_PERSISTED_WORKSPACE_STATE.activeOptimizationStep,
  );
  const [operationalProfileDate, setOperationalProfileDate] = useState<string | null>(
    INITIAL_PERSISTED_WORKSPACE_STATE.operationalProfileDate,
  );
  const [comparisonAhp, setComparisonAhp] = useState<ComparisonAHPWorkspaceState | null>(
    INITIAL_PERSISTED_WORKSPACE_STATE.comparisonAhp,
  );
  const [comparisonConfiguration, setComparisonConfiguration] = useState<ComparisonOptimizationConfiguration | null>(
    INITIAL_PERSISTED_WORKSPACE_STATE.comparisonConfiguration,
  );
  const [comparisonRunState, setComparisonRunState] = useState<ComparisonRunWorkspaceState>(
    INITIAL_PERSISTED_WORKSPACE_STATE.comparisonRunState,
  );
  const [comparisonOptimization, setComparisonOptimization] = useState<ComparisonOptimizationWorkspaceState | null>(
    INITIAL_PERSISTED_WORKSPACE_STATE.comparisonOptimization,
  );
  const [promethee, setPromethee] = useState<PrometheeWorkspaceState | null>(
    INITIAL_PERSISTED_WORKSPACE_STATE.promethee,
  );
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);

  useEffect(() => {
    const storage = window.sessionStorage;
    const persisted = readPersistedWorkspaceState(storage);

    if (!persisted) {
      setWorkspaceReady(true);
      return;
    }

    void validatePersistedWorkspaceState(persisted, {
      datasetExists: async (datasetId: string, startDate: string) => {
        try {
          const response = await fetch(`/api/datasets/${encodeURIComponent(datasetId)}/day?date=${encodeURIComponent(startDate || "2000-01-01")}`, {
            method: "GET",
            headers: { Accept: "application/json" },
          });
          return response.status !== 404;
        } catch {
          return true;
        }
      },
      jobExists: async (jobId: string) => {
        try {
          const response = await fetch(`/api/single-optimization/jobs/${encodeURIComponent(jobId)}`);
          return response.status !== 404;
        } catch {
          return true;
        }
      },
      comparisonJobExists: async (jobId: string) => {
        try {
          const response = await fetch(`/api/comparison-optimization/jobs/${encodeURIComponent(jobId)}`);
          return response.status !== 404;
        } catch {
          return true;
        }
      },
    }).then(({ state, error }) => {
      if (error) {
        setRestoreError(error);
        if (!state) clearPersistedWorkspaceState(storage);
      }

      if (state) {
        setActivePage(state.activePage as ActivePage);
        setUploadedDataset(state.dataset);
        setWorkspaceDispatchStrategy(state.dispatchStrategy);
        setSingleOptimizationRunState(state.runState);
        setSelectedBatteryId(state.selectedBatteryId);
        setSelectedMode(state.selectedMode);
        setBatteryConfiguration(state.battery);
        setSetupConfiguration(state.setup);
        setActiveOptimizationStep(state.activeOptimizationStep);
        setOperationalProfileDate(state.operationalProfileDate);
        setComparisonAhp(state.comparisonAhp);
        setComparisonConfiguration(state.comparisonConfiguration);
        setComparisonRunState(state.comparisonRunState);
        setComparisonOptimization(state.comparisonOptimization);
        setPromethee(state.promethee);
      }
      setWorkspaceReady(true);
    });
  }, []);

  useEffect(() => {
    if (!workspaceReady) {
      return;
    }

    const storage = window.sessionStorage;
    const state = buildPersistedWorkspaceState({
      activePage,
      dataset: uploadedDataset,
      dispatchStrategy: workspaceDispatchStrategy,
      battery: batteryConfiguration,
      setup: setupConfiguration,
      runState: singleOptimizationRunState,
      selectedBatteryId,
      selectedMode,
      activeOptimizationStep,
      operationalProfileDate,
      comparisonAhp,
      comparisonConfiguration,
      comparisonRunState,
      comparisonOptimization,
      promethee,
    });
    writePersistedWorkspaceState(storage, state);
  }, [activePage, uploadedDataset, workspaceDispatchStrategy, batteryConfiguration, setupConfiguration, singleOptimizationRunState, selectedBatteryId, selectedMode, activeOptimizationStep, operationalProfileDate, comparisonAhp, comparisonConfiguration, comparisonRunState, comparisonOptimization, promethee, workspaceReady]);

  const invalidateComparisonScience = useCallback(() => {
    setComparisonOptimization((current) => current ? { ...current, stale: true } : current);
    setComparisonAhp((current) => current?.accepted ? { ...current, accepted: false } : current);
  }, []);

  useEffect(() => {
    if (!comparisonConfiguration || !comparisonOptimization || comparisonOptimization.stale) return;
    const currentSignature = buildComparisonInputSignature(comparisonConfiguration, uploadedDataset, workspaceDispatchStrategy);
    if (synchronizeComparisonSnapshot(comparisonOptimization, currentSignature)?.stale) invalidateComparisonScience();
  }, [comparisonConfiguration, comparisonOptimization, invalidateComparisonScience, uploadedDataset, workspaceDispatchStrategy]);

  const openComparisonAHP = useCallback(() => {
    setSelectedMode("comparison");
    setActiveOptimizationStep("comparison-ahp");
    setActivePage("Optimization");
  }, []);

  const handleNavigate = (page: ActivePage) => {
    setActivePage(page);
    setMobileOpen(false);
  };

  const handleOptimizationStateChange = (nextState: {
    selectedMode: "single" | "comparison" | null;
    selectedBatteryId: string | null;
    batteryConfiguration: SingleBatteryConfigurationSnapshot | null;
    setupConfiguration: SingleOptimizationSetupSnapshot | null;
    activeStep: string | null;
    comparisonAhp: ComparisonAHPWorkspaceState | null;
  }) => {
    setSelectedMode(nextState.selectedMode);
    setSelectedBatteryId(nextState.selectedBatteryId);
    setBatteryConfiguration(nextState.batteryConfiguration);
    setSetupConfiguration(nextState.setupConfiguration);
    setActiveOptimizationStep(nextState.activeStep);
    setComparisonAhp(nextState.comparisonAhp);
  };

  const workspaceStatus = useMemo(() => {
    const datasetStatus = uploadedDataset ? "Available" : "Missing";
    let optimizationStatus = "Not started";
    if (singleOptimizationRunState.phase === "queued" || singleOptimizationRunState.phase === "running" || singleOptimizationRunState.phase === "cancelling" || singleOptimizationRunState.phase === "submitting") {
      optimizationStatus = "Running";
    } else if (singleOptimizationRunState.phase === "completed") {
      optimizationStatus = "Completed";
    } else if (restoreError && singleOptimizationRunState.phase === "ready" && singleOptimizationRunState.jobId === null) {
      optimizationStatus = "Expired";
    }

    const profilesStatus = shouldRenderOperationalProfiles(singleOptimizationRunState.latestJob?.final_result ?? null) && singleOptimizationRunState.phase === "completed"
      ? "Available"
      : (singleOptimizationRunState.phase === "completed" ? "Waiting" : "Waiting");

    return { datasetStatus, optimizationStatus, profilesStatus };
  }, [restoreError, singleOptimizationRunState]);

  const sidebar = (
    <SidebarContent activePage={activePage} onNavigate={handleNavigate} />
  );

  if (!workspaceReady) {
    return (
      <Box sx={{ display: "grid", minHeight: "100vh", placeItems: "center", bgcolor: "background.default" }}>
        <Paper variant="outlined" sx={{ p: 4, borderRadius: "24px", minWidth: { xs: 280, sm: 360 } }}>
          <Typography variant="h6" sx={{ fontWeight: 850 }}>Restoring workspace…</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Recovering the current dataset, optimization state, and profile selection from the browser session.</Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { md: `${DRAWER_WIDTH}px` },
          color: "text.primary",
          bgcolor: "rgba(255,255,255,0.9)",
          backdropFilter: "blur(14px)",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Toolbar sx={{ minHeight: "72px !important", px: { xs: 2, sm: 3 } }}>
          <IconButton
            color="inherit"
            aria-label="Open navigation"
            edge="start"
            onClick={() => setMobileOpen(true)}
            sx={{ mr: 1.5, display: { md: "none" } }}
          >
            <MenuRoundedIcon />
          </IconButton>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.15 }}>
              {activePage}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {activePage === "Dispatch"
                ? "Default reference dispatch strategy"
                : activePage === "Data Upload"
                  ? "CSV validation and 15-minute day explorer"
                  : activePage === "Optimization"
                    ? "Choose how the optimization workflow should run"
                  : "Default battery configuration"}
            </Typography>
          </Box>
          <Chip
            icon={
              activePage === "Dispatch" ? (
                <BoltRoundedIcon />
              ) : activePage === "Data Upload" ? (
                <CloudUploadRoundedIcon />
              ) : activePage === "Optimization" ? (
                <AutoGraphRoundedIcon />
              ) : (
                <ScaleRoundedIcon />
              )
            }
            label={
              activePage === "Dispatch"
                ? "Default strategy"
                : activePage === "Data Upload"
                  ? "Annual dataset"
                  : activePage === "Optimization"
                    ? "Mode setup"
                  : "Reference setup"
            }
            size="small"
            sx={{
              display: { xs: "none", sm: "inline-flex" },
              bgcolor: "#f0fdfa",
              color: "#0f766e",
              fontWeight: 750,
              "& .MuiChip-icon": { color: "inherit" },
            }}
          />
        </Toolbar>
      </AppBar>

      <Box component="nav" aria-label="Primary navigation" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: "block", md: "none" },
            "& .MuiDrawer-paper": {
              width: DRAWER_WIDTH,
              boxSizing: "border-box",
              bgcolor: "#0d1b2a",
              borderRight: 0,
            },
          }}
        >
          {sidebar}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: "none", md: "block" },
            "& .MuiDrawer-paper": {
              width: DRAWER_WIDTH,
              boxSizing: "border-box",
              bgcolor: "#0d1b2a",
              borderRight: 0,
            },
          }}
        >
          {sidebar}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { xs: "100%", md: `calc(100% - ${DRAWER_WIDTH}px)` },
          minWidth: 0,
        }}
      >
        <Toolbar sx={{ minHeight: "72px !important" }} />
        <Box sx={{ width: "100%", maxWidth: 1540, mx: "auto", p: { xs: 2, sm: 3, lg: 4 } }}>
          {restoreError && (
            <Alert severity="warning" sx={{ mb: 2.5, borderRadius: "16px" }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>Workspace restore notice</Typography>
              <Typography variant="body2">{restoreError}</Typography>
            </Alert>
          )}
          <Paper elevation={0} sx={{ mb: 2.5, p: { xs: 1.6, sm: 2.1 }, borderRadius: "20px", border: "1px solid #dce7ec", background: "linear-gradient(135deg, #f8fffd 0%, #f7fbff 100%)" }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}>
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>Workspace status</Typography>
                <Typography variant="body2" color="text.secondary">Your current dataset, optimization run, and operational profiles stay available across navigation and refresh.</Typography>
              </Box>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Chip size="small" label={`Dataset: ${workspaceStatus.datasetStatus}`} color={workspaceStatus.datasetStatus === "Available" ? "success" : "default"} variant="outlined" />
                <Chip size="small" label={`Optimization: ${workspaceStatus.optimizationStatus}`} color={workspaceStatus.optimizationStatus === "Completed" ? "success" : workspaceStatus.optimizationStatus === "Running" ? "info" : workspaceStatus.optimizationStatus === "Expired" ? "warning" : "default"} variant="outlined" />
                <Chip size="small" label={`Profiles: ${workspaceStatus.profilesStatus}`} color={workspaceStatus.profilesStatus === "Available" ? "success" : workspaceStatus.profilesStatus === "Error" ? "error" : "default"} variant="outlined" />
              </Stack>
            </Stack>
          </Paper>
          <Box sx={{ display: activePage === "Optimization" ? "block" : "none" }}>
            <Suspense fallback={<LoadingContent />}>
              <OptimizationPage
                dataset={uploadedDataset}
                dispatchStrategy={workspaceDispatchStrategy}
                onGoToDataUpload={() => handleNavigate("Data Upload")}
                onReviewDispatchStrategy={() => handleNavigate("Dispatch")}
                runState={singleOptimizationRunState}
                setRunState={setSingleOptimizationRunState}
                selectedMode={selectedMode}
                selectedBatteryId={selectedBatteryId}
                batteryConfiguration={batteryConfiguration}
                setupConfiguration={setupConfiguration}
                activeStep={activeOptimizationStep}
                operationalProfileDate={operationalProfileDate}
                onOperationalProfileDateChange={setOperationalProfileDate}
                comparisonAhp={comparisonAhp}
                onOpenComparisonMode={() => handleNavigate("Comparison Mode")}
                onStateChange={handleOptimizationStateChange}
              />
            </Suspense>
          </Box>
          {activePage === "Data Upload" ? (
            <Suspense fallback={<LoadingContent />}>
              <DataUploadPage onDatasetUploaded={setUploadedDataset} />
            </Suspense>
          ) : activePage === "Dispatch" ? (
            <DispatchStrategyPage
              persistedStrategy={workspaceDispatchStrategy}
              onStrategyChange={setWorkspaceDispatchStrategy}
            />
          ) : null}
          <Box sx={{ display: activePage === "Comparison Mode" ? "block" : "none" }}>
            <ComparisonModePage
              dataset={uploadedDataset}
              dispatchStrategy={workspaceDispatchStrategy}
              comparisonConfiguration={comparisonConfiguration}
              comparisonRunState={comparisonRunState}
              comparisonOptimization={comparisonOptimization}
              comparisonAhp={comparisonAhp}
              promethee={promethee}
              onComparisonConfigurationChange={setComparisonConfiguration}
              onComparisonRunStateChange={setComparisonRunState}
              onComparisonCompleted={setComparisonOptimization}
              onInvalidateScientificState={invalidateComparisonScience}
              onOpenAHP={openComparisonAHP}
              onPrometheeChange={setPromethee}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
