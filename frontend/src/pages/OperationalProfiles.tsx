import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import BatteryChargingFullRoundedIcon from "@mui/icons-material/BatteryChargingFullRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import CloudOffRoundedIcon from "@mui/icons-material/CloudOffRounded";
import ElectricMeterRoundedIcon from "@mui/icons-material/ElectricMeterRounded";
import InsightsRoundedIcon from "@mui/icons-material/InsightsRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import WaterfallChartRoundedIcon from "@mui/icons-material/WaterfallChartRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type {
  OperationalProfilePoint,
  SingleOptimizationFinalResult,
  SingleOptimizationOperationalProfile,
  WorkspaceDatasetSummary,
} from "../types/workspace";
import { batteryTypeLabel } from "../lib/batteryCatalogue";

const numberFormatter = new Intl.NumberFormat("en-LK", { maximumFractionDigits: 2 });

interface SeriesDefinition {
  id: string;
  label: string;
  color: string;
  value: (point: OperationalProfilePoint) => number;
}

interface ReferenceLine {
  label: string;
  value: number;
  color: string;
}

function timeLabel(timestamp: string) {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp.slice(11, 16);
  return parsed.toLocaleTimeString("en-LK", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function stepPath(values: number[], x: (index: number) => number, y: (value: number) => number) {
  if (!values.length) return "";
  let path = `M ${x(0)} ${y(values[0])}`;
  for (let index = 1; index < values.length; index += 1) {
    path += ` H ${x(index)} V ${y(values[index])}`;
  }
  return path;
}

function InteractiveStepChart({
  title,
  description,
  points,
  series,
  unit,
  signed = false,
  fixedDomain,
  referenceLines = [],
  highlightLimits = false,
}: {
  title: string;
  description: string;
  points: OperationalProfilePoint[];
  series: SeriesDefinition[];
  unit: string;
  signed?: boolean;
  fixedDomain?: [number, number];
  referenceLines?: ReferenceLine[];
  highlightLimits?: boolean;
}) {
  const [visibleSeries, setVisibleSeries] = useState(() => new Set(series.map((item) => item.id)));
  const [activeIndex, setActiveIndex] = useState(0);
  const width = 980;
  const height = 330;
  const margins = { left: 64, right: 24, top: 28, bottom: 48 };
  const visible = series.filter((item) => visibleSeries.has(item.id));
  const allValues = visible.flatMap((item) => points.map(item.value));
  const dataMin = allValues.length ? Math.min(...allValues) : 0;
  const dataMax = allValues.length ? Math.max(...allValues) : 1;
  const referenceValues = referenceLines.map((line) => line.value);
  let minimum = fixedDomain?.[0] ?? Math.min(dataMin, ...referenceValues, signed ? 0 : dataMin);
  let maximum = fixedDomain?.[1] ?? Math.max(dataMax, ...referenceValues, signed ? 0 : dataMax);
  const span = Math.max(maximum - minimum, 1);
  if (!fixedDomain) {
    minimum -= span * 0.08;
    maximum += span * 0.08;
  }
  const x = (index: number) => margins.left + (index / Math.max(points.length - 1, 1)) * (width - margins.left - margins.right);
  const y = (value: number) => margins.top + ((maximum - value) / Math.max(maximum - minimum, 1)) * (height - margins.top - margins.bottom);
  const selectedPoint = points[Math.min(activeIndex, Math.max(points.length - 1, 0))];

  function toggleSeries(id: string) {
    setVisibleSeries((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function moveSelection(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setActiveIndex((current) => Math.min(Math.max(current + (event.key === "ArrowRight" ? 1 : -1), 0), points.length - 1));
  }

  function selectFromPointer(event: MouseEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const relative = (event.clientX - bounds.left) / Math.max(bounds.width, 1);
    const chartRelative = Math.min(Math.max((relative * width - margins.left) / (width - margins.left - margins.right), 0), 1);
    setActiveIndex(Math.round(chartRelative * Math.max(points.length - 1, 0)));
  }

  return (
    <Paper component="section" variant="outlined" sx={{ overflow: "hidden", borderRadius: "24px", borderColor: "divider", bgcolor: "#0D1D2D", boxShadow: "0 14px 38px rgba(0,0,0,0.18)", transition: "box-shadow 180ms ease", "&:hover": { boxShadow: "0 20px 46px rgba(0,0,0,0.25)" } }}>
      <Box sx={{ px: { xs: 2, sm: 2.6 }, py: 2.1, background: "linear-gradient(120deg, rgba(155,239,74,.065), rgba(76,141,255,.075))", borderBottom: "1px solid", borderColor: "divider" }}>
        <Stack direction={{ xs: "column", lg: "row" }} spacing={1.5} sx={{ justifyContent: "space-between", alignItems: { lg: "center" } }}>
          <Box><Typography variant="h6" sx={{ color: "text.primary", fontWeight: 880 }}>{title}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>{description}</Typography></Box>
          <Stack direction="row" useFlexGap spacing={0.8} sx={{ flexWrap: "wrap" }}>{series.map((item) => { const shown = visibleSeries.has(item.id); return <Button key={item.id} size="small" variant={shown ? "contained" : "outlined"} aria-pressed={shown} onClick={() => toggleSeries(item.id)} sx={{ borderRadius: 99, bgcolor: shown ? item.color : undefined, borderColor: item.color, color: shown ? "#fff" : item.color, "&:hover": { bgcolor: shown ? item.color : `${item.color}12`, borderColor: item.color } }}><Box component="span" sx={{ width: 8, height: 8, mr: 0.7, borderRadius: "50%", bgcolor: shown ? "#fff" : item.color }} />{item.label}</Button>; })}</Stack>
        </Stack>
      </Box>
      <Box sx={{ p: { xs: 1.4, sm: 2.2 } }}>
        {selectedPoint && <Paper elevation={0} aria-live="polite" sx={{ mb: 1.3, p: 1.35, borderRadius: "15px", bgcolor: "rgba(255,255,255,.025)", border: "1px solid", borderColor: "divider" }}><Stack direction="row" useFlexGap spacing={1.4} sx={{ alignItems: "center", flexWrap: "wrap" }}><Chip size="small" label={timeLabel(selectedPoint.timestamp)} sx={{ fontWeight: 850, bgcolor: "rgba(155,239,74,.12)", color: "primary.main" }} />{visible.map((item) => <Typography key={item.id} variant="caption" color="text.secondary"><Box component="span" sx={{ display: "inline-block", width: 8, height: 8, mr: 0.55, borderRadius: "50%", bgcolor: item.color }} /><strong>{item.label}:</strong> {numberFormatter.format(item.value(selectedPoint))} {unit}</Typography>)}</Stack></Paper>}
        <Box tabIndex={0} role="application" aria-label={`${title}. Use left and right arrow keys to inspect 15-minute values.`} onKeyDown={moveSelection} sx={{ overflowX: "auto", borderRadius: 2, outline: "none", "&:focus-visible": { boxShadow: "0 0 0 3px rgba(13,148,136,0.2)" } }}>
          <Box component="svg" viewBox={`0 0 ${width} ${height}`} onMouseMove={selectFromPointer} sx={{ display: "block", width: "100%", minWidth: 580, height: "auto", cursor: "crosshair" }}>
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => { const value = maximum - ratio * (maximum - minimum); const position = margins.top + ratio * (height - margins.top - margins.bottom); return <g key={ratio}><line x1={margins.left} x2={width - margins.right} y1={position} y2={position} stroke="rgba(148,166,186,.18)" strokeDasharray="5 6" /><text x={margins.left - 9} y={position + 4} textAnchor="end" fill="#94A6BA" fontSize="12">{numberFormatter.format(value)}</text></g>; })}
            {referenceLines.map((line) => <g key={line.label}><line x1={margins.left} x2={width - margins.right} y1={y(line.value)} y2={y(line.value)} stroke={line.color} strokeWidth="1.8" strokeDasharray="9 5" /><text x={width - margins.right - 4} y={y(line.value) - 6} textAnchor="end" fill={line.color} fontSize="12" fontWeight="700">{line.label}</text></g>)}
            {signed && minimum < 0 && maximum > 0 && <line x1={margins.left} x2={width - margins.right} y1={y(0)} y2={y(0)} stroke="#475569" strokeWidth="2" />}
            {visible.map((item) => <path key={item.id} d={stepPath(points.map(item.value), x, y)} fill="none" stroke={item.color} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />)}
            {highlightLimits && points.map((point, index) => { const atLimit = referenceLines.some((line) => Math.abs(point.soc_pct - line.value) <= 0.05); return atLimit ? <circle key={`${point.timestamp}-limit`} cx={x(index)} cy={y(point.soc_pct)} r="5" fill="#f59e0b" stroke="#fff" strokeWidth="2"><title>{`${timeLabel(point.timestamp)}: SOC limit reached`}</title></circle> : null; })}
            {selectedPoint && <line x1={x(activeIndex)} x2={x(activeIndex)} y1={margins.top} y2={height - margins.bottom} stroke="#0f766e" strokeWidth="1.5" strokeDasharray="4 4" />}
            {[0, 24, 48, 72, 95].map((index) => points[index] ? <text key={index} x={x(index)} y={height - 17} textAnchor={index === 0 ? "start" : index === 95 ? "end" : "middle"} fill="#94A6BA" fontSize="12">{timeLabel(points[index].timestamp)}</text> : null)}
            <text x="16" y={height / 2} transform={`rotate(-90 16 ${height / 2})`} textAnchor="middle" fill="#94A6BA" fontSize="12">{unit}</text>
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}

function SummaryCards({ profile }: { profile: SingleOptimizationOperationalProfile }) {
  const summary = profile.daily_summary;
  const cards = [
    ["PV energy", `${numberFormatter.format(summary.pv_energy_kwh)} kWh`, SolarPowerRoundedIcon, "#0d9488"],
    ["EV energy", `${numberFormatter.format(summary.ev_energy_kwh)} kWh`, BoltRoundedIcon, "#2563eb"],
    ["Grid import", `${numberFormatter.format(summary.grid_import_energy_kwh)} kWh`, ElectricMeterRoundedIcon, "#7c3aed"],
    ["PV export", `${numberFormatter.format(summary.pv_export_energy_kwh)} kWh`, InsightsRoundedIcon, "#0284c7"],
    ["BESS charged", `${numberFormatter.format(summary.bess_charge_energy_kwh)} kWh`, BatteryChargingFullRoundedIcon, "#dc2626"],
    ["BESS discharged", `${numberFormatter.format(summary.bess_discharge_energy_kwh)} kWh`, WaterfallChartRoundedIcon, "#16a34a"],
    ["Minimum SOC", `${numberFormatter.format(summary.minimum_soc_pct)}%`, BatteryChargingFullRoundedIcon, "#b45309"],
    ["Maximum SOC", `${numberFormatter.format(summary.maximum_soc_pct)}%`, BatteryChargingFullRoundedIcon, "#0f766e"],
  ] as const;
  return <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0,1fr))", lg: "repeat(4, minmax(0,1fr))" }, gap: 1.2 }}>{cards.map(([label, value, Icon, color]) => <Paper key={label} elevation={0} sx={{ p: 1.65, borderRadius: "17px", border: "1px solid", borderColor: "divider", bgcolor: "rgba(255,255,255,.025)" }}><Stack direction="row" spacing={1.1} sx={{ alignItems: "center" }}><Box sx={{ width: 38, height: 38, display: "grid", placeItems: "center", flexShrink: 0, borderRadius: "12px", color, bgcolor: `${color}18` }}><Icon fontSize="small" /></Box><Box><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="subtitle2" sx={{ mt: 0.2, color: "text.primary", fontWeight: 880 }}>{value}</Typography></Box></Stack></Paper>)}</Box>;
}

function errorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object" && "message" in detail) return String((detail as { message: unknown }).message);
  }
  return `The profile request failed with HTTP ${status}.`;
}

export default function OperationalProfiles({ projectId, jobId, dataset, result, selectedDate: initialDate, onDateChange }: { projectId: string; jobId: string | null; dataset: WorkspaceDatasetSummary | null; result: SingleOptimizationFinalResult; selectedDate: string | null; onDateChange: (date: string | null) => void; }) {
  const [selectedDate, setSelectedDate] = useState(initialDate ?? dataset?.startDate ?? "");
  const [profile, setProfile] = useState<SingleOptimizationOperationalProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    if (!dataset || !selectedDate) {
      onDateChange(null);
      return;
    }
    onDateChange(selectedDate);
  }, [dataset, onDateChange, selectedDate]);

  useEffect(() => {
    if (!jobId || !dataset || !selectedDate) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/projects/${encodeURIComponent(projectId)}/single-optimization/jobs/${encodeURIComponent(jobId)}/profiles?date=${encodeURIComponent(selectedDate)}`, { credentials: "include", signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error(errorMessage(payload, response.status));
        return payload as SingleOptimizationOperationalProfile;
      })
      .then((payload) => {
        if (!Array.isArray(payload.points) || payload.points.length !== 96) throw new Error("The backend profile did not contain exactly 96 points.");
        setProfile(payload);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        const message = caught instanceof Error ? caught.message : "The operational profile could not be loaded.";
        setError({ code: message.includes("fetch") || message.includes("Network") ? "BACKEND_UNAVAILABLE" : message.includes("date") ? "INVALID_DATE" : "PROFILE_LOAD_FAILED", message });
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [dataset, jobId, requestVersion, selectedDate]);

  const systemSeries = useMemo<SeriesDefinition[]>(() => [
    { id: "pv", label: "PV generation", color: "#9BEF4A", value: (point) => point.pv_kw },
    { id: "ev", label: "EV demand", color: "#4C8DFF", value: (point) => point.ev_kw },
    { id: "grid", label: "Grid import", color: "#C084FC", value: (point) => point.grid_import_kw },
    { id: "export", label: "PV export", color: "#F5A742", value: (point) => point.pv_export_kw },
  ], []);
  const bessSeries = useMemo<SeriesDefinition[]>(() => [
    { id: "charge", label: "Charging", color: "#F06464", value: (point) => -point.bess_charge_kw },
    { id: "discharge", label: "Discharging", color: "#9BEF4A", value: (point) => point.bess_discharge_kw },
  ], []);
  const socSeries = useMemo<SeriesDefinition[]>(() => [
    { id: "soc", label: "State of charge", color: "#4C8DFF", value: (point) => point.soc_pct },
  ], []);

  if (!jobId || !dataset) return <Alert severity="info" sx={{ borderRadius: "17px" }}>Operational profiles need a completed job and its uploaded dataset.</Alert>;

  return (
    <Paper component="section" aria-labelledby="operational-profiles-title" elevation={0} sx={{ mt: 0.5, overflow: "hidden", borderRadius: "28px", border: "1px solid", borderColor: "divider", bgcolor: "#0D1D2D", boxShadow: "0 22px 55px rgba(0,0,0,0.22)" }}>
      <Box sx={{ p: { xs: 2.3, sm: 3 }, color: "#fff", background: "linear-gradient(115deg, #0b4f59, #0f766e 56%, #2563eb 130%)" }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ justifyContent: "space-between", alignItems: { md: "center" } }}><Box><Stack direction="row" spacing={1} sx={{ alignItems: "center" }}><WaterfallChartRoundedIcon /><Typography variant="overline" sx={{ color: "#a7f3d0", fontWeight: 850, letterSpacing: "0.1em" }}>SIMULATED OPERATIONS</Typography></Stack><Typography id="operational-profiles-title" variant="h4" sx={{ mt: 0.5, fontWeight: 900 }}>Operational Profiles</Typography><Typography sx={{ mt: 0.7, color: "rgba(255,255,255,0.79)" }}>Winning {batteryTypeLabel(result.battery_name)} dispatch at 15-minute resolution.</Typography></Box><Chip label={`${numberFormatter.format(result.best_bess_capacity_kwh)} kWh · ${numberFormatter.format(result.best_peak_support_pct)}% peak support`} sx={{ color: "#fff", bgcolor: "rgba(255,255,255,0.14)", fontWeight: 820 }} /></Stack>
      </Box>
      <Box sx={{ p: { xs: 2.1, sm: 2.8 } }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.4} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}><Box><Typography variant="h6" sx={{ fontWeight: 870 }}>Select an operating day</Typography><Typography variant="body2" color="text.secondary">Available from {dataset.startDate} through {dataset.endDate}.</Typography></Box><TextField type="date" label="Profile date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: dataset.startDate, max: dataset.endDate } }} sx={{ minWidth: { sm: 220 }, "& .MuiOutlinedInput-root": { borderRadius: "13px" } }} /></Stack>

        {loading && !profile && <Stack spacing={1.2} sx={{ mt: 2.2 }}><Skeleton variant="rounded" height={110} /><Skeleton variant="rounded" height={360} /><Skeleton variant="rounded" height={360} /></Stack>}
        {loading && profile && <Alert icon={<CircularProgress size={18} />} severity="info" sx={{ mt: 2, borderRadius: "15px" }}>Loading {selectedDate} while keeping the previous profile visible…</Alert>}
        {error && <Alert severity="error" icon={error.code === "BACKEND_UNAVAILABLE" ? <CloudOffRoundedIcon /> : undefined} action={<Button color="inherit" size="small" startIcon={<RefreshRoundedIcon />} onClick={() => setRequestVersion((current) => current + 1)}>Retry</Button>} sx={{ mt: 2, borderRadius: "16px" }}><Typography variant="subtitle2" sx={{ fontWeight: 850 }}>{error.code}</Typography><Typography variant="body2">{error.message}</Typography></Alert>}

        {profile && <Stack spacing={2.2} sx={{ mt: 2.3, opacity: loading ? 0.62 : 1, transition: "opacity 180ms ease" }}><Stack direction="row" spacing={1} sx={{ alignItems: "center" }}><CalendarMonthRoundedIcon sx={{ color: "primary.main" }} /><Typography variant="subtitle1" sx={{ fontWeight: 850 }}>Daily summary · {profile.date}</Typography><Chip size="small" label="96 intervals" sx={{ ml: "auto", fontWeight: 780 }} /></Stack><SummaryCards profile={profile} /><InteractiveStepChart title="System Power Profile" description="PV, EV, grid import, and export on one shared kW axis." points={profile.points} series={systemSeries} unit="kW" /><InteractiveStepChart title="BESS Charge and Discharge" description="Charging is plotted below zero; discharging is plotted above zero." points={profile.points} series={bessSeries} unit="kW" signed /><InteractiveStepChart title="Battery State of Charge" description="SOC trajectory with the verified reference minimum and maximum limits." points={profile.points} series={socSeries} unit="%" fixedDomain={[0, 100]} referenceLines={[{ label: `Minimum ${numberFormatter.format(profile.soc_min_limit_pct)}%`, value: profile.soc_min_limit_pct, color: "#F06464" }, { label: `Maximum ${numberFormatter.format(profile.soc_max_limit_pct)}%`, value: profile.soc_max_limit_pct, color: "#F5A742" }]} highlightLimits /></Stack>}
      </Box>
    </Paper>
  );
}
