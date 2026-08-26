import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/pages/SingleOptimizationRun.tsx", import.meta.url), "utf8");

test("single optimization run status uses a dark readable surface", () => {
  assert.match(source, /background: "linear-gradient\(135deg, #0D1D2D, #102438\)"/);
  assert.match(source, /color: "text\.primary", fontWeight: 880/);
  assert.match(source, /bgcolor: "rgba\(148,166,186,0\.16\)"/);
});

test("run metric and result cards keep visible dark-theme contrast", () => {
  assert.match(source, /color: "text\.primary", fontWeight: 880, fontSize:/);
  assert.match(source, /bgcolor: "#0D1D2D"/);
  assert.doesNotMatch(source, /Live convergence/);
  assert.doesNotMatch(source, /linear-gradient\(135deg, #fff, #f3fffc\)/);
  assert.doesNotMatch(source, /linear-gradient\(120deg, #ecfdf8, #eff6ff\)/);
});
