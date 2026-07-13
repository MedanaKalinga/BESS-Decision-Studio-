import { lazy, Suspense, useState } from "react";
import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
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

import SingleBatteryConfiguration from "./SingleBatteryConfiguration";
import SingleOptimizationSetup from "./SingleOptimizationSetup";
import type {
  SingleBatteryConfigurationSnapshot,
  SingleOptimizationRunWorkspaceState,
  SingleOptimizationSetupSnapshot,
  WorkspaceDatasetSummary,
  WorkspaceDispatchStrategy,
} from "../types/workspace";

const SingleOptimizationRun = lazy(() => import("./SingleOptimizationRun"));

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
  { id: "medium-high", number: "04", name: "Medium-high", descriptor: "Premium endurance profile" },
];

function ModeCard({
  mode,
  selected,
  onSelect,
}: {
  mode: ModeDefinition;
  selected: boolean;
  onSelect: () => void;
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
        minHeight: { xs: 380, md: 410 },
        p: { xs: 2.5, sm: 3.25 },
        cursor: "pointer",
        borderRadius: "28px",
        border: "1px solid",
        borderColor: selected ? "#0d9488" : "#dce5eb",
        background: selected
          ? "linear-gradient(145deg, #ecfdf8 0%, #eff8ff 58%, #ffffff 100%)"
          : "linear-gradient(145deg, #ffffff 0%, #f8fbfd 100%)",
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
          borderColor: selected ? "#0d9488" : "#9ccbc7",
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
              color: "#fff",
              background: "linear-gradient(135deg, #0f766e 0%, #0ea5a6 52%, #2563eb 120%)",
              boxShadow: "0 14px 30px rgba(15, 118, 110, 0.24)",
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
              color: selected ? "#fff" : "transparent",
              bgcolor: selected ? "#0d9488" : "#fff",
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
          sx={{ mt: 3, color: "#0f766e", fontWeight: 850, letterSpacing: "0.11em" }}
        >
          {mode.eyebrow}
        </Typography>
        <Typography
          variant="h4"
          sx={{ mt: 0.5, fontSize: { xs: 25, sm: 29 }, lineHeight: 1.14, fontWeight: 850, color: "#132f3c" }}
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
                  color: "#0f766e",
                  bgcolor: "rgba(20, 184, 166, 0.11)",
                }}
              >
                <HighlightIcon sx={{ fontSize: 18 }} />
              </Box>
              <Typography variant="body2" sx={{ color: "#294653", fontWeight: 720 }}>
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
                sx={{ bgcolor: "#eef2f4", color: "#5d6d74", fontWeight: 750 }}
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
                    color: "#0f766e",
                    bgcolor: index % 2 === 0 ? "#ccfbf1" : "#dbeafe",
                    border: "2px solid #fff",
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
            The GA will keep this battery type fixed while searching its capacity and peak support.
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
  dataset,
  dispatchStrategy,
  onGoToDataUpload,
  onReviewDispatchStrategy,
  runState,
  setRunState,
}: {
  dataset: WorkspaceDatasetSummary | null;
  dispatchStrategy: WorkspaceDispatchStrategy;
  onGoToDataUpload: () => void;
  onReviewDispatchStrategy: () => void;
  runState: SingleOptimizationRunWorkspaceState;
  setRunState: Dispatch<SetStateAction<SingleOptimizationRunWorkspaceState>>;
}) {
  const [selectedMode, setSelectedMode] = useState<OptimizationMode | null>(null);
  const [selectedBattery, setSelectedBattery] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [activeStep, setActiveStep] = useState<
    "mode-selection" | "single-configuration" | "single-setup" | "single-run"
  >("mode-selection");
  const [batteryConfiguration, setBatteryConfiguration] =
    useState<SingleBatteryConfigurationSnapshot | null>(null);
  const [setupConfiguration, setSetupConfiguration] =
    useState<SingleOptimizationSetupSnapshot | null>(null);

  const canContinue =
    selectedMode === "comparison" || (selectedMode === "single" && selectedBattery !== null);
  const selectedBatteryName = BATTERIES.find((battery) => battery.id === selectedBattery)?.name;

  function chooseMode(mode: OptimizationMode) {
    setSelectedMode(mode);
    setIsReady(false);
    setActiveStep("mode-selection");
  }

  function chooseBattery(batteryId: string) {
    setSelectedBattery(batteryId);
    setIsReady(false);
    if (batteryId !== selectedBattery) {
      setBatteryConfiguration(null);
    }
  }

  function continueFromModeSelection() {
    if (selectedMode === "single" && selectedBatteryName) {
      setActiveStep("single-configuration");
      return;
    }
    setIsReady(true);
  }

  if (activeStep !== "mode-selection" && selectedBatteryName) {
    return (
      <>
        <Box sx={{ display: activeStep === "single-configuration" ? "block" : "none" }}>
          <SingleBatteryConfiguration
            batteryName={selectedBatteryName}
            initialConfiguration={batteryConfiguration}
            onBack={() => setActiveStep("mode-selection")}
            onContinue={(configuration) => {
              setBatteryConfiguration(configuration);
              setActiveStep("single-setup");
            }}
          />
        </Box>
        {batteryConfiguration && (
          <Box sx={{ display: activeStep === "single-setup" ? "block" : "none" }}>
            <SingleOptimizationSetup
              battery={batteryConfiguration}
              dataset={dataset}
              dispatchStrategy={dispatchStrategy}
              onBack={() => setActiveStep("single-configuration")}
              onGoToDataUpload={onGoToDataUpload}
              onReviewDispatchStrategy={onReviewDispatchStrategy}
              onReadyToRun={(setup) => {
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
              }}
            />
          </Box>
        )}
        {batteryConfiguration && setupConfiguration && (
          <Box sx={{ display: activeStep === "single-run" ? "block" : "none" }}>
            <Suspense fallback={<Paper variant="outlined" sx={{ p: 4, borderRadius: "24px" }}><Typography color="text.secondary">Loading optimization run workspace…</Typography></Paper>}>
              <SingleOptimizationRun
                battery={batteryConfiguration}
                dataset={dataset}
                dispatchStrategy={dispatchStrategy}
                setup={setupConfiguration}
                runState={runState}
                setRunState={setRunState}
                onBackToSetup={() => setActiveStep("single-setup")}
                onAdjustSearchBounds={() => setActiveStep("single-setup")}
              />
            </Suspense>
          </Box>
        )}
      </>
    );
  }

  return (
    <Stack spacing={2.5}>
      <Paper
        elevation={0}
        sx={{
          position: "relative",
          overflow: "hidden",
          px: { xs: 2.5, sm: 3.5, lg: 4 },
          py: { xs: 3.25, sm: 4 },
          borderRadius: "28px",
          color: "#fff",
          background: "linear-gradient(118deg, #073e49 0%, #08766f 56%, #1669a9 125%)",
          boxShadow: "0 20px 48px rgba(7, 62, 73, 0.2)",
          "&::before": {
            content: '\"\"',
            position: "absolute",
            width: 330,
            height: 330,
            right: -120,
            top: -190,
            borderRadius: "50%",
            border: "55px solid rgba(255,255,255,0.055)",
          },
        }}
      >
        <Box sx={{ position: "relative", zIndex: 1, maxWidth: 790 }}>
          <Chip
            icon={<AutoAwesomeRoundedIcon />}
            label="Optimization workspace"
            size="small"
            sx={{
              color: "#fff",
              bgcolor: "rgba(255,255,255,0.14)",
              border: "1px solid rgba(255,255,255,0.16)",
              fontWeight: 750,
              "& .MuiChip-icon": { color: "#baf7ec" },
            }}
          />
          <Typography variant="h3" sx={{ mt: 2, fontSize: { xs: 32, sm: 42 }, fontWeight: 850, letterSpacing: "-0.035em" }}>
            Choose how to optimize your BESS
          </Typography>
          <Typography sx={{ mt: 1.2, maxWidth: 680, color: "rgba(255,255,255,0.79)", fontSize: { xs: 15, sm: 16.5 }, lineHeight: 1.7 }}>
            Start with a focused system design or evaluate the complete battery portfolio. The optimization engine will be connected in a later milestone.
          </Typography>
        </Box>
      </Paper>

      <Box component="section" aria-labelledby="optimization-mode-title">
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ mb: 1.8, justifyContent: "space-between", alignItems: { sm: "flex-end" } }}
        >
          <Box>
            <Typography id="optimization-mode-title" variant="h5" sx={{ color: "#163542", fontWeight: 850 }}>
              Select an optimization path
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.45 }}>
              Choose one mode to configure the next stage of your study.
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
          sx={{ borderRadius: "18px", border: "1px solid #cfe6ef", bgcolor: "#f3fbfd" }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 820 }}>
            Comparison workflow selected
          </Typography>
          <Typography variant="body2">
            One fixed-type GA will run for each enabled battery before AHP and PROMETHEE II ranking. No optimization will run during this milestone.
          </Typography>
        </Alert>
      )}

      {isReady && selectedMode && (
        <Alert
          severity="success"
          icon={<CheckCircleRoundedIcon />}
          sx={{ borderRadius: "18px", border: "1px solid #bce8d6", bgcolor: "#f1fdf7" }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 820 }}>
            Optimization path prepared locally
          </Typography>
          <Typography variant="body2">
            {selectedMode === "single"
              ? `${selectedBatteryName} is selected for single-battery optimization.`
              : "Battery Comparison is selected for the future multi-battery workflow."} The GA has not been started.
          </Typography>
        </Alert>
      )}

      <Paper
        elevation={0}
        sx={{
          p: { xs: 2, sm: 2.25 },
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          gap: 1.5,
          alignItems: { sm: "center" },
          justifyContent: "space-between",
          borderRadius: "22px",
          border: "1px solid #dfe7eb",
          bgcolor: "#fff",
          boxShadow: "0 8px 24px rgba(20, 55, 69, 0.05)",
        }}
      >
        <Box>
          <Typography variant="subtitle2" sx={{ color: "#173844", fontWeight: 820 }}>
            {selectedMode ? "Ready to continue" : "Choose a mode to continue"}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Your selection stays in this page only and does not start the optimization engine.
          </Typography>
        </Box>
        <Button
          type="button"
          variant="contained"
          endIcon={<ArrowForwardRoundedIcon />}
          disabled={!canContinue}
          onClick={continueFromModeSelection}
          sx={{
            minWidth: 154,
            alignSelf: { xs: "stretch", sm: "center" },
            px: 2.5,
            py: 1.15,
            borderRadius: "13px",
            fontWeight: 820,
            textTransform: "none",
            background: "linear-gradient(100deg, #0f766e, #0d9488)",
            boxShadow: "0 10px 24px rgba(15, 118, 110, 0.22)",
            "&:hover": { background: "linear-gradient(100deg, #0b655f, #0b8178)" },
          }}
        >
          Continue
        </Button>
      </Paper>
    </Stack>
  );
}
