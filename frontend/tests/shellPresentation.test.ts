import assert from "node:assert/strict";
import test from "node:test";

import {
  isShellNavigationActive,
  nextMobileDrawerState,
  shouldUseMotion,
} from "../src/lib/shellPresentation.ts";

test("sidebar exposes exactly one active-page state", () => {
  assert.equal(isShellNavigationActive("Dashboard", "Dashboard"), true);
  assert.equal(isShellNavigationActive("Dashboard", "Data Upload"), false);
  assert.equal(isShellNavigationActive("Dashboard", undefined), false);
});

test("mobile drawer closes after navigation", () => {
  assert.equal(nextMobileDrawerState("open"), true);
  assert.equal(nextMobileDrawerState("navigate"), false);
  assert.equal(nextMobileDrawerState("close"), false);
});

test("motion helper respects reduced-motion preference", () => {
  assert.equal(shouldUseMotion(false), true);
  assert.equal(shouldUseMotion(true), false);
});
