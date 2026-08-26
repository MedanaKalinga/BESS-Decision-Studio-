import type { ProjectSummary } from "./authProjects.ts";

export type LandingAuthMode = "login" | "register";
export type LandingAuthAction = "login" | "sign-up" | "get-started";
export type LandingSessionStatus = "loading" | "unauthenticated" | "authenticated";

export const LANDING_WORKFLOW_STEPS = [
  {
    title: "PV and EV Dataset",
    detail: "Validate 15-minute generation and demand data.",
  },
  {
    title: "GA-Based Sizing",
    detail: "GA optimizes each battery alternative and peak-support setting.",
  },
  {
    title: "AHP Weighting",
    detail: "AHP determines the five decision-criterion weights.",
  },
  {
    title: "PROMETHEE II Ranking",
    detail: "PROMETHEE II ranks feasible GA-optimized alternatives.",
  },
  {
    title: "Recommended BESS",
    detail: "Review the final ranked battery and its GA-optimized size.",
  },
] as const;

export function authModeForLandingAction(action: LandingAuthAction): LandingAuthMode {
  return action === "login" ? "login" : "register";
}

export function shouldShowPublicLanding(
  authStatus: LandingSessionStatus,
  requestedSurface: "landing" | "app",
): boolean {
  return requestedSurface === "landing" || authStatus !== "authenticated";
}

export function openWorkspaceDestination(
  projects: ProjectSummary[],
  activeProjectId: string | null,
): { page: "Dashboard" | "My Projects"; projectId: string | null } {
  const activeProject = projects.find(
    (project) =>
      project.project_id === activeProjectId && project.status === "active",
  );
  return activeProject
    ? { page: "Dashboard", projectId: activeProject.project_id }
    : { page: "My Projects", projectId: null };
}
