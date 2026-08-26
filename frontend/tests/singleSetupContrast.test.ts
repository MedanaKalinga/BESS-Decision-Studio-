import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/pages/SingleOptimizationSetup.tsx", import.meta.url), "utf8");

test("single optimization numeric values use explicit dark-theme contrast", () => {
  assert.match(source, /bgcolor: "rgba\(7,17,29,0\.72\)"/);
  assert.match(source, /WebkitTextFillColor: "#F4F8FC"/);
  assert.match(source, /colorScheme: "dark"/);
});

test("single optimization field labels and suffixes remain readable", () => {
  assert.match(source, /MuiInputLabel-root\.Mui-focused/);
  assert.match(source, /MuiInputLabel-root\.Mui-error/);
  assert.match(source, /MuiInputAdornment-root/);
});
