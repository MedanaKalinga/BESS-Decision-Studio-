import { lazy, Suspense, useEffect, useState } from "react";
import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import BatteryChargingFullRoundedIcon from "@mui/icons-material/BatteryChargingFullRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import CompareArrowsRoundedIcon from "@mui/icons-material/CompareArrowsRounded";
import EmojiEventsRoundedIcon from "@mui/icons-material/EmojiEventsRounded";
import InsightsRoundedIcon from "@mui/icons-material/InsightsRounded";
import PsychologyRoundedIcon from "@mui/icons-material/PsychologyRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import type { SvgIconComponent } from "@mui/icons-material";
import { PageHeader, SurfaceCard } from "../components/ui";

import SingleBatteryConfiguration from "./SingleBatteryConfiguration";
import SingleOptimizationSetup from "./SingleOptimizationSetup";
import {
  activeOptimizationMessage,
  activeOptimizationMode,
  comparisonDisabledReason,
  type SingleOptimizationStep,
} from "../lib/optimizationWorkflow";
import { currentBatterySelectionId } from "../lib/batteryCatalogue";
import type {
  ComparisonRunPhase,
  SingleBatteryConfigurationSnapshot,
  ComparisonAHPWorkspaceState,
  SingleOptimizationRunWorkspaceState,
  SingleOptimizationSetupSnapshot,
  WorkspaceDatasetSummary,
  WorkspaceDispatchStrategy,
} from "../types/workspace";

const SingleOptimizationRun = lazy(() => import("./SingleOptimizationRun"));
const ComparisonAHPConfiguration = lazy(() => import("./ComparisonAHPConfiguration"));

type OptimizationMode = "single" | "comparison";

interface ModeDefinition {
  id: OptimizationMode;
  eyebrow: string;
  title: string;
  description: string;
  icon: SvgIconComponent;
  highlights: Array<{ icon: SvgIconComponent; label: string }>;
  exclusions?: string[];
}

interface BatteryOption {
  id: string;
  number: string;
  name: string;
  descriptor: string;
}

const MODES: ModeDefinition[] = [
  {
    id: "single",
    eyebrow: "Focused sizing",
    title: "Single Battery Optimization",
    description:
      "Choose one battery type and tune its operating design for the active energy dataset.",
    icon: BatteryChargingFullRoundedIcon,
    highlights: [
      { icon: TuneRoundedIcon, label: "BESS energy capacity" },
      { icon: BoltRoundedIcon, label: "Peak-support percentage" },
    ],
    exclusions: ["No AHP", "No PROMETHEE II"],
  },
  {
    id: "comparison",
    eyebrow: "Portfolio decision",
    title: "Battery Comparison",
    description:
      "Optimize every enabled battery independently, then rank the resulting designs through the decision framework.",
    icon: CompareArrowsRoundedIcon,
    highlights: [
      { icon: PsychologyRoundedIcon, label: "Fixed-type GA per battery" },
      { icon: InsightsRoundedIcon, label: "AHP + PROMETHEE II ranking" },
      { icon: EmojiEventsRoundedIcon, label: "Final battery recommendation" },
    ],
  },
];

const BATTERIES: BatteryOption[] = [
  { id: "low-cost", number: "01", name: "Low-cost", descriptor: "Value-focused profile" },
  { id: "medium-low", number: "02", name: "Medium-low", descriptor: "Balanced entry profile" },
  { id: "medium", number: "03", name: "Medium", descriptor: "Performance balance" },
  { id: "high", number: "04", name: "High", descriptor: "Premium endurance profile" },
];

function ModeCard({
  mode,
  selected,
  onSelect,
  onConfigure,
  configureDisabled = false,
  disabledReason = null,
}: {
  mode: ModeDefinition;
  selected: boolean;
  onSelect: () => void;
  onConfigure: () => void;
  configureDisabled?: boolean;
  disabledReason?: string | null;
}) {
  const Icon = mode.icon;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  }

  return (
    <Paper
      component="div"
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      elevation={0}
      sx={{
        position: "relative",
        isolation: "isolate",
        overflow: "hidden",
        minHeight: { xs: 330, md: 360 },
        p: { xs: 2.5, sm: 3.25 },
        cursor: "pointer",
        borderRadius: "28px",
        border: "1px solid",
        borderColor: selected ? "primary.main" : "divider",
        background: selected
          ? "linear-gradient(145deg, rgba(155,239,74,.09), rgba(76,141,255,.06))"
          : "#0D1D2D",
        boxShadow: selected
          ? "0 20px 52px rgba(13, 148, 136, 0.16)"
          : "0 8px 28px rgba(15, 53, 70, 0.06)",
        transform: selected ? "translateY(-4px)" : "translateY(0)",
        transition:
          "transform 220ms ease, box-shadow 220ms ease, border-color 220ms ease, background 220ms ease",
        outline: "none",
        "&::after": {
          content: '\"\"',
          position: "absolute",
          zIndex: -1,
          width: 210,
          height: 210,
          borderRadius: "50%",
          top: -105,
          right: -62,
          background: selected
            ? "radial-gradient(circle, rgba(20,184,166,0.18), rgba(59,130,246,0.03) 70%)"
            : "radial-gradient(circle, rgba(37,99,235,0.08), transparent 70%)",
          transition: "transform 260ms ease",
        },
        "&:hover": {
          transform: "translateY(-6px)",
          borderColor: selected ? "primary.main" : "rgba(155,239,74,.32)",
          boxShadow: "0 24px 56px rgba(15, 75, 91, 0.14)",
          "&::after": { transform: "scale(1.12)" },
        },
        "&:focus-visible": {
          boxShadow: "0 0 0 4px rgba(13,148,136,0.19), 0 20px 52px rgba(13,148,136,0.14)",
        },
        "@media (prefers-reduced-motion: reduce)": {
          transition: "none",
          transform: "none",
          "&:hover": { transform: "none" },
        },
      }}
    >
      <Stack sx={{ height: "100%" }}>
        <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <Box
            sx={{
              width: 64,
              height: 64,
              display: "grid",
              placeItems: "center",
              borderRadius: "20px",
              color: "#07111D",
              background: "linear-gradient(135deg, #9BEF4A, #4C8DFF)",
              boxShadow: "0 14px 30px rgba(0,0,0,.25)",
            }}
          >
            <Icon sx={{ fontSize: 32 }} />
          </Box>
          <Box
            aria-hidden="true"
            sx={{
              display: "grid",
              placeItems: "center",
              width: 28,
              height: 28,
              borderRadius: "50%",
              color: selected ? "#07111D" : "transparent",
              bgcolor: selected ? "primary.main" : "transparent",
              border: "2px solid",
              borderColor: selected ? "#0d9488" : "#cbd8df",
              transition: "all 180ms ease",
            }}
          >
            <CheckCircleRoundedIcon sx={{ fontSize: 19 }} />
          </Box>
        </Stack>

        <Typography
          variant="overline"
          sx={{ mt: 3, color: "primary.main", fontWeight: 850, letterSpacing: "0.11em" }}
        >
          {mode.eyebrow}
        </Typography>
        <Typography
          variant="h4"
          sx={{ mt: 0.5, fontSize: { xs: 25, sm: 29 }, lineHeight: 1.14, fontWeight: 850 }}
        >
          {mode.title}
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 1.25, lineHeight: 1.7, maxWidth: 560 }}>
          {mode.description}
        </Typography>

        <Stack spacing={1.05} sx={{ mt: 2.5 }}>
          {mode.highlights.map(({ icon: HighlightIcon, label }) => (
            <Stack key={label} direction="row" spacing={1.2} sx={{ alignItems: "center" }}>
              <Box
                sx={{
                  display: "grid",
                  placeItems: "center",
                  width: 32,
                  height: 32,
                  flexShrink: 0,
                  borderRadius: "10px",
                  color: "primary.main",
                  bgcolor: "rgba(155,239,74,.08)",
                }}
              >
                <HighlightIcon sx={{ fontSize: 18 }} />
              </Box>
              <Typography variant="body2" sx={{ color: "text.primary", fontWeight: 720 }}>
                {label}
              </Typography>
            </Stack>
          ))}
        </Stack>

        {mode.exclusions && (
          <Stack direction="row" useFlexGap spacing={0.9} sx={{ mt: "auto", pt: 2.5, flexWrap: "wrap" }}>
            {mode.exclusions.map((label) => (
              <Chip
                key={label}
                size="small"
                label={label}
                sx={{ bgcolor: "rgba(255,255,255,.05)", color: "text.secondary", fontWeight: 750 }}
              />
            ))}
          </Stack>
        )}

        {!mode.exclusions && (
          <Stack direction="row" spacing={1} sx={{ mt: "auto", pt: 2.5, alignItems: "center" }}>
            <Box sx={{ display: "flex", ml: 0.2 }}>
              {BATTERIES.map((battery, index) => (
                <Box
                  key={battery.id}
                  sx={{
                    display: "grid",
                    placeItems: "center",
                    width: 31,
                    height: 31,
                    ml: index === 0 ? 0 : -0.7,
                    borderRadius: "50%",
                    color: index % 2 === 0 ? "primary.main" : "secondary.main",
                    bgcolor: "#081522",
                    border: "2px solid #0D1D2D",
                    fontSize: 10,
                    fontWeight: 850,
                  }}
                >
                  {battery.number}
                </Box>
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
              All enabled battery types
            </Typography>
          </Stack>
        )}

        <Button
          type="button"
          variant="contained"
          endIcon={<ArrowForwardRoundedIcon />}
          disabled={configureDisabled}
          onClick={(event) => {
            event.stopPropagation();
            onConfigure();
          }}
          sx={{
            mt: 2.25,
            alignSelf: "stretch",
            py: 1.15,
            borderRadius: "13px",
            background: "linear-gradient(100deg, #9BEF4A, #83D63B)",
            color: "#07111D",
          }}
        >
          {mode.id === "single"
            ? "Configure Single Optimization"
            : "Configure Battery Comparison"}
        </Button>
        {disabledReason ? (
          <Typography
            variant="caption"
            role="status"
            sx={{ mt: 0.8, minHeight: 20, color: "warning.main", fontWeight: 750 }}
          >
            {disabledReason}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}

function BatterySelector({
  selectedBattery,
  onSelect,
}: {
  selectedBattery: string | null;
  onSelect: (batteryId: string) => void;
}) {
  return (
    <Paper
      component="section"
      aria-labelledby="battery-selector-title"
      elevation={0}
      sx={{
        p: { xs: 2.25, sm: 3 },
        borderRadius: "24px",
        border: "1px solid #dce7ec",
        background: "linear-gradient(135deg, #f8fffd 0%, #f7fbff 100%)",
      }}
    >
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1}
        sx={{ justifyContent: "space-between", alignItems: { md: "center" } }}
      >
        <Box>
          <Typography id="battery-selector-title" variant="h6" sx={{ color: "#173744", fontWeight: 820 }}>
            Select the battery to optimize
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
            The GA keeps this battery type fixed.
          </Typography>
        </Box>
        <Chip label="Required for this mode" size="small" sx={{ alignSelf: { xs: "flex-start", md: "center" }, fontWeight: 750 }} />
      </Stack>

      <Box
        role="radiogroup"
        aria-label="Battery type"
        sx={{
          mt: 2.25,
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", xl: "repeat(4, minmax(0, 1fr))" },
          gap: 1.2,
        }}
      >
        {BATTERIES.map((battery) => {
          const selected = selectedBattery === battery.id;
          return (
            <Box
              key={battery.id}
              component="button"
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(battery.id)}
              sx={{
                appearance: "none",
                width: "100%",
                p: 1.5,
                display: "flex",
                alignItems: "center",
                gap: 1.25,
                cursor: "pointer",
                textAlign: "left",
                borderRadius: "17px",
                border: "1px solid",
                borderColor: selected ? "#0d9488" : "#d9e3e8",
                color: "inherit",
                bgcolor: selected ? "#ecfdf8" : "#fff",
                boxShadow: selected ? "0 9px 24px rgba(13,148,136,0.12)" : "none",
                transition: "all 180ms ease",
                "&:hover": { borderColor: "#5abbb0", transform: "translateY(-2px)" },
                "&:focus-visible": { outline: "3px solid rgba(13,148,136,0.21)", outlineOffset: 2 },
              }}
            >
              <Box
                sx={{
                  display: "grid",
                  placeItems: "center",
                  width: 40,
                  height: 40,
                  flexShrink: 0,
                  borderRadius: "12px",
                  color: selected ? "#fff" : "#0f766e",
                  bgcolor: selected ? "#0d9488" : "#e4f7f3",
                  fontSize: 12,
                  fontWeight: 850,
                }}
              >
                {battery.number}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ color: "#183946", fontWeight: 820 }}>
                  {battery.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {battery.descriptor}
                </Typography>
              </Box>
              {selected && <CheckCircleRoundedIcon sx={{ ml: "auto", color: "#0d9488", fontSize: 20 }} />}
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}

export default function OptimizationPage({
  projectId,
  dataset,
  dispatchStrategy,
  onGoToDataUpload,
  onReviewDispatchStrategy,
  runState,
  setRunState,
  selectedMode: initialMode,
  selectedBatteryId: initialBatteryId,
  batteryConfiguration: initialBatteryConfiguration,
  setupConfiguration: initialSetupConfiguration,
  activeStep: initialActiveStep,
  operationalProfileDate,
  onOperationalProfileDateChange,
  comparisonAhp: initialComparisonAhp,
  projectReady,
  comparisonRunPhase,
  onOpenComparisonMode,
  onViewActiveRun,
  onViewResults,
  onStepChange,
  onStateChange,
}: {
  projectId: string;
  dataset: WorkspaceDatasetSummary | null;
  dispatchStrategy: WorkspaceDispatchStrategy;
  onGoToDataUpload: () => void;
  onReviewDispatchStrategy: () => void;
  runState: SingleOptimizationRunWorkspaceState;
  setRunState: Dispatch<SetStateAction<SingleOptimizationRunWorkspaceState>>;
  selectedMode: "single" | "comparison" | null;
  selectedBatteryId: string | null;
  batteryConfiguration: SingleBatteryConfigurationSnapshot | null;
  setupConfiguration: SingleOptimizationSetupSnapshot | null;
  activeStep: string | null;
  operationalProfileDate: string | null;
  onOperationalProfileDateChange: (date: string | null) => void;
  comparisonAhp: ComparisonAHPWorkspaceState | null;
  projectReady: boolean;
  comparisonRunPhase: ComparisonRunPhase;
  onOpenComparisonMode: () => void;
  onViewActiveRun: () => void;
  onViewResults: () => void;
  onStepChange: (step: SingleOptimizationStep) => void;
  onStateChange: (state: {
    selectedMode: "single" | "comparison" | null;
    selectedBatteryId: string | null;
    batteryConfiguration: SingleBatteryConfigurationSnapshot | null;
    setupConfiguration: SingleOptimizationSetupSnapshot | null;
    activeStep: string | null;
    comparisonAhp: ComparisonAHPWorkspaceState | null;
  }) => void;
}) {
  const [selectedMode, setSelectedMode] = useState<OptimizationMode | null>(
    initialMode === "single" || initialMode === "comparison" ? initialMode : null,
  );
  const [selectedBattery, setSelectedBattery] = useState<string | null>(
    currentBatterySelectionId(initialBatteryId),
  );
  const [isReady, setIsReady] = useState(false);
  const [activeStep, setActiveStep] = useState<
    "mode-selection" | "single-configuration" | "single-setup" | "single-run" | "comparison-ahp"
  >(
    initialActiveStep === "single-configuration" || initialActiveStep === "single-setup" || initialActiveStep === "single-run" || initialActiveStep === "comparison-ahp"
      ? initialActiveStep
      : "mode-selection",
  );
  const [batteryConfiguration, setBatteryConfiguration] =
    useState<SingleBatteryConfigurationSnapshot | null>(initialBatteryConfiguration);
  const [setupConfiguration, setSetupConfiguration] =
    useState<SingleOptimizationSetupSnapshot | null>(initialSetupConfiguration);
  const [comparisonAhp, setComparisonAhp] =
    useState<ComparisonAHPWorkspaceState | null>(initialComparisonAhp);

  useEffect(() => {
    if (
      initialActiveStep === "mode-selection"
      || initialActiveStep === "single-configuration"
      || initialActiveStep === "single-setup"
      || initialActiveStep === "single-run"
      || initialActiveStep === "comparison-ahp"
    ) {
      setActiveStep(initialActiveStep);
    }
    if (initialMode === "single" || initialMode === "comparison") {
      setSelectedMode(initialMode);
    }
  }, [initialActiveStep, initialMode]);

  const canContinue =
    selectedMode === "comparison" || (selectedMode === "single" && selectedBattery !== null);
  const selectedBatteryName = BATTERIES.find((battery) => battery.id === selectedBattery)?.name;
  const activeRunMode = activeOptimizationMode(runState.phase, comparisonRunPhase);
  const activeRunReason = activeOptimizationMessage(activeRunMode);
  const comparisonReason = activeRunReason ?? comparisonDisabledReason({
    projectId,
    projectLoading: !projectReady,
    dataset,
    runPhase: comparisonRunPhase,
  });

  const persistState = (nextSelectedMode: OptimizationMode | null, nextSelectedBattery: string | null, nextBatteryConfiguration: SingleBatteryConfigurationSnapshot | null, nextSetupConfiguration: SingleOptimizationSetupSnapshot | null, nextActiveStep: "mode-selection" | "single-configuration" | "single-setup" | "single-run" | "comparison-ahp", nextComparisonAhp: ComparisonAHPWorkspaceState | null = comparisonAhp) => {
    onStateChange({
      selectedMode: nextSelectedMode,
      selectedBatteryId: nextSelectedBattery,
      batteryConfiguration: nextBatteryConfiguration,
      setupConfiguration: nextSetupConfiguration,
      activeStep: nextActiveStep,
      comparisonAhp: nextComparisonAhp,
    });
  };

  function chooseMode(mode: OptimizationMode) {
    setSelectedMode(mode);
    setIsReady(false);
    setActiveStep("mode-selection");
    persistState(mode, selectedBattery, batteryConfiguration, setupConfiguration, "mode-selection");
  }

  function chooseBattery(batteryId: string) {
    setSelectedBattery(batteryId);
    setIsReady(false);
    if (batteryId !== selectedBattery) {
      setBatteryConfiguration(null);
    }
    persistState(selectedMode, batteryId, batteryConfiguration, setupConfiguration, activeStep);
  }

  function continueFromModeSelection() {
    if (selectedMode === "single" && selectedBatteryName) {
      setActiveStep("single-configuration");
      persistState(selectedMode, selectedBattery, batteryConfiguration, setupConfiguration, "single-configuration");
      onStepChange("single-configuration");
      return;
    }
    if (selectedMode === "comparison" && !comparisonReason) {
      setActiveStep("mode-selection");
      persistState(selectedMode, selectedBattery, batteryConfiguration, setupConfiguration, "mode-selection");
      onOpenComparisonMode();
      return;
    }
    setIsReady(true);
  }

  function configureMode(mode: OptimizationMode) {
    chooseMode(mode);
    if (mode === "comparison") {
      if (!comparisonReason) onOpenComparisonMode();
      return;
    }
    if (selectedBatteryName) {
      setActiveStep("single-configuration");
      persistState("single", selectedBattery, batteryConfiguration, setupConfiguration, "single-configuration");
      onStepChange("single-configuration");
    }
  }

  if (activeStep === "comparison-ahp" && selectedMode === "comparison") {
    return (
      <Suspense fallback={<Paper variant="outlined" sx={{ p: 4, borderRadius: "24px" }}><Typography color="text.secondary">Loading AHP configuration…</Typography></Paper>}>
        <ComparisonAHPConfiguration
          workspaceState={comparisonAhp}
          onWorkspaceStateChange={(state) => {
            setComparisonAhp(state);
            persistState(selectedMode, selectedBattery, batteryConfiguration, setupConfiguration, "comparison-ahp", state);
          }}
          onBack={() => {
            setActiveStep("mode-selection");
            persistState(selectedMode, selectedBattery, batteryConfiguration, setupConfiguration, "mode-selection");
          }}
          onContinue={(state) => {
            setComparisonAhp(state);
            setIsReady(true);
            setActiveStep("mode-selection");
            persistState(selectedMode, selectedBattery, batteryConfiguration, setupConfiguration, "mode-selection", state);
          }}
        />
      </Suspense>
    );
  }

  if (activeStep !== "mode-selection" && selectedBatteryName) {
    return (
      <>
        <Box sx={{ display: activeStep === "single-configuration" ? "block" : "none" }}>
          <SingleBatteryConfiguration
            batteryName={selectedBatteryName}
            initialConfiguration={batteryConfiguration}
            onBack={(configuration) => {
              const preservedConfiguration = configuration ?? batteryConfiguration;
              if (configuration) setBatteryConfiguration(configuration);
              setActiveStep("mode-selection");
              persistState(selectedMode, selectedBattery, preservedConfiguration, setupConfiguration, "mode-selection");
              onStepChange("mode-selection");
            }}
            onContinue={(configuration) => {
              setBatteryConfiguration(configuration);
              setActiveStep("single-setup");
              persistState(selectedMode, selectedBattery, configuration, setupConfiguration, "single-setup");
              onStepChange("single-setup");
            }}
          />
        </Box>
        {batteryConfiguration && (
          <Box sx={{ display: activeStep === "single-setup" ? "block" : "none" }}>
            <SingleOptimizationSetup
              battery={batteryConfiguration}
              initialSetup={setupConfiguration}
              dataset={dataset}
              dispatchStrategy={dispatchStrategy}
              onBack={() => {
                setActiveStep("single-configuration");
                persistState(selectedMode, selectedBattery, batteryConfiguration, setupConfiguration, "single-configuration");
                onStepChange("single-configuration");
              }}
              onGoToDataUpload={onGoToDataUpload}
              onReviewDispatchStrategy={onReviewDispatchStrategy}
              onReadyToRun={(setup) => {
                if (activeRunMode) {
                  onViewActiveRun();
                  return;
                }
                setSetupConfiguration(setup);
                setRunState({
                  phase: "ready",
                  jobId: null,
                  latestJob: null,
                  error: null,
                  startedAt: null,
                  finishedAt: null,
                  reconnecting: false,
                });
                setActiveStep("single-run");
                persistState(selectedMode, selectedBattery, batteryConfiguration, setup, "single-run");
                onStepChange("single-run");
              }}
            />
          </Box>
        )}
        {batteryConfiguration && setupConfiguration && (
          <Box sx={{ display: activeStep === "single-run" ? "block" : "none" }}>
            <Suspense fallback={<Paper variant="outlined" sx={{ p: 4, borderRadius: "24px" }}><Typography color="text.secondary">Loading optimization run workspace…</Typography></Paper>}>
              <SingleOptimizationRun
                projectId={projectId}
                battery={batteryConfiguration}
                dataset={dataset}
                dispatchStrategy={dispatchStrategy}
                setup={setupConfiguration}
                runState={runState}
                setRunState={setRunState}
                onBackToSetup={() => {
                  setActiveStep("single-setup");
                  persistState(selectedMode, selectedBattery, batteryConfiguration, setupConfiguration, "single-setup");
                  onStepChange("single-setup");
                }}
                onAdjustSearchBounds={() => {
                  setActiveStep("single-setup");
                  persistState(selectedMode, selectedBattery, batteryConfiguration, setupConfiguration, "single-setup");
                  onStepChange("single-setup");
                }}
                startBlockedReason={activeRunMode === "comparison" ? activeRunReason : null}
                onViewActiveRun={onViewActiveRun}
                onViewResults={onViewResults}
                operationalProfileDate={operationalProfileDate}
                onOperationalProfileDateChange={onOperationalProfileDateChange}
              />
            </Suspense>
          </Box>
        )}
      </>
    );
  }

  return (
    <Stack spacing={2.5}>
      <PageHeader
        eyebrow="OPTIMIZATION"
        title="Choose an optimization workflow"
        subtitle="Size one battery or compare the enabled alternatives."
      />

      {activeRunReason ? (
        <Alert
          severity="info"
          action={<Button color="inherit" onClick={onViewActiveRun}>View Running Optimization</Button>}
          sx={{ borderRadius: "18px", alignItems: "center" }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>{activeRunReason}</Typography>
          <Typography variant="body2">Wait for it to finish or cancel it before starting another optimization.</Typography>
        </Alert>
      ) : null}

      <Box component="section" aria-labelledby="optimization-mode-title">
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ mb: 1.8, justifyContent: "space-between", alignItems: { sm: "flex-end" } }}
        >
          <Box>
            <Typography id="optimization-mode-title" variant="h5" sx={{ fontWeight: 850 }}>
              Select an optimization path
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.45 }}>
              Select a workflow.
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
            Step 1 of 2 - Mode selection
          </Typography>
        </Stack>

        <Box
          role="radiogroup"
          aria-label="Optimization mode"
          sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" }, gap: 2.25 }}
        >
          {MODES.map((mode) => (
            <ModeCard
              key={mode.id}
              mode={mode}
              selected={selectedMode === mode.id}
              onSelect={() => chooseMode(mode.id)}
              onConfigure={() => configureMode(mode.id)}
              configureDisabled={Boolean(activeRunReason) || (mode.id === "comparison" && Boolean(comparisonReason))}
              disabledReason={activeRunReason ?? (mode.id === "comparison" ? comparisonReason : null)}
            />
          ))}
        </Box>
      </Box>

      {selectedMode === "single" && (
        <BatterySelector selectedBattery={selectedBattery} onSelect={chooseBattery} />
      )}

      {selectedMode === "comparison" && (
        <Alert
          severity="info"
          icon={<CompareArrowsRoundedIcon />}
          sx={{ borderRadius: "18px" }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 820 }}>
            Comparison workflow selected
          </Typography>
          <Typography variant="body2">
            Configure criteria weights before ranking.
          </Typography>
          {comparisonAhp?.accepted && <Chip icon={<CheckCircleRoundedIcon />} label="AHP weights ready" size="small" color="success" sx={{ mt: 1.25, fontWeight: 800 }} />}
        </Alert>
      )}

      {(isReady || (selectedMode === "comparison" && comparisonAhp?.accepted)) && selectedMode && (
        <Alert
          severity="success"
          icon={<CheckCircleRoundedIcon />}
          sx={{ borderRadius: "18px" }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 820 }}>
            Optimization path prepared locally
          </Typography>
          <Typography variant="body2">
            {selectedMode === "single"
              ? `${selectedBatteryName} is selected for single-battery optimization.`
              : comparisonAhp?.accepted
                ? "AHP weights ready. The accepted judgments are saved in this browser workspace."
                : "Battery Comparison is selected for the future multi-battery workflow."} The GA has not been started.
          </Typography>
        </Alert>
      )}

      <SurfaceCard
        sx={{
          p: { xs: 2, sm: 2.25 },
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          gap: 1.5,
          alignItems: { sm: "center" },
          justifyContent: "space-between",
          borderRadius: "22px",
          borderColor: "divider",
        }}
      >
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 820 }}>
            {selectedMode ? "Ready to continue" : "Choose a mode to continue"}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Selection only; optimization does not start here.
          </Typography>
        </Box>
        <Button
          type="button"
          variant="contained"
          endIcon={<ArrowForwardRoundedIcon />}
          disabled={Boolean(activeRunReason) || !canContinue || (selectedMode === "comparison" && Boolean(comparisonReason))}
          onClick={continueFromModeSelection}
          sx={{
            minWidth: 154,
            alignSelf: { xs: "stretch", sm: "center" },
            px: 2.5,
            py: 1.15,
            borderRadius: "13px",
            fontWeight: 820,
            textTransform: "none",
            boxShadow: "0 10px 24px rgba(155,239,74,.12)",
          }}
        >
          {selectedMode === "comparison"
            ? "Configure Battery Comparison"
            : selectedMode === "single"
              ? "Configure Single Optimization"
              : "Continue"}
        </Button>
      </SurfaceCard>
    </Stack>
  );
}
