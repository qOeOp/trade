import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
  MACOS_SYNTHESIZED_KEY_SPIN_FIRST_MAJOR,
  refuseBrowserThatSpinsOnSynthesizedKeys,
} from "./browser-acceptance.mjs";

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const cft = "/cache/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const shell = "/cache/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const linux = "/runner/_temp/dashboard-strategy-viewer-chrome/chrome-linux64/chrome";

test("a browser that spins on synthesized keys is refused, and nothing else is", () => {
  const refused = [
    [chrome, "darwin", "Google Chrome 153.0.8010.53"],
    [cft, "darwin", "Google Chrome for Testing 151.0.7922.34"],
    [cft, "darwin", `Google Chrome for Testing ${MACOS_SYNTHESIZED_KEY_SPIN_FIRST_MAJOR}.0.0.0`],
  ];
  const allowed = [
    // Measured not to spin.
    [cft, "darwin", "Google Chrome for Testing 145.0.7632.6"],
    [cft, "darwin", "Google Chrome for Testing 144.0.7559.96"],
    // No browser UI, so no AppKit key-equivalent routing, whatever the version.
    [shell, "darwin", "Google Chrome for Testing 153.0.8010.53"],
    // What CI drives, and the version after it: Linux has no AppKit path.
    [linux, "linux", "Google Chrome for Testing 152.0.7977.83"],
    [linux, "linux", "Google Chrome for Testing 153.0.8010.53"],
  ];
  for (const [executable, platform, versionText] of refused) {
    assert.throws(
      () => refuseBrowserThatSpinsOnSynthesizedKeys(executable, { platform, versionText }),
      (error) => /refusing to drive/.test(error.message) && /NSMenu _enableItems/.test(error.message)
        && error.message.includes(versionText),
      `${versionText} on ${platform} must be refused by name`,
    );
  }
  for (const [executable, platform, versionText] of allowed) {
    assert.doesNotThrow(
      () => refuseBrowserThatSpinsOnSynthesizedKeys(executable, { platform, versionText }),
      `${versionText} (${executable}) on ${platform} must be allowed`,
    );
  }
});

test("an unreadable version on macOS is refused rather than guessed", () => {
  assert.throws(
    () => refuseBrowserThatSpinsOnSynthesizedKeys(chrome, { platform: "darwin", versionText: "Chromium dev build" }),
    /cannot read a Chrome version/,
  );
});

test("off macOS the browser is not asked for its version at all", () => {
  // The Linux runners must pay nothing for this: no subprocess, so a missing or wedged executable
  // cannot fail or stall a run through this path.
  assert.doesNotThrow(() => refuseBrowserThatSpinsOnSynthesizedKeys("/nonexistent/chrome", { platform: "linux" }));
});

// The refusal only helps a suite that calls it. A new suite that sends keys and forgets to would
// fail on a spinning browser 60 s into a DevTools command, looking like a hung page - which is the
// report this refusal exists to prevent.
//
// Both sides are read from code, not text. A sender is a `.send("Input.dispatchKeyEvent"` call, so
// a comment naming the method does not count; Input.insertText is left out because it measured not
// to spin (see browser-acceptance.mjs). A refusal counts only as a call that starts a statement,
// optionally behind an `if (...)`, after block and line comments are stripped - so a commented-out
// call does not satisfy it. browser-acceptance.mjs is scanned too: a shared helper that sends keys would be
// called from suites that never mention the method, so the refusal has to live inside that helper.
const SENDS_KEYS = /\.send\(\s*["']Input\.dispatchKeyEvent["']/u;
const REFUSES = /^\s*(?:if \([^)]*\)\s*)?refuseBrowserThatSpinsOnSynthesizedKeys\(browserExecutable\b/mu;
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//gu, "")
  .replace(/^\s*\/\/.*$/gmu, "").replace(/\s\/\/.*$/gmu, "");

test("every suite that synthesizes keys refuses a browser that spins on them", async () => {
  const directory = new URL("./", import.meta.url);
  const senders = [];
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".mjs") || name === "synthesized-key-spin-refusal.test.mjs") continue;
    const source = withoutComments(await readFile(new URL(name, directory), "utf8"));
    if (!SENDS_KEYS.test(source)) continue;
    assert.notEqual(name, "browser-acceptance.mjs",
      "browser-acceptance.mjs sends keys itself: put the refusal inside that helper, since its callers never name the method");
    senders.push([name, REFUSES.test(source)]);
  }
  // A scan that found nothing would pass whatever the suites did. Two suites send keys today.
  assert.ok(senders.length >= 2, `expected at least two key-sending suites, found ${JSON.stringify(senders)}`);
  assert.deepEqual(senders.filter(([, calls]) => !calls).map(([name]) => name), []);
});
