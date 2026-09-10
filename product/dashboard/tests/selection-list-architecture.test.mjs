import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const atomUrl = new URL("../components/ui/selection-list.tsx", import.meta.url);
const stylesUrl = new URL("../components/ui/selection-list.module.css", import.meta.url);
const serviceLogsUrl = new URL("../components/operations-service-logs.tsx", import.meta.url);
const globalsUrl = new URL("../app/globals.css", import.meta.url);

test("Service Logs composes the shared SelectionList atom", async () => {
  const [atom, styles, serviceLogs, globals] = await Promise.all([
    readFile(atomUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
    readFile(serviceLogsUrl, "utf8"),
    readFile(globalsUrl, "utf8"),
  ]);

  assert.match(atom, /export function SelectionList/u);
  assert.match(atom, /export function SelectionListItem/u);
  assert.match(atom, /data-ui="selection-list"/u);
  assert.match(atom, /data-selected=\{selected \|\| undefined\}/u);
  assert.match(styles, /\.root \{[^}]*border-radius: var\(--panel-inner-radius\);/u);
  assert.match(styles, /\.item:focus-visible \{[^}]*data-table-row-selected-accent/u);
  assert.match(styles, /@media \(max-width: 1279px\)[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/u);

  assert.match(serviceLogs, /<SelectionList aria-label="Service instances" count=\{instances\.length\} label="Instances">/u);
  assert.match(serviceLogs, /<SelectionListItem[\s\S]*selected=\{instance\.instance_identity === selectedIdentity\}/u);
  assert.match(serviceLogs, /onClick=\{\(\) => onSelect\(instance\.instance_identity\)\}/u);
  assert.doesNotMatch(serviceLogs, /className="selection-list|className="service-instance-list/u);
  assert.doesNotMatch(globals, /\.selection-list|\.service-instance-list/u);
});
