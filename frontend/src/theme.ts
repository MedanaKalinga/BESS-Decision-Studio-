import { createTheme } from "@mui/material/styles";

export const designTokens = {
  background: {
    main: "#07111D",
    sidebar: "#081522",
  },
  surface: {
    card: "#0D1D2D",
    elevated: "#12263A",
  },
  accent: {
    lime: "#9BEF4A",
    limeHover: "#83D63B",
    blue: "#4C8DFF",
  },
  text: {
    primary: "#F4F8FC",
    secondary: "#94A6BA",
  },
  border: "rgba(148,166,186,0.18)",
  warning: "#F5A742",
  error: "#F06464",
} as const;

export const appTheme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: designTokens.accent.lime,
      dark: designTokens.accent.limeHover,
      light: "#C6FF8E",
      contrastText: "#07111D",
    },
    secondary: {
      main: designTokens.accent.blue,
    },
    background: {
      default: designTokens.background.main,
      paper: designTokens.surface.card,
    },
    text: designTokens.text,
    divider: designTokens.border,
    success: { main: "#63D69A" },
    info: { main: designTokens.accent.blue },
    warning: { main: designTokens.warning },
    error: { main: designTokens.error },
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: { fontWeight: 850, letterSpacing: "-0.045em" },
    h2: { fontWeight: 820, letterSpacing: "-0.035em" },
    h3: { fontWeight: 800, letterSpacing: "-0.03em" },
    h4: { fontWeight: 780, letterSpacing: "-0.03em" },
    h6: { fontWeight: 750, letterSpacing: "-0.015em" },
    button: { fontWeight: 780, textTransform: "none" },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundImage:
            "radial-gradient(circle at 50% -20%, rgba(76,141,255,.09), transparent 38%)",
        },
        "::selection": {
          background: "rgba(155,239,74,.28)",
        },
        "@media (prefers-reduced-motion: reduce)": {
          "*, *::before, *::after": {
            animationDuration: "0.01ms !important",
            animationIterationCount: "1 !important",
            transitionDuration: "0.01ms !important",
            scrollBehavior: "auto !important",
          },
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 10, minHeight: 40 },
        contained: {
          boxShadow: "0 10px 26px rgba(155,239,74,.12)",
          "&:hover": { backgroundColor: designTokens.accent.limeHover },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: "none" },
      },
    },
    MuiCard: {
      styleOverrides: { root: { backgroundImage: "none" } },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: "rgba(7,17,29,.46)",
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: "rgba(155,239,74,.46)",
          },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          border: `1px solid ${designTokens.border}`,
          backgroundColor: designTokens.surface.card,
        },
      },
    },
    MuiButtonBase: {
      styleOverrides: {
        root: {
          "&.Mui-focusVisible": {
            outline: `3px solid ${designTokens.accent.blue}`,
            outlineOffset: 2,
          },
        },
      },
    },
  },
});
