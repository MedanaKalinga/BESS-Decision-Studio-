import { useMemo, useState } from "react";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import AutoGraphRoundedIcon from "@mui/icons-material/AutoGraphRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import EmojiEventsRoundedIcon from "@mui/icons-material/EmojiEventsRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";

import { AHP_CRITERIA } from "../lib/comparisonAhp";
import { batteryDisplayName } from "../lib/batteryCatalogue";
import {
  comparisonRankingEligibility,
  findRecommendedStageOneResult,
  isPrometheeResultStale,
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

const SECTIONS = ["Overview", "Battery Ranking", "GA Comparison", "AHP Analysis", "PROMETHEE Analysis", "Excluded Alternatives"];

const currency = new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("en-LK", { maximumFractionDigits: 3 });

function resultForBattery(
  comparison: ComparisonOptimizationWorkspaceState | null,
  name: string,
): ComparisonBatteryResult | undefined {
  return comparison?.finalResult.battery_results.find((battery) => battery.battery_name === name);
}

function formatCriterion(value: number, criterion: string): string {
  if (criterion === "total_annual_cost_Rs" || criterion === "total_annual_cost_rs") return currency.format(value);
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
              <g key={item.battery_name} tabIndex={0} aria-label={`${batteryDisplayName(item.battery_name)}, net flow ${item.net_flow.toFixed(4)}`}>
                <text x="8" y={y + 17} fontSize="13" fontWeight="700" fill="#24404a">{batteryDisplayName(item.battery_name)}</text>
                <line x1={middle} x2={middle} y1={y - 5} y2={y + 29} stroke="#9fb1b8" />
                <rect x={x} y={y} width={barWidth} height="24" rx="7" fill={item.net_flow >= 0 ? "#0f8b7d" : "#d97706"} />
                <text x={item.net_flow >= 0 ? x + barWidth + 7 : x - 7} y={y + 17} textAnchor={item.net_flow >= 0 ? "start" : "end"} fontSize="12" fill="#52666e">{item.net_flow.toFixed(4)}</text>
              </g>
            );
          }
          return (
            <g key={item.battery_name} tabIndex={0} aria-label={`${batteryDisplayName(item.battery_name)}, positive flow ${item.positive_flow.toFixed(4)}, negative flow ${item.negative_flow.toFixed(4)}`}>
              <text x="8" y={y + 25} fontSize="13" fontWeight="700" fill="#24404a">{batteryDisplayName(item.battery_name)}</text>
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
            <Box role="rowheader" key={`label-${names[rowIndex]}`} sx={{ p: 1.2, bgcolor: "#0D1D2D", fontWeight: 760, fontSize: 13 }}>{batteryDisplayName(names[rowIndex])}</Box>,
            ...row.map((value, column) => <Box role="cell" key={`${rowIndex}-${column}`} sx={{ p: 1.2, bgcolor: rowIndex === column ? "#12263A" : "#0D1D2D", fontSize: 13 }}>{value.toFixed(4)}</Box>),
          ])}
        </Box>
      </Box>
    </Stack>
  );
}

export default function ComparisonResultsPage({
  comparison,
  ahp,
  promethee,
  projectId,
  datasetId,
  onBackToAHP,
  onBackToRecommendation,
  onBackToSummary,
  onReturnDashboard,
}: {
  comparison: ComparisonOptimizationWorkspaceState | null;
  ahp: ComparisonAHPWorkspaceState | null;
  promethee: PrometheeWorkspaceState | null;
  projectId: string;
  datasetId: string | null;
  onBackToAHP: () => void;
  onBackToRecommendation: () => void;
  onBackToSummary: () => void;
  onReturnDashboard: () => void;
}) {
  const [section, setSection] = useState(0);
  const scientificContext = { projectId, datasetId };
  const stale = isPrometheeResultStale(promethee, comparison, ahp, scientificContext);
  const result = promethee?.result ?? null;
  const feasibleAlternatives = comparison?.finalResult.battery_results.filter(
    (battery) => battery.is_feasible,
  ) ?? [];
  const eligibility = comparisonRankingEligibility(comparison);

  const recommended = result?.recommended_battery
    ? result.ordered_ranking.find((entry) => entry.battery_name === result.recommended_battery)
    : undefined;
  const recommendedStageOne = findRecommendedStageOneResult(result, comparison) ?? undefined;
  const presentRecommendation = result
    ? shouldPresentRecommendation(result.scientific_status, result.recommended_battery, stale)
    : false;
  const excludedWithStageOne = useMemo(() => {
    const backendExcluded = result?.excluded_alternatives ?? [];
    const comparisonExcluded = comparison?.finalResult.battery_results
      .filter((battery) => !battery.is_feasible)
      .map((battery) => ({
        battery_name: battery.battery_name,
        solution_status: battery.solution_status,
        failed_constraints: battery.failed_constraints,
      })) ?? [];
    const unique = new Map(
      [...backendExcluded, ...comparisonExcluded].map((entry) => [entry.battery_name, entry]),
    );
    return [...unique.values()].map((entry) => ({
      ...entry,
      stageOne: resultForBattery(comparison, entry.battery_name),
    }));
  }, [comparison, result?.excluded_alternatives]);

  function exportResults() {
    if (!promethee) return;
    const blob = new Blob([JSON.stringify({
      calculated_at: promethee.calculatedAt,
      ranking: promethee.result.ordered_ranking.map((entry) => ({
        ...entry,
        battery_name: batteryDisplayName(entry.battery_name),
      })),
      criteria: promethee.result.criteria_order,
      directions: promethee.result.criterion_directions,
      weights: promethee.result.normalized_weights,
      decision_matrix: promethee.result.raw_decision_matrix,
      excluded_alternatives: promethee.result.excluded_alternatives.map((entry) => ({
        ...entry,
        battery_name: batteryDisplayName(entry.battery_name),
      })),
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
          <Alert severity="warning">
            {!comparison
              ? "No comparison results yet."
              : !ahp?.accepted
                ? "GA optimization is complete. Configure AHP criteria weights to continue."
                : eligibility === "insufficient_feasible_alternatives"
                  ? "Only one feasible alternative is available. PROMETHEE II requires at least two feasible alternatives."
                  : eligibility === "no_feasible_alternatives"
                    ? "No feasible battery alternatives were found."
                    : "The final ranking is not available yet."}
          </Alert>
          <Button
            variant="contained"
            sx={{ alignSelf: "flex-start" }}
            onClick={!comparison ? onBackToSummary : !ahp?.accepted ? onBackToAHP : onBackToRecommendation}
          >
            {!comparison ? "Start Optimization" : !ahp?.accepted ? "Continue to AHP" : "Calculate Final Ranking"}
          </Button>
          {eligibility === "no_feasible_alternatives" && onBackToSummary && (
            <Button variant="contained" onClick={onBackToSummary}>Edit Comparison Configuration</Button>
          )}
          {comparison && feasibleAlternatives.length < 2 && (
            <Paper variant="outlined" sx={{ p: 2, borderRadius: "18px" }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>
                {eligibility === "insufficient_feasible_alternatives" ? "Feasible alternative" : "Excluded alternatives"}
              </Typography>
              <Stack spacing={1} sx={{ mt: 1.2 }}>
                {(eligibility === "insufficient_feasible_alternatives"
                  ? feasibleAlternatives
                  : comparison.finalResult.battery_results
                ).map((battery) => (
                  <Stack key={battery.battery_name} direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between" }}>
                    <Typography variant="body2" sx={{ fontWeight: 780 }}>{battery.battery_name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {number.format(battery.best_bess_capacity_kwh)} kWh · {battery.is_feasible ? "Feasible" : `Failed: ${battery.failed_constraints.join(", ")}`}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Paper>
          )}
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
          <Paper elevation={0} sx={{ p: { xs: 2.5, md: 4 }, borderRadius: "26px", border: "1px solid rgba(155,239,74,.28)", background: "linear-gradient(120deg,#0D1D2D,#12263A 72%,rgba(155,239,74,.07))", boxShadow: "0 18px 42px rgba(0,0,0,.22)" }}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2.5} sx={{ alignItems: { md: "center" }, justifyContent: "space-between" }}>
              <Box>
                <Chip icon={presentRecommendation ? <EmojiEventsRoundedIcon /> : <WarningAmberRoundedIcon />} label={presentRecommendation ? "Final Recommended BESS" : "Outdated recommendation"} sx={{ bgcolor: "rgba(155,239,74,.1)", color: "primary.main", fontWeight: 820, "& .MuiChip-icon": { color: "primary.main" } }} />
                <Typography variant="h3" sx={{ mt: 1.5, fontSize: { xs: 32, md: 48 }, fontWeight: 850 }}>{recommended ? batteryDisplayName(recommended.battery_name) : "No recommendation"}</Typography>
                <Typography sx={{ mt: 1, color: "rgba(255,255,255,.82)", maxWidth: 700 }}>Recommended from the GA-optimized feasible alternatives.</Typography>
              </Box>
              {recommended && <Stack spacing={1} sx={{ minWidth: 220 }}><Chip label={`Rank #${recommended.rank}`} color="primary" sx={{ fontWeight: 850 }} /><Typography>Net flow <strong>{recommended.net_flow.toFixed(4)}</strong></Typography><Typography>Positive flow <strong>{recommended.positive_flow.toFixed(4)}</strong></Typography><Typography>Negative flow <strong>{recommended.negative_flow.toFixed(4)}</strong></Typography></Stack>}
            </Stack>
          </Paper>
          {recommendedStageOne && <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2,minmax(0,1fr))", lg: "repeat(4,minmax(0,1fr))" }, gap: 1.2 }}>{[
            ["GA-optimized BESS capacity", `${number.format(recommendedStageOne.best_bess_capacity_kwh)} kWh`],
            ["GA-optimized peak support", `${recommendedStageOne.best_peak_support_pct.toFixed(2)}%`],
            ["Total annual cost", currency.format(recommendedStageOne.best_total_annual_cost_rs)],
            ["Cycle-based service life", `${number.format(recommendedStageOne.cycle_based_life_years)} years`],
            ["Round-trip efficiency", `${(recommendedStageOne.round_trip_efficiency * 100).toFixed(2)}%`],
            ["Warranty", `${number.format(recommendedStageOne.warranty_years)} years`],
            ["Feasibility", "Feasible"],
          ].map(([label, value]) => <Paper key={label} variant="outlined" sx={{ p: 1.7, borderRadius: "16px" }}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="subtitle1" sx={{ fontWeight: 820 }}>{value}</Typography></Paper>)}</Box>}
        </Stack>
      );
    }

    if (section === 1) {
      if (!shouldPresentRanking(result.scientific_status)) return <Alert severity="warning" sx={{ mt: 2 }}>No PROMETHEE ranking is available for this scientific status.</Alert>;
      return <Box sx={{ py: 2, display: "grid", gridTemplateColumns: { xs: "1fr", lg: "repeat(2,minmax(0,1fr))" }, gap: 1.5 }}>{[...result.ordered_ranking].sort((left, right) => right.net_flow - left.net_flow).map((entry) => {
        const battery = resultForBattery(comparison, entry.battery_name);
        return <Paper key={entry.battery_name} variant="outlined" sx={{ p: 2.2, borderRadius: "20px", borderColor: entry.rank === 1 ? "#75c8b9" : "#dce6e9", background: entry.rank === 1 ? "linear-gradient(135deg,#f0fdfa,#f4f9ff)" : "#fff" }}><Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}><Typography variant="h6">#{entry.rank} {batteryDisplayName(entry.battery_name)}</Typography><Stack direction="row" spacing={.7}>{entry.rank === 1 && <Chip label="Recommended" size="small" color="success" />}<Chip label="Feasible" size="small" variant="outlined" /></Stack></Stack>{battery && <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 1.1, mt: 2 }}>{[["Capacity", `${number.format(battery.best_bess_capacity_kwh)} kWh`], ["Peak support", `${battery.best_peak_support_pct.toFixed(2)}%`], ["Annual cost", currency.format(battery.best_total_annual_cost_rs)], ["Service life", `${number.format(battery.cycle_based_life_years)} years`], ["Round-trip", `${(battery.round_trip_efficiency * 100).toFixed(2)}%`], ["Weight density", `${number.format(battery.weight_density_kg_per_kwh)} kg/kWh`], ["Annual O&M", currency.format(battery.annual_om_cost_rs)], ["Warranty", `${number.format(battery.warranty_years)} years`]].map(([label, value]) => <Box key={label}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="body2" sx={{ fontWeight: 760 }}>{value}</Typography></Box>)}</Box>}<Divider sx={{ my: 1.8 }} /><Stack direction="row" spacing={2}><Typography variant="caption">φ+ <strong>{entry.positive_flow.toFixed(4)}</strong></Typography><Typography variant="caption">φ− <strong>{entry.negative_flow.toFixed(4)}</strong></Typography><Typography variant="caption">φ <strong>{entry.net_flow.toFixed(4)}</strong></Typography></Stack></Paper>;
      })}</Box>;
    }

    if (section === 2) return <Stack spacing={1.5} sx={{ py: 2 }}>{comparison?.finalResult.battery_results.map((battery) => <Paper key={battery.battery_name} variant="outlined" sx={{ p: 2.2, borderRadius: "20px" }}><Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between" }}><Typography variant="h6">{batteryDisplayName(battery.battery_name)}</Typography><Chip size="small" label={battery.is_feasible ? "Feasible" : "Infeasible"} color={battery.is_feasible ? "success" : "warning"} /></Stack><Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2,minmax(0,1fr))", md: "repeat(4,minmax(0,1fr))" }, gap: 1.2, mt: 1.5 }}>{[
      ["Optimized capacity", `${number.format(battery.best_bess_capacity_kwh)} kWh`],
      ["Peak support", `${battery.best_peak_support_pct.toFixed(2)}%`],
      ["Annual cost", currency.format(battery.best_total_annual_cost_rs)],
      ["Annual O&M", currency.format(battery.annual_om_cost_rs)],
      ["Service life", `${number.format(battery.cycle_based_life_years)} years`],
      ["Equivalent cycles", number.format(battery.equivalent_cycles_per_year ?? 0)],
      ["PV self-consumption", `${battery.pv_self_consumption_pct.toFixed(2)}%`],
      ["Peak-support success", `${battery.peak_support_success_pct.toFixed(2)}%`],
    ].map(([label, value]) => <Box key={label}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="body2" sx={{ fontWeight: 780 }}>{value}</Typography></Box>)}</Box></Paper>)}</Stack>;

    if (section === 3) return <Stack spacing={2.5} sx={{ py: 2 }}>{ahp?.calculation && !ahp.incompatible ? <><Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2,minmax(0,1fr))", md: "repeat(4,minmax(0,1fr))" }, gap: 1.2 }}>{[
      ["λ max", ahp.calculation.lambdaMax.toFixed(4)],
      ["Consistency index", ahp.calculation.consistencyIndex.toFixed(4)],
      ["Random index", ahp.calculation.randomIndex.toFixed(2)],
      ["Consistency ratio", `${(ahp.calculation.consistencyRatio * 100).toFixed(2)}%`],
    ].map(([label, value]) => <Paper key={label} variant="outlined" sx={{ p: 1.7, borderRadius: "17px" }}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="h6">{value}</Typography></Paper>)}</Box><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2,minmax(0,1fr))" }, gap: 1.3 }}>{AHP_CRITERIA.map((criterion, index) => <Paper key={criterion.id} variant="outlined" sx={{ p: 1.7, borderRadius: "17px" }}><Stack direction="row" sx={{ justifyContent: "space-between" }}><Typography variant="body2" sx={{ fontWeight: 800 }}>{criterion.label}</Typography><Typography variant="body2" color="primary.main" sx={{ fontWeight: 850 }}>{(ahp.calculation!.weights[index] * 100).toFixed(2)}%</Typography></Stack><LinearProgress variant="determinate" value={ahp.calculation!.weights[index] * 100} sx={{ mt: 1, height: 7, borderRadius: 6 }} /></Paper>)}</Box><Box sx={{ overflowX: "auto" }}><Box role="table" aria-label="Accepted AHP pairwise matrix" sx={{ display: "grid", gridTemplateColumns: "minmax(150px,1.4fr) repeat(5,minmax(95px,1fr))", minWidth: 700, gap: "1px", bgcolor: "#dce7ea" }}>{["Criterion", ...AHP_CRITERIA.map((criterion) => criterion.label)].map((heading) => <Box key={heading} role="columnheader" sx={{ p: 1, bgcolor: "#eaf7f5", fontSize: 12, fontWeight: 820 }}>{heading}</Box>)}{ahp.matrix.flatMap((row, rowIndex) => [<Box key={`ahp-${rowIndex}`} role="rowheader" sx={{ p: 1, bgcolor: "#fff", fontSize: 12, fontWeight: 760 }}>{AHP_CRITERIA[rowIndex].label}</Box>, ...row.map((value, column) => <Box key={`${rowIndex}-${column}`} role="cell" sx={{ p: 1, bgcolor: "#fff", fontSize: 12 }}>{value.toFixed(4)}</Box>)])}</Box></Box><Alert severity={ahp.accepted ? "success" : "warning"}>{ahp.accepted ? "AHP judgments accepted." : "AHP judgments are not accepted."}</Alert></> : <Alert severity="warning">No AHP analysis is available.</Alert>}</Stack>;

    if (section === 4) return <Stack spacing={3} sx={{ py: 2 }}><Alert severity="info" icon={<AutoGraphRoundedIcon />}><strong>PROMETHEE Type III V-shape.</strong> q is zero and p is 10% of the observed criterion range.</Alert><Paper variant="outlined" sx={{ p: 2.2, borderRadius: "20px" }}><Typography variant="h6" sx={{ mb: 1.5 }}>Net flow by battery</Typography><FlowChart result={result} metric="net" /></Paper><Paper variant="outlined" sx={{ p: 2.2, borderRadius: "20px" }}><Typography variant="h6">Positive and negative flows</Typography><FlowChart result={result} metric="positive-negative" /></Paper><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2,minmax(0,1fr))" }, gap: 1.5 }}>{AHP_CRITERIA.map((criterion, index) => <Paper key={criterion.id} variant="outlined" sx={{ p: 2, borderRadius: "18px" }}><Stack direction="row" sx={{ justifyContent: "space-between" }}><Box><Typography variant="subtitle1" sx={{ fontWeight: 820 }}>{criterion.label}</Typography><Chip label={criterion.direction} size="small" variant="outlined" sx={{ mt: .7 }} /></Box><Typography variant="h6" color="primary.main">{(result.normalized_weights[index] * 100).toFixed(2)}%</Typography></Stack><Stack direction="row" spacing={2} sx={{ mt: 1.5 }}><Typography variant="caption">Range <strong>{number.format(result.observed_ranges[index])}</strong></Typography><Typography variant="caption">q <strong>{result.q_thresholds[index]}</strong></Typography><Typography variant="caption">p <strong>{number.format(result.p_thresholds[index])}</strong></Typography></Stack></Paper>)}</Box><Divider /><Box><Typography variant="h6">Decision matrix</Typography><Typography variant="body2" color="text.secondary">Stage 1 criterion values; not recomputed.</Typography></Box><Box sx={{ overflowX: "auto" }}><Box role="table" aria-label="PROMETHEE raw decision matrix" sx={{ display: "grid", gridTemplateColumns: "minmax(140px,1.3fr) repeat(5,minmax(150px,1fr))", minWidth: 930, gap: "1px", bgcolor: "#dce7ea", border: "1px solid #dce7ea" }}>{["Battery", ...AHP_CRITERIA.map((criterion) => criterion.label)].map((heading) => <Box role="columnheader" key={heading} sx={{ p: 1.1, bgcolor: "#eaf7f5", fontWeight: 820, fontSize: 12 }}>{heading}</Box>)}{result.raw_decision_matrix.flatMap((row, rowIndex) => [<Box role="rowheader" key={`name-${rowIndex}`} sx={{ p: 1.1, bgcolor: "#fff", fontWeight: 780 }}>{batteryDisplayName(result.feasible_alternative_names[rowIndex])}</Box>, ...row.map((value, criterionIndex) => <Box role="cell" key={`${rowIndex}-${criterionIndex}`} sx={{ p: 1.1, bgcolor: "#fff", fontSize: 12 }}>{formatCriterion(value, result.criteria_order[criterionIndex])}</Box>)])}</Box></Box><Divider /><Box><Typography variant="h6" sx={{ mb: 1.5 }}>Preference matrices</Typography><MatrixPanel result={result} /></Box></Stack>;

    return <Stack spacing={1.5} sx={{ py: 2 }}>{excludedWithStageOne.length ? excludedWithStageOne.map((entry) => <Paper key={entry.battery_name} variant="outlined" sx={{ p: 2, borderRadius: "18px", borderColor: "#f2cf9b", bgcolor: "#fffaf3" }}><Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between" }}><Box><Typography variant="h6">{batteryDisplayName(entry.battery_name)}</Typography><Typography variant="body2" color="text.secondary">Excluded because technical constraints failed.</Typography></Box><Chip label="No rank · Infeasible" color="warning" variant="outlined" /></Stack><Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1.5 }}><Chip label={`Status: ${entry.solution_status}`} size="small" /><Chip label={`Failed: ${entry.failed_constraints.join(", ")}`} size="small" /><Chip label={`Penalty: ${currency.format(entry.stageOne?.total_penalty_rs ?? 0)}`} size="small" /></Stack></Paper>) : <Alert severity="success">No alternatives were excluded. Every submitted battery was technically feasible.</Alert>}</Stack>;
  }, [ahp?.accepted, comparison, eligibility, excludedWithStageOne, feasibleAlternatives, presentRecommendation, recommended, recommendedStageOne, result, section, stale]);

  return (
    <Stack spacing={0} sx={{ minHeight: "calc(100vh - 150px)", border: "1px solid", borderColor: "divider", borderRadius: "28px", overflow: "hidden", bgcolor: "#081522" }}>
      <Box sx={{ px: { xs: 2.25, md: 3.5 }, py: 2.7, background: "linear-gradient(112deg,#0D1D2D,#12263A)" }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
          <Box sx={{ flex: 1 }}><Typography variant="overline" sx={{ color: "#a7f3d0", fontWeight: 850 }}>Comparison Mode · Detailed results</Typography><Typography variant="h4" sx={{ fontWeight: 850 }}>Scientific decision analysis</Typography></Box>
          {result && <Chip label={stale ? "Outdated result" : result.scientific_status.replaceAll("_", " ")} sx={{ bgcolor: "rgba(255,255,255,.15)", color: "#fff", fontWeight: 780 }} />}
        </Stack>
      </Box>
      <Tabs value={section} onChange={(_, next: number) => setSection(next)} variant="scrollable" scrollButtons="auto" aria-label="Comparison result sections" sx={{ px: { xs: 1, md: 2 }, bgcolor: "#0D1D2D", borderBottom: "1px solid", borderColor: "divider", minHeight: 50 }}>{SECTIONS.map((label) => <Tab key={label} label={label} sx={{ minHeight: 50 }} />)}</Tabs>
      <Box sx={{ px: { xs: 2, md: 3 }, py: 1.5, flex: 1 }}>
        {content}
      </Box>
      <Paper square elevation={0} sx={{ position: "sticky", bottom: 0, px: { xs: 2, md: 3 }, py: 1.5, borderTop: "1px solid", borderColor: "divider", bgcolor: "rgba(8,21,34,.97)" }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1} sx={{ justifyContent: "space-between" }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => section > 0 ? setSection(section - 1) : onBackToRecommendation()}>
            {section > 0 ? "Back" : "Back to Recommendation"}
          </Button>
          <Button onClick={onBackToSummary}>Comparison Summary</Button>
          <Button onClick={onBackToAHP}>Revise AHP</Button>
          <Button onClick={onReturnDashboard}>Return to Dashboard</Button>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button startIcon={<DownloadRoundedIcon />} onClick={exportResults} disabled={!promethee}>Export Results</Button>
        </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}
