import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseApplicationRoute } from "../src/lib/appRouting.ts";
import { documentationUrl } from "../src/lib/documentationLinks.ts";

const documentationSource = readFileSync(
  new URL("../src/pages/DocumentationPage.tsx", import.meta.url),
  "utf8",
);
const appSource = readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);

test("documentation route remains an authenticated internal surface", () => {
  assert.deepEqual(parseApplicationRoute("/documentation"), { kind: "documentation" });
  assert.match(appSource, /lazy\(\(\) => import\("\.\/pages\/DocumentationPage"\)\)/);
});

test("Documentation overview defines exactly six guide cards", () => {
  assert.equal(documentationSource.match(/title: "/g)?.length, 6);
});

test("Documentation overview includes the full-guide action", () => {
  assert.match(documentationSource, />\s*Open Full Documentation\s*</);
});

test("documentation URL helper normalizes home and section paths", () => {
  assert.equal(
    documentationUrl(),
    "https://MedanaKalinga.github.io/BESS-Decision-Studio-Docs/",
  );
  assert.equal(
    documentationUrl("/ahp/"),
    "https://MedanaKalinga.github.io/BESS-Decision-Studio-Docs/ahp/",
  );
});

test("all Documentation links use safe new-tab attributes", () => {
  assert.equal(documentationSource.match(/target="_blank"/g)?.length, 2);
  assert.equal(documentationSource.match(/rel="noopener noreferrer"/g)?.length, 2);
});

test("sidebar Documentation action routes internally", () => {
  assert.match(appSource, /label: "Documentation"[\s\S]*?page: "Documentation"/);
  assert.match(appSource, /page === "Documentation"[\s\S]*?navigate\("\/documentation"\)/);
});
