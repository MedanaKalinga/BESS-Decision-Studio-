import type { ReactNode } from "react";
import {
  AccountTreeRounded,
  BoltRounded,
  CheckCircleRounded,
  CompareArrowsRounded,
  DatasetRounded,
  EmojiEventsRounded,
  InsightsRounded,
  PlayArrowRounded,
  StorageRounded,
  TuneRounded,
  UploadFileRounded,
  WarningAmberRounded,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import type {
  DashboardModel,
  DashboardQuickAction,
  DashboardStatusCard,
} from "../lib/dashboardState";
import { designTokens } from "../theme";

interface DashboardPageProps {
  projectName: string;
  displayName: string;
  model: DashboardModel;
  onAction: (action: DashboardQuickAction) => void;
  onViewRun: (mode: "Single Optimization" | "Battery Comparison") => void;
}

const moneyFormatter = new Intl.NumberFormat("en-LK", {
  style: "currency",
  currency: "LKR",
  maximumFractionDigits: 0,
  notation: "compact",
});

const numberFormatter = new Intl.NumberFormat("en-LK", {
  maximumFractionDigits: 1,
});

const dateFormatter = new Intl.DateTimeFormat("en-LK", {
  dateStyle: "medium",
  timeStyle: "short",
});

function statusColor(tone: DashboardStatusCard["tone"]) {
  return tone === "neutral" ? "default" : tone;
}

function StatusChip({ status, tone }: DashboardStatusCard) {
  return (
    <Chip
      label={status}
      color={statusColor(tone)}
      size="small"
      variant={tone === "neutral" ? "outlined" : "filled"}
      sx={{ fontWeight: 800 }}
    />
  );
}

function StatusCard({
  icon,
  title,
  status,
  tone,
  children,
  action,
}: DashboardStatusCard & {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 3,
        p: 2.25,
        minHeight: 205,
        bgcolor: designTokens.surface.card,
        display: "flex",
        flexDirection: "column",
        transition: "transform 180ms ease, box-shadow 180ms ease",
        "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        "&:hover": { transform: "translateY(-2px)", borderColor: "rgba(155,239,74,.3)", boxShadow: "0 18px 42px rgba(0,0,0,.22)" },
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Stack direction="row" spacing={1.1} sx={{ alignItems: "center" }}>
          <Box
            sx={{
              width: 38,
              height: 38,
              borderRadius: 2.5,
              display: "grid",
              placeItems: "center",
              color: "primary.main",
              bgcolor: "rgba(155,239,74,.08)",
            }}
          >
            {icon}
          </Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
            {title}
          </Typography>
        </Stack>
        <StatusChip status={status} tone={tone} />
      </Stack>
      <Box sx={{ flex: 1, pt: 2 }}>{children}</Box>
      <Box sx={{ pt: 1.5 }}>{action}</Box>
    </Paper>
  );
}

function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Stack direction="row" spacing={2} sx={{ py: 0.35, justifyContent: "space-between" }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 800, textAlign: "right" }}>
        {value}
      </Typography>
    </Stack>
  );
}

function Metric({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <Box
      sx={{
        p: 1.75,
        borderRadius: 3,
        bgcolor: "rgba(255,255,255,.025)",
        border: `1px solid ${designTokens.border}`,
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ mt: 0.4, fontWeight: 900 }}>
        {numberFormatter.format(value)}{" "}
        <Typography component="span" variant="caption" color="text.secondary">
          {unit}
        </Typography>
      </Typography>
    </Box>
  );
}

export default function DashboardPage({ projectName, displayName, model, onAction, onViewRun }: DashboardPageProps) {
  const dataset = model.dataset.summary;
  const maximumCapacity = Math.max(
    ...model.capacityOverview.map((item) => item.capacityKwh),
    1,
  );

  return (
    <Stack spacing={3}>
      <Paper
        elevation={0}
        sx={{
          borderRadius: 3,
          p: { xs: 2.5, md: 3.5 },
          color: "text.primary",
          overflow: "hidden",
          background:
            "linear-gradient(125deg, rgba(155,239,74,.09), rgba(76,141,255,.08)), #0D1D2D",
          border: `1px solid ${designTokens.border}`,
          position: "relative",
          "&::after": {
            content: '""',
            position: "absolute",
            width: 240,
            height: 240,
            borderRadius: "50%",
            right: -80,
            top: -130,
            bgcolor: "rgba(155,239,74,.08)",
          },
        }}
      >
        <Typography variant="h4" sx={{ position: "relative", zIndex: 1, fontWeight: 950 }}>
            {`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${displayName}`}
        </Typography>
        <Typography sx={{ mt: 0.65, color: "text.secondary", position: "relative", zIndex: 1 }}>
            {projectName} · Current project status and scientific results.
        </Typography>
      </Paper>

      {model.persistenceUnavailable ? (
        <Alert severity="warning" icon={<StorageRounded />}>
          Remote workspace is unavailable. Valid local state is still shown.
        </Alert>
      ) : null}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, minmax(0, 1fr))",
            xl: "repeat(5, minmax(0, 1fr))",
          },
          gap: 2,
        }}
      >
        <StatusCard
          icon={<DatasetRounded />}
          title="Dataset"
          status={model.dataset.status}
          tone={model.dataset.tone}
          action={<Button onClick={() => onAction("dataset")}>Open Dataset</Button>}
        >
          {dataset ? (
            <>
              <Typography variant="body2" noWrap title={dataset.filename} sx={{ fontWeight: 850 }}>
                {dataset.filename}
              </Typography>
              <KeyValue label="Rows" value={dataset.rowCount.toLocaleString()} />
              <KeyValue label="From" value={dataset.startDate} />
              <KeyValue label="To" value={dataset.endDate} />
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Upload a dataset to begin.
            </Typography>
          )}
        </StatusCard>

        <StatusCard
          icon={<BoltRounded />}
          title="Single Optimization"
          status={model.single.status}
          tone={model.single.tone}
          action={<Button onClick={() => onAction("single")}>Open Single Optimization</Button>}
        >
          {model.single.capacityKwh !== null ? (
            <>
              <KeyValue label="Battery" value={model.single.batteryName} />
              <KeyValue label="Capacity" value={`${numberFormatter.format(model.single.capacityKwh)} kWh`} />
              <KeyValue
                label="Annual cost"
                value={moneyFormatter.format(model.single.totalAnnualCostRs ?? 0)}
              />
              <KeyValue label="Feasibility" value={model.single.feasible ? "Feasible" : "Infeasible"} />
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No completed single-battery result.
            </Typography>
          )}
        </StatusCard>

        <StatusCard
          icon={<CompareArrowsRounded />}
          title="Comparison Stage 1"
          status={model.comparison.status}
          tone={model.comparison.tone}
          action={<Button onClick={() => onAction("comparison")}>Open Comparison</Button>}
        >
          <KeyValue
            label="Completed"
            value={`${model.comparison.completedBatteries} / ${model.comparison.totalBatteries}`}
          />
          <KeyValue label="Feasible" value={model.comparison.feasibleBatteries} />
          <KeyValue label="Infeasible" value={model.comparison.infeasibleBatteries} />
          {model.comparison.status === "Running" || model.comparison.status === "Resuming" ? (
            <LinearProgress
              variant="determinate"
              value={model.comparison.progressPercent}
              sx={{ mt: 1.25, height: 7, borderRadius: 10 }}
            />
          ) : null}
        </StatusCard>

        <StatusCard
          icon={<AccountTreeRounded />}
          title="AHP"
          status={model.ahp.status}
          tone={model.ahp.tone}
          action={<Button onClick={() => onAction("ahp")}>Open AHP</Button>}
        >
          <KeyValue
            label="Consistency ratio"
            value={model.ahp.consistencyRatio === null ? "—" : model.ahp.consistencyRatio.toFixed(4)}
          />
          <KeyValue label="Accepted" value={model.ahp.accepted ? "Yes" : "No"} />
        </StatusCard>

        <StatusCard
          icon={<EmojiEventsRounded />}
          title="PROMETHEE II"
          status={model.promethee.status}
          tone={model.promethee.tone}
          action={<Button onClick={() => onAction("results")}>{model.promethee.actionLabel}</Button>}
        >
          {model.promethee.recommendedBattery ? (
            <>
              <KeyValue label="Recommended" value={model.promethee.recommendedBattery} />
              <KeyValue label="Net flow" value={model.promethee.netFlow?.toFixed(4)} />
              <KeyValue label="Rank" value={`#${model.promethee.rank}`} />
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {model.promethee.stale ? "Recalculation is required." : "No current ranking."}
            </Typography>
          )}
        </StatusCard>
      </Box>

      {model.activeJob ? (
        <Paper
          elevation={0}
          sx={{ p: 2.5, borderRadius: 3, border: "1px solid", borderColor: "divider", bgcolor: designTokens.surface.elevated }}
        >
          <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ alignItems: { md: "center" } }}>
            <Box sx={{ flex: 1 }}>
              <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Typography variant="h6" sx={{ fontWeight: 900 }}>Active Optimization</Typography>
                <Chip label={model.activeJob.status} color={model.activeJob.blockedReason ? "error" : "info"} size="small" />
                {model.activeJob.recovered ? <Chip label="Recovered" variant="outlined" size="small" /> : null}
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {model.activeJob.mode}
                {model.activeJob.currentBattery ? ` · ${model.activeJob.currentBattery}` : ""}
              </Typography>
              {model.activeJob.blockedReason ? (
                <Alert severity="warning" sx={{ mt: 1.5 }}>{model.activeJob.blockedReason}</Alert>
              ) : (
                <>
                  <Stack direction="row" sx={{ mt: 1.5, justifyContent: "space-between" }}>
                    <Typography variant="caption" sx={{ fontWeight: 750 }}>
                      Generation {model.activeJob.currentGeneration} / {model.activeJob.totalGenerations}
                    </Typography>
                    <Typography variant="caption" sx={{ fontWeight: 850 }}>
                      {model.activeJob.progressPercent.toFixed(0)}%
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={model.activeJob.progressPercent}
                    sx={{ mt: 0.75, height: 8, borderRadius: 10 }}
                  />
                </>
              )}
            </Box>
            <Button
              variant="contained"
              startIcon={<PlayArrowRounded />}
              onClick={() => onViewRun(model.activeJob!.mode)}
            >
              View Run
            </Button>
          </Stack>
        </Paper>
      ) : null}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1.35fr 1fr" }, gap: 2 }}>
        <Paper
          elevation={0}
          sx={{
            p: { xs: 2.25, md: 3 },
            borderRadius: 3,
            border: "1px solid",
            borderColor: "divider",
            background: "linear-gradient(145deg, rgba(155,239,74,.06), rgba(13,29,45,.96) 55%)",
          }}
        >
          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 950 }}>Primary Recommendation</Typography>
              <Typography variant="body2" color="text.secondary">Current scientific ranking.</Typography>
            </Box>
            {model.recommendation ? <CheckCircleRounded color="success" /> : <InsightsRounded color="disabled" />}
          </Stack>
          {model.recommendation ? (
            <Box sx={{ mt: 2.5 }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ justifyContent: "space-between" }}>
                <Box>
                  <Typography variant="h4" color="primary.main" sx={{ fontWeight: 950 }}>
                    {model.recommendation.batteryName}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>
                    Recommended from the GA-optimized feasible alternatives.
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
                  <Chip label="Feasible" color="success" size="small" />
                  <Chip label="AHP accepted" color="info" size="small" />
                  <Chip label="PROMETHEE current" color="primary" size="small" />
                </Stack>
              </Stack>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "repeat(2, 1fr)", md: "repeat(5, 1fr)" },
                  gap: 1.25,
                  mt: 2.5,
                }}
              >
                <Metric label="Capacity" value={model.recommendation.capacityKwh} unit="kWh" />
                <Metric label="Peak support" value={model.recommendation.peakSupportPct} unit="%" />
                <Metric label="Net flow" value={model.recommendation.netFlow} unit="" />
                <Metric label="Annual cost" value={model.recommendation.totalAnnualCostRs} unit="LKR" />
                <Metric label="Service life" value={model.recommendation.cycleBasedLifeYears} unit="years" />
              </Box>
            </Box>
          ) : (
            <Alert
              severity={model.staleRecommendationBattery ? "warning" : "info"}
              icon={model.staleRecommendationBattery ? <WarningAmberRounded /> : <InsightsRounded />}
              sx={{ mt: 2 }}
            >
              {model.staleRecommendationBattery
                ? `${model.staleRecommendationBattery} is an outdated recommendation. Recalculate PROMETHEE.`
                : "A current PROMETHEE ranking is not available."}
            </Alert>
          )}
        </Paper>

        <Paper elevation={0} sx={{ p: { xs: 2.25, md: 3 }, borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
          <Typography variant="h6" sx={{ fontWeight: 950 }}>Quick Actions</Typography>
          <Typography variant="body2" color="text.secondary">Open an existing workflow.</Typography>
          <Box sx={{ display: "grid", gap: 1, mt: 2 }}>
            <Button variant="outlined" startIcon={<UploadFileRounded />} onClick={() => onAction("dataset")}>
              Upload / Open Dataset
            </Button>
            <Button variant="outlined" startIcon={<BoltRounded />} onClick={() => onAction("single")}>
              Single Optimization
            </Button>
            <Button variant="outlined" startIcon={<CompareArrowsRounded />} onClick={() => onAction("comparison")}>
              Battery Comparison
            </Button>
            <Button variant="outlined" startIcon={<TuneRounded />} onClick={() => onAction("ahp")}>
              Configure AHP
            </Button>
            <Button variant="contained" startIcon={<EmojiEventsRounded />} onClick={() => onAction("results")}>
              {model.promethee.actionLabel}
            </Button>
          </Box>
        </Paper>
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, gap: 2 }}>
        <Paper elevation={0} sx={{ p: { xs: 2.25, md: 3 }, borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
          <Typography variant="h6" sx={{ fontWeight: 950 }}>Dataset Overview</Typography>
          <Typography variant="body2" color="text.secondary">Persisted annual summary.</Typography>
          {dataset ? (
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1.25, mt: 2 }}>
              <Metric label="Annual PV" value={dataset.annualPvEnergyKwh} unit="kWh" />
              <Metric label="Annual EV" value={dataset.annualEvEnergyKwh} unit="kWh" />
              <Metric label="PV peak" value={dataset.pvPeakKw} unit="kW" />
              <Metric label="EV peak" value={dataset.evPeakKw} unit="kW" />
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>No dataset summary.</Typography>
          )}
        </Paper>

        <Paper elevation={0} sx={{ p: { xs: 2.25, md: 3 }, borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
          <Typography variant="h6" sx={{ fontWeight: 950 }}>Optimized Capacity</Typography>
          <Typography variant="body2" color="text.secondary">Comparison alternatives.</Typography>
          {model.capacityOverview.length ? (
            <Stack spacing={1.5} sx={{ mt: 2 }}>
              {model.capacityOverview.map((item) => (
                <Box key={item.batteryName}>
                  <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between" }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 800 }}>{item.batteryName}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {numberFormatter.format(item.capacityKwh)} kWh
                    </Typography>
                  </Stack>
                  <Box sx={{ mt: 0.6, height: 9, borderRadius: 8, bgcolor: "action.hover", overflow: "hidden" }}>
                    <Box
                      sx={{
                        width: `${Math.max(2, (item.capacityKwh / maximumCapacity) * 100)}%`,
                        height: "100%",
                        borderRadius: 8,
                        bgcolor: item.feasible ? "primary.main" : "warning.main",
                        transition: "width 250ms ease",
                        "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                      }}
                    />
                  </Box>
                </Box>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>No comparison result.</Typography>
          )}
        </Paper>
      </Box>

      {model.recentResults.length ? (
        <Paper elevation={0} sx={{ p: { xs: 2.25, md: 3 }, borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
          <Typography variant="h6" sx={{ fontWeight: 950 }}>Recent Results</Typography>
          <Stack spacing={1} sx={{ mt: 1.5 }}>
            {model.recentResults.map((result) => (
              <Stack
                key={`${result.mode}-${result.completedAt}`}
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                sx={{ py: 1.1, borderBottom: "1px solid", borderColor: "divider", justifyContent: "space-between" }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Chip label={result.mode} size="small" variant="outlined" />
                  <Typography variant="body2" sx={{ fontWeight: 800 }}>{result.summary}</Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {dateFormatter.format(new Date(result.completedAt))}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  );
}
