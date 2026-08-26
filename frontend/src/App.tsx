import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ElementType, SetStateAction } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import DashboardRoundedIcon from "@mui/icons-material/DashboardRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DescriptionRoundedIcon from "@mui/icons-material/DescriptionRounded";
import DoNotDisturbOnRoundedIcon from "@mui/icons-material/DoNotDisturbOnRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import LockRoundedIcon from "@mui/icons-material/LockRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
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
  Dialog,
  DialogContent,
  DialogTitle,
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
  useMediaQuery,
  useTheme,
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
  getProjectWorkspaceStorageKey,
  readPersistedWorkspaceState,
  shouldRenderOperationalProfiles,
  validatePersistedWorkspaceState,
  writePersistedWorkspaceState,
} from "./lib/workspacePersistence";
import { INITIAL_COMPARISON_RUN_STATE, buildComparisonInputSignature, createDefaultComparisonConfiguration, synchronizeComparisonSnapshot, transitionFromComparisonRunner } from "./lib/comparisonOptimization";
import { canEnterComparisonResults, isAHPCurrent, isPrometheeResultStale, sanitizePrometheeWorkspaceState } from "./lib/comparisonResults";
import { linkAHPStateToComparison, sanitizeComparisonAHPState } from "./lib/comparisonAhp";
import {
  deriveComparisonDecisionStage,
  destinationForComparisonDecisionStage,
} from "./lib/comparisonDecisionWorkflow";
import { buildDashboardModel } from "./lib/dashboardState";
import { batteryTypeLabel } from "./lib/batteryCatalogue";
import type { DashboardQuickAction } from "./lib/dashboardState";
import {
  buildRemoteWorkspaceState,
  chooseNewerWorkspaceState,
  isHydratableRemoteState,
  remoteWorkspaceFingerprint,
} from "./lib/remoteWorkspacePersistence";
import type { PersistenceStatus } from "./lib/remoteWorkspacePersistence";
import { getWorkspaceIdStorageKey } from "./lib/remoteWorkspacePersistence";
import {
  archiveProject as archiveOwnedProject,
  createProject as createOwnedProject,
  createSignedOutShellState,
  getProject as fetchOwnedProject,
  listProjects as fetchOwnedProjects,
  logoutUser,
  replaceProject,
  restoreAuthenticatedUser,
  updateProject as updateOwnedProject,
  writeActiveProjectId,
} from "./lib/authProjects";
import type { AuthState, AuthUser, ProjectSummary } from "./lib/authProjects";
import {
  getProjectAHPState,
  getProjectPrometheeState,
  getProjectWorkspace,
  importLegacyWorkspace,
  ProjectWorkspaceRevisionConflictError,
  saveProjectWorkspace,
} from "./lib/projectWorkspacePersistence";
import { activateProjectDataset, listProjectDatasets, removeProjectDataset } from "./lib/projectDatasets";
import type { ProjectDatasetRecord } from "./lib/projectDatasets";
import { belongsToProject } from "./lib/projectWorkspaceState";
import { openWorkspaceDestination, type LandingAuthMode } from "./lib/landingRouting";
import {
  authenticatedEntryPath,
  isPublicApplicationRoute,
  parseApplicationRoute,
  projectApplicationPath,
  projectOptimizationPath,
} from "./lib/appRouting";
import {
  activeOptimizationMessage,
  activeOptimizationMode,
  optimizationStepForSurface,
} from "./lib/optimizationWorkflow";
import { projectDatasetToWorkspace, resolveActiveProjectDataset } from "./lib/projectWorkflow";
import { resolveDatasetExplorerDate } from "./lib/datasetWorkspace";
import { isShellNavigationActive, nextMobileDrawerState } from "./lib/shellPresentation";


const DRAWER_WIDTH = 264;
const COLLAPSED_DRAWER_WIDTH = 84;
const CONFIG_DEFAULTS_ENDPOINT = "/api/config/defaults";
const DataUploadPage = lazy(() => import("./pages/DataUploadPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage"));
const OptimizationPage = lazy(() => import("./pages/OptimizationPage"));
const ComparisonAHPConfiguration = lazy(() => import("./pages/ComparisonAHPConfiguration"));
const ComparisonRecommendationPage = lazy(() => import("./pages/ComparisonRecommendationPage"));
const ComparisonResultsPage = lazy(() => import("./pages/ComparisonResultsPage"));
const ComparisonOptimizationPage = lazy(() => import("./pages/ComparisonOptimizationPage"));
const ProjectResultsPage = lazy(() => import("./pages/ProjectResultsPage"));
const DocumentationPage = lazy(() => import("./pages/DocumentationPage"));

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
  activePage: "Dashboard",
  dataset: null,
  dispatchStrategy: INITIAL_WORKSPACE_DISPATCH_STRATEGY,
  battery: null,
  setup: null,
  runState: INITIAL_SINGLE_OPTIMIZATION_RUN_STATE,
  selectedBatteryId: null,
  selectedMode: null,
  activeOptimizationStep: null,
  operationalProfileDate: null,
  datasetExplorerDate: null,
  comparisonAhp: null,
  comparisonConfiguration: null,
  comparisonRunState: INITIAL_COMPARISON_RUN_STATE,
  comparisonOptimization: null,
  promethee: null,
};

type BatteryTypeName = "Low-cost" | "Medium-low" | "Medium" | "High";
type CriterionDirection = "minimize" | "maximize";
type CriterionName =
  | "total_annual_cost_Rs"
  | "cycle_based_life_years"
  | "round_trip_efficiency"
  | "weight_density_kg_per_kwh"
  | "warranty_years";
type ActivePage = "My Projects" | "Dashboard" | "Comparison Mode" | "Results" | "Dispatch" | "Data Upload" | "Optimization" | "Documentation";
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
  scientific_configuration_version: number;
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
  { label: "Dashboard", icon: DashboardRoundedIcon, page: "Dashboard" },
  { label: "My Projects", icon: FolderRoundedIcon, page: "My Projects" },
  { label: "Dataset", icon: CloudUploadRoundedIcon, page: "Data Upload" },
  { label: "Optimization", icon: AutoGraphRoundedIcon, page: "Optimization" },
  { label: "Decision", icon: ScaleRoundedIcon, page: "Comparison Mode" },
  { label: "Results", icon: AssessmentRoundedIcon, page: "Results" },
  { label: "Documentation", icon: DescriptionRoundedIcon, page: "Documentation" },
];

const criterionLabels: Record<CriterionName, string> = {
  total_annual_cost_Rs: "Annualized total cost",
  cycle_based_life_years: "Cycle-based life",
  round_trip_efficiency: "Round-trip efficiency",
  weight_density_kg_per_kwh: "Weight density (kg/kWh)",
  warranty_years: "Warranty period",
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
    candidate.criteria.length === 5 &&
    Array.isArray(candidate.ahp_matrix) &&
    candidate.scientific_configuration_version === 3 &&
    Array.isArray(candidate.dispatch_periods) &&
    candidate.dispatch_periods.length === 4
  );
}

function SidebarContent({
  activePage,
  onNavigate,
  user,
  hasActiveProject,
  onLogout,
  collapsed,
  onToggleCollapsed,
}: {
  activePage: ActivePage;
  onNavigate: (page: ActivePage) => void;
  user: AuthUser;
  hasActiveProject: boolean;
  onLogout: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
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
      <Toolbar sx={{ minHeight: "72px !important", px: collapsed ? 1.5 : 2.5, justifyContent: collapsed ? "center" : "flex-start" }}>
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
          <Box sx={{ display: collapsed ? "none" : "block" }}>
            <Typography
              variant="subtitle1"
              sx={{ color: "#ffffff", fontWeight: 800, lineHeight: 1.1 }}
            >
              BESS Decision
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
          sx={{ display: collapsed ? "none" : "block", color: "#6f879f", fontWeight: 800, letterSpacing: "0.12em", px: 1.5 }}
        >
          Workspace
        </Typography>
        <List sx={{ mt: 0.75 }}>
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const selected = isShellNavigationActive(activePage, item.page);
            const disabled = !item.page || (
              !hasActiveProject
              && item.page !== "My Projects"
              && item.page !== "Documentation"
            );

            return (
              <ListItemButton
                key={item.label}
                selected={selected}
                disabled={disabled}
                aria-current={selected ? "page" : undefined}
                onClick={() => item.page && onNavigate(item.page)}
                sx={{
                  minHeight: 46,
                  mb: 0.5,
                  borderRadius: 2.5,
                  color: selected ? "#ffffff" : "#a8b9ca",
                  "&.Mui-selected": {
                    bgcolor: "rgba(155,239,74,.11)",
                    color: "#9BEF4A",
                    boxShadow: "inset 3px 0 #9BEF4A",
                  },
                  "&.Mui-selected:hover": {
                    bgcolor: "rgba(155,239,74,.15)",
                  },
                  "&.Mui-disabled": {
                    color: "#71869a",
                    opacity: 0.78,
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: collapsed ? 0 : 40, justifyContent: "center", color: "inherit" }}>
                  <Icon fontSize="small" />
                </ListItemIcon>
                {!collapsed ? <ListItemText
                  primary={
                    <Typography
                      component="span"
                      sx={{ fontSize: 14, fontWeight: selected ? 750 : 600 }}
                    >
                      {item.label}
                    </Typography>
                  }
                /> : null}
              </ListItemButton>
            );
          })}
        </List>
      </Box>

      <Box sx={{ mt: "auto", p: collapsed ? 1.25 : 2 }}>
        <Button
          fullWidth
          size="small"
          color="inherit"
          startIcon={collapsed ? undefined : <ChevronLeftRoundedIcon />}
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          sx={{ mb: 1 }}
        >
          {collapsed ? <ChevronRightRoundedIcon /> : "Collapse menu"}
        </Button>
        <Paper
          elevation={0}
          sx={{
            p: collapsed ? 1 : 1.75,
            borderRadius: 2.5,
            bgcolor: "rgba(255,255,255,0.055)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "#c6d3df",
          }}
        >
          <Stack spacing={1.25}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
              <Avatar sx={{ width: 32, height: 32, bgcolor: "#2dd4bf", color: "#062c2a", fontSize: 13, fontWeight: 850 }}>
                {user.display_name.slice(0, 2).toUpperCase()}
              </Avatar>
              <Box sx={{ minWidth: 0, display: collapsed ? "none" : "block" }}>
                <Typography variant="caption" noWrap sx={{ display: "block", fontWeight: 800 }}>
                  {user.display_name}
                </Typography>
                <Typography variant="caption" noWrap sx={{ display: "block", color: "#8198ae" }}>
                  {user.email}
                </Typography>
              </Box>
            </Stack>
            <Button fullWidth size="small" color="inherit" startIcon={collapsed ? undefined : <LogoutRoundedIcon />} onClick={onLogout} aria-label="Sign out">
              {collapsed ? <LogoutRoundedIcon /> : "Sign out"}
            </Button>
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
            aria-label={`Edit ${batteryTypeLabel(battery.name)} battery settings`}
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
              {batteryTypeLabel(battery.name)}
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
  projectId,
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
  onOpenResults,
  onOpenDetailedResults,
  onRunnerClose,
  onViewDashboard,
  startBlockedReason,
  onViewActiveRun,
}: {
  projectId: string;
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
  onOpenResults: () => void;
  onOpenDetailedResults: () => void;
  onRunnerClose: () => void;
  onViewDashboard: () => void;
  startBlockedReason?: string | null;
  onViewActiveRun?: () => void;
}) {
  const [configuration, setConfiguration] = useState<DefaultConfiguration | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
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

  const scientificContext = { projectId, datasetId: dataset?.datasetId ?? null };
  const rankingReady = Boolean(
    promethee
    && comparisonOptimization
    && !isPrometheeResultStale(
      promethee,
      comparisonOptimization,
      comparisonAhp,
      scientificContext,
    ),
  );
  const resultsEntryReady = canEnterComparisonResults(
    comparisonOptimization,
    comparisonAhp,
    scientificContext,
  );

  if (!isLoading && !error && configuration && comparisonConfiguration) {
    return (
      <Suspense fallback={<LoadingContent />}>
        <ComparisonOptimizationPage
          projectId={projectId}
          configuration={comparisonConfiguration}
          dataset={dataset}
          dispatchStrategy={dispatchStrategy}
          runState={comparisonRunState}
          completedComparison={comparisonOptimization}
          ahpState={comparisonAhp}
          prometheeState={promethee}
          onConfigurationChange={onComparisonConfigurationChange}
          onRunStateChange={onComparisonRunStateChange}
          onCompleted={onComparisonCompleted}
          onInvalidateScientificState={onInvalidateScientificState}
          onOpenAHP={onOpenAHP}
          onOpenResults={onOpenResults}
          onOpenDetailedResults={onOpenDetailedResults}
          onBackToModes={onRunnerClose}
          onViewDashboard={onViewDashboard}
          startBlockedReason={startBlockedReason}
          onViewActiveRun={onViewActiveRun}
        />
      </Suspense>
    );
  }

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
            Review battery options and the six decision criteria.
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
              onClick={onOpenResults}
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
                  Catalogue technologies
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
                  Minimize or maximize each measure
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
        {configuration && comparisonConfiguration && <ComparisonOptimizationPage
          projectId={projectId}
          open={runnerOpen}
          configuration={comparisonConfiguration}
          dataset={dataset}
          dispatchStrategy={dispatchStrategy}
          runState={comparisonRunState}
          completedComparison={comparisonOptimization}
          ahpState={comparisonAhp}
          prometheeState={promethee}
          onConfigurationChange={onComparisonConfigurationChange}
          onRunStateChange={onComparisonRunStateChange}
          onCompleted={onComparisonCompleted}
          onInvalidateScientificState={onInvalidateScientificState}
          onOpenAHP={() => transitionFromComparisonRunner(() => setRunnerOpen(false), onOpenAHP)}
          onOpenResults={() => transitionFromComparisonRunner(() => setRunnerOpen(false), onOpenResults)}
          onOpenDetailedResults={() => transitionFromComparisonRunner(() => setRunnerOpen(false), onOpenDetailedResults)}
          startBlockedReason={startBlockedReason}
          onViewActiveRun={onViewActiveRun}
          onClose={() => {
            setRunnerOpen(false);
            onRunnerClose();
          }}
        />}
      </Suspense>
    </Stack>
  );
}

export default function App() {
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const applicationRoute = useMemo(
    () => parseApplicationRoute(location.pathname),
    [location.pathname],
  );
  const authDialogFullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [authState, setAuthState] = useState<AuthState>({ status: "loading", user: null });
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authDialogMode, setAuthDialogMode] = useState<LandingAuthMode>("login");
  const [authRestoreError, setAuthRestoreError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectDatasets, setProjectDatasets] = useState<ProjectDatasetRecord[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
  const [datasetExplorerDate, setDatasetExplorerDate] = useState<string | null>(
    INITIAL_PERSISTED_WORKSPACE_STATE.datasetExplorerDate,
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
  const activeRunMode = activeOptimizationMode(
    singleOptimizationRunState.phase,
    comparisonRunState.phase,
  );
  const activeRunMessage = activeOptimizationMessage(activeRunMode);
  const [restoredFromMongo, setRestoredFromMongo] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>("idle");
  const [persistenceRetry, setPersistenceRetry] = useState(0);
  const workspaceRevisionRef = useRef(0);
  const workspaceSaveSequenceRef = useRef(0);
  const lastRemoteFingerprintRef = useRef<string | null>(null);

  const resetScientificWorkspace = useCallback(() => {
    setUploadedDataset(null);
    setProjectDatasets([]);
    setWorkspaceDispatchStrategy(INITIAL_PERSISTED_WORKSPACE_STATE.dispatchStrategy);
    setSingleOptimizationRunState(INITIAL_PERSISTED_WORKSPACE_STATE.runState);
    setSelectedBatteryId(null);
    setSelectedMode(null);
    setBatteryConfiguration(null);
    setSetupConfiguration(null);
    setActiveOptimizationStep(null);
    setOperationalProfileDate(null);
    setDatasetExplorerDate(null);
    setComparisonAhp(null);
    setComparisonConfiguration(null);
    setComparisonRunState(INITIAL_PERSISTED_WORKSPACE_STATE.comparisonRunState);
    setComparisonOptimization(null);
    setPromethee(null);
    setRestoredFromMongo(false);
    setRestoreError(null);
    workspaceRevisionRef.current = 0;
    lastRemoteFingerprintRef.current = null;
  }, []);

  const establishAuthenticatedShell = useCallback(async (user: AuthUser) => {
    // A valid login is independent of the project-list hydration that follows.
    // Enter the authenticated shell immediately so a slow project request cannot
    // leave the user trapped on the sign-in surface.
    setAuthState({ status: "authenticated", user });
    setAuthRestoreError(null);
    setProjectsLoading(true);
    setProjectsError(null);
    setWorkspaceReady(false);
    try {
      const ownedProjects = await fetchOwnedProjects();
      const requestedRoute = parseApplicationRoute(window.location.pathname);
      const requestedProject = requestedRoute.kind === "project"
        ? ownedProjects.find((project) =>
          project.project_id === requestedRoute.projectId && project.status === "active") ?? null
        : null;
      const selected = requestedRoute.kind === "project" ? requestedProject : null;
      setProjects(ownedProjects);
      setActiveProjectId(selected?.project_id ?? null);
      if (selected) {
        writeActiveProjectId(window.localStorage, selected.project_id);
      } else if (requestedRoute.kind === "project") {
        writeActiveProjectId(window.localStorage, null);
        setProjectsError("Project was not found or is not available.");
        navigate("/projects", { replace: true });
      }
      setActivePage(
        requestedRoute.kind === "documentation"
          ? "Documentation"
          : requestedRoute.kind === "projects" || !selected
            ? "My Projects"
            : "Dashboard",
      );
      if (!selected) setWorkspaceReady(true);
    } catch (error) {
      setProjects([]);
      setActiveProjectId(null);
      setProjectsError(error instanceof Error ? error.message : "Projects could not be loaded.");
      setActivePage("My Projects");
      setWorkspaceReady(true);
    } finally {
      setProjectsLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    void restoreAuthenticatedUser()
      .then((user) => {
        if (cancelled) return;
        if (!user) {
          setAuthState({ status: "unauthenticated", user: null });
          return;
        }
        void establishAuthenticatedShell(user);
      })
      .catch((error) => {
        if (cancelled) return;
        setAuthRestoreError(error instanceof Error ? error.message : "Authentication is unavailable.");
        setAuthState({ status: "unauthenticated", user: null });
      });
    return () => {
      cancelled = true;
    };
  }, [establishAuthenticatedShell]);

  useEffect(() => {
    if (authState.status === "loading") return;
    if (authState.status !== "authenticated") {
      if (!isPublicApplicationRoute(applicationRoute)) {
        navigate("/", { replace: true });
      }
      return;
    }
    const authenticatedEntry = authenticatedEntryPath(applicationRoute);
    if (authenticatedEntry) {
      navigate(authenticatedEntry, { replace: true });
      return;
    }
    if (applicationRoute.kind === "projects") {
      setActivePage("My Projects");
      setOpeningProjectId(null);
      return;
    }
    if (applicationRoute.kind === "documentation") {
      setActivePage("Documentation");
      setOpeningProjectId(null);
      return;
    }
    if (applicationRoute.kind !== "project") return;
    const requestedProject = projects.find(
      (project) =>
        project.project_id === applicationRoute.projectId && project.status === "active",
    );
    if (!requestedProject) {
      setProjectsError("Project was not found or is not available.");
      setActiveProjectId(null);
      writeActiveProjectId(window.localStorage, null);
      resetScientificWorkspace();
      setWorkspaceReady(true);
      setOpeningProjectId(null);
      navigate("/projects", { replace: true });
      return;
    }
    if (activeProjectId !== requestedProject.project_id) {
      setWorkspaceReady(false);
      setOpeningProjectId(requestedProject.project_id);
      setActiveProjectId(requestedProject.project_id);
      writeActiveProjectId(window.localStorage, requestedProject.project_id);
    } else {
      const optimizationStep = optimizationStepForSurface(applicationRoute.surface);
      if (["results", "comparison-recommendation", "comparison-results"].includes(applicationRoute.surface) && workspaceReady) {
        setActivePage("Results");
      } else if (["comparison", "comparison-ahp"].includes(applicationRoute.surface) && workspaceReady) {
        setActivePage("Comparison Mode");
      } else if (applicationRoute.surface === "dataset" && workspaceReady) {
        setActivePage("Data Upload");
      } else if (applicationRoute.surface === "dispatch" && workspaceReady) {
        setActivePage("Dispatch");
      } else if (optimizationStep) {
        setActivePage("Optimization");
        setActiveOptimizationStep(optimizationStep);
        if (optimizationStep !== "mode-selection") setSelectedMode("single");
      } else if (workspaceReady) {
        setActivePage("Dashboard");
      }
      if (workspaceReady) setOpeningProjectId(null);
    }
  }, [
    activeProjectId,
    applicationRoute,
    authState.status,
    navigate,
    projects,
    resetScientificWorkspace,
    workspaceReady,
  ]);

  useEffect(() => {
    if (authState.status === "authenticated") {
      setAuthDialogOpen(false);
      return;
    }
    if (applicationRoute.kind === "login" || applicationRoute.kind === "register") {
      setAuthDialogMode(applicationRoute.kind);
      setAuthDialogOpen(true);
    } else {
      setAuthDialogOpen(false);
    }
  }, [applicationRoute.kind, authState.status]);

  useEffect(() => {
    if (authState.status !== "authenticated") return;
    if (!activeProjectId) {
      resetScientificWorkspace();
      setWorkspaceReady(true);
      return;
    }
    setWorkspaceReady(false);
    resetScientificWorkspace();
    const storage = window.sessionStorage;
    const storageKey = getProjectWorkspaceStorageKey(activeProjectId);
    const restoredLocal = readPersistedWorkspaceState(storage, storageKey);
    const localPersisted = belongsToProject(restoredLocal, activeProjectId) ? restoredLocal : null;
    let cancelled = false;

    const restore = async () => {
      let persisted = localPersisted;
      let selectedRemoteState = false;
      let openedProject: ProjectSummary;
      let datasets: ProjectDatasetRecord[];
      let projectedAHP: Record<string, unknown> | null = null;
      let projectedPromethee: Record<string, unknown> | null = null;
      try {
        const [project, remoteSnapshot, loadedDatasets, loadedAHP, loadedPromethee] = await Promise.all([
          fetchOwnedProject(activeProjectId),
          getProjectWorkspace(activeProjectId),
          listProjectDatasets(activeProjectId),
          getProjectAHPState(activeProjectId).catch(() => null),
          getProjectPrometheeState(activeProjectId).catch(() => null),
        ]);
        if (cancelled) return;
        openedProject = project;
        datasets = loadedDatasets;
        projectedAHP = loadedAHP;
        projectedPromethee = loadedPromethee;
        setProjects((current) => replaceProject(current, project));
        setProjectDatasets(loadedDatasets);
        workspaceRevisionRef.current = remoteSnapshot.revision;
        const remoteState = isHydratableRemoteState(remoteSnapshot.state)
          ? { ...remoteSnapshot.state, projectId: activeProjectId, persistenceRevision: remoteSnapshot.revision }
          : null;
        persisted = chooseNewerWorkspaceState(localPersisted, remoteState, remoteSnapshot.revision);
        selectedRemoteState = Boolean(remoteState && persisted === remoteState);
        setPersistenceStatus("saved");
      } catch (error) {
        if (cancelled) return;
        setPersistenceStatus("failed");
        setProjectsError(error instanceof Error ? error.message : "Project could not be opened.");
        setActiveProjectId(null);
        writeActiveProjectId(window.localStorage, null);
        resetScientificWorkspace();
        setWorkspaceReady(true);
        setOpeningProjectId(null);
        navigate("/projects", { replace: true });
        return;
      }

      const result = await validatePersistedWorkspaceState(persisted, {
      datasetExists: async (datasetId: string) => datasets.some(
        (dataset) => dataset.dataset_id === datasetId && dataset.status !== "expired",
      ),
      jobExists: async (jobId: string) => {
        try {
          const response = await fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/single-optimization/jobs/${encodeURIComponent(jobId)}`, { credentials: "include" });
          return response.status !== 404;
        } catch {
          return true;
        }
      },
      comparisonJobExists: async (jobId: string) => {
        try {
          const response = await fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/comparison-optimization/jobs/${encodeURIComponent(jobId)}`, { credentials: "include" });
          return response.status !== 404;
        } catch {
          return true;
        }
      },
      });
      if (cancelled) return;
      const { error } = result;
      const state = result.state ?? {
        ...INITIAL_PERSISTED_WORKSPACE_STATE,
        projectId: activeProjectId,
        activeDatasetId: openedProject.active_dataset_id ?? null,
      };
      if (error) {
        setRestoreError(error);
      }

      const activeDataset = resolveActiveProjectDataset(
        openedProject,
        datasets,
        state.dataset,
        state.activeDatasetId ?? null,
      );
      setUploadedDataset(activeDataset);
      setWorkspaceDispatchStrategy(state.dispatchStrategy);
      setSingleOptimizationRunState(state.runState);
      setSelectedBatteryId(state.selectedBatteryId);
      setSelectedMode(state.selectedMode);
      setBatteryConfiguration(state.battery);
      setSetupConfiguration(state.setup);
      setActiveOptimizationStep(state.activeOptimizationStep);
      setOperationalProfileDate(state.operationalProfileDate);
      setDatasetExplorerDate(resolveDatasetExplorerDate(activeDataset, state.datasetExplorerDate));
      const scientificContext = {
        projectId: activeProjectId,
        datasetId: activeDataset?.datasetId ?? null,
      };
      const projectedAHPState = sanitizeComparisonAHPState(projectedAHP);
      const restoredAHPState = state.comparisonAhp?.accepted
        ? state.comparisonAhp
        : projectedAHPState && isAHPCurrent(
          projectedAHPState,
          state.comparisonOptimization,
          scientificContext,
        )
          ? projectedAHPState
          : state.comparisonAhp;
      const projectedPrometheeState = sanitizePrometheeWorkspaceState(projectedPromethee);
      const restoredPrometheeState = state.promethee
        ?? (projectedPrometheeState && !isPrometheeResultStale(
          projectedPrometheeState,
          state.comparisonOptimization,
          restoredAHPState,
          scientificContext,
        ) ? projectedPrometheeState : null);
      setComparisonAhp(restoredAHPState);
      setComparisonConfiguration(state.comparisonConfiguration);
      setComparisonRunState(state.comparisonRunState);
      setComparisonOptimization(state.comparisonOptimization);
      setPromethee(restoredPrometheeState);
      const restoredRoute = parseApplicationRoute(window.location.pathname);
      if (restoredRoute.kind === "project") {
        const optimizationStep = optimizationStepForSurface(restoredRoute.surface);
        if (["results", "comparison-recommendation", "comparison-results"].includes(restoredRoute.surface)) {
          setActivePage("Results");
        } else if (["comparison", "comparison-ahp"].includes(restoredRoute.surface)) {
          setActivePage("Comparison Mode");
        } else if (restoredRoute.surface === "dataset") {
          setActivePage("Data Upload");
        } else if (restoredRoute.surface === "dispatch") {
          setActivePage("Dispatch");
        } else if (optimizationStep) {
          setActivePage("Optimization");
          setActiveOptimizationStep(optimizationStep);
          if (optimizationStep !== "mode-selection") setSelectedMode("single");
        } else {
          setActivePage("Dashboard");
        }
      } else if (restoredRoute.kind === "documentation") {
        setActivePage("Documentation");
      } else {
        setActivePage("My Projects");
      }
      setRestoredFromMongo(selectedRemoteState);
      setWorkspaceReady(true);
      setOpeningProjectId(null);
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, authState.status, navigate, resetScientificWorkspace]);

  useEffect(() => {
    if (!workspaceReady) {
      return;
    }

    const storage = window.sessionStorage;
    if (!activeProjectId) return;
    const state = buildPersistedWorkspaceState({
      projectId: activeProjectId,
      activeDatasetId: uploadedDataset?.datasetId ?? null,
      persistenceRevision: workspaceRevisionRef.current,
      updatedAt: new Date().toISOString(),
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
      datasetExplorerDate,
      comparisonAhp,
      comparisonConfiguration,
      comparisonRunState,
      comparisonOptimization,
      promethee,
    });
    writePersistedWorkspaceState(storage, state, getProjectWorkspaceStorageKey(activeProjectId));
  }, [activePage, activeProjectId, uploadedDataset, workspaceDispatchStrategy, batteryConfiguration, setupConfiguration, singleOptimizationRunState, selectedBatteryId, selectedMode, activeOptimizationStep, operationalProfileDate, datasetExplorerDate, comparisonAhp, comparisonConfiguration, comparisonRunState, comparisonOptimization, promethee, workspaceReady]);

  useEffect(() => {
    if (!workspaceReady || !activeProjectId) return;
    const localState = buildPersistedWorkspaceState({
      projectId: activeProjectId,
      activeDatasetId: uploadedDataset?.datasetId ?? null,
      persistenceRevision: workspaceRevisionRef.current,
      updatedAt: new Date().toISOString(),
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
      datasetExplorerDate,
      comparisonAhp,
      comparisonConfiguration,
      comparisonRunState,
      comparisonOptimization,
      promethee,
    });
    const remoteState = buildRemoteWorkspaceState(localState, workspaceRevisionRef.current);
    const fingerprint = remoteWorkspaceFingerprint(remoteState);
    if (fingerprint === lastRemoteFingerprintRef.current && persistenceRetry === 0) return;
    const saveSequence = workspaceSaveSequenceRef.current + 1;
    workspaceSaveSequenceRef.current = saveSequence;

    const timer = window.setTimeout(() => {
      setPersistenceStatus("saving");
      const saveLatest = async () => {
        const expectedRevision = workspaceRevisionRef.current;
        try {
          return await saveProjectWorkspace(activeProjectId, remoteState, expectedRevision);
        } catch (error) {
          if (!(error instanceof ProjectWorkspaceRevisionConflictError)
            || saveSequence !== workspaceSaveSequenceRef.current) throw error;
          const currentSnapshot = await getProjectWorkspace(activeProjectId);
          if (saveSequence !== workspaceSaveSequenceRef.current) return null;
          workspaceRevisionRef.current = currentSnapshot.revision;
          return saveProjectWorkspace(activeProjectId, remoteState, currentSnapshot.revision);
        }
      };
      void saveLatest().then((snapshot) => {
        if (!snapshot || saveSequence !== workspaceSaveSequenceRef.current) return;
        workspaceRevisionRef.current = snapshot.revision;
        lastRemoteFingerprintRef.current = fingerprint;
        writePersistedWorkspaceState(
          window.sessionStorage,
          { ...remoteState, persistenceRevision: snapshot.revision },
          getProjectWorkspaceStorageKey(activeProjectId),
        );
        setPersistenceStatus("saved");
        if (persistenceRetry !== 0) setPersistenceRetry(0);
      }).catch(() => {
        if (saveSequence !== workspaceSaveSequenceRef.current) return;
        setPersistenceStatus("failed");
      });
    }, comparisonAhp?.accepted || promethee ? 0 : 800);
    return () => window.clearTimeout(timer);
  }, [activePage, activeProjectId, uploadedDataset, workspaceDispatchStrategy, batteryConfiguration, setupConfiguration, singleOptimizationRunState, selectedBatteryId, selectedMode, activeOptimizationStep, operationalProfileDate, datasetExplorerDate, comparisonAhp, comparisonConfiguration, comparisonRunState, comparisonOptimization, promethee, workspaceReady, persistenceRetry]);

  const invalidateComparisonScience = useCallback(() => {
    setComparisonOptimization((current) => current ? { ...current, stale: true } : current);
    setComparisonAhp((current) => current?.accepted ? { ...current, accepted: false } : current);
    setPromethee((current) => current ? { ...current, stale: true } : current);
  }, []);

  useEffect(() => {
    if (!comparisonConfiguration || !comparisonOptimization || comparisonOptimization.stale) return;
    const currentSignature = buildComparisonInputSignature(comparisonConfiguration, uploadedDataset, workspaceDispatchStrategy);
    if (synchronizeComparisonSnapshot(comparisonOptimization, currentSignature)?.stale) invalidateComparisonScience();
  }, [comparisonConfiguration, comparisonOptimization, invalidateComparisonScience, uploadedDataset, workspaceDispatchStrategy]);

  const openActiveOptimization = useCallback(() => {
    if (!activeProjectId || !activeRunMode) return;
    navigate(projectOptimizationPath(
      activeProjectId,
      activeRunMode === "single" ? "single-run" : "comparison",
    ));
    setMobileOpen(false);
  }, [activeProjectId, activeRunMode, navigate]);

  const openComparisonAHP = useCallback(() => {
    if (!activeProjectId) return;
    setSelectedMode("comparison");
    setActiveOptimizationStep("comparison-ahp");
    navigate(projectOptimizationPath(activeProjectId, "comparison-ahp"));
  }, [activeProjectId, navigate]);

  const handleNavigate = (page: ActivePage) => {
    if (page === "My Projects") {
      navigate("/projects");
      setMobileOpen(false);
      return;
    }
    if (page === "Documentation") {
      navigate("/documentation");
      setMobileOpen(false);
      return;
    }
    if (!activeProjectId) {
      setProjectsError("Open a project before starting an optimization.");
      navigate("/projects");
      setMobileOpen(false);
      return;
    }
    if (page === "Optimization") {
      if (activeRunMode) {
        openActiveOptimization();
        return;
      }
      setActiveOptimizationStep("mode-selection");
      navigate(projectOptimizationPath(activeProjectId));
      setMobileOpen(false);
      return;
    }
    if (page === "Comparison Mode") {
      if (activeRunMode) {
        openActiveOptimization();
        return;
      }
      navigate(projectOptimizationPath(activeProjectId, "comparison"));
      setMobileOpen(false);
      return;
    }
    if (page === "Results") {
      navigate(projectApplicationPath(activeProjectId, "results"));
      setMobileOpen(false);
      return;
    }
    if (page === "Dashboard") {
      navigate(projectApplicationPath(activeProjectId));
    } else if (page === "Data Upload") {
      navigate(projectApplicationPath(activeProjectId, "dataset"));
    } else if (page === "Dispatch") {
      navigate(projectApplicationPath(activeProjectId, "dispatch"));
    } else {
      setActivePage(page);
    }
    setMobileOpen(false);
  };

  const handleLogout = useCallback(async () => {
    try {
      await logoutUser();
    } finally {
      writeActiveProjectId(window.localStorage, null);
      const signedOut = createSignedOutShellState();
      setActiveProjectId(signedOut.activeProjectId);
      setProjects(signedOut.projects);
      resetScientificWorkspace();
      setWorkspaceReady(false);
      setAuthState(signedOut.authState);
      setAuthDialogOpen(false);
      setMobileOpen(false);
      navigate("/", { replace: true });
    }
  }, [navigate, resetScientificWorkspace]);

  const handleAuthenticatedFromLanding = useCallback((user: AuthUser) => {
    setActivePage("My Projects");
    setAuthDialogOpen(false);
    navigate("/projects", { replace: true });
    void establishAuthenticatedShell(user);
  }, [establishAuthenticatedShell, navigate]);

  const handleOpenAuth = useCallback((mode: LandingAuthMode) => {
    setAuthRestoreError(null);
    setAuthDialogMode(mode);
    setAuthDialogOpen(true);
    navigate(mode === "login" ? "/login" : "/register");
  }, [navigate]);

  const handleOpenWorkspace = useCallback(() => {
    if (authState.status !== "authenticated") {
      handleOpenAuth("register");
      return;
    }
    const destination = openWorkspaceDestination(projects, activeProjectId);
    if (destination.projectId) {
      navigate(projectApplicationPath(destination.projectId));
    } else {
      navigate("/projects");
    }
  }, [activeProjectId, authState.status, handleOpenAuth, navigate, projects]);

  const handleViewProjects = useCallback(() => {
    if (authState.status !== "authenticated") {
      handleOpenAuth("login");
      return;
    }
    navigate("/projects");
  }, [authState.status, handleOpenAuth, navigate]);

  const handleCreateProject = useCallback(async (name: string, description: string) => {
    setProjectsError(null);
    try {
      const created = await createOwnedProject(name, description);
      setProjects((current) => replaceProject(current, created));
    } catch (error) {
      setProjectsError(error instanceof Error ? error.message : "Project could not be created.");
      throw error;
    }
  }, []);

  const handleUpdateProject = useCallback(async (projectId: string, name: string, description: string) => {
    setProjectsError(null);
    try {
      const updated = await updateOwnedProject(projectId, { name, description });
      setProjects((current) => replaceProject(current, updated));
    } catch (error) {
      setProjectsError(error instanceof Error ? error.message : "Project could not be updated.");
      throw error;
    }
  }, []);

  const handleDeleteProject = useCallback(async (projectId: string) => {
    setProjectsError(null);
    try {
      const removed = await archiveOwnedProject(projectId);
      setProjects((current) => removed.status === "archived"
        ? current.filter((project) => project.project_id !== removed.project_id)
        : replaceProject(current, removed));
      if (activeProjectId === projectId) {
        setActiveProjectId(null);
        writeActiveProjectId(window.localStorage, null);
        resetScientificWorkspace();
        setActivePage("My Projects");
        navigate("/projects", { replace: true });
      }
    } catch (error) {
      setProjectsError(error instanceof Error ? error.message : "Project could not be deleted.");
      throw error;
    }
  }, [activeProjectId, navigate, resetScientificWorkspace]);

  const handleOpenProject = useCallback((projectId: string) => {
    const switchProject = () => {
      setProjectsError(null);
      setOpeningProjectId(projectId);
      if (activeProjectId && workspaceReady && activeProjectId !== projectId) {
        const state = buildPersistedWorkspaceState({
          projectId: activeProjectId,
          activeDatasetId: uploadedDataset?.datasetId ?? null,
          persistenceRevision: workspaceRevisionRef.current,
          updatedAt: new Date().toISOString(),
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
          datasetExplorerDate,
          comparisonAhp,
          comparisonConfiguration,
          comparisonRunState,
          comparisonOptimization,
          promethee,
        });
        writePersistedWorkspaceState(window.sessionStorage, state, getProjectWorkspaceStorageKey(activeProjectId));
        void saveProjectWorkspace(
          activeProjectId,
          buildRemoteWorkspaceState(state, workspaceRevisionRef.current),
          workspaceRevisionRef.current,
        ).catch(() => setPersistenceStatus("failed"));
      }
      if (activeProjectId === projectId && workspaceReady) {
        setActivePage("Dashboard");
        setOpeningProjectId(null);
      }
      navigate(projectApplicationPath(projectId));
    };
    switchProject();
  }, [activeOptimizationStep, activePage, activeProjectId, batteryConfiguration, comparisonAhp, comparisonConfiguration, comparisonOptimization, comparisonRunState, datasetExplorerDate, navigate, operationalProfileDate, promethee, selectedBatteryId, selectedMode, setupConfiguration, singleOptimizationRunState, uploadedDataset, workspaceDispatchStrategy, workspaceReady]);

  const handleImportPreviousWorkspace = useCallback(async () => {
    if (!activeProjectId) return;
    const legacyWorkspaceId = window.localStorage.getItem(getWorkspaceIdStorageKey());
    if (!legacyWorkspaceId) {
      setRestoreError("No previous anonymous workspace was found in this browser.");
      return;
    }
    try {
      const snapshot = await importLegacyWorkspace(activeProjectId, legacyWorkspaceId);
      workspaceRevisionRef.current = snapshot.revision;
      const state = snapshot.state as PersistedWorkspaceState;
      writePersistedWorkspaceState(window.sessionStorage, state, getProjectWorkspaceStorageKey(activeProjectId));
      setWorkspaceReady(false);
      setActiveProjectId(null);
      window.setTimeout(() => setActiveProjectId(activeProjectId), 0);
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : "Previous workspace could not be imported.");
    }
  }, [activeProjectId]);

  const handleDashboardAction = useCallback((action: DashboardQuickAction) => {
    setMobileOpen(false);
    if (action === "dataset") {
      if (activeProjectId) navigate(projectApplicationPath(activeProjectId, "dataset"));
      return;
    }
    if (action === "single") {
      if (activeRunMode) {
        openActiveOptimization();
        return;
      }
      if (activeProjectId) navigate(projectOptimizationPath(activeProjectId));
      return;
    }
    if (action === "comparison") {
      if (activeRunMode) {
        openActiveOptimization();
        return;
      }
      if (activeProjectId) navigate(projectOptimizationPath(activeProjectId, "comparison"));
      return;
    }
    if (action === "ahp") {
      openComparisonAHP();
      return;
    }
    if (!activeProjectId) return;
    const context = { projectId: activeProjectId, datasetId: uploadedDataset?.datasetId ?? null };
    const stage = deriveComparisonDecisionStage({
      comparison: comparisonOptimization,
      ahp: comparisonAhp,
      promethee,
      context,
      comparisonRunning: ["submitting", "queued", "running", "cancelling"].includes(comparisonRunState.phase),
    });
    navigate(projectOptimizationPath(
      activeProjectId,
      destinationForComparisonDecisionStage(stage),
    ));
  }, [activeProjectId, activeRunMode, comparisonAhp, comparisonOptimization, comparisonRunState.phase, navigate, openActiveOptimization, openComparisonAHP, promethee, uploadedDataset?.datasetId]);

  const handleDashboardViewRun = useCallback((mode: "Single Optimization" | "Battery Comparison") => {
    setMobileOpen(false);
    if (activeRunMode) {
      openActiveOptimization();
      return;
    }
    if (mode === "Battery Comparison") {
      if (activeProjectId) navigate(projectOptimizationPath(activeProjectId, "comparison"));
      return;
    }
    if (activeProjectId) navigate(projectOptimizationPath(activeProjectId, "single-run"));
  }, [activeProjectId, activeRunMode, navigate, openActiveOptimization]);

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
    setComparisonAhp(
      nextState.comparisonAhp && activeProjectId && comparisonOptimization
        ? linkAHPStateToComparison(nextState.comparisonAhp, {
            projectId: activeProjectId,
            datasetId: uploadedDataset?.datasetId ?? null,
            comparisonRevision: comparisonOptimization.revision,
          })
        : nextState.comparisonAhp,
    );
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

  const dashboardModel = useMemo(
    () => buildDashboardModel({
      projectId: activeProjectId,
      activeDatasetId: uploadedDataset?.datasetId ?? null,
      dataset: uploadedDataset,
      singleRun: singleOptimizationRunState,
      comparisonRun: comparisonRunState,
      comparison: comparisonOptimization,
      ahp: comparisonAhp,
      promethee,
      restoredFromMongo,
      persistenceStatus,
    }),
    [
      activeProjectId,
      comparisonAhp,
      comparisonOptimization,
      comparisonRunState,
      persistenceStatus,
      promethee,
      restoredFromMongo,
      singleOptimizationRunState,
      uploadedDataset,
    ],
  );

  const activeProject = useMemo(
    () => projects.find((project) => project.project_id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );

  const sidebar = (
    authState.status === "authenticated" ? (
      <SidebarContent
        activePage={activePage}
        onNavigate={handleNavigate}
        user={authState.user}
        hasActiveProject={Boolean(activeProject)}
        onLogout={() => void handleLogout()}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
      />
    ) : null
  );

  const mobileSidebar = (
    authState.status === "authenticated" ? (
      <SidebarContent
        activePage={activePage}
        onNavigate={(page) => { setMobileOpen(nextMobileDrawerState("navigate")); handleNavigate(page); }}
        user={authState.user}
        hasActiveProject={Boolean(activeProject)}
        onLogout={() => void handleLogout()}
        collapsed={false}
        onToggleCollapsed={() => setMobileOpen(false)}
      />
    ) : null
  );

  if (authState.status === "loading" && !isPublicApplicationRoute(applicationRoute)) {
    return (
      <Box sx={{ display: "grid", minHeight: "100vh", placeItems: "center", bgcolor: "background.default" }}>
        <Typography variant="body1" color="text.secondary">Checking session...</Typography>
      </Box>
    );
  }

  if (isPublicApplicationRoute(applicationRoute) || authState.status !== "authenticated") {
    return (
      <>
        <Suspense fallback={<LoadingContent />}>
          <LandingPage
            authenticated={authState.status === "authenticated"}
            displayName={authState.status === "authenticated" ? authState.user.display_name : null}
            onOpenAuth={handleOpenAuth}
            onOpenWorkspace={handleOpenWorkspace}
            onViewProjects={handleViewProjects}
          />
        </Suspense>
        <Dialog
          open={authDialogOpen}
          onClose={() => navigate("/")}
          fullScreen={authDialogFullScreen}
          fullWidth
          maxWidth="lg"
          aria-labelledby="authentication-dialog-title"
          slotProps={{
            paper: {
              sx: {
                borderRadius: authDialogFullScreen ? 0 : "28px",
                overflow: "hidden",
                background: "#0D1D2D",
              },
            },
          }}
        >
          <DialogTitle
            component="div"
            sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 0 }}
          >
            <Typography id="authentication-dialog-title" component="h2" variant="h6" sx={{ fontWeight: 900 }}>
              {authDialogMode === "login" ? "Login" : "Create Account"}
            </Typography>
            <IconButton aria-label="Close authentication" onClick={() => navigate("/")}>
              <CloseRoundedIcon />
            </IconButton>
          </DialogTitle>
          <DialogContent sx={{ p: 0 }}>
            <Suspense fallback={<LoadingContent />}>
              <AuthPage
                embedded
                initialMode={authDialogMode}
                onAuthenticated={handleAuthenticatedFromLanding}
                onModeChange={(mode) => {
                  setAuthDialogMode(mode);
                  navigate(mode === "login" ? "/login" : "/register", { replace: true });
                }}
                serviceError={authRestoreError}
              />
            </Suspense>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  const optimizationRouteVisibleWhileLoading =
    applicationRoute.kind === "project"
    && optimizationStepForSurface(applicationRoute.surface) !== null;

  if (!workspaceReady && !optimizationRouteVisibleWhileLoading) {
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
          width: { md: `calc(100% - ${sidebarCollapsed ? COLLAPSED_DRAWER_WIDTH : DRAWER_WIDTH}px)` },
          ml: { md: `${sidebarCollapsed ? COLLAPSED_DRAWER_WIDTH : DRAWER_WIDTH}px` },
          color: "text.primary",
          bgcolor: "rgba(7,17,29,.88)",
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
            onClick={() => setMobileOpen(nextMobileDrawerState("open"))}
            sx={{ mr: 1.5, display: { md: "none" } }}
          >
            <MenuRoundedIcon />
          </IconButton>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.15 }}>
              {activePage}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {activeProject?.name ?? "Project workspace"}
            </Typography>
          </Box>
          {activeProject && activePage !== "My Projects" ? (
            <Button
              size="small"
              variant="text"
              startIcon={<FolderRoundedIcon />}
              onClick={() => navigate("/projects")}
              sx={{ mr: 1, display: { xs: "none", sm: "inline-flex" } }}
            >
              {activeProject.name} · Switch
            </Button>
          ) : null}
          {activeProject && uploadedDataset ? <Chip
            label={uploadedDataset.status === "expired" ? "Dataset expired" : "Dataset ready"}
            size="small"
            color={uploadedDataset.status === "expired" ? "warning" : "success"}
            variant="outlined"
            sx={{ display: { xs: "none", lg: "inline-flex" }, mr: 1, fontWeight: 750 }}
          /> : null}
          {dashboardModel.activeJob ? <Chip
            label={`${dashboardModel.activeJob.status} · ${dashboardModel.activeJob.progressPercent.toFixed(0)}%`}
            size="small"
            color="info"
            clickable
            onClick={openActiveOptimization}
            title="View running optimization"
            sx={{ display: { xs: "none", lg: "inline-flex" }, mr: 1, fontWeight: 750 }}
          /> : null}
          <Chip
            icon={
              activePage === "Dispatch" ? (
                <BoltRoundedIcon />
              ) : activePage === "My Projects" ? (
                <FolderRoundedIcon />
              ) : activePage === "Data Upload" ? (
                <CloudUploadRoundedIcon />
              ) : activePage === "Optimization" ? (
                <AutoGraphRoundedIcon />
              ) : activePage === "Dashboard" ? (
                <DashboardRoundedIcon />
              ) : activePage === "Results" ? (
                <AssessmentRoundedIcon />
              ) : activePage === "Documentation" ? (
                <DescriptionRoundedIcon />
              ) : (
                <ScaleRoundedIcon />
              )
            }
            label={
              activePage === "Dispatch"
                ? "Default strategy"
                : activePage === "My Projects"
                  ? `${projects.length} project${projects.length === 1 ? "" : "s"}`
                : activePage === "Data Upload"
                  ? "Annual dataset"
                  : activePage === "Optimization"
                    ? "Mode setup"
                    : activePage === "Dashboard"
                      ? "Workspace overview"
                    : activePage === "Results"
                      ? "Final decision"
                    : activePage === "Documentation"
                      ? "External user guide"
                    : "Reference setup"
            }
            size="small"
            sx={{
              display: { xs: "none", sm: "inline-flex" },
              bgcolor: "rgba(155,239,74,.08)",
              color: "primary.main",
              fontWeight: 750,
              "& .MuiChip-icon": { color: "inherit" },
            }}
          />
          <Stack direction="row" spacing={1} sx={{ ml: 1.25, alignItems: "center" }}>
            <Avatar sx={{ width: 32, height: 32, bgcolor: "primary.main", color: "primary.contrastText", fontSize: 12, fontWeight: 900 }}>
              {authState.user.display_name.slice(0, 2).toUpperCase()}
            </Avatar>
            <Typography variant="caption" sx={{ display: { xs: "none", xl: "block" }, fontWeight: 800 }}>
              {authState.user.display_name}
            </Typography>
          </Stack>
        </Toolbar>
      </AppBar>

      <Box component="nav" aria-label="Primary navigation" sx={{ width: { md: sidebarCollapsed ? COLLAPSED_DRAWER_WIDTH : DRAWER_WIDTH }, flexShrink: { md: 0 }, transition: "width 180ms ease" }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(nextMobileDrawerState("close"))}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: "block", md: "none" },
            "& .MuiDrawer-paper": {
              width: DRAWER_WIDTH,
              boxSizing: "border-box",
              bgcolor: "#081522",
              borderRight: 0,
            },
          }}
        >
          {mobileSidebar}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: "none", md: "block" },
            "& .MuiDrawer-paper": {
              width: sidebarCollapsed ? COLLAPSED_DRAWER_WIDTH : DRAWER_WIDTH,
              boxSizing: "border-box",
              bgcolor: "#081522",
              borderRight: 0,
              transition: "width 180ms ease",
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
          width: { xs: "100%", md: `calc(100% - ${sidebarCollapsed ? COLLAPSED_DRAWER_WIDTH : DRAWER_WIDTH}px)` },
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
          {activeProject && !uploadedDataset && activePage === "Dashboard" && window.localStorage.getItem(getWorkspaceIdStorageKey()) ? (
            <Alert
              severity="info"
              sx={{ mb: 2.5, borderRadius: "16px" }}
              action={<Button color="inherit" size="small" onClick={() => void handleImportPreviousWorkspace()}>Import Previous Workspace</Button>}
            >
              A previous anonymous workspace is available for one-time import.
            </Alert>
          ) : null}
          {activePage !== "Dashboard" && activePage !== "My Projects" ? <Paper elevation={0} sx={{ mb: 2.5, p: { xs: 1.6, sm: 2.1 }, borderRadius: "16px", border: "1px solid", borderColor: "divider", bgcolor: "rgba(13,29,45,.78)" }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}>
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>Workspace status</Typography>
              </Box>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Chip
                  size="small"
                  label={`Persistence: ${persistenceStatus === "saving" ? "Saving…" : persistenceStatus === "saved" ? "Saved" : persistenceStatus === "failed" ? "Save failed" : "Local"}`}
                  color={persistenceStatus === "saved" ? "success" : persistenceStatus === "failed" ? "warning" : "default"}
                  variant="outlined"
                  onClick={persistenceStatus === "failed" ? () => setPersistenceRetry((value) => value + 1) : undefined}
                  title={persistenceStatus === "failed" ? "Select to retry workspace persistence." : undefined}
                />
                <Chip size="small" label={`Dataset: ${workspaceStatus.datasetStatus}`} color={workspaceStatus.datasetStatus === "Available" ? "success" : "default"} variant="outlined" />
                <Chip size="small" label={`Optimization: ${workspaceStatus.optimizationStatus}`} color={workspaceStatus.optimizationStatus === "Completed" ? "success" : workspaceStatus.optimizationStatus === "Running" ? "info" : workspaceStatus.optimizationStatus === "Expired" ? "warning" : "default"} variant="outlined" />
                <Chip size="small" label={`Profiles: ${workspaceStatus.profilesStatus}`} color={workspaceStatus.profilesStatus === "Available" ? "success" : workspaceStatus.profilesStatus === "Error" ? "error" : "default"} variant="outlined" />
              </Stack>
            </Stack>
          </Paper> : null}
          {activePage === "My Projects" ? (
            <Suspense fallback={<LoadingContent />}>
              <ProjectsPage
                projects={projects}
                loading={projectsLoading}
                error={projectsError}
                onCreate={handleCreateProject}
                onUpdate={handleUpdateProject}
                onDelete={handleDeleteProject}
                onOpen={handleOpenProject}
                openingProjectId={openingProjectId}
                activeProjectId={activeProjectId}
                activeWorkflowStatus={dashboardModel.promethee.status === "Current" ? "Decision ready" : dashboardModel.activeJob?.status ?? "Ready"}
              />
            </Suspense>
          ) : null}
          {activePage === "Dashboard" ? (
            <Suspense fallback={<LoadingContent />}>
              <DashboardPage
                projectName={activeProject?.name ?? "Project"}
                displayName={authState.user.display_name}
                model={dashboardModel}
                onAction={handleDashboardAction}
                onViewRun={handleDashboardViewRun}
              />
            </Suspense>
          ) : null}
          {activePage === "Documentation" ? (
            <Suspense fallback={<LoadingContent />}>
              <DocumentationPage />
            </Suspense>
          ) : null}
          {activeProject ? <Box sx={{ display: activePage === "Optimization" ? "block" : "none" }}>
            <Suspense fallback={<LoadingContent />}>
              <OptimizationPage
                projectId={activeProjectId!}
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
                projectReady={workspaceReady}
                comparisonRunPhase={comparisonRunState.phase}
                onOpenComparisonMode={() => {
                  if (activeRunMode) {
                    openActiveOptimization();
                    return;
                  }
                  navigate(projectOptimizationPath(activeProjectId!, "comparison"));
                }}
                onViewActiveRun={openActiveOptimization}
                onViewResults={() => navigate(projectApplicationPath(activeProjectId!, "results"))}
                onStepChange={(step) => {
                  const surface = step === "mode-selection"
                    ? "optimization"
                    : step;
                  navigate(projectOptimizationPath(activeProjectId!, surface));
                }}
                onStateChange={handleOptimizationStateChange}
              />
            </Suspense>
          </Box> : null}
          {activePage === "Data Upload" ? (
            <Suspense fallback={<LoadingContent />}>
              <DataUploadPage
                projectId={activeProjectId!}
                dataset={uploadedDataset}
                projectDatasets={projectDatasets}
                selectedDate={datasetExplorerDate}
                onDatasetUploaded={(dataset) => {
                  setProjects((current) => current.map((project) => project.project_id === activeProjectId ? { ...project, active_dataset_id: dataset.datasetId } : project));
                  setUploadedDataset(dataset);
                  setDatasetExplorerDate(dataset.startDate);
                  setSingleOptimizationRunState(INITIAL_PERSISTED_WORKSPACE_STATE.runState);
                  setComparisonOptimization((current) => current ? { ...current, stale: true } : null);
                  setComparisonAhp((current) => current ? { ...current, accepted: false } : null);
                  setPromethee((current) => current ? { ...current, stale: true } : null);
                  void listProjectDatasets(activeProjectId!).then(setProjectDatasets).catch(() => undefined);
                  void getProjectWorkspace(activeProjectId!).then((snapshot) => {
                    workspaceRevisionRef.current = snapshot.revision;
                  }).catch(() => undefined);
                }}
                onSelectedDateChange={setDatasetExplorerDate}
                onDatasetExpired={(datasetId) => {
                  setUploadedDataset((current) => current?.datasetId === datasetId
                    ? { ...current, status: "expired" }
                    : current);
                }}
                onUseDataset={(datasetId) => {
                  void activateProjectDataset(activeProjectId!, datasetId)
                    .then(() => getProjectWorkspace(activeProjectId!))
                    .then((snapshot) => {
                      setProjects((current) => current.map((project) => project.project_id === activeProjectId ? { ...project, active_dataset_id: datasetId } : project));
                      const state = snapshot.state as Partial<PersistedWorkspaceState>;
                      const selectedDataset = state.dataset
                        ?? (projectDatasets.find((dataset) => dataset.dataset_id === datasetId)
                          ? projectDatasetToWorkspace(projectDatasets.find((dataset) => dataset.dataset_id === datasetId)!)
                          : null);
                      setUploadedDataset(selectedDataset);
                      setDatasetExplorerDate(selectedDataset?.startDate ?? null);
                      setSingleOptimizationRunState(INITIAL_PERSISTED_WORKSPACE_STATE.runState);
                      setComparisonOptimization((current) => current ? { ...current, stale: true } : null);
                      setComparisonAhp((current) => current ? { ...current, accepted: false } : null);
                      setPromethee((current) => current ? { ...current, stale: true } : null);
                      workspaceRevisionRef.current = snapshot.revision;
                    })
                    .catch((error) => setRestoreError(error instanceof Error ? error.message : "Dataset could not be activated."));
                }}
                onRemoveDataset={(datasetId) => {
                  void removeProjectDataset(activeProjectId!, datasetId)
                    .then(() => listProjectDatasets(activeProjectId!))
                    .then((datasets) => {
                      setProjectDatasets(datasets);
                      if (uploadedDataset?.datasetId === datasetId) {
                        setProjects((current) => current.map((project) => project.project_id === activeProjectId
                          ? { ...project, active_dataset_id: null }
                          : project));
                        setUploadedDataset(null);
                        setDatasetExplorerDate(null);
                        setSingleOptimizationRunState(INITIAL_PERSISTED_WORKSPACE_STATE.runState);
                        invalidateComparisonScience();
                      }
                    })
                    .catch((error) => setRestoreError(error instanceof Error ? error.message : "Dataset could not be removed."));
                }}
              />
            </Suspense>
          ) : activePage === "Dispatch" ? (
            <DispatchStrategyPage
              persistedStrategy={workspaceDispatchStrategy}
              onStrategyChange={setWorkspaceDispatchStrategy}
            />
          ) : null}
          {activeProject ? <Box sx={{ display: activePage === "Comparison Mode" || activePage === "Results" ? "block" : "none" }}>
            {applicationRoute.kind === "project" && applicationRoute.surface === "results" ? (
              <Suspense fallback={<LoadingContent />}>
                <ProjectResultsPage
                  projectId={activeProjectId!}
                  activeDatasetId={uploadedDataset?.datasetId ?? null}
                  singleRun={singleOptimizationRunState}
                  comparison={comparisonOptimization}
                  ahp={comparisonAhp}
                  promethee={promethee}
                  onViewSingleRun={() => navigate(projectOptimizationPath(activeProjectId!, singleOptimizationRunState.phase === "ready" ? "optimization" : "single-run"))}
                  onContinueDecision={() => {
                    const stage = deriveComparisonDecisionStage({
                      comparison: comparisonOptimization,
                      ahp: comparisonAhp,
                      promethee,
                      context: { projectId: activeProjectId!, datasetId: uploadedDataset?.datasetId ?? null },
                      comparisonRunning: ["submitting", "queued", "running", "cancelling"].includes(comparisonRunState.phase),
                    });
                    navigate(projectOptimizationPath(activeProjectId!, destinationForComparisonDecisionStage(stage)));
                  }}
                  onOpenDetailedDecision={() => navigate(projectOptimizationPath(activeProjectId!, "comparison-results"))}
                />
              </Suspense>
            ) : applicationRoute.kind === "project" && applicationRoute.surface === "comparison-ahp" ? (
              comparisonOptimization
              && !comparisonOptimization.stale
              && comparisonOptimization.projectId === activeProjectId
              && comparisonOptimization.datasetId === (uploadedDataset?.datasetId ?? null)
                ? (
                  <Suspense fallback={<LoadingContent />}>
                    <ComparisonAHPConfiguration
                      workspaceState={comparisonAhp}
                      onWorkspaceStateChange={(state) => {
                        setComparisonAhp(linkAHPStateToComparison(state, {
                          projectId: activeProjectId!,
                          datasetId: uploadedDataset?.datasetId ?? null,
                          comparisonRevision: comparisonOptimization.revision,
                        }));
                        setPromethee((current) => current ? { ...current, stale: true } : current);
                      }}
                      onBack={() => navigate(projectOptimizationPath(activeProjectId!, "comparison"))}
                      onContinue={(state) => {
                        setComparisonAhp(linkAHPStateToComparison(state, {
                          projectId: activeProjectId!,
                          datasetId: uploadedDataset?.datasetId ?? null,
                          comparisonRevision: comparisonOptimization.revision,
                        }));
                        setPromethee(null);
                        navigate(projectOptimizationPath(activeProjectId!, "comparison-recommendation"));
                      }}
                    />
                  </Suspense>
                )
                : (
                  <Alert
                    severity="warning"
                    action={<Button color="inherit" onClick={() => navigate(projectOptimizationPath(activeProjectId!, "comparison"))}>Back to Comparison</Button>}
                  >
                    A current completed comparison is required before configuring AHP.
                  </Alert>
                )
            ) : applicationRoute.kind === "project" && applicationRoute.surface === "comparison-recommendation" ? (
              <Suspense fallback={<LoadingContent />}>
                <ComparisonRecommendationPage
                  projectId={activeProjectId!}
                  datasetId={uploadedDataset?.datasetId ?? null}
                  comparison={comparisonOptimization}
                  ahp={comparisonAhp}
                  promethee={promethee}
                  onPrometheeChange={(state) => setPromethee(state)}
                  onBackToSummary={() => navigate(projectOptimizationPath(activeProjectId!, "comparison"))}
                  onBackToAHP={openComparisonAHP}
                  onViewDetails={() => navigate(projectOptimizationPath(activeProjectId!, "comparison-results"))}
                  onReturnDashboard={() => navigate(projectApplicationPath(activeProjectId!))}
                  onEditComparison={() => navigate(projectOptimizationPath(activeProjectId!, "comparison"))}
                />
              </Suspense>
            ) : applicationRoute.kind === "project" && applicationRoute.surface === "comparison-results" ? (
              <Suspense fallback={<LoadingContent />}>
                <ComparisonResultsPage
                  comparison={comparisonOptimization}
                  ahp={comparisonAhp}
                  promethee={promethee}
                  projectId={activeProjectId!}
                  datasetId={uploadedDataset?.datasetId ?? null}
                  onBackToAHP={openComparisonAHP}
                  onBackToRecommendation={() => navigate(projectOptimizationPath(activeProjectId!, "comparison-recommendation"))}
                  onBackToSummary={() => navigate(projectOptimizationPath(activeProjectId!, "comparison"))}
                  onReturnDashboard={() => navigate(projectApplicationPath(activeProjectId!))}
                />
              </Suspense>
            ) : (
              <ComparisonModePage
                projectId={activeProjectId!}
                dataset={uploadedDataset}
                dispatchStrategy={workspaceDispatchStrategy}
                comparisonConfiguration={comparisonConfiguration}
                comparisonRunState={comparisonRunState}
                comparisonOptimization={comparisonOptimization}
                comparisonAhp={comparisonAhp}
                promethee={promethee}
                onComparisonConfigurationChange={setComparisonConfiguration}
                onComparisonRunStateChange={setComparisonRunState}
                onComparisonCompleted={(comparison) => setComparisonOptimization({
                  ...comparison,
                  projectId: activeProjectId ?? undefined,
                  datasetId: uploadedDataset?.datasetId,
                })}
                onInvalidateScientificState={invalidateComparisonScience}
                onOpenAHP={openComparisonAHP}
                onOpenResults={() => {
                  const stage = deriveComparisonDecisionStage({
                    comparison: comparisonOptimization,
                    ahp: comparisonAhp,
                    promethee,
                    context: {
                      projectId: activeProjectId!,
                      datasetId: uploadedDataset?.datasetId ?? null,
                    },
                  });
                  navigate(projectOptimizationPath(
                    activeProjectId!,
                    destinationForComparisonDecisionStage(stage),
                  ));
                }}
                onOpenDetailedResults={() => navigate(projectOptimizationPath(activeProjectId!, "comparison-results"))}
                onRunnerClose={() => navigate(projectOptimizationPath(activeProjectId!))}
                onViewDashboard={() => navigate(projectApplicationPath(activeProjectId!))}
                startBlockedReason={activeRunMode === "single" ? activeRunMessage : null}
                onViewActiveRun={openActiveOptimization}
              />
            )}
          </Box> : null}
        </Box>
      </Box>
    </Box>
  );
}
