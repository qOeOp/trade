// Shared helpers for the documentation contract tests.
//
// A documentation test is only worth running when the expected value comes from somewhere other
// than the prose itself. These helpers make that the only shape available: a token is asserted
// against the code that implements it first, and only then against each language of the document.
// A token that has disappeared from the code fails here with a message saying to drop it from the
// documented contract, which is the direction drift actually happens in.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { allRoutes } from "../lib/navigation.js";

const packageRoot = new URL("../", import.meta.url);

/** Read one file relative to `product/dashboard`. */
export function source(path) {
  return readFile(new URL(path, packageRoot), "utf8");
}

/** Read several files relative to `product/dashboard` and concatenate them into one search corpus. */
export async function sources(paths) {
  const texts = await Promise.all(paths.map(source));
  return texts.join("\n");
}

/** The full English and Chinese Dashboard guide. */
export async function bilingualDoc() {
  const [en, zh] = await Promise.all([
    source("../../docs/guide/dashboard.md"),
    source("../../docs/guide/dashboard.zh.md"),
  ]);
  return { en, zh };
}

/**
 * Slice one section out of each language of the Dashboard guide. The section starts at the given
 * heading and ends at the next heading of the same level (`until`). Both languages must carry the
 * section: that is the structural half of the contract.
 */
export async function bilingualSection({ en, zh, until = "\n## " }) {
  const docs = await bilingualDoc();
  const section = {};
  for (const [language, heading] of [["en", en], ["zh", zh]]) {
    const doc = docs[language];
    const start = doc.indexOf(heading);
    assert.ok(start >= 0, `${language} guide has no section headed ${JSON.stringify(heading)}`);
    const end = doc.indexOf(until, start + heading.length);
    section[language] = end > start ? doc.slice(start, end) : doc.slice(start);
  }
  return section;
}

/**
 * Bond identifiers between the implementation and the documented contract. Every token must exist
 * in `code` (a component, gateway, route, or Owner API source) and in each language of `section`.
 */
export function expectBonded(section, code, tokens, label) {
  for (const token of tokens) {
    assert.ok(
      code.includes(token),
      `${label}: ${JSON.stringify(token)} no longer exists in the code; drop it from the documented contract`,
    );
    for (const [language, text] of Object.entries(section)) {
      assert.ok(text.includes(token), `${label}: ${language} contract omits ${JSON.stringify(token)}`);
    }
  }
}

/** The section documents a route that navigation actually registers. */
export function expectRoute(section, href, label) {
  assert.ok(allRoutes.some((route) => route.href === href), `${label}: navigation does not register ${href}`);
  for (const [language, text] of Object.entries(section)) {
    assert.ok(text.includes(href), `${label}: ${language} contract omits route ${href}`);
  }
}
