import { useState } from "react";
import AccountTreeRoundedIcon from "@mui/icons-material/AccountTreeRounded";
import AnalyticsRoundedIcon from "@mui/icons-material/AnalyticsRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import BatteryChargingFullRoundedIcon from "@mui/icons-material/BatteryChargingFullRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import CompareArrowsRoundedIcon from "@mui/icons-material/CompareArrowsRounded";
import ElectricCarRoundedIcon from "@mui/icons-material/ElectricCarRounded";
import FolderCopyRoundedIcon from "@mui/icons-material/FolderCopyRounded";
import LockPersonRoundedIcon from "@mui/icons-material/LockPersonRounded";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import ScaleRoundedIcon from "@mui/icons-material/ScaleRounded";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import {
  AppBar,
  Box,
  Button,
  Container,
  Drawer,
  IconButton,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material";
import type { SvgIconComponent } from "@mui/icons-material";
import {
  LANDING_WORKFLOW_STEPS,
  authModeForLandingAction,
  type LandingAuthAction,
  type LandingAuthMode,
} from "../lib/landingRouting.ts";
import { SurfaceCard } from "../components/ui";
import { designTokens } from "../theme";

interface LandingPageProps {
  authenticated: boolean;
  displayName?: string | null;
  onOpenAuth: (mode: LandingAuthMode) => void;
  onOpenWorkspace: () => void;
  onViewProjects: () => void;
}

const capabilities: Array<{ title: string; detail: string; icon: SvgIconComponent }> = [
  { title: "Multi-Project Studies", detail: "Keep each research workspace and its evidence separate.", icon: FolderCopyRoundedIcon },
  { title: "Dataset Analysis", detail: "Validate and explore PV and EV profiles at 15-minute resolution.", icon: AnalyticsRoundedIcon },
  { title: "Single BESS Optimization", detail: "Optimize capacity and peak-support settings for one battery.", icon: TuneRoundedIcon },
  { title: "Battery Comparison", detail: "Optimize enabled battery alternatives with the same study inputs.", icon: CompareArrowsRoundedIcon },
  { title: "AHP Decision Weighting", detail: "Set criterion importance through consistent pairwise judgments.", icon: ScaleRoundedIcon },
  { title: "PROMETHEE II Ranking", detail: "Rank the feasible GA-optimized battery alternatives.", icon: AccountTreeRoundedIcon },
];

function BrandMark() {
  return (
    <Stack direction="row" spacing={1.1} sx={{ alignItems: "center" }}>
      <Box
        sx={{
          width: 38,
          height: 38,
          borderRadius: 2.5,
          display: "grid",
          placeItems: "center",
          color: "#07111D",
          bgcolor: "primary.main",
          boxShadow: "0 0 0 5px rgba(155,239,74,.08)",
        }}
      >
        <BatteryChargingFullRoundedIcon fontSize="small" />
      </Box>
      <Box>
        <Typography sx={{ color: "text.primary", fontWeight: 900, lineHeight: 1.05 }}>
          BESS Decision
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", letterSpacing: ".12em" }}>
          PLATFORM
        </Typography>
      </Box>
    </Stack>
  );
}

function HeroVisual() {
  return (
    <Box
      role="img"
      aria-label="Electric vehicle, solar generation, and battery energy system"
      sx={{
        position: "relative",
        minHeight: { xs: 400, sm: 500, lg: 590 },
        borderRadius: { xs: 4, lg: 6 },
        overflow: "hidden",
        border: `1px solid ${designTokens.border}`,
        backgroundColor: "#0A1724",
        backgroundImage:
          "linear-gradient(180deg,rgba(7,17,29,.04),rgba(7,17,29,.88)), url('/landing/ev-solar-bess-hero.jpg')",
        backgroundPosition: "center",
        backgroundSize: "cover",
        boxShadow: "0 38px 100px rgba(0,0,0,.42)",
        isolation: "isolate",
        "&::before": {
          content: '\"\"',
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 72% 28%,rgba(155,239,74,.18),transparent 23%), radial-gradient(circle at 20% 78%,rgba(76,141,255,.2),transparent 28%)",
        },
      }}
    >
      <Box
        sx={{
          position: "absolute",
          left: { xs: 16, sm: 24 },
          right: { xs: 16, sm: 24 },
          bottom: { xs: 16, sm: 24 },
          display: "grid",
          gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(4, minmax(0, 1fr))" },
          gap: { xs: 1, sm: 1.25 },
        }}
      >
        {[
          [SolarPowerRoundedIcon, "PV", "Generation"],
          [ElectricCarRoundedIcon, "EV", "Demand"],
          [BatteryChargingFullRoundedIcon, "BESS", "Storage"],
          [BoltRoundedIcon, "Grid", "Exchange"],
        ].map(([Icon, title, subtitle]) => {
          const NodeIcon = Icon as SvgIconComponent;
          return (
            <Box
              key={title as string}
              sx={{
                minWidth: 0,
                minHeight: { xs: 68, sm: 76 },
                px: { xs: 1.1, sm: 1.35 },
                py: 1.1,
                display: "flex",
                alignItems: "center",
                gap: { xs: 1, sm: 1.15 },
                bgcolor: "rgba(8,21,34,.88)",
                border: `1px solid ${designTokens.border}`,
                borderRadius: 2.5,
                backdropFilter: "blur(14px)",
              }}
            >
              <Box
                sx={{
                  width: { xs: 34, sm: 38 },
                  height: { xs: 34, sm: 38 },
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 2,
                  color: "primary.main",
                  bgcolor: "rgba(155,239,74,.1)",
                  border: "1px solid rgba(155,239,74,.18)",
                }}
              >
                <NodeIcon sx={{ fontSize: { xs: 19, sm: 21 } }} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography component="span" variant="subtitle2" sx={{ display: "block", fontWeight: 850, lineHeight: 1.2 }}>{title as string}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.2, lineHeight: 1.2 }}>{subtitle as string}</Typography>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

export default function LandingPage({
  authenticated,
  displayName,
  onOpenAuth,
  onOpenWorkspace,
  onViewProjects,
}: LandingPageProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const openAuth = (action: LandingAuthAction) => {
    setMobileOpen(false);
    onOpenAuth(authModeForLandingAction(action));
  };

  const nav = (
    <Stack direction={{ xs: "column", md: "row" }} spacing={1} sx={{ alignItems: { md: "center" } }}>
      <Button color="inherit" href="#how-it-works">How It Works</Button>
      <Button color="inherit" href="#capabilities">Capabilities</Button>
      {authenticated ? (
        <Button variant="contained" onClick={onOpenWorkspace} endIcon={<ArrowForwardRoundedIcon />}>Open Workspace</Button>
      ) : (
        <>
          <Button color="inherit" onClick={() => openAuth("login")}>Sign In</Button>
          <Button variant="contained" onClick={() => openAuth("get-started")}>Get Started</Button>
        </>
      )}
    </Stack>
  );

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#07111D", color: "text.primary", overflowX: "hidden" }}>
      <AppBar
        position="sticky"
        elevation={0}
        sx={{ bgcolor: "rgba(7,17,29,.82)", backdropFilter: "blur(18px)", borderBottom: `1px solid ${designTokens.border}` }}
      >
        <Container maxWidth="xl">
          <Toolbar disableGutters sx={{ minHeight: "72px !important", justifyContent: "space-between" }}>
            <BrandMark />
            <Box sx={{ display: { xs: "none", md: "block" } }}>{nav}</Box>
            <IconButton aria-label="Open public navigation" onClick={() => setMobileOpen(true)} sx={{ display: { md: "none" } }}>
              <MenuRoundedIcon />
            </IconButton>
          </Toolbar>
        </Container>
      </AppBar>

      <Drawer
        anchor="right"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        slotProps={{ paper: { sx: { width: "min(88vw, 340px)", p: 2.5, bgcolor: designTokens.background.sidebar } } }}
      >
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 3 }}>
          <BrandMark />
          <IconButton aria-label="Close public navigation" onClick={() => setMobileOpen(false)}><CloseRoundedIcon /></IconButton>
        </Stack>
        {nav}
      </Drawer>

      <Box component="main">
        <Container maxWidth="xl" sx={{ py: { xs: 7, md: 11 } }}>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0,1fr) minmax(520px,.95fr)" }, gap: { xs: 6, lg: 8 }, alignItems: "center" }}>
            <Box sx={{ animation: "landingEnter .55s ease-out", "@keyframes landingEnter": { from: { opacity: 0, transform: "translateY(12px)" }, to: { opacity: 1, transform: "none" } }, "@media (prefers-reduced-motion: reduce)": { animation: "none" } }}>
              <Typography variant="overline" sx={{ color: "primary.main", fontWeight: 900, letterSpacing: ".15em" }}>
                BESS OPTIMIZATION AND DECISION PLATFORM
              </Typography>
              <Typography component="h1" variant="h1" sx={{ mt: 1.7, fontSize: { xs: "2.75rem", sm: "4.25rem", xl: "5.1rem" }, lineHeight: .99, maxWidth: 850 }}>
                Optimize, Compare and Select the <Box component="span" sx={{ color: "primary.main" }}>Right BESS</Box>
              </Typography>
              <Typography sx={{ mt: 2.5, maxWidth: 690, color: "text.secondary", fontSize: { xs: "1rem", sm: "1.12rem" }, lineHeight: 1.65 }}>
                Dataset-driven battery sizing, lifecycle evaluation and multi-criteria decision support for PV-integrated EV charging systems.
              </Typography>
              {authenticated && displayName ? <Typography sx={{ mt: 1.5, color: "primary.main", fontWeight: 750 }}>Welcome back, {displayName}.</Typography> : null}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ mt: 3.5 }}>
                <Button variant="contained" size="large" endIcon={<ArrowForwardRoundedIcon />} onClick={authenticated ? onOpenWorkspace : () => openAuth("get-started")}>
                  {authenticated ? "Open Workspace" : "Get Started"}
                </Button>
                <Button variant="outlined" size="large" onClick={authenticated ? onViewProjects : () => openAuth("login")}>
                  {authenticated ? "View Projects" : "Sign In"}
                </Button>
              </Stack>
            </Box>
            <HeroVisual />
          </Box>
        </Container>

        <Box component="section" id="how-it-works" sx={{ py: { xs: 8, md: 10 }, bgcolor: "#081522", scrollMarginTop: 80 }}>
          <Container maxWidth="xl">
            <Typography variant="overline" sx={{ color: "primary.main", fontWeight: 900, letterSpacing: ".14em" }}>HOW IT WORKS</Typography>
            <Typography component="h2" variant="h3" sx={{ mt: .6 }}>From data to decision</Typography>
            <Box sx={{ mt: 4, display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(5,minmax(0,1fr))" }, gap: 1.5 }}>
              {LANDING_WORKFLOW_STEPS.map((step, index) => (
                <SurfaceCard key={step.title} sx={{ p: 2.25, position: "relative" }}>
                  <Typography variant="overline" sx={{ color: "primary.main", fontWeight: 900 }}>0{index + 1}</Typography>
                  <Typography component="h3" variant="subtitle1" sx={{ mt: .5, fontWeight: 850 }}>{step.title}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: .7 }}>{step.detail}</Typography>
                </SurfaceCard>
              ))}
            </Box>
          </Container>
        </Box>

        <Box component="section" id="capabilities" sx={{ py: { xs: 8, md: 10 }, scrollMarginTop: 80 }}>
          <Container maxWidth="xl">
            <Typography variant="overline" sx={{ color: "primary.main", fontWeight: 900, letterSpacing: ".14em" }}>CAPABILITIES</Typography>
            <Typography component="h2" variant="h3" sx={{ mt: .6 }}>Built for BESS research</Typography>
            <Box sx={{ mt: 4, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2,minmax(0,1fr))", lg: "repeat(3,minmax(0,1fr))" }, gap: 2 }}>
              {capabilities.map(({ title, detail, icon: Icon }) => (
                <SurfaceCard key={title} sx={{ p: 2.5 }}>
                  <Box sx={{ width: 42, height: 42, display: "grid", placeItems: "center", borderRadius: 2.3, color: "primary.main", bgcolor: "rgba(155,239,74,.08)" }}><Icon /></Box>
                  <Typography component="h3" variant="h6" sx={{ mt: 1.6 }}>{title}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: .5 }}>{detail}</Typography>
                </SurfaceCard>
              ))}
            </Box>
          </Container>
        </Box>

        <Box component="section" sx={{ py: { xs: 8, md: 9 }, bgcolor: "#081522" }}>
          <Container maxWidth="lg">
            <SurfaceCard sx={{ p: { xs: 3, md: 4 }, bgcolor: "#0B1B2A" }}>
              <Stack direction={{ xs: "column", md: "row" }} spacing={3} sx={{ alignItems: { md: "center" } }}>
                <Box sx={{ width: 58, height: 58, display: "grid", placeItems: "center", borderRadius: 3, color: "primary.main", bgcolor: "rgba(155,239,74,.08)" }}><LockPersonRoundedIcon /></Box>
                <Box>
                  <Typography component="h2" variant="h4">Data and project privacy</Typography>
                  <Stack component="ul" spacing={.5} sx={{ mt: 1.5, mb: 0, pl: 2.3, color: "text.secondary" }}>
                    <Typography component="li">Every user accesses only their own projects.</Typography>
                    <Typography component="li">Project datasets and results remain separate.</Typography>
                    <Typography component="li">Saved jobs and valid checkpoints can be recovered.</Typography>
                  </Stack>
                </Box>
              </Stack>
            </SurfaceCard>
          </Container>
        </Box>

        <Box component="section" sx={{ py: { xs: 8, md: 11 } }}>
          <Container maxWidth="md">
            <SurfaceCard sx={{ p: { xs: 4, md: 6 }, textAlign: "center", background: "linear-gradient(135deg,rgba(155,239,74,.10),rgba(76,141,255,.10))" }}>
              <Typography component="h2" variant="h3">Start Your BESS Study</Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ mt: 3, justifyContent: "center" }}>
                <Button variant="contained" size="large" onClick={authenticated ? onOpenWorkspace : () => openAuth("get-started")}>{authenticated ? "Open Workspace" : "Get Started"}</Button>
                {!authenticated ? <Button variant="outlined" size="large" onClick={() => openAuth("login")}>Sign In</Button> : null}
              </Stack>
            </SurfaceCard>
          </Container>
        </Box>
      </Box>

      <Box component="footer" sx={{ py: 3, borderTop: `1px solid ${designTokens.border}`, bgcolor: "#081522" }}>
        <Container maxWidth="xl">
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
            <BrandMark />
            <Typography variant="caption" color="text.secondary">BESS sizing and battery-selection research platform.</Typography>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}
