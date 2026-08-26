const DEFAULT_DOCUMENTATION_URL =
  "https://MedanaKalinga.github.io/BESS-Decision-Studio-Docs";

function normalizedDocumentationBaseUrl(): string {
  const configuredUrl = import.meta.env?.VITE_DOCUMENTATION_URL?.trim();
  return (configuredUrl || DEFAULT_DOCUMENTATION_URL).replace(/\/+$/, "");
}

export function documentationUrl(path = ""): string {
  const normalizedPath = path.trim().replace(/^\/+|\/+$/g, "");
  const baseUrl = normalizedDocumentationBaseUrl();
  return normalizedPath ? `${baseUrl}/${normalizedPath}/` : `${baseUrl}/`;
}
