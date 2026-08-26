import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ChangeEvent,
  DragEvent,
  KeyboardEvent,
  PointerEvent,
} from "react";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import BatteryChargingFullRoundedIcon from "@mui/icons-material/BatteryChargingFullRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import CloudDoneRoundedIcon from "@mui/icons-material/CloudDoneRounded";
import CloudUploadRoundedIcon from "@mui/icons-material/CloudUploadRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import ElectricCarRoundedIcon from "@mui/icons-material/ElectricCarRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import InsertDriveFileRoundedIcon from "@mui/icons-material/InsertDriveFileRounded";
import QueryStatsRoundedIcon from "@mui/icons-material/QueryStatsRounded";
import SettingsSuggestRoundedIcon from "@mui/icons-material/SettingsSuggestRounded";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import TrendingDownRoundedIcon from "@mui/icons-material/TrendingDownRounded";
import TrendingUpRoundedIcon from "@mui/icons-material/TrendingUpRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { SvgIconComponent } from "@mui/icons-material";
import type { WorkspaceDatasetSummary } from "../types/workspace";
import {
  DATASET_EXPIRED_MESSAGE,
  DatasetExpiredError,
  fetchDatasetDay,
  resolveDatasetExplorerDate,
} from "../lib/datasetWorkspace";
import type { DatasetDayPoint, DatasetDayResponse } from "../lib/datasetWorkspace";
import { PageHeader, StatusChip, SurfaceCard } from "../components/ui";


interface ValidationIssue {
  code: string;
  message: string;
  row?: number | null;
  column?: string | null;
}

interface DatasetUploadResponse {
  dataset_id: string;
  filename: string;
  validation_summary: {
    valid: boolean;
    row_count: number;
    interval_minutes: number;
    detected_columns: {
      timestamp: string | null;
      pv: string;
      ev: string;
      tariff: string | null;
    };
    dataset_type?: "normal_year" | "leap_year" | "partial" | string;
    duration_days?: number;
    timestamps_generated?: boolean;
    notice?: string | null;
    available_columns?: string[];
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
  };
  summary: {
    annual_pv_energy_kwh: number;
    annual_ev_energy_kwh: number;
    pv_peak_kw: number;
    ev_peak_kw: number;
    start_date: string;
    end_date: string;
  };
}

type UploadPhase = "idle" | "uploading" | "validating";

const NO_TIMESTAMP_NOTICE =
  "No timestamp column detected. Timestamps will be generated from the selected start date using 15-minute intervals.";

const COLUMN_ALIASES = {
  timestamp: ["timestamp", "datetime", "date_time", "time_stamp", "time"],
  pv: ["P_PV_kW", "PV_kW", "PV_Generation", "PV_generation", "P_pv", "pv"],
  ev: ["P_EV_kW", "EV_kW", "EV_Demand", "EV_demand", "P_ev", "ev"],
  tariff: [
    "tariff",
    "Tariff",
    "price",
    "Price",
    "tariff_Rs_per_kWh",
    "price_Rs_per_kWh",
    "Price_Rs_per_kWh",
  ],
} as const;

function normalizedColumnName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findKnownColumn(columns: string[], aliases: readonly string[]): string {
  const candidates = new Set(aliases.map(normalizedColumnName));
  return columns.find((column) => candidates.has(normalizedColumnName(column))) ?? "";
}

function parseCsvHeader(source: string): string[] {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const columns: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      columns.push(current);
      current = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      columns.push(current);
      break;
    } else {
      current += character;
    }

    if (index === text.length - 1) {
      columns.push(current);
    }
  }

  if (quoted) {
    throw new Error("The CSV header contains an unclosed quoted value.");
  }

  return columns;
}

function datasetTypeLabel(datasetType?: string): string {
  if (datasetType === "normal_year") return "Normal year";
  if (datasetType === "leap_year") return "Leap year";
  if (datasetType === "partial") return "Partial dataset";
  return "Validated dataset";
}

const energyFormatter = new Intl.NumberFormat("en-LK", {
  maximumFractionDigits: 1,
});

const compactFormatter = new Intl.NumberFormat("en-LK", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestampTime(timestamp: string): string {
  return /T(\d{2}:\d{2})/.exec(timestamp)?.[1] ?? timestamp;
}

function responsePayload(xhr: XMLHttpRequest): unknown {
  if (xhr.response !== null && xhr.response !== undefined) {
    return xhr.response;
  }
  try {
    return JSON.parse(xhr.responseText) as unknown;
  } catch {
    return null;
  }
}

function uploadErrorMessages(payload: unknown, status: number): string[] {
  if (!payload || typeof payload !== "object") {
    return [`Upload failed with HTTP ${status}.`];
  }

  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") {
    return [detail];
  }
  if (!detail || typeof detail !== "object") {
    return [`Upload failed with HTTP ${status}.`];
  }

  const message = (detail as { message?: unknown }).message;
  const validationSummary = (detail as {
    validation_summary?: { errors?: unknown };
  }).validation_summary;
  const issues = Array.isArray(validationSummary?.errors)
    ? validationSummary.errors
        .filter(
          (issue): issue is ValidationIssue =>
            Boolean(issue) &&
            typeof issue === "object" &&
            typeof (issue as ValidationIssue).message === "string",
        )
        .map((issue) => {
          const location = issue.row ? ` (CSV row ${issue.row})` : "";
          return `${issue.message}${location}`;
        })
    : [];

  if (issues.length > 0) {
    return issues;
  }
  return [typeof message === "string" ? message : `Upload failed with HTTP ${status}.`];
}

function isUploadResponse(value: unknown): value is DatasetUploadResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<DatasetUploadResponse>;
  return (
    typeof candidate.dataset_id === "string" &&
    Boolean(candidate.summary) &&
    Boolean(candidate.validation_summary)
  );
}

function MetricCard({
  label,
  value,
  unit,
  icon: Icon,
  color,
  background,
}: {
  label: string;
  value: number;
  unit: string;
  icon: SvgIconComponent;
  color: string;
  background: string;
}) {
  return (
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        borderRadius: "20px",
        borderColor: "#e5eaf0",
        boxShadow: "0 10px 30px rgba(28, 45, 70, 0.045)",
        transition: "transform 220ms ease, box-shadow 220ms ease",
        "&:hover": {
          transform: "translateY(-3px)",
          boxShadow: "0 18px 38px rgba(28, 45, 70, 0.095)",
        },
      }}
    >
      <CardContent sx={{ p: 2.25, "&:last-child": { pb: 2.25 } }}>
        <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 750 }}>
              {label}
            </Typography>
            <Stack direction="row" spacing={0.7} sx={{ mt: 0.9, alignItems: "baseline" }}>
              <Typography variant="h6" sx={{ fontSize: { xs: 21, sm: 24 }, fontWeight: 850 }}>
                {energyFormatter.format(value)}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                {unit}
              </Typography>
            </Stack>
          </Box>
          <Box
            sx={{
              display: "grid",
              placeItems: "center",
              width: 42,
              height: 42,
              borderRadius: "13px",
              color,
              background,
            }}
          >
            <Icon fontSize="small" />
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}


function CombinedStepChart({ points }: { points: DatasetDayPoint[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [showPv, setShowPv] = useState(true);
  const [showEv, setShowEv] = useState(true);
  const width = 920;
  const height = 330;
  const padding = { top: 26, right: 22, bottom: 44, left: 66 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const pvColor = "#9BEF4A";
  const evColor = "#4C8DFF";
  const pvValues = useMemo(() => points.map((point) => point.pv_kw), [points]);
  const evValues = useMemo(() => points.map((point) => point.ev_kw), [points]);
  const scaleMax = Math.max(1, ...pvValues, ...evValues);
  const intervalCount = Math.max(points.length, 1);
  const xEdge = (edge: number) =>
    padding.left + (edge / intervalCount) * plotWidth;
  const xCenter = (index: number) => (xEdge(index) + xEdge(index + 1)) / 2;
  const y = (value: number) =>
    padding.top + plotHeight - (value / scaleMax) * plotHeight;

  const makeStepPath = (values: number[]) => {
    if (values.length === 0) {
      return "";
    }
    let path = `M ${xEdge(0)} ${y(values[0])} H ${xEdge(1)}`;
    for (let index = 1; index < values.length; index += 1) {
      path += ` V ${y(values[index])} H ${xEdge(index + 1)}`;
    }
    return path;
  };

  const pvPath = makeStepPath(pvValues);
  const evPath = makeStepPath(evValues);
  const timeTickIndices = useMemo(() => {
    const finalIndex = Math.max(points.length - 1, 0);
    return Array.from(
      new Set([
        0,
        Math.round(finalIndex * 0.25),
        Math.round(finalIndex * 0.5),
        Math.round(finalIndex * 0.75),
        finalIndex,
      ]),
    );
  }, [points.length]);

  const handlePointerMove = (event: PointerEvent<SVGRectElement>) => {
    const svg = event.currentTarget.ownerSVGElement;
    const screenMatrix = svg?.getScreenCTM();
    if (!svg || !screenMatrix || points.length === 0) {
      return;
    }
    const pointer = svg.createSVGPoint();
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    const svgX = pointer.matrixTransform(screenMatrix.inverse()).x;
    const fraction = Math.min(1, Math.max(0, (svgX - padding.left) / plotWidth));
    setActiveIndex(Math.min(points.length - 1, Math.floor(fraction * points.length)));
  };

  const handleChartKey = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    if (event.key === "Home") {
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      setActiveIndex(Math.max(points.length - 1, 0));
      return;
    }
    const direction = event.key === "ArrowRight" ? 1 : -1;
    setActiveIndex((current) =>
      Math.min(points.length - 1, Math.max(0, (current ?? 0) + direction)),
    );
  };

  const activePoint = activeIndex === null ? null : points[activeIndex];
  const tooltipX = activeIndex === null
    ? padding.left
    : xCenter(activeIndex) > width - padding.right - 205
      ? xCenter(activeIndex) - 192
      : xCenter(activeIndex) + 12;
  const liveSummary = activePoint
    ? `${formatTimestampTime(activePoint.timestamp)}. PV generation ${activePoint.pv_kw.toFixed(2)} kilowatts. EV demand ${activePoint.ev_kw.toFixed(2)} kilowatts.`
    : "Use Left and Right arrow keys to inspect each interval. Home moves to the first interval and End moves to the last interval.";

  return (
    <Paper
      component="section"
      aria-labelledby="combined-profile-title"
      variant="outlined"
      sx={{
        position: "relative",
        overflow: "hidden",
        borderRadius: "24px",
        borderColor: "divider",
        background: "#0D1D2D",
        boxShadow: "0 16px 42px rgba(0,0,0,.2)",
        "& .combined-series, & .balance-band": {
          transition: "opacity 220ms ease",
        },
        "@media (prefers-reduced-motion: reduce)": {
          "& .combined-series, & .balance-band": { transition: "none" },
        },
      }}
    >
      <Box
        sx={{
          px: { xs: 2, sm: 2.75 },
          py: { xs: 2, sm: 2.35 },
          borderBottom: "1px solid",
          borderColor: "divider",
          background: "linear-gradient(120deg, rgba(155,239,74,.06), rgba(76,141,255,.05))",
        }}
      >
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1.5}
          sx={{ justifyContent: "space-between", alignItems: { md: "flex-start" } }}
        >
          <Box>
            <Typography id="combined-profile-title" variant="h6" sx={{ fontWeight: 850 }}>
              Combined PV and EV Profile
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
              PV and EV on one 15-minute power scale.
            </Typography>
          </Box>
          <Stack
            component="div"
            aria-label="Chart series visibility"
            direction="row"
            sx={{ flexWrap: "wrap", gap: 1 }}
          >
            <Button
              type="button"
              size="small"
              aria-label={`${showPv ? "Hide" : "Show"} PV generation series`}
              aria-pressed={showPv}
              onClick={() => setShowPv((visible) => !visible)}
              startIcon={<Box component="span" sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: pvColor }} />}
              sx={{
                borderRadius: "999px",
                px: 1.35,
                color: showPv ? "primary.main" : "text.secondary",
                bgcolor: showPv ? "rgba(155,239,74,.08)" : "rgba(255,255,255,.03)",
                border: "1px solid",
                borderColor: showPv ? "rgba(155,239,74,.42)" : "divider",
              }}
            >
              PV generation
            </Button>
            <Button
              type="button"
              size="small"
              aria-label={`${showEv ? "Hide" : "Show"} EV demand series`}
              aria-pressed={showEv}
              onClick={() => setShowEv((visible) => !visible)}
              startIcon={<Box component="span" sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: evColor }} />}
              sx={{
                borderRadius: "999px",
                px: 1.35,
                color: showEv ? "secondary.main" : "text.secondary",
                bgcolor: showEv ? "rgba(76,141,255,.09)" : "rgba(255,255,255,.03)",
                border: "1px solid",
                borderColor: showEv ? "rgba(76,141,255,.42)" : "divider",
              }}
            >
              EV demand
            </Button>
          </Stack>
        </Stack>
      </Box>

      <Box sx={{ p: { xs: 1.5, sm: 2.5 } }}>
        <Stack
          direction="row"
          sx={{ mb: 0.5, px: { xs: 0.5, sm: 0 }, flexWrap: "wrap", gap: 1, alignItems: "center" }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ mr: 0.25, fontWeight: 750 }}>
            Balance regions
          </Typography>
          <Chip
            size="small"
            label="PV surplus"
            sx={{ bgcolor: "#ecfdf5", color: "#047857", fontWeight: 750 }}
          />
          <Chip
            size="small"
            label="EV deficit"
            sx={{ bgcolor: "#fff1f2", color: "#be123c", fontWeight: 750 }}
          />
          {(!showPv || !showEv) && (
            <Typography variant="caption" color="text.secondary">
              Balance shading is available when both series are visible.
            </Typography>
          )}
        </Stack>

        <Box sx={{ width: "100%", overflow: "hidden" }}>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            width="100%"
            role="img"
            aria-label="Combined PV generation and EV demand 15-minute step graph"
            aria-describedby="combined-profile-live-status"
            tabIndex={0}
            onFocus={() => setActiveIndex((current) => current ?? 0)}
            onBlur={() => setActiveIndex(null)}
            onKeyDown={handleChartKey}
            style={{ display: "block", minHeight: 240 }}
          >
            <title>
              Combined PV and EV Profile. Use Left and Right arrow keys to inspect intervals,
              Home for the first interval, and End for the last interval.
            </title>
            <rect
              x={padding.left}
              y={padding.top}
              width={plotWidth}
              height={plotHeight}
              rx="12"
              fill="#081522"
            />
            {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
              const gridY = padding.top + fraction * plotHeight;
              const labelValue = scaleMax * (1 - fraction);
              return (
                <g key={fraction}>
                  <line
                    x1={padding.left}
                    x2={width - padding.right}
                    y1={gridY}
                    y2={gridY}
                    stroke="#20364A"
                    strokeDasharray="4 6"
                  />
                  <text
                    x={padding.left - 12}
                    y={gridY + 4}
                    textAnchor="end"
                    fontSize="11"
                    fill="#94A6BA"
                  >
                    {compactFormatter.format(labelValue)}
                  </text>
                </g>
              );
            })}
            <text
              x="17"
              y={padding.top + plotHeight / 2}
              transform={`rotate(-90 17 ${padding.top + plotHeight / 2})`}
              textAnchor="middle"
              fontSize="11"
              fontWeight="700"
              fill="#94A6BA"
            >
              Power (kW)
            </text>
            {timeTickIndices.map((index) => (
              <text
                key={index}
                x={xCenter(index)}
                y={height - 13}
                textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
                fontSize="11"
                fill="#94A6BA"
              >
                {points[index] ? formatTimestampTime(points[index].timestamp) : ""}
              </text>
            ))}

            {points.map((point, index) => {
              const top = Math.min(y(point.pv_kw), y(point.ev_kw));
              const bandHeight = Math.abs(y(point.pv_kw) - y(point.ev_kw));
              const isSurplus = point.pv_kw > point.ev_kw;
              const isDeficit = point.ev_kw > point.pv_kw;
              return (
                <rect
                  className="balance-band"
                  key={`${point.timestamp}-${index}`}
                  x={xEdge(index)}
                  y={top}
                  width={Math.max(0, xEdge(index + 1) - xEdge(index))}
                  height={bandHeight}
                  fill={isSurplus ? "#10b981" : isDeficit ? "#fb7185" : "transparent"}
                  opacity={showPv && showEv ? 0.2 : 0}
                  pointerEvents="none"
                />
              );
            })}

            {pvPath && (
              <path
                className="combined-series"
                d={pvPath}
                fill="none"
                stroke={pvColor}
                strokeWidth="3"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                opacity={showPv ? 1 : 0}
                pointerEvents="none"
              />
            )}
            {evPath && (
              <path
                className="combined-series"
                d={evPath}
                fill="none"
                stroke={evColor}
                strokeWidth="3"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                opacity={showEv ? 1 : 0}
                pointerEvents="none"
              />
            )}

            {activePoint && activeIndex !== null && (
              <g pointerEvents="none">
                <line
                  x1={xCenter(activeIndex)}
                  x2={xCenter(activeIndex)}
                  y1={padding.top}
                  y2={padding.top + plotHeight}
                  stroke="#475569"
                  strokeOpacity="0.42"
                  strokeDasharray="4 4"
                />
                {showPv && (
                  <circle
                    cx={xCenter(activeIndex)}
                    cy={y(activePoint.pv_kw)}
                    r="5.5"
                    fill="#fff"
                    stroke={pvColor}
                    strokeWidth="3"
                  />
                )}
                {showEv && (
                  <circle
                    cx={xCenter(activeIndex)}
                    cy={y(activePoint.ev_kw)}
                    r="5.5"
                    fill="#fff"
                    stroke={evColor}
                    strokeWidth="3"
                  />
                )}
                <rect
                  x={tooltipX}
                  y={padding.top + 9}
                  width="180"
                  height="78"
                  rx="11"
                  fill="#172033"
                  opacity="0.96"
                />
                <text x={tooltipX + 13} y={padding.top + 29} fontSize="11" fill="#cbd5e1">
                  {formatTimestampTime(activePoint.timestamp)}
                </text>
                <circle cx={tooltipX + 16} cy={padding.top + 48} r="4" fill={pvColor} />
                <text x={tooltipX + 28} y={padding.top + 52} fontSize="12" fontWeight="700" fill="#fff">
                  PV {activePoint.pv_kw.toFixed(2)} kW
                </text>
                <circle cx={tooltipX + 16} cy={padding.top + 69} r="4" fill={evColor} />
                <text x={tooltipX + 28} y={padding.top + 73} fontSize="12" fontWeight="700" fill="#fff">
                  EV {activePoint.ev_kw.toFixed(2)} kW
                </text>
              </g>
            )}

            <rect
              x={padding.left}
              y={padding.top}
              width={plotWidth}
              height={plotHeight}
              fill="transparent"
              onPointerMove={handlePointerMove}
              onPointerLeave={() => setActiveIndex(null)}
            />
          </svg>
        </Box>
      </Box>

      <Box
        id="combined-profile-live-status"
        component="p"
        aria-live="polite"
        sx={{
          position: "absolute",
          width: 1,
          height: 1,
          p: 0,
          m: -1,
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {liveSummary}
      </Box>
    </Paper>
  );
}

interface DataUploadPageProps {
  projectId: string;
  dataset: WorkspaceDatasetSummary | null;
  projectDatasets?: Array<{ dataset_id: string; filename: string; uploaded_at: string; row_count: number; start_date: string; end_date: string; status: string }>;
  selectedDate: string | null;
  onDatasetUploaded?: (dataset: WorkspaceDatasetSummary) => void;
  onSelectedDateChange: (date: string | null) => void;
  onDatasetExpired: (datasetId: string) => void;
  onUseDataset?: (datasetId: string) => void;
  onRemoveDataset?: (datasetId: string) => void;
}

export default function DataUploadPage({
  projectId,
  dataset,
  projectDatasets = [],
  selectedDate,
  onDatasetUploaded,
  onSelectedDateChange,
  onDatasetExpired,
  onUseDataset,
  onRemoveDataset,
}: DataUploadPageProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeRequestRef = useRef<XMLHttpRequest | null>(null);
  const headerReadSequenceRef = useRef(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [headerLoading, setHeaderLoading] = useState(false);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [pvColumn, setPvColumn] = useState("");
  const [evColumn, setEvColumn] = useState("");
  const [tariffColumn, setTariffColumn] = useState("");
  const [timestampColumn, setTimestampColumn] = useState("");
  const [datasetStartDate, setDatasetStartDate] = useState("");
  const [timestampGenerationConfirmed, setTimestampGenerationConfirmed] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [dayResult, setDayResult] = useState<DatasetDayResponse | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [dayError, setDayError] = useState<string | null>(null);
  const [projectDatasetsOpen, setProjectDatasetsOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  useEffect(
    () => () => {
      activeRequestRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    const resolvedDate = resolveDatasetExplorerDate(dataset, selectedDate);
    if (resolvedDate !== selectedDate) onSelectedDateChange(resolvedDate);
  }, [dataset, onSelectedDateChange, selectedDate]);

  useEffect(() => {
    if (!dataset || dataset.status === "expired" || !selectedDate) {
      setDayResult(null);
      return;
    }

    const controller = new AbortController();
    const datasetId = dataset.datasetId;
    const dayDate = selectedDate;

    async function loadDay() {
      setDayLoading(true);
      setDayError(null);
      try {
        setDayResult(await fetchDatasetDay(datasetId, dayDate, controller.signal, fetch, projectId));
      } catch (error) {
        if (!controller.signal.aborted) {
          setDayResult(null);
          if (error instanceof DatasetExpiredError) onDatasetExpired(datasetId);
          setDayError(error instanceof Error ? error.message : "Unable to load the selected day.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setDayLoading(false);
        }
      }
    }

    void loadDay();
    return () => controller.abort();
  }, [dataset, onDatasetExpired, projectId, selectedDate]);

  const resetForFile = (file: File | null) => {
    headerReadSequenceRef.current += 1;
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setSelectedFile(file);
    setAvailableColumns([]);
    setHeaderLoading(false);
    setHeaderError(null);
    setPvColumn("");
    setEvColumn("");
    setTariffColumn("");
    setTimestampColumn("");
    setDatasetStartDate("");
    setTimestampGenerationConfirmed(false);
    setUploadPhase("idle");
    setUploadProgress(0);
    setUploadErrors([]);
    setDayResult(null);
    setDayError(null);
  };

  const selectFile = (file: File | null) => {
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      resetForFile(null);
      setUploadErrors(["Choose a CSV file with a .csv extension."]);
      return;
    }
    resetForFile(file);
    const readSequence = headerReadSequenceRef.current;
    setHeaderLoading(true);
    void file
      .slice(0, Math.min(file.size, 256 * 1024))
      .text()
      .then((text) => {
        if (headerReadSequenceRef.current !== readSequence) {
          return;
        }
        const columns = parseCsvHeader(text);
        if (columns.length < 2 || columns.some((column) => column.trim().length === 0)) {
          throw new Error("The CSV header must contain at least two named columns.");
        }
        if (new Set(columns.map(normalizedColumnName)).size !== columns.length) {
          throw new Error("The CSV header contains duplicate column names.");
        }
        setAvailableColumns(columns);
        setPvColumn(findKnownColumn(columns, COLUMN_ALIASES.pv));
        setEvColumn(findKnownColumn(columns, COLUMN_ALIASES.ev));
        setTariffColumn(findKnownColumn(columns, COLUMN_ALIASES.tariff));
        setTimestampColumn(findKnownColumn(columns, COLUMN_ALIASES.timestamp));
        setHeaderLoading(false);
      })
      .catch((error: unknown) => {
        if (headerReadSequenceRef.current !== readSequence) {
          return;
        }
        setAvailableColumns([]);
        setHeaderLoading(false);
        setHeaderError(
          error instanceof Error ? error.message : "The CSV header could not be read.",
        );
      });
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    selectFile(event.target.files?.[0] ?? null);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    selectFile(event.dataTransfer.files?.[0] ?? null);
  };

  const openFilePicker = () => fileInputRef.current?.click();

  const handleDropZoneKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openFilePicker();
    }
  };

  const downloadCsvTemplate = () => {
    const template = [
      "timestamp,pv_kw,ev_kw,tariff_rs_per_kwh",
      "2025-01-01T00:00:00,0,12.5,18.0",
      "2025-01-01T00:15:00,0,11.8,18.0",
      "2025-01-01T00:30:00,0,10.9,18.0",
      "2025-01-01T00:45:00,0,10.1,18.0",
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([template], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "bess_dataset_template.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const selectedMappingColumns = [pvColumn, evColumn, tariffColumn, timestampColumn].filter(Boolean);
  const mappingsAreDistinct = new Set(selectedMappingColumns).size === selectedMappingColumns.length;
  const needsGeneratedTimestamps = Boolean(selectedFile) && !timestampColumn;
  const requiredMappingsReady = Boolean(pvColumn && evColumn && mappingsAreDistinct);
  const timestampChoiceReady = Boolean(
    timestampColumn || (datasetStartDate && timestampGenerationConfirmed),
  );
  const uploadReady = Boolean(
    selectedFile &&
      availableColumns.length > 0 &&
      !headerLoading &&
      !headerError &&
      requiredMappingsReady &&
      timestampChoiceReady,
  );

  const uploadDataset = () => {
    if (!selectedFile) {
      setUploadErrors(["Choose a CSV file before uploading."]);
      return;
    }
    if (!uploadReady) {
      setUploadErrors([
        "Complete the column mapping and timestamp settings before uploading.",
      ]);
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("use_manual_mapping", "true");
    formData.append("pv_column", pvColumn);
    formData.append("ev_column", evColumn);
    formData.append("tariff_column", tariffColumn);
    formData.append("timestamp_column", timestampColumn);
    if (needsGeneratedTimestamps) {
      formData.append("start_date", datasetStartDate);
      formData.append("generate_timestamps", "true");
    }
    const request = new XMLHttpRequest();
    activeRequestRef.current = request;
    setUploadErrors([]);
    setDayResult(null);
    setUploadProgress(0);
    setUploadPhase("uploading");

    request.open("POST", `/api/projects/${encodeURIComponent(projectId)}/datasets`);
    request.withCredentials = true;
    request.responseType = "json";
    request.setRequestHeader("Accept", "application/json");

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const progress = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(progress);
        if (progress >= 100) {
          setUploadPhase("validating");
        }
      }
    };

    request.onload = () => {
      activeRequestRef.current = null;
      setUploadPhase("idle");
      const payload = responsePayload(request);
      if (request.status < 200 || request.status >= 300) {
        setUploadErrors(uploadErrorMessages(payload, request.status));
        return;
      }
      if (!isUploadResponse(payload)) {
        setUploadErrors(["The backend returned an unexpected upload response."]);
        return;
      }
      setUploadProgress(100);
      onDatasetUploaded?.({
        datasetId: payload.dataset_id,
        filename: payload.filename,
        rowCount: payload.validation_summary.row_count,
        datasetType: payload.validation_summary.dataset_type ?? "partial",
        status: "ready",
        startDate: payload.summary.start_date,
        endDate: payload.summary.end_date,
        annualPvEnergyKwh: payload.summary.annual_pv_energy_kwh,
        annualEvEnergyKwh: payload.summary.annual_ev_energy_kwh,
        pvPeakKw: payload.summary.pv_peak_kw,
        evPeakKw: payload.summary.ev_peak_kw,
        intervalMinutes: payload.validation_summary.interval_minutes,
        durationDays: payload.validation_summary.duration_days ?? null,
        timestampsGenerated: payload.validation_summary.timestamps_generated === true,
        notice: payload.validation_summary.notice ?? null,
        detectedColumns: payload.validation_summary.detected_columns,
      });
    };

    request.onerror = () => {
      activeRequestRef.current = null;
      setUploadPhase("idle");
      setUploadErrors([
        "The upload could not reach the backend. Make sure FastAPI is running on port 8000.",
      ]);
    };

    request.onabort = () => {
      activeRequestRef.current = null;
      setUploadPhase("idle");
    };

    request.send(formData);
  };

  const isBusy = uploadPhase !== "idle";
  const isPartialDataset = dataset?.datasetType === "partial";
  const annualMetrics = dataset
    ? [
        {
          label: isPartialDataset ? "Dataset PV energy" : "Annual PV energy",
          value: dataset.annualPvEnergyKwh,
          unit: "kWh",
          icon: SolarPowerRoundedIcon,
          color: "#b45309",
          background: "linear-gradient(135deg, #fef3c7, #fff7ed)",
        },
        {
          label: isPartialDataset ? "Dataset EV energy" : "Annual EV energy",
          value: dataset.annualEvEnergyKwh,
          unit: "kWh",
          icon: ElectricCarRoundedIcon,
          color: "#2563eb",
          background: "linear-gradient(135deg, #dbeafe, #eff6ff)",
        },
        {
          label: "PV peak",
          value: dataset.pvPeakKw,
          unit: "kW",
          icon: TrendingUpRoundedIcon,
          color: "#0f766e",
          background: "linear-gradient(135deg, #ccfbf1, #f0fdfa)",
        },
        {
          label: "EV peak",
          value: dataset.evPeakKw,
          unit: "kW",
          icon: QueryStatsRoundedIcon,
          color: "#7c3aed",
          background: "linear-gradient(135deg, #ede9fe, #f5f3ff)",
        },
      ]
    : [];

  const dailyMetrics = dayResult
    ? [
        { label: "Daily PV energy", value: dayResult.summary.pv_energy_kwh, unit: "kWh", icon: SolarPowerRoundedIcon, color: "#b45309", background: "#fff7ed" },
        { label: "Daily EV energy", value: dayResult.summary.ev_energy_kwh, unit: "kWh", icon: ElectricCarRoundedIcon, color: "#2563eb", background: "#eff6ff" },
        { label: "Energy surplus", value: dayResult.summary.surplus_energy_kwh, unit: "kWh", icon: TrendingUpRoundedIcon, color: "#0f766e", background: "#f0fdfa" },
        { label: "Energy deficit", value: dayResult.summary.deficit_energy_kwh, unit: "kWh", icon: TrendingDownRoundedIcon, color: "#dc2626", background: "#fef2f2" },
        { label: "PV peak", value: dayResult.summary.pv_peak_kw, unit: "kW", icon: QueryStatsRoundedIcon, color: "#ca8a04", background: "#fefce8" },
        { label: "EV peak", value: dayResult.summary.ev_peak_kw, unit: "kW", icon: QueryStatsRoundedIcon, color: "#7c3aed", background: "#f5f3ff" },
      ]
    : [];

  return (
    <Stack spacing={3}>
      <PageHeader
        eyebrow="PROJECT DATA"
        title="Dataset"
        subtitle="Upload, validate and explore the active PV and EV dataset."
        action={(
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            {!dataset ? (
              <Button variant="contained" startIcon={<CloudUploadRoundedIcon />} onClick={openFilePicker}>Upload Dataset</Button>
            ) : (
              <Button color="error" variant="outlined" startIcon={<DeleteOutlineRoundedIcon />} onClick={() => setRemoveTarget(dataset.datasetId)}>Remove Dataset</Button>
            )}
            {projectDatasets.length > 0 ? <Button variant="outlined" onClick={() => setProjectDatasetsOpen((open) => !open)}>Select Dataset</Button> : null}
            <Button variant="text" onClick={() => document.getElementById("day-explorer")?.scrollIntoView({ behavior: "smooth" })} disabled={!dataset}>Change Day</Button>
          </Stack>
        )}
      />

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2,minmax(0,1fr))", lg: "repeat(4,minmax(0,1fr))" }, gap: 1.5 }}>
        {[
          ["Active Dataset", dataset?.filename ?? "None"],
          ["Rows", dataset ? dataset.rowCount.toLocaleString() : "—"],
          ["Date Range", dataset ? `${dataset.startDate} → ${dataset.endDate}` : "—"],
        ].map(([label, value]) => (
          <SurfaceCard key={label} sx={{ p: 2, minHeight: 112 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>{label}</Typography>
            <Typography variant="h6" noWrap title={value} sx={{ mt: 1.2 }}>{value}</Typography>
          </SurfaceCard>
        ))}
        <SurfaceCard sx={{ p: 2, minHeight: 112 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>Status</Typography>
          <Box sx={{ mt: 1.35 }}><StatusChip label={dataset?.status === "ready" ? "Available" : dataset?.status === "expired" ? "Expired" : "Not selected"} tone={dataset?.status === "ready" ? "success" : dataset?.status === "expired" ? "error" : "neutral"} /></Box>
        </SurfaceCard>
      </Box>

      <Paper
        elevation={0}
        sx={{
          display: "none",
          position: "relative",
          overflow: "hidden",
          p: { xs: 2.5, sm: 3.5 },
          borderRadius: "26px",
          color: "#f8fafc",
          background: "linear-gradient(125deg, #0f766e 0%, #0b7189 52%, #1759a6 100%)",
          boxShadow: "0 22px 52px rgba(15, 94, 110, 0.18)",
          "&::after": {
            content: '\"\"',
            position: "absolute",
            width: 260,
            height: 260,
            borderRadius: "50%",
            right: -90,
            top: -140,
            bgcolor: "rgba(255,255,255,0.1)",
          },
        }}
      >
        <Box sx={{ position: "relative", zIndex: 1, maxWidth: 800 }}>
          <Typography variant="overline" sx={{ color: "#a7f3d0", fontWeight: 850, letterSpacing: "0.13em" }}>
            DATA WORKSPACE
          </Typography>
          <Typography variant="h4" sx={{ mt: 0.3, color: "#fff", fontSize: { xs: 29, sm: 37 } }}>
            Upload and explore an energy dataset
          </Typography>
          <Typography sx={{ mt: 1.2, maxWidth: 720, color: "rgba(240,253,250,0.82)", lineHeight: 1.7 }}>
            Upload PV and EV data, then explore 15-minute daily profiles.
          </Typography>
          <Stack direction="row" sx={{ mt: 2.2, flexWrap: "wrap", gap: 1 }}>
            <Chip label="CSV | 15-minute intervals" size="small" sx={{ bgcolor: "rgba(255,255,255,0.14)", color: "#fff", fontWeight: 750 }} />
            <Chip label="Temporary local storage" size="small" sx={{ bgcolor: "rgba(255,255,255,0.14)", color: "#fff", fontWeight: 750 }} />
            <Chip label="No simulation yet" size="small" sx={{ bgcolor: "rgba(255,255,255,0.14)", color: "#fff", fontWeight: 750 }} />
          </Stack>
        </Box>
      </Paper>

      {!dataset && (
      <Paper
        variant="outlined"
        sx={{ p: { xs: 2, sm: 2.75 }, borderRadius: "24px", borderColor: "divider", bgcolor: "background.paper" }}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{ mb: 2, justifyContent: "space-between", alignItems: { sm: "center" } }}
        >
          <Box>
            <Typography variant="h6">Dataset file</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              Map the required CSV columns before upload.
            </Typography>
          </Box>
          <Button
            type="button"
            variant="outlined"
            startIcon={<DownloadRoundedIcon />}
            onClick={downloadCsvTemplate}
            sx={{ alignSelf: { xs: "flex-start", sm: "center" }, borderRadius: "12px" }}
          >
            Download CSV Template
          </Button>
        </Stack>
        <Box
          role="button"
          tabIndex={0}
          aria-label="Choose or drop a CSV dataset"
          onClick={openFilePicker}
          onKeyDown={handleDropZoneKey}
          onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
          onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
          onDragLeave={(event) => { event.preventDefault(); setDragActive(false); }}
          onDrop={handleDrop}
          sx={{
            cursor: "pointer",
            p: { xs: 3, sm: 4.5 },
            borderRadius: "20px",
            border: "2px dashed",
            borderColor: dragActive ? "primary.main" : selectedFile ? "rgba(155,239,74,.45)" : "divider",
            textAlign: "center",
            background: dragActive
              ? "rgba(155,239,74,.06)"
              : selectedFile
                ? "rgba(76,141,255,.05)"
                : "#081522",
            transition: "border-color 180ms ease, background 180ms ease, transform 180ms ease",
            transform: dragActive ? "scale(1.006)" : "none",
            outline: "none",
            "&:focus-visible": { boxShadow: "0 0 0 4px rgba(15,118,110,0.16)" },
          }}
        >
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" hidden onChange={handleFileInput} />
          <Box
            sx={{
              mx: "auto",
              display: "grid",
              placeItems: "center",
              width: 62,
              height: 62,
              borderRadius: "19px",
              color: selectedFile ? "#0f766e" : "#2563eb",
              background: selectedFile ? "#ccfbf1" : "#dbeafe",
              boxShadow: "0 12px 28px rgba(37, 99, 235, 0.12)",
            }}
          >
            {selectedFile ? <InsertDriveFileRoundedIcon /> : <CloudUploadRoundedIcon />}
          </Box>
          <Typography variant="h6" sx={{ mt: 1.8, fontSize: 20 }}>
            {selectedFile ? selectedFile.name : "Drop your energy CSV here"}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.55 }}>
            {selectedFile
              ? `${formatFileSize(selectedFile.size)} | Ready for column mapping`
              : "or click to choose a file | maximum 25 MB"}
          </Typography>
        </Box>

        {selectedFile && (
          <Paper
            component="section"
            id="column-mapping"
            aria-labelledby="column-mapping-title"
            elevation={0}
            sx={{
              mt: 2.25,
              p: { xs: 2, sm: 2.5 },
              borderRadius: "20px",
              border: "1px solid",
              borderColor: "divider",
              bgcolor: "rgba(18,38,58,.72)",
            }}
          >
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "flex-start" }}>
              <Box
                sx={{
                  display: "grid",
                  placeItems: "center",
                  width: 42,
                  height: 42,
                  flexShrink: 0,
                  borderRadius: "13px",
                  color: "#0f766e",
                  bgcolor: "#ccfbf1",
                }}
              >
                <SettingsSuggestRoundedIcon fontSize="small" />
              </Box>
              <Box>
                <Typography id="column-mapping-title" variant="subtitle1" sx={{ fontWeight: 850 }}>
                  Column mapping
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Confirm the suggested matches.
                </Typography>
              </Box>
            </Stack>

            {headerLoading && (
              <Stack direction="row" spacing={1.2} sx={{ mt: 2, alignItems: "center" }}>
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">
                  Reading CSV header...
                </Typography>
              </Stack>
            )}

            {headerError && (
              <Alert severity="error" sx={{ mt: 2, borderRadius: "14px" }}>
                {headerError}
              </Alert>
            )}

            {!headerLoading && !headerError && availableColumns.length > 0 && (
              <>
                <Box
                  sx={{
                    mt: 2.25,
                    display: "grid",
                    gridTemplateColumns: {
                      xs: "1fr",
                      sm: "repeat(2, minmax(0, 1fr))",
                      xl: "repeat(4, minmax(0, 1fr))",
                    },
                    gap: 1.5,
                  }}
                >
                  <FormControl required size="small" fullWidth>
                    <InputLabel id="pv-column-label">PV column</InputLabel>
                    <Select
                      labelId="pv-column-label"
                      label="PV column"
                      value={pvColumn}
                      onChange={(event) => setPvColumn(event.target.value)}
                    >
                      {availableColumns.map((column) => (
                        <MenuItem key={column} value={column}>{column.trim()}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl required size="small" fullWidth>
                    <InputLabel id="ev-column-label">EV column</InputLabel>
                    <Select
                      labelId="ev-column-label"
                      label="EV column"
                      value={evColumn}
                      onChange={(event) => setEvColumn(event.target.value)}
                    >
                      {availableColumns.map((column) => (
                        <MenuItem key={column} value={column}>{column.trim()}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl size="small" fullWidth>
                    <InputLabel id="tariff-column-label">Tariff column (optional)</InputLabel>
                    <Select
                      labelId="tariff-column-label"
                      label="Tariff column (optional)"
                      value={tariffColumn}
                      onChange={(event) => setTariffColumn(event.target.value)}
                    >
                      <MenuItem value=""><em>Not included</em></MenuItem>
                      {availableColumns.map((column) => (
                        <MenuItem key={column} value={column}>{column.trim()}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl size="small" fullWidth>
                    <InputLabel id="timestamp-column-label">Timestamp column</InputLabel>
                    <Select
                      labelId="timestamp-column-label"
                      label="Timestamp column"
                      value={timestampColumn}
                      onChange={(event) => {
                        setTimestampColumn(event.target.value);
                        setTimestampGenerationConfirmed(false);
                      }}
                    >
                      <MenuItem value=""><em>No timestamp column</em></MenuItem>
                      {availableColumns.map((column) => (
                        <MenuItem key={column} value={column}>{column.trim()}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>

                {!mappingsAreDistinct && (
                  <Alert severity="error" sx={{ mt: 1.75, borderRadius: "14px" }}>
                    Each mapping must use a different CSV column.
                  </Alert>
                )}

                {needsGeneratedTimestamps && (
                  <Box sx={{ mt: 2 }}>
                    <Alert severity="warning" sx={{ borderRadius: "14px" }}>
                      {NO_TIMESTAMP_NOTICE}
                    </Alert>
                    <Box
                      sx={{
                        mt: 1.5,
                        display: "grid",
                        gridTemplateColumns: { xs: "1fr", md: "minmax(220px, 300px) 1fr" },
                        gap: { xs: 1, md: 2 },
                        alignItems: "center",
                      }}
                    >
                      <TextField
                        required
                        size="small"
                        label="Dataset start date"
                        type="date"
                        value={datasetStartDate}
                        onChange={(event) => {
                          setDatasetStartDate(event.target.value);
                          setTimestampGenerationConfirmed(false);
                        }}
                        slotProps={{ inputLabel: { shrink: true } }}
                      />
                      <FormControlLabel
                        control={(
                          <Checkbox
                            checked={timestampGenerationConfirmed}
                            onChange={(event) => setTimestampGenerationConfirmed(event.target.checked)}
                            disabled={!datasetStartDate}
                          />
                        )}
                        label="I confirm that timestamps should be generated from this start date in the original row order."
                        sx={{
                          m: 0,
                          alignItems: "flex-start",
                          "& .MuiFormControlLabel-label": { pt: 0.7, fontSize: 14 },
                        }}
                      />
                    </Box>
                  </Box>
                )}
              </>
            )}
          </Paper>
        )}

        <Stack direction="row" sx={{ mt: 2, justifyContent: "center" }}>
          <Button
            type="button"
            variant={selectedFile ? "contained" : "outlined"}
            startIcon={isBusy ? <CircularProgress size={16} color="inherit" /> : <CloudUploadRoundedIcon />}
            disabled={!uploadReady || isBusy}
            onClick={uploadDataset}
            sx={{ borderRadius: "12px", px: 2.4 }}
          >
            {uploadPhase === "uploading"
              ? "Uploading"
              : uploadPhase === "validating"
                ? "Validating dataset"
                : "Upload & validate"}
          </Button>
        </Stack>

        {isBusy && (
          <Box sx={{ mt: 2.2 }}>
            <Stack direction="row" sx={{ mb: 0.8, justifyContent: "space-between" }}>
              <Typography variant="caption" sx={{ fontWeight: 750 }}>
                {uploadPhase === "uploading" ? "Uploading CSV" : "Checking 15-minute data quality"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {uploadPhase === "uploading" ? `${uploadProgress}%` : "Processing..."}
              </Typography>
            </Stack>
            <LinearProgress
              variant={uploadPhase === "uploading" ? "determinate" : "indeterminate"}
              value={uploadProgress}
              sx={{ height: 8, borderRadius: 5 }}
            />
          </Box>
        )}
      </Paper>
      )}

      {uploadErrors.length > 0 && (
        <Alert severity="error" icon={<ErrorOutlineRoundedIcon />} sx={{ borderRadius: "18px", alignItems: "flex-start" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
            Dataset could not be accepted
          </Typography>
          <Box component="ul" sx={{ mt: 0.7, mb: 0, pl: 2.2 }}>
            {uploadErrors.map((message, index) => (
              <Typography component="li" variant="body2" key={`${message}-${index}`} sx={{ mb: 0.25 }}>
                {message}
              </Typography>
            ))}
          </Box>
        </Alert>
      )}

      {projectDatasets.length > 0 && (
        <Collapse in={projectDatasetsOpen}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: "20px", borderColor: "#dbe7ec" }}>
              <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
                <Typography variant="h6">Project Datasets</Typography>
                <Button size="small" endIcon={<ExpandMoreRoundedIcon sx={{ transform: "rotate(180deg)" }} />} onClick={() => setProjectDatasetsOpen(false)}>Close</Button>
              </Stack>
              <Stack spacing={1} sx={{ mt: 1.25 }}>
                {projectDatasets.map((item) => (
                  <Stack key={item.dataset_id} direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between", p: 1.25, borderRadius: "14px", bgcolor: item.dataset_id === dataset?.datasetId ? "rgba(155,239,74,.08)" : "rgba(255,255,255,.025)" }}>
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{item.filename}</Typography>
                      <Typography variant="caption" color="text.secondary">{item.row_count.toLocaleString()} rows · {item.start_date} to {item.end_date}</Typography>
                    </Box>
                    <Stack direction="row" spacing={0.75}>
                      <Button size="small" disabled={item.dataset_id === dataset?.datasetId || item.status !== "ready"} onClick={() => onUseDataset?.(item.dataset_id)}>
                        {item.dataset_id === dataset?.datasetId ? "Current" : "Use Dataset"}
                      </Button>
                      <Button size="small" color="error" onClick={() => setRemoveTarget(item.dataset_id)}>Remove</Button>
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            </Paper>
        </Collapse>
      )}

      {dataset && (
        <>
          {dataset.status === "expired" && (
            <Alert severity="error" icon={<ErrorOutlineRoundedIcon />} sx={{ borderRadius: "18px" }}>
              {DATASET_EXPIRED_MESSAGE}
            </Alert>
          )}
          <Alert severity={dataset.status === "ready" ? "success" : "info"} icon={<CloudDoneRoundedIcon />} sx={{ borderRadius: "18px" }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
              {dataset.status === "ready" ? "Dataset validated and stored temporarily" : "Saved dataset details"}
            </Typography>
            <Typography variant="body2">
              {dataset.rowCount.toLocaleString()} rows | {datasetTypeLabel(dataset.datasetType)}
              {dataset.durationDays
                ? ` (${dataset.durationDays.toLocaleString()} days)`
                : ""}
              {` | ${dataset.startDate} to ${dataset.endDate}`}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.3 }}>
              PV: {dataset.detectedColumns.pv} | EV: {dataset.detectedColumns.ev} | {dataset.detectedColumns.timestamp
                ? `Timestamp: ${dataset.detectedColumns.timestamp}`
                : "Timestamp: generated"}
              {dataset.detectedColumns.tariff
                ? ` | Tariff: ${dataset.detectedColumns.tariff}`
                : ""}
            </Typography>
          </Alert>

          {dataset.timestampsGenerated && (
            <Alert severity="info" sx={{ borderRadius: "18px" }}>
              {dataset.notice ?? NO_TIMESTAMP_NOTICE}
            </Alert>
          )}

          <Box component="section" aria-labelledby="annual-summary-title">
            <Stack direction="row" sx={{ mb: 1.7, justifyContent: "space-between", alignItems: "center" }}>
              <Box>
                <Typography id="annual-summary-title" variant="h6">
                  {isPartialDataset ? "Dataset summary" : "Annual summary"}
                </Typography>
                <Typography variant="body2" color="text.secondary">Calculated at 0.25 hours per interval.</Typography>
              </Box>
              <Chip icon={<CheckCircleRoundedIcon />} label="Validated" color="success" size="small" variant="outlined" />
            </Stack>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", xl: "repeat(4, minmax(0, 1fr))" }, gap: 1.8 }}>
              {annualMetrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
            </Box>
          </Box>

          <Paper id="day-explorer" variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: "22px", borderColor: "divider" }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}>
              <Box>
                <Typography variant="h6">Day explorer</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
                  Choose a date to view its 96 intervals.
                </Typography>
              </Box>
              <TextField
                label="Explore date"
                type="date"
                value={selectedDate ?? ""}
                onChange={(event) => onSelectedDateChange(event.target.value)}
                disabled={dayLoading || dataset.status === "expired"}
                slotProps={{
                  inputLabel: { shrink: true },
                  htmlInput: {
                    min: dataset.startDate,
                    max: dataset.endDate,
                  },
                  input: { startAdornment: <CalendarMonthRoundedIcon color="action" sx={{ mr: 1 }} /> },
                }}
                sx={{ minWidth: { sm: 230 } }}
              />
            </Stack>
          </Paper>

          {dayError && <Alert severity="error" sx={{ borderRadius: "16px" }}>{dayError}</Alert>}

          {dayLoading && (
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }, gap: 1.8 }}>
              {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} variant="rounded" height={112} sx={{ borderRadius: "20px" }} />)}
            </Box>
          )}

          {!dayLoading && dayResult && (
            <>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" }, gap: 1.8 }}>
                {dailyMetrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
              </Box>
              <CombinedStepChart points={dayResult.points} />
              <Paper
                component="aside"
                variant="outlined"
                sx={{
                  p: { xs: 2, sm: 2.25 },
                  borderRadius: "20px",
                  borderColor: "#dbe7ec",
                  background: "linear-gradient(135deg, #f0fdfa 0%, #f8fafc 52%, #eff6ff 100%)",
                  boxShadow: "0 10px 28px rgba(31, 49, 73, 0.045)",
                }}
              >
                <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                  <Box
                    sx={{
                      display: "grid",
                      placeItems: "center",
                      width: 44,
                      height: 44,
                      flexShrink: 0,
                      borderRadius: "14px",
                      color: "#0f766e",
                      bgcolor: "rgba(20, 184, 166, 0.13)",
                    }}
                  >
                    <BatteryChargingFullRoundedIcon />
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 850, color: "#173744" }}>
                      Battery profiles are not available yet
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, lineHeight: 1.6 }}>
                      Charging, discharging, and SOC appear after dispatch simulation.
                    </Typography>
                  </Box>
                </Stack>
              </Paper>
            </>
          )}
        </>
      )}

      <Dialog open={Boolean(removeTarget)} onClose={() => setRemoveTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>Remove Dataset</DialogTitle>
        <DialogContent>
          <Typography>Remove this dataset from the project? The upload option will become available when no active dataset remains.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveTarget(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (removeTarget) onRemoveDataset?.(removeTarget);
              setRemoveTarget(null);
            }}
          >
            Remove Dataset
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
