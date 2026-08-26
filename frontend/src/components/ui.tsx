import type { ReactNode } from "react";
import { Box, Chip, Paper, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { designTokens } from "../theme";

export function SurfaceCard({
  children,
  sx,
}: {
  children: ReactNode;
  sx?: SxProps<Theme>;
}) {
  return (
    <Paper
      elevation={0}
      sx={[
        {
          border: `1px solid ${designTokens.border}`,
          borderRadius: 3,
          bgcolor: designTokens.surface.card,
          transition: "transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease",
          "&:hover": {
            borderColor: "rgba(155,239,74,.3)",
            boxShadow: "0 18px 48px rgba(0,0,0,.2)",
          },
          "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Paper>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={2}
      sx={{ justifyContent: "space-between", alignItems: { sm: "flex-end" } }}
    >
      <Box>
        {eyebrow ? (
          <Typography variant="overline" sx={{ color: "primary.main", fontWeight: 850, letterSpacing: ".12em" }}>
            {eyebrow}
          </Typography>
        ) : null}
        <Typography component="h1" variant="h4">{title}</Typography>
        {subtitle ? <Typography color="text.secondary" sx={{ mt: 0.6 }}>{subtitle}</Typography> : null}
      </Box>
      {action}
    </Stack>
  );
}

export function StatusChip({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "info" | "success" | "warning" | "error";
}) {
  const color = tone === "neutral" ? "default" : tone;
  return (
    <Chip
      label={label}
      color={color}
      variant={tone === "neutral" ? "outlined" : "filled"}
      size="small"
      sx={{ fontWeight: 800, borderColor: designTokens.border }}
    />
  );
}

export function MetricCard({
  label,
  value,
  supporting,
  icon,
}: {
  label: string;
  value: ReactNode;
  supporting?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <SurfaceCard sx={{ p: 2.25, minHeight: 148 }}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800, letterSpacing: ".04em" }}>
          {label}
        </Typography>
        {icon ? <Box sx={{ color: "primary.main" }}>{icon}</Box> : null}
      </Stack>
      <Typography variant="h4" sx={{ mt: 1.8, fontWeight: 850 }}>{value}</Typography>
      {supporting ? <Box sx={{ mt: 1, color: "text.secondary" }}>{supporting}</Box> : null}
    </SurfaceCard>
  );
}

export function EmptyState({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) {
  return (
    <SurfaceCard sx={{ p: { xs: 4, sm: 6 }, textAlign: "center" }}>
      <Box sx={{ color: "primary.main", mb: 1.5 }}>{icon}</Box>
      <Typography variant="h6">{title}</Typography>
      {action ? <Box sx={{ mt: 2.5 }}>{action}</Box> : null}
    </SurfaceCard>
  );
}

