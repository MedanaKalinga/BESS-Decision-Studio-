export type ApplicationRoute =
  | { kind: "landing" }
  | { kind: "login" }
  | { kind: "register" }
  | { kind: "projects" }
  | { kind: "documentation" }
  | {
      kind: "project";
      projectId: string;
      surface:
        | "dashboard"
        | "dataset"
        | "dispatch"
        | "results"
        | "optimization"
        | "single-configuration"
        | "single-setup"
        | "single-run"
        | "comparison"
        | "comparison-ahp"
        | "comparison-recommendation"
        | "comparison-results";
    };

export function parseApplicationRoute(pathname: string): ApplicationRoute {
  if (pathname === "/login") return { kind: "login" };
  if (pathname === "/register") return { kind: "register" };
  if (pathname === "/projects") return { kind: "projects" };
  if (pathname === "/documentation" || pathname === "/documentation/") {
    return { kind: "documentation" };
  }
  const projectMatch = /^\/projects\/([^/]+)(?:(?:\/(dataset|dispatch|results))|(?:\/optimization(?:\/(single\/configuration|single\/setup|single\/run|comparison|comparison\/ahp|comparison\/recommendation|comparison\/results))?))?\/?$/.exec(pathname);
  if (projectMatch) {
    const workspaceSurface = projectMatch[2];
    const nested = projectMatch[3];
    const surface = workspaceSurface === "dataset"
      ? "dataset"
      : workspaceSurface === "dispatch"
        ? "dispatch"
        : workspaceSurface === "results"
          ? "results"
        : nested === "single/configuration"
          ? "single-configuration"
      : nested === "single/setup"
        ? "single-setup"
        : nested === "single/run"
          ? "single-run"
          : nested === "comparison/ahp"
            ? "comparison-ahp"
            : nested === "comparison/recommendation"
              ? "comparison-recommendation"
            : nested === "comparison/results"
              ? "comparison-results"
          : nested === "comparison"
            ? "comparison"
            : pathname.includes("/optimization")
              ? "optimization"
              : "dashboard";
    return {
      kind: "project",
      projectId: decodeURIComponent(projectMatch[1]),
      surface,
    };
  }
  return { kind: "landing" };
}

export function projectApplicationPath(
  projectId: string,
  surface: "dashboard" | "dataset" | "dispatch" | "results" = "dashboard",
): string {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  return surface === "dashboard" ? base : `${base}/${surface}`;
}

export type OptimizationRouteSurface =
  | "optimization"
  | "single-configuration"
  | "single-setup"
  | "single-run"
  | "comparison"
  | "comparison-ahp"
  | "comparison-recommendation"
  | "comparison-results";

export function projectOptimizationPath(
  projectId: string,
  surface: OptimizationRouteSurface = "optimization",
): string {
  const base = `${projectApplicationPath(projectId)}/optimization`;
  if (surface === "optimization") return base;
  if (surface === "comparison") return `${base}/comparison`;
  if (surface === "comparison-ahp") return `${base}/comparison/ahp`;
  if (surface === "comparison-recommendation") return `${base}/comparison/recommendation`;
  if (surface === "comparison-results") return `${base}/comparison/results`;
  return `${base}/single/${surface.replace("single-", "")}`;
}

export function isPublicApplicationRoute(route: ApplicationRoute): boolean {
  return route.kind === "landing" || route.kind === "login" || route.kind === "register";
}

export function authenticatedEntryPath(route: ApplicationRoute): string | null {
  return route.kind === "login" || route.kind === "register" ? "/projects" : null;
}
