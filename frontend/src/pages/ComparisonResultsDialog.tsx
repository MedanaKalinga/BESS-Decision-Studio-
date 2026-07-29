import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import AutoGraphRoundedIcon from "@mui/icons-material/AutoGraphRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import EmojiEventsRoundedIcon from "@mui/icons-material/EmojiEventsRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";

import { AHP_CRITERIA } from "../lib/comparisonAhp";
import {
  hasPrometheePrerequisites,
  isPrometheeResultStale,
  isValidPrometheeCalculationResult,
  mapComparisonToPrometheeRequest,
  shouldPresentRanking,
  shouldPresentRecommendation,
} from "../lib/comparisonResults";
import type {
  ComparisonAHPWorkspaceState,
  ComparisonBatteryResult,
  ComparisonOptimizationWorkspaceState,
  PrometheeCalculationResult,
  PrometheeWorkspaceState,
} from "../types/workspace";

const ENDPOINT = "/api/promethee/calculate";
const REQUEST_TIMEOUT_MS = 8_000;
const SECTIONS = ["Recommendation", "Final Ranking", "Flow Visualization", "Criteria & Weights", "Decision Analysis", "Excluded"];

const currency = new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("en-LK", { maximumFractionDigits: 3 });

function resultForBattery(
  comparison: ComparisonOptimizationWorkspaceState | null,
  name: string,
): ComparisonBatteryResult | undefined {
  return comparison?.finalResult.battery_results.find((battery) => battery.battery_name === name);
}

function formatCriterion(value: number, criterion: string): string {
  if (criterion === "total_annual_cost_rs" || criterion === "annual_om_cost_rs") return currency.format(value);
  if (criterion === "round_trip_efficiency") return `${(value * 100).toFixed(2)}%`;
  if (criterion === "cycle_based_life_years" || criterion === "warranty_years") return `${number.format(value)} years`;
  if (criterion === "weight_density_kg_per_kwh") return `${number.format(value)} kg/kWh`;
  return number.format(value);
}

function FlowChart({
  result,
  metric,
}: {
  result: PrometheeCalculationResult;
  metric: "net" | "positive-negative";
}) {
  const ranking = result.ordered_ranking;
  const width = 760;
  const rowHeight = metric === "net" ? 54 : 70;
  const height = Math.max(150, ranking.length * rowHeight + 52);
  const chartLeft = 175;
  const chartWidth = width - chartLeft - 34;
  const maxNet = Math.max(0.01, ...ranking.map((item) => Math.abs(item.net_flow)));

  return (
    <Box role="img" tabIndex={0} aria-label={metric === "net" ? "Net flow by battery" : "Positive and negative flow by battery"} sx={{ overflowX: "auto", outline: "none", "&:focus-visible": { borderRadius: 2, boxShadow: "0 0 0 3px rgba(13,148,136,.2)" } }}>
      <Box component="svg" viewBox={`0 0 ${width} ${height}`} sx={{ display: "block", minWidth: 620, width: "100%", height: "auto" }}>
        {ranking.map((item, index) => {
          const y = 30 + index * rowHeight;
          if (metric === "net") {
            const middle = chartLeft + chartWidth / 2;
            const barWidth = Math.abs(item.net_flow) / maxNet * (chartWidth / 2 - 10);
            const x = item.net_flow >= 0 ? middle : middle - barWidth;
            return (
              <g key={item.battery_name} tabIndex={0} aria-label={`${item.battery_name}, net flow ${item.net_flow.toFixed(4)}`}>
                <text x="8" y={y + 17} fontSize="13" fontWeight="700" fill="#24404a">{item.battery_name}</text>
                <line x1={middle} x2={middle} y1={y - 5} y2={y + 29} stroke="#9fb1b8" />
                <rect x={x} y={y} width={barWidth} height="24" rx="7" fill={item.net_flow >= 0 ? "#0f8b7d" : "#d97706"} />
                <text x={item.net_flow >= 0 ? x + barWidth + 7 : x - 7} y={y + 17} textAnchor={item.net_flow >= 0 ? "start" : "end"} fontSize="12" fill="#52666e">{item.net_flow.toFixed(4)}</text>
              </g>
            );
          }
          return (
            <g key={item.battery_name} tabIndex={0} aria-label={`${item.battery_name}, positive flow ${item.positive_flow.toFixed(4)}, negative flow ${item.negative_flow.toFixed(4)}`}>
              <text x="8" y={y + 25} fontSize="13" fontWeight="700" fill="#24404a">{item.battery_name}</text>
              <rect x={chartLeft} y={y} width={chartWidth * item.positive_flow} height="20" rx="6" fill="#0f8b7d" />
              <rect x={chartLeft} y={y + 27} width={chartWidth * item.negative_flow} height="20" rx="6" fill="#2584bd" />
              <text x={chartLeft + chartWidth * item.positive_flow + 6} y={y + 15} fontSize="11" fill="#52666e">+ {item.positive_flow.toFixed(4)}</text>
              <text x={chartLeft + chartWidth * item.negative_flow + 6} y={y + 42} fontSize="11" fill="#52666e">− {item.negative_flow.toFixed(4)}</text>
            </g>
          );
        })}
      </Box>
    </Box>
  );
}

function MatrixPanel({ result }: { result: PrometheeCalculationResult }) {
  const [selection, setSelection] = useState("aggregated");
  const matrix = selection === "aggregated"
    ? result.aggregated_preference_matrix
    : result.criterion_preference_matrices[selection] ?? [];
  const names = result.feasible_alternative_names;

  return (
    <Stack spacing={2}>
      <FormControl size="small" sx={{ minWidth: { xs: "100%", sm: 340 }, alignSelf: "flex-start" }}>
        <InputLabel id="preference-matrix-selector">Preference matrix</InputLabel>
        <Select labelId="preference-matrix-selector" label="Preference matrix" value={selection} onChange={(event) => setSelection(event.target.value)}>
          <MenuItem value="aggregated">Aggregated preference matrix</MenuItem>
          {AHP_CRITERIA.map((criterion) => <MenuItem key={criterion.id} value={criterion.id}>{criterion.label}</MenuItem>)}
        </Select>
      </FormControl>
      <Box sx={{ overflowX: "auto" }}>
        <Box role="table" aria-label={`${selection} preference matrix`} sx={{ display: "grid", gridTemplateColumns: `minmax(150px,1.4fr) repeat(${names.length},minmax(110px,1fr))`, minWidth: 520, gap: "1px", bgcolor: "#dce7ea", border: "1px solid #dce7ea" }}>
          {["Alternative", ...names].map((heading) => <Box role="columnheader" key={heading} sx={{ p: 1.2, bgcolor: "#eaf7f5", fontWeight: 820, fontSize: 13 }}>{heading}</Box>)}
          {matrix.flatMap((row, rowIndex) => [
            <Box role="rowheader" key={`label-${names[rowIndex]}`} sx={{ p: 1.2, bgcolor: "#fff", fontWeight: 760, fontSize: 13 }}>{names[rowIndex]}</Box>,
            ...row.map((value, column) => <Box role="cell" key={`${rowIndex}-${column}`} sx={{ p: 1.2, bgcolor: rowIndex === column ? "#f3f7f8" : "#fff", fontSize: 13 }}>{value.toFixed(4)}</Box>),
          ])}
        </Box>
      </Box>
    </Stack>
  );
}

export default function ComparisonResultsDialog({
  open,
  comparison,
  ahp,
  promethee,
  onPrometheeChange,
  onClose,
}: {
  open: boolean;
  comparison: ComparisonOptimizationWorkspaceState | null;
  ahp: ComparisonAHPWorkspaceState | null;
  promethee: PrometheeWorkspaceState | null;
  onPrometheeChange: (state: PrometheeWorkspaceState) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [section, setSection] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const autoCalculationKey = useRef<string | null>(null);
  const prerequisitesReady = hasPrometheePrerequisites(comparison, ahp);
  const stale = isPrometheeResultStale(promethee, comparison, ahp);
  const result = promethee?.result ?? null;

  const calculate = useCallback(async () => {
    if (!comparison || !ahp) {
      setError("Completed comparison results and accepted AHP weights are required.");
      return;
    }
    let request;
    try {
      request = mapComparisonToPrometheeRequest(comparison, ahp);
    } catch (mappingError) {
      setError(mappingError instanceof Error ? mappingError.message : "The comparison result is malformed.");
      return;
    }

    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    setPending(true);
    setError(null);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload && typeof payload === "object" && "detail" in payload
          ? String((payload as { detail: unknown }).detail)
          : `PROMETHEE backend returned HTTP ${response.status}.`;
        throw new Error(detail);
      }
      if (!isValidPrometheeCalculationResult(payload)) {
        throw new Error("The PROMETHEE backend returned an invalid result contract.");
      }
      onPrometheeChange({
        result: payload,
        comparisonRevision: comparison.revision,
        batteryConfigurationSignature: comparison.batteryConfigurationSignature,
        ahpRevision: ahp.revision,
        calculatedAt: new Date().toISOString(),
      });
      setSection(0);
    } catch (requestError) {
      setError(controller.signal.aborted
        ? "The PROMETHEE calculation timed out. Stage 1 results and AHP weights were preserved."
        : requestError instanceof TypeError
          ? "The PROMETHEE backend is unavailable. Stage 1 results and AHP weights were preserved."
          : requestError instanceof Error
            ? requestError.message
            : "PROMETHEE calculation failed.");
    } finally {
      window.clearTimeout(timeout);
      setPending(false);
    }
  }, [ahp, comparison, onPrometheeChange]);

  useEffect(() => {
    if (!open || !prerequisitesReady || promethee) return;
    const key = `${comparison?.revision}:${ahp?.revision}`;
    if (autoCalculationKey.current === key) return;
    autoCalculationKey.current = key;
    void calculate();
  }, [ahp?.revision, calculate, comparison?.revision, open, prerequisitesReady, promethee]);

  useEffect(() => () => activeRequest.current?.abort(), []);

  const recommended = result?.recommended_battery
    ? result.ordered_ranking.find((entry) => entry.battery_name === result.recommended_battery)
    : undefined;
  const recommendedStageOne = recommended ? resultForBattery(comparison, recommended.battery_name) : undefined;
  const presentRecommendation = result
    ? shouldPresentRecommendation(result.scientific_status, result.recommended_battery, stale)
    : false;
  const excludedWithStageOne = result?.excluded_alternatives.map((entry) => ({
    ...entry,
    stageOne: resultForBattery(comparison, entry.battery_name),
  })) ?? [];

  function exportResults() {
    if (!promethee) return;
    const blob = new Blob([JSON.stringify({
      calculated_at: promethee.calculatedAt,
      ranking: promethee.result.ordered_ranking,
      criteria: promethee.result.criteria_order,
      directions: promethee.result.criterion_directions,
      weights: promethee.result.normalized_weights,
      decision_matrix: promethee.result.raw_decision_matrix,
      excluded_alternatives: promethee.result.excluded_alternatives,
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "bess-comparison-promethee-results.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const content = useMemo(() => {
    if (!result) {
      return (
        <Stack spacing={2.5} sx={{ py: 2 }}>
          <Alert severity={prerequisitesReady ? "info" : "warning"}>
            {prerequisitesReady
              ? "The scientific prerequisites are ready. PROMETHEE II calculation will start automatically."
              : !comparison
                ? "A completed four-battery Comparison Stage 1 result is not available in this browser workspace."
                : !ahp?.accepted
                  ? "Accept a consistent AHP configuration before calculating PROMETHEE II."
                  : "At least two technically feasible alternatives are required for pairwise ranking."}
          </Alert>
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: "20px" }}>
            <Typography variant="h6">Scientific workflow status</Typography>
            <Stack spacing={1.2} sx={{ mt: 2 }}>
              {[
                ["1", "Configure comparison", comparison ? "Ready" : "Awaiting configuration"],
                ["2", "Run four-battery Stage 1", comparison ? "Completed" : "Not completed"],
                ["3", "Accept AHP weights", ahp?.accepted ? "Accepted" : "Not accepted"],
                ["4", "Calculate PROMETHEE II", "Pending"],
                ["5", "View final ranking", "Pending"],
              ].map(([step, label, status]) => <Stack key={step} direction="row" spacing={1.2} sx={{ alignItems: "center" }}><Chip label={step} size="small" /><Typography sx={{ flex: 1 }}>{label}</Typography><Chip label={status} size="small" variant="outlined" /></Stack>)}
            </Stack>
          </Paper>
        </Stack>
      );
    }

    if (section === 0) {
      if (result.scientific_status !== "ranking_completed") {
        return <Alert severity="warning" sx={{ mt: 2 }}>{result.scientific_status === "insufficient_feasible_alternatives" ? "PROMETHEE pairwise ranking requires at least two feasible alternatives. No recommendation was produced." : "No feasible battery alternatives were available. No ranking or recommendation was produced."}</Alert>;
      }
      return (
        <Stack spacing={2.5} sx={{ py: 2 }}>
          {stale && <Alert severity="warning" icon={<WarningAmberRoundedIcon />}>This ranking is outdated because the comparison result or accepted AHP revision changed. Recalculate before treating it as current.</Alert>}
          <Paper elevation={0} sx={{ p: { xs: 2.5, md: 4 }, borderRadius: "26px", color: "#fff", background: "linear-gradient(120deg,#073e49,#0f766e 58%,#1769a8)", boxShadow: "0 18px 42px rgba(7,62,73,.18)" }}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2.5} sx={{ alignItems: { md: "center" }, justifyContent: "space-between" }}>
              <Box>
                <Chip icon={presentRecommendation ? <EmojiEventsRoundedIcon /> : <WarningAmberRoundedIcon />} label={presentRecommendation ? "Recommended battery" : "Outdated recommendation"} sx={{ bgcolor: "rgba(255,255,255,.15)", color: "#fff", fontWeight: 820, "& .MuiChip-icon": { color: "#a7f3d0" } }} />
                <Typography variant="h3" sx={{ mt: 1.5, fontSize: { xs: 32, md: 48 }, fontWeight: 850 }}>{recommended?.battery_name ?? "No recommendation"}</Typography>
                <Typography sx={{ mt: 1, color: "rgba(255,255,255,.82)", maxWidth: 700 }}>This recommendation combines the six Stage 1 criteria using accepted AHP weights and PROMETHEE II Type III V-shape preferences. Battery capacity and peak support were optimized earlier by the GA.</Typography>
              </Box>
              {recommended && <Stack spacing={1} sx={{ minWidth: 220 }}><Chip label={`Rank #${recommended.rank}`} sx={{ bgcolor: "#fff", fontWeight: 850 }} /><Typography>Net flow <strong>{recommended.net_flow.toFixed(4)}</strong></Typography><Typography>Positive flow <strong>{recommended.positive_flow.toFixed(4)}</strong></Typography><Typography>Negative flow <strong>{recommended.negative_flow.toFixed(4)}</strong></Typography></Stack>}
            </Stack>
          </Paper>
          {recommendedStageOne && <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}>{[["Optimized capacity", `${number.format(recommendedStageOne.best_bess_capacity_kwh)} kWh`], ["Peak support", `${recommendedStageOne.best_peak_support_pct.toFixed(2)}%`], ["Feasibility", "Technically feasible"]].map(([label, value]) => <Paper key={label} variant="outlined" sx={{ p: 1.7, borderRadius: "16px", flex: 1 }}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="subtitle1" sx={{ fontWeight: 820 }}>{value}</Typography></Paper>)}</Stack>}
        </Stack>
      );
    }

    if (section === 1) {
      if (!shouldPresentRanking(result.scientific_status)) return <Alert severity="warning" sx={{ mt: 2 }}>No PROMETHEE ranking is available for this scientific status.</Alert>;
      return <Box sx={{ py: 2, display: "grid", gridTemplateColumns: { xs: "1fr", lg: "repeat(2,minmax(0,1fr))" }, gap: 1.5 }}>{result.ordered_ranking.map((entry) => {
        const battery = resultForBattery(comparison, entry.battery_name);
        return <Paper key={entry.battery_name} variant="outlined" sx={{ p: 2.2, borderRadius: "20px", borderColor: entry.rank === 1 ? "#75c8b9" : "#dce6e9", background: entry.rank === 1 ? "linear-gradient(135deg,#f0fdfa,#f4f9ff)" : "#fff" }}><Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}><Typography variant="h6">#{entry.rank} {entry.battery_name}</Typography><Stack direction="row" spacing={.7}>{entry.rank === 1 && <Chip label="Recommended" size="small" color="success" />}<Chip label="Feasible" size="small" variant="outlined" /></Stack></Stack>{battery && <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 1.1, mt: 2 }}>{[["Capacity", `${number.format(battery.best_bess_capacity_kwh)} kWh`], ["Peak support", `${battery.best_peak_support_pct.toFixed(2)}%`], ["Annual cost", currency.format(battery.best_total_annual_cost_rs)], ["Service life", `${number.format(battery.cycle_based_life_years)} years`], ["Round-trip", `${(battery.round_trip_efficiency * 100).toFixed(2)}%`], ["Weight density", `${number.format(battery.weight_density_kg_per_kwh)} kg/kWh`], ["Annual O&M", currency.format(battery.annual_om_cost_rs)], ["Warranty", `${number.format(battery.warranty_years)} years`]].map(([label, value]) => <Box key={label}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="body2" sx={{ fontWeight: 760 }}>{value}</Typography></Box>)}</Box>}<Divider sx={{ my: 1.8 }} /><Stack direction="row" spacing={2}><Typography variant="caption">φ+ <strong>{entry.positive_flow.toFixed(4)}</strong></Typography><Typography variant="caption">φ− <strong>{entry.negative_flow.toFixed(4)}</strong></Typography><Typography variant="caption">φ <strong>{entry.net_flow.toFixed(4)}</strong></Typography></Stack></Paper>;
      })}</Box>;
    }

    if (section === 2) return <Stack spacing={2.5} sx={{ py: 2 }}><Paper variant="outlined" sx={{ p: 2.2, borderRadius: "20px" }}><Typography variant="h6" sx={{ mb: 1.5 }}>Net flow by battery</Typography><FlowChart result={result} metric="net" /></Paper><Paper variant="outlined" sx={{ p: 2.2, borderRadius: "20px" }}><Typography variant="h6">Positive and negative flows</Typography><Stack direction="row" spacing={2} sx={{ my: 1 }}><Chip label="Positive flow" size="small" sx={{ bgcolor: "#d8f4ed" }} /><Chip label="Negative flow" size="small" sx={{ bgcolor: "#deedfa" }} /></Stack><FlowChart result={result} metric="positive-negative" /></Paper></Stack>;

    if (section === 3) return <Stack spacing={2} sx={{ py: 2 }}><Alert severity="info" icon={<AutoGraphRoundedIcon />}><strong>PROMETHEE Type III V-shape.</strong> q is zero and p equals the full observed criterion range.</Alert><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2,minmax(0,1fr))" }, gap: 1.5 }}>{AHP_CRITERIA.map((criterion, index) => <Paper key={criterion.id} variant="outlined" sx={{ p: 2, borderRadius: "18px" }}><Stack direction="row" sx={{ justifyContent: "space-between" }}><Box><Typography variant="subtitle1" sx={{ fontWeight: 820 }}>{criterion.label}</Typography><Chip label={criterion.direction} size="small" variant="outlined" sx={{ mt: .7 }} /></Box><Typography variant="h6" color="primary.main">{(result.normalized_weights[index] * 100).toFixed(2)}%</Typography></Stack><LinearProgress variant="determinate" value={result.normalized_weights[index] * 100} sx={{ my: 1.5, height: 7, borderRadius: 6 }} /><Stack direction="row" spacing={2}><Typography variant="caption">Range <strong>{number.format(result.observed_ranges[index])}</strong></Typography><Typography variant="caption">q <strong>{result.q_thresholds[index]}</strong></Typography><Typography variant="caption">p <strong>{number.format(result.p_thresholds[index])}</strong></Typography></Stack></Paper>)}</Box></Stack>;

    if (section === 4) return <Stack spacing={3} sx={{ py: 2 }}><Box><Typography variant="h6">Raw decision matrix</Typography><Typography variant="body2" color="text.secondary">Criterion values produced by the completed fixed-type GA runs; no values are recomputed here.</Typography></Box><Box sx={{ overflowX: "auto" }}><Box role="table" aria-label="PROMETHEE raw decision matrix" sx={{ display: "grid", gridTemplateColumns: "minmax(140px,1.3fr) repeat(6,minmax(150px,1fr))", minWidth: 1080, gap: "1px", bgcolor: "#dce7ea", border: "1px solid #dce7ea" }}>{["Battery", ...AHP_CRITERIA.map((criterion) => criterion.label)].map((heading) => <Box role="columnheader" key={heading} sx={{ p: 1.1, bgcolor: "#eaf7f5", fontWeight: 820, fontSize: 12 }}>{heading}</Box>)}{result.raw_decision_matrix.flatMap((row, rowIndex) => [<Box role="rowheader" key={`name-${rowIndex}`} sx={{ p: 1.1, bgcolor: "#fff", fontWeight: 780 }}>{result.feasible_alternative_names[rowIndex]}</Box>, ...row.map((value, criterionIndex) => <Box role="cell" key={`${rowIndex}-${criterionIndex}`} sx={{ p: 1.1, bgcolor: "#fff", fontSize: 12 }}>{formatCriterion(value, result.criteria_order[criterionIndex])}</Box>)])}</Box></Box><Divider /><Box><Typography variant="h6" sx={{ mb: 1.5 }}>Preference analysis</Typography><MatrixPanel result={result} /></Box></Stack>;

    return <Stack spacing={1.5} sx={{ py: 2 }}>{excludedWithStageOne.length ? excludedWithStageOne.map((entry) => <Paper key={entry.battery_name} variant="outlined" sx={{ p: 2, borderRadius: "18px", borderColor: "#f2cf9b", bgcolor: "#fffaf3" }}><Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between" }}><Box><Typography variant="h6">{entry.battery_name}</Typography><Typography variant="body2" color="text.secondary">Excluded from PROMETHEE ranking because technical constraints were not satisfied.</Typography></Box><Chip label="No rank · Infeasible" color="warning" variant="outlined" /></Stack><Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1.5 }}><Chip label={`Status: ${entry.solution_status}`} size="small" /><Chip label={`Failed: ${entry.failed_constraints.join(", ")}`} size="small" /><Chip label={`Penalty: ${currency.format(entry.stageOne?.total_penalty_rs ?? 0)}`} size="small" /></Stack></Paper>) : <Alert severity="success">No alternatives were excluded. Every submitted battery was technically feasible.</Alert>}</Stack>;
  }, [ahp?.accepted, comparison, excludedWithStageOne, presentRecommendation, prerequisitesReady, recommended, recommendedStageOne, result, section, stale]);

  return (
    <Dialog open={open} onClose={pending ? undefined : onClose} fullScreen={fullScreen} fullWidth maxWidth="xl" aria-labelledby="comparison-results-title" slotProps={{ paper: { sx: { height: fullScreen ? "100%" : "calc(100vh - 32px)", maxHeight: fullScreen ? "100%" : 980, borderRadius: fullScreen ? 0 : "26px", overflow: "hidden", "@media (prefers-reduced-motion: reduce)": { transition: "none" } } } }}>
      <DialogTitle id="comparison-results-title" sx={{ p: 0 }}>
        <Box sx={{ px: { xs: 2, md: 3 }, py: 2.1, color: "#fff", background: "linear-gradient(112deg,#073e49,#0f766e 60%,#1769a8)" }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}><Box sx={{ flex: 1 }}><Typography variant="overline" sx={{ color: "#a7f3d0", fontWeight: 850 }}>Comparison Mode · Final decision</Typography><Typography variant="h5" sx={{ fontWeight: 850 }}>Battery ranking and recommendation</Typography></Box>{result && <Chip label={stale ? "Outdated result" : result.scientific_status.replaceAll("_", " ")} sx={{ bgcolor: "rgba(255,255,255,.15)", color: "#fff", fontWeight: 780 }} />}<IconButton aria-label="Close comparison results" onClick={onClose} disabled={pending} sx={{ color: "#fff" }}><CloseRoundedIcon /></IconButton></Stack>
        </Box>
        <Tabs value={section} onChange={(_, next: number) => setSection(next)} variant="scrollable" scrollButtons="auto" aria-label="Comparison result sections" sx={{ px: { xs: 1, md: 2 }, borderBottom: "1px solid #e2e8eb", minHeight: 50 }}>{SECTIONS.map((label) => <Tab key={label} label={label} sx={{ minHeight: 50 }} />)}</Tabs>
      </DialogTitle>
      {pending && <LinearProgress aria-label="Calculating PROMETHEE ranking" />}
      <DialogContent sx={{ px: { xs: 2, md: 3 }, py: 1.5, bgcolor: "#f7f9fa" }}>
        {error && <Alert severity="error" sx={{ mt: 1.5 }} action={<Button color="inherit" onClick={() => void calculate()} disabled={!prerequisitesReady || pending}>Retry</Button>}>{error}</Alert>}
        {content}
      </DialogContent>
      <DialogActions sx={{ px: { xs: 2, md: 3 }, py: 1.5, borderTop: "1px solid #e2e8eb", justifyContent: "space-between" }}>
        <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => section > 0 ? setSection(section - 1) : onClose()} disabled={pending}>{section > 0 ? "Back" : "Close"}</Button>
        <Stack direction="row" spacing={1}><Button startIcon={<DownloadRoundedIcon />} onClick={exportResults} disabled={!promethee}>Export Results</Button><Button variant="contained" startIcon={<RefreshRoundedIcon />} onClick={() => void calculate()} disabled={!prerequisitesReady || pending}>{promethee ? "Recalculate PROMETHEE" : "Calculate PROMETHEE"}</Button></Stack>
      </DialogActions>
    </Dialog>
  );
}
