const LEGACY_BATTERY_LABELS: Record<string, string> = {
  "Medium-high": "High",
};

export function batteryDisplayName(name: string): string {
  return LEGACY_BATTERY_LABELS[name] ?? name;
}

const BATTERY_TYPE_LABELS: Record<string, string> = {
  "Low-cost": "Type 1",
  "Medium-low": "Type 2",
  Medium: "Type 3",
  High: "Type 4",
};

export function batteryTypeLabel(name: string): string {
  const currentName = batteryDisplayName(name);
  return BATTERY_TYPE_LABELS[currentName] ?? currentName;
}

export function currentBatterySelectionId(id: string | null): string | null {
  return id === "medium-high" ? "high" : id;
}
