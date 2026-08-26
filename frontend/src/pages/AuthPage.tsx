import { useEffect, useState } from "react";
import BatteryChargingFullRoundedIcon from "@mui/icons-material/BatteryChargingFullRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import LockRoundedIcon from "@mui/icons-material/LockRounded";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import {
  Alert,
  Box,
  Button,
  Divider,
  FormHelperText,
  FormLabel,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { loginUser, registerUser, type AuthUser } from "../lib/authProjects";
import { registrationCompletion } from "../lib/authWorkflow";
import { designTokens } from "../theme";

const authInputSx = {
  "& .MuiOutlinedInput-root": {
    borderRadius: 2.5,
    backgroundColor: "#081522",
  },
  "& input:-webkit-autofill": {
    WebkitBoxShadow: "0 0 0 100px #081522 inset",
    WebkitTextFillColor: designTokens.text.primary,
    caretColor: designTokens.text.primary,
    transition: "background-color 9999s ease-out 0s",
  },
};

function AuthInput({
  id,
  label,
  type = "text",
  value,
  autoComplete,
  helperText,
  onChange,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  autoComplete: string;
  helperText?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Stack spacing={0.75}>
      <FormLabel htmlFor={id} required sx={{ color: "text.secondary", fontWeight: 750 }}>
        {label}
      </FormLabel>
      <TextField
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        required
        fullWidth
        sx={authInputSx}
      />
      {helperText ? <FormHelperText sx={{ mx: 0 }}>{helperText}</FormHelperText> : null}
    </Stack>
  );
}

export default function AuthPage({
  onAuthenticated,
  serviceError = null,
  initialMode = "login",
  embedded = false,
  onModeChange,
}: {
  onAuthenticated: (user: AuthUser) => void | Promise<void>;
  serviceError?: string | null;
  initialMode?: "login" | "register";
  embedded?: boolean;
  onModeChange?: (mode: "login" | "register") => void;
}) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [serviceErrorDismissed, setServiceErrorDismissed] = useState(false);

  useEffect(() => {
    setMode(initialMode);
    setError(null);
    if (initialMode === "register") setNotice(null);
    setServiceErrorDismissed(false);
  }, [initialMode]);

  const submit = async () => {
    setError(null);
    setServiceErrorDismissed(true);
    if (mode === "register" && password.length < 8) {
      setError("Password must contain at least 8 characters.");
      return;
    }
    if (mode === "register" && password.length > 72) {
      setError("Password must contain no more than 72 characters.");
      return;
    }
    if (mode === "register" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "register") {
        await registerUser(displayName, email, password);
        const completion = registrationCompletion(email);
        setMode(completion.mode);
        setEmail(completion.email);
        setDisplayName("");
        setPassword("");
        setConfirmPassword("");
        setNotice(completion.message);
        onModeChange?.(completion.mode);
        return;
      }
      setNotice(null);
      await onAuthenticated(await loginUser(email, password));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const content = (
    <Box
      sx={{
        width: "100%",
        maxWidth: embedded ? 980 : 1060,
        minHeight: { sm: 610 },
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: ".92fr 1.08fr" },
        bgcolor: designTokens.surface.card,
        border: embedded ? 0 : `1px solid ${designTokens.border}`,
        borderRadius: embedded ? 0 : 4,
        overflow: "hidden",
        boxShadow: embedded ? "none" : "0 34px 100px rgba(0,0,0,.4)",
      }}
    >
      <Box
        sx={{
          display: { xs: "none", md: "flex" },
          flexDirection: "column",
          justifyContent: "space-between",
          p: 5,
          background:
            "radial-gradient(circle at 25% 20%,rgba(155,239,74,.18),transparent 32%), radial-gradient(circle at 80% 80%,rgba(76,141,255,.2),transparent 35%), #081522",
          borderRight: `1px solid ${designTokens.border}`,
        }}
      >
        <Stack direction="row" spacing={1.2} sx={{ alignItems: "center" }}>
          <Box sx={{ width: 42, height: 42, display: "grid", placeItems: "center", borderRadius: 2.5, color: "#07111D", bgcolor: "primary.main" }}>
            <BatteryChargingFullRoundedIcon />
          </Box>
          <Typography sx={{ fontWeight: 900 }}>BESS Decision Platform</Typography>
        </Stack>

        <Box>
          <Typography variant="overline" sx={{ color: "primary.main", fontWeight: 900, letterSpacing: ".14em" }}>ENERGY DECISION WORKSPACE</Typography>
          <Typography variant="h3" sx={{ mt: 1.5, maxWidth: 420 }}>Build a traceable BESS study.</Typography>
          <Typography color="text.secondary" sx={{ mt: 1.5, maxWidth: 410 }}>
            Keep datasets, optimization runs and final decisions together.
          </Typography>
          <Stack direction="row" spacing={1.2} sx={{ mt: 4 }}>
            {[SolarPowerRoundedIcon, BatteryChargingFullRoundedIcon, BoltRoundedIcon].map((Icon, index) => (
              <Box key={index} sx={{ width: 54, height: 54, display: "grid", placeItems: "center", borderRadius: 2.5, color: index === 2 ? "secondary.main" : "primary.main", bgcolor: "rgba(255,255,255,.045)", border: `1px solid ${designTokens.border}` }}>
                <Icon />
              </Box>
            ))}
          </Stack>
        </Box>

        <Typography variant="caption" color="text.secondary">PV · EV · BESS · Grid</Typography>
      </Box>

      <Box sx={{ p: { xs: 3, sm: 5, md: 6 }, display: "flex", alignItems: "center" }}>
        <Stack spacing={2.2} sx={{ width: "100%", maxWidth: 440, mx: "auto" }}>
          <Box>
            <Typography component={embedded ? "h3" : "h1"} variant="h4">{mode === "login" ? "Welcome back" : "Create your account"}</Typography>
            <Typography color="text.secondary" sx={{ mt: .6 }}>{mode === "login" ? "Sign in to open your projects." : "Start a new BESS research workspace."}</Typography>
          </Box>
          {notice ? <Alert severity="success">{notice}</Alert> : null}
          {error || (!serviceErrorDismissed && serviceError) ? <Alert severity="error">{error ?? serviceError}</Alert> : null}
          {mode === "register" ? <AuthInput id="auth-display-name" label="Display name" value={displayName} onChange={setDisplayName} autoComplete="name" /> : null}
          <AuthInput id="auth-email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
          <AuthInput id="auth-password" label="Password" type="password" value={password} onChange={setPassword} autoComplete={mode === "login" ? "current-password" : "new-password"} helperText={mode === "register" ? "Use 8–72 characters." : undefined} />
          {mode === "register" ? <AuthInput id="auth-confirm-password" label="Confirm password" type="password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" /> : null}
          <Button variant="contained" size="large" startIcon={<LockRoundedIcon />} disabled={submitting || !email || !password || (mode === "register" && (!displayName || !confirmPassword))} onClick={() => void submit()}>
            {submitting ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
          </Button>
          <Divider />
          <Button
            color="inherit"
            onClick={() => {
              const nextMode = mode === "login" ? "register" : "login";
              setMode(nextMode);
              setError(null);
              setNotice(null);
              setServiceErrorDismissed(true);
              onModeChange?.(nextMode);
            }}
          >
            {mode === "login" ? "Create an account" : "Already have an account? Sign in"}
          </Button>
        </Stack>
      </Box>
    </Box>
  );

  if (embedded) return content;

  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: { xs: 0, sm: 3 }, bgcolor: "background.default" }}>
      {content}
    </Box>
  );
}

//seperate docs