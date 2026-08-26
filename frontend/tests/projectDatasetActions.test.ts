import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const projectsSource = readFileSync(new URL("../src/pages/ProjectsPage.tsx", import.meta.url), "utf8");
const datasetSource = readFileSync(new URL("../src/pages/DataUploadPage.tsx", import.meta.url), "utf8");

test("project cards expose rename/edit and delete without an archive action", () => {
  assert.match(projectsSource, /Rename \/ Edit/);
  assert.match(projectsSource, />\s*Delete\s*</);
  assert.match(projectsSource, /Delete Project/);
  assert.doesNotMatch(projectsSource, /Archive Project|>Archive</);
});

test("dataset upload is replaced by remove when an active dataset exists", () => {
  assert.match(datasetSource, /!dataset \? \([\s\S]*Upload Dataset[\s\S]*Remove Dataset/);
  assert.match(datasetSource, /\{!dataset && \([\s\S]*Dataset file/);
});

test("removing a dataset uses confirmation and restores the empty upload state through the parent", () => {
  assert.match(datasetSource, /<DialogTitle>Remove Dataset<\/DialogTitle>/);
  assert.match(datasetSource, /onRemoveDataset\?\.\(removeTarget\)/);
});
