const LEGACY_BATTERY_LABELS: Record<string, string> = {
  "Medium-high": "High",
};

export function batteryDisplayName(name: string): string {
  return LEGACY_BATTERY_LABELS[name] ?? name;
}

export function currentBatterySelectionId(id: string | null): string | null {
  return id === "medium-high" ? "high" : id;
}
