import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import AutoGraphRoundedIcon from "@mui/icons-material/AutoGraphRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import EmojiEventsRoundedIcon from "@mui/icons-material/EmojiEventsRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  Paper,
  Stack,
  Typography,
  useMediaQuery,
} from "@mui/material";

import {
  deriveComparisonDecisionStage,
  recommendationAnimationEnabled,
} from "../lib/comparisonDecisionWorkflow";
import {
  calculatePrometheeRanking,
  findRecommendedStageOneResult,
  isPrometheeResultStale,
} from "../lib/comparisonResults";
import { batteryDisplayName } from "../lib/batteryCatalogue";
import type {
  ComparisonAHPWorkspaceState,
  ComparisonOptimizationWorkspaceState,
  PrometheeWorkspaceState,
} from "../types/workspace";

const REQUEST_TIMEOUT_MS = 20_000;
const calculationSteps = [
  "Checking feasible alternatives",
  "Applying accepted AHP weights",
  "Calculating preference flows",
  "Determining final ranking",
];
const currency = new Intl.NumberFormat("en-LK", {
  style: "currency",
  currency: "LKR",
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat("en-LK", { maximumFractionDigits: 3 });

export default function ComparisonRecommendationPage({
  projectId,
  datasetId,
  comparison,
  ahp,
  promethee,
  onPrometheeChange,
  onBackToSummary,
  onBackToAHP,
  onViewDetails,
  onReturnDashboard,
  onEditComparison,
}: {
  projectId: string;
  datasetId: string | null;
  comparison: ComparisonOptimizationWorkspaceState | null;
  ahp: ComparisonAHPWorkspaceState | null;
  promethee: PrometheeWorkspaceState | null;
  onPrometheeChange: (state: PrometheeWorkspaceState) => void;
  onBackToSummary: () => void;
  onBackToAHP: () => void;
  onViewDetails: () => void;
  onReturnDashboard: () => void;
  onEditComparison: () => void;
}) {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);
  const calculationKey = useRef<string | null>(null);
  const context = useMemo(() => ({ projectId, datasetId }), [datasetId, projectId]);
  const resultIsStale = isPrometheeResultStale(promethee, comparison, ahp, context);
  const stage = deriveComparisonDecisionStage({
    comparison,
    ahp,
    promethee,
    context,
    prometheeCalculating: pending,
    prometheeError: Boolean(error),
  });

  const calculate = useCallback(async () => {
    if (!comparison || !ahp || pending) return;
    const key = `${comparison.revision}:${ahp.revision}`;
    if (calculationKey.current === key && !error) return;
    calculationKey.current = key;
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    setPending(true);
    setError(null);
    setStepIndex(0);
    try {
      const nextState = await calculatePrometheeRanking({
        comparison,
        ahp,
        context,
        signal: controller.signal,
      });
      onPrometheeChange(nextState);
    } catch (requestError) {
      calculationKey.current = null;
      // React Strict Mode intentionally performs an extra effect cleanup in
      // development. An abort caused by that cleanup (or by leaving the page)
      // is not a network timeout and must not replace the valid workflow with
      // an error state.
      if (controller.signal.aborted && !timedOut) return;
      setError(
        timedOut
          ? "Final ranking timed out. The accepted AHP state was preserved."
          : requestError instanceof TypeError
            ? "Network failure. The accepted AHP state was preserved."
            : requestError instanceof Error
              ? requestError.message
              : "Final ranking could not be calculated.",
      );
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller) activeRequest.current = null;
      setPending(false);
    }
  }, [ahp, comparison, context, error, onPrometheeChange, pending]);

  useEffect(() => {
    if (stage !== "ahp_accepted") return undefined;
    // Schedule after the current effect cycle so React Strict Mode can run its
    // development-only setup/cleanup pass before the real request begins.
    const scheduledCalculation = window.setTimeout(() => void calculate(), 0);
    return () => window.clearTimeout(scheduledCalculation);
  }, [calculate, stage]);

  useEffect(() => {
    if (!pending || reducedMotion) return undefined;
    const timer = window.setInterval(() => {
      setStepIndex((current) => Math.min(current + 1, calculationSteps.length - 1));
    }, 650);
    return () => window.clearInterval(timer);
  }, [pending, reducedMotion]);

  useEffect(() => () => activeRequest.current?.abort(), []);

  const result = promethee?.result ?? null;
  const recommended = result?.recommended_battery
    ? result.ordered_ranking.find((entry) => entry.battery_name === result.recommended_battery)
    : null;
  const optimized = findRecommendedStageOneResult(result, comparison);
  const reveal = recommendationAnimationEnabled(reducedMotion);

  if (pending || stage === "promethee_calculating") {
    return (
      <Stack spacing={3} sx={{ maxWidth: 880, mx: "auto", py: { xs: 3, md: 8 } }}>
        <Paper elevation={0} sx={{ p: { xs: 3, md: 5 }, borderRadius: "30px", textAlign: "center", border: "1px solid", borderColor: "divider", background: "linear-gradient(145deg,rgba(155,239,74,.055),rgba(76,141,255,.045))" }}>
          <CircularProgress size={64} thickness={3.6} aria-label="Calculating final ranking" />
          <Typography variant="h4" sx={{ mt: 2.5, fontWeight: 860 }}>Calculating Final Ranking</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>{calculationSteps[stepIndex]}</Typography>
          <LinearProgress variant="determinate" value={(stepIndex + 1) / calculationSteps.length * 100} sx={{ mt: 3, height: 8, borderRadius: 8 }} />
          <Stack spacing={1} sx={{ mt: 3, textAlign: "left" }}>
            {calculationSteps.map((label, index) => (
              <Stack key={label} direction="row" spacing={1} sx={{ alignItems: "center", opacity: index <= stepIndex ? 1 : .45 }}>
                <CheckCircleRoundedIcon color={index < stepIndex ? "success" : "disabled"} fontSize="small" />
                <Typography variant="body2" sx={{ fontWeight: index === stepIndex ? 800 : 500 }}>{label}</Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>
      </Stack>
    );
  }

  if (error) {
    return (
      <Stack spacing={2.5} sx={{ maxWidth: 860, mx: "auto", py: 4 }}>
        <Alert severity="error">
          <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>Final ranking could not be calculated.</Typography>
          <Typography variant="body2">{error}</Typography>
        </Alert>
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: "22px" }}>
          <Typography variant="body2">Your accepted AHP weights and completed comparison remain saved.</Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ mt: 2 }}>
            <Button variant="contained" startIcon={<RefreshRoundedIcon />} onClick={() => void calculate()}>Retry Final Ranking</Button>
            <Button onClick={onBackToAHP}>Back to AHP</Button>
            <Button onClick={onBackToSummary}>Back to Comparison Summary</Button>
          </Stack>
        </Paper>
      </Stack>
    );
  }

  if (stage === "insufficient_feasible_alternatives") {
    const only = comparison?.finalResult.battery_results.find((battery) => battery.is_feasible);
    return (
      <Stack spacing={2.5}>
        <Alert severity="warning"><strong>Only One Feasible Alternative.</strong> PROMETHEE II ranking requires at least two feasible alternatives.</Alert>
        {only && <Paper variant="outlined" sx={{ p: 3, borderRadius: "24px" }}><Typography variant="h4">{batteryDisplayName(only.battery_name)}</Typography><Typography variant="h5" color="primary.main" sx={{ mt: 1 }}>{number.format(only.best_bess_capacity_kwh)} kWh</Typography><Typography color="text.secondary">GA-optimized capacity</Typography></Paper>}
        <Button sx={{ alignSelf: "flex-start" }} startIcon={<ArrowBackRoundedIcon />} onClick={onBackToSummary}>Back to Comparison Summary</Button>
      </Stack>
    );
  }

  if (stage === "no_feasible_alternatives") {
    return <Stack spacing={2.5}><Alert severity="warning"><strong>No Feasible Alternatives.</strong> Revise the comparison configuration and search bounds.</Alert><Button variant="contained" sx={{ alignSelf: "flex-start" }} onClick={onEditComparison}>Edit Comparison Configuration</Button></Stack>;
  }

  if (stage === "ahp_required") {
    return <Stack spacing={2}><Alert severity="info">Configure and accept AHP criteria weights before calculating the final ranking.</Alert><Button variant="contained" sx={{ alignSelf: "flex-start" }} onClick={onBackToAHP}>Configure AHP</Button></Stack>;
  }

  if (!result || !recommended || !optimized || resultIsStale) {
    return <Stack spacing={2}><Alert severity="warning">The ranking is outdated or unavailable.</Alert><Button variant="contained" sx={{ alignSelf: "flex-start" }} onClick={onBackToSummary}>Return to Comparison Summary</Button></Stack>;
  }

  return (
    <Stack spacing={3} sx={{
      animation: reveal ? "recommendationReveal .48s ease-out both" : "none",
      "@keyframes recommendationReveal": {
        from: { opacity: 0, transform: "translateY(18px)" },
        to: { opacity: 1, transform: "translateY(0)" },
      },
      "@media (prefers-reduced-motion: reduce)": { animation: "none" },
    }}>
      <Paper elevation={0} sx={{ position: "relative", overflow: "hidden", p: { xs: 3, md: 5 }, borderRadius: "32px", border: "1px solid rgba(155,239,74,.32)", background: "linear-gradient(120deg,#0D1D2D,#12263A 62%,rgba(155,239,74,.08))", boxShadow: "0 24px 60px rgba(0,0,0,.28)" }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={3} sx={{ alignItems: { md: "center" }, justifyContent: "space-between" }}>
          <Box>
            <Chip icon={<EmojiEventsRoundedIcon />} label="Final Recommended BESS" sx={{ bgcolor: "rgba(155,239,74,.1)", color: "primary.main", fontWeight: 850, "& .MuiChip-icon": { color: "primary.main" } }} />
            <Typography variant="h2" sx={{ mt: 2, fontSize: { xs: 38, md: 58 }, fontWeight: 900 }}>{batteryDisplayName(optimized.battery_name)}</Typography>
            <Typography sx={{ mt: 1, color: "text.secondary" }}>Recommended from the GA-optimized feasible alternatives.</Typography>
          </Box>
          <Box sx={{ minWidth: { md: 300 }, textAlign: { md: "right" } }}>
            <Typography variant="overline" sx={{ color: "primary.main", fontWeight: 850 }}>GA-optimized BESS capacity</Typography>
            <Typography variant="h2" sx={{ color: "primary.main", fontSize: { xs: 40, md: 62 }, fontWeight: 900 }}>{number.format(optimized.best_bess_capacity_kwh)}</Typography>
            <Typography variant="h6">kWh</Typography>
          </Box>
        </Stack>
      </Paper>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2,minmax(0,1fr))", lg: "repeat(4,minmax(0,1fr))" }, gap: 1.5 }}>
        {[
          ["Peak support", `${optimized.best_peak_support_pct.toFixed(2)}%`],
          ["PROMETHEE net flow", recommended.net_flow.toFixed(4)],
          ["Total annual cost", currency.format(optimized.best_total_annual_cost_rs)],
          ["Cycle-based service life", `${number.format(optimized.cycle_based_life_years)} years`],
          ["Round-trip efficiency", `${(optimized.round_trip_efficiency * 100).toFixed(2)}%`],
          ["Warranty", `${number.format(optimized.warranty_years)} years`],
          ["Feasibility", "Feasible"],
        ].map(([label, value]) => <Paper key={label} variant="outlined" sx={{ p: 2, borderRadius: "20px" }}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="h6" sx={{ mt: .5, fontWeight: 850 }}>{value}</Typography></Paper>)}
      </Box>

      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: "22px" }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.2} sx={{ justifyContent: "space-between", alignItems: { md: "center" } }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}><AutoGraphRoundedIcon color="primary" /><Typography variant="body2">PROMETHEE II ranking complete · Rank #{recommended.rank}</Typography></Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Button variant="contained" onClick={onViewDetails}>View Detailed Results</Button>
            <Button onClick={onBackToSummary}>Back to Comparison Summary</Button>
            <Button onClick={onBackToAHP}>Revise AHP</Button>
            <Button onClick={onReturnDashboard}>Return to Dashboard</Button>
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}
