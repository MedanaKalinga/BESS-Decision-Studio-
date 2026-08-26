export function isShellNavigationActive(activePage: string, targetPage: string | undefined): boolean {
  return Boolean(targetPage && activePage === targetPage);
}

export function nextMobileDrawerState(action: "open" | "close" | "navigate"): boolean {
  return action === "open";
}

export function shouldUseMotion(prefersReducedMotion: boolean): boolean {
  return !prefersReducedMotion;
}

