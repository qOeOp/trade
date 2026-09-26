import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { exactBlueprints, maturityFor, parentTabFor } from "../lib/navigation.js";

test("Source to Research has an independent admitted typed control route", async () => {
  const [component, shell, gate, field, css] = await Promise.all([
    readFile(new URL("../components/source-research-control.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ui/action-admission-gate.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ui/form-field.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/source-research-control.module.css", import.meta.url), "utf8"),
  ]);
  assert.equal(maturityFor("/rd/intake/new"), "DRAWABLE_EXACT");
  assert.equal(parentTabFor("/rd/intake/new"), "/rd");
  assert.equal(exactBlueprints["/rd/intake/new"].primary, "SourceResearchControl");
  assert.match(exactBlueprints["/rd/intake/new"].state, /DISPOSABLE_SOURCE_RESEARCH - NOT_CUT_OVER/u);
  assert.match(shell, /sourceResearchControl \? <SourceResearchControl/u);
  assert.match(component, /validSourceResearchOperationRequestV1/u);
  assert.match(component, /parseSourceResearchActionEnvelopeV1/u);
  assert.match(component, /function recoveryForDraft/u);
  assert.match(component, /source_request_identity: draft\.sourceRequestIdentity\.trim\(\)/u);
  assert.match(component, /Recover existing/u);
  assert.match(component, /setCapability\(""\)/u);
  assert.match(component, /SUBMITTED_OR_UNKNOWN/u);
  assert.match(component, /<FormField/u);
  assert.match(component, /<ActionAdmissionGate/u);
  assert.match(gate, /eyebrow = "Artifact formation"/u);
  assert.match(field, /data-span/u);
  assert.doesNotMatch(component, /localStorage|sessionStorage|URLSearchParams|console\./u);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(/iu);
});

// dashboard.md, the Instrument field: one required field in the research region, entered once, never
// suggested or defaulted, validated before dispatch and sent as entered; the terminal names the
// Owner's rejection code.
test("the control states its instrument once, in the research region, without suggesting one", async () => {
  const component = await readFile(new URL("../components/source-research-control.tsx", import.meta.url), "utf8");
  const research = component.slice(component.indexOf('title="Falsifiable goal"'), component.indexOf('title="Trial family policy"'));
  assert.equal((component.match(/field\("instrument", "Instrument"/gu) ?? []).length, 1);
  assert.match(research, /field\("instrument", "Instrument"/u);
  assert.match(component, /\n  instrument: "",\n/u);
  assert.match(component, /instrument_scope: \{ schema_version: 1, identities: \[draft\.instrument\] \}/u);
  assert.match(component, /validResearchInstrumentIdentityV1\(draft\.instrument\)/u);
  assert.match(component, /validSourceResearchSubmissionV1\(request\)/u);
  assert.match(component, /result\.research\.rejection_code/u);
  // No instrument is named anywhere the operator could take as a suggestion or a default.
  assert.doesNotMatch(component, /BTCUSDT|PERP\.|\.BINANCE|<datalist|placeholder=/u);
});

test("the readback surface links to but does not absorb the mutation composer", async () => {
  const readback = await readFile(new URL("../components/source-intake-readback-workbench.tsx", import.meta.url), "utf8");
  assert.match(readback, /href="\/rd\/intake\/new"/u);
  assert.doesNotMatch(readback, /SourceResearchControl|\/api\/rd\/source-research/u);
});
