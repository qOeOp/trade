import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const rulesFor = (css, selector) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
  .filter(([, selectors]) => selectors.trim().split(/,\s*/u).includes(selector))
  .map(([, , declarations]) => declarations);

// Examine every occurrence, including media overrides: an 8px mobile override
// must fail even when the first desktop declaration still consumes the token.
function sharedPadding(css, selector) {
  const rules = rulesFor(css, selector);
  assert.ok(rules.length, `missing consumer ${selector}`);
  const padding = rules.flatMap((rule) => [...rule.matchAll(/(?:^|;)\s*padding(?:-inline|-left|-right)?:\s*([^;]+)/gu)]);
  assert.ok(padding.length, `missing spacing for ${selector}`);
  for (const [, value] of padding) assert.equal(value.trim(), "var(--panel-content-padding)", selector);
}

function sharedInnerRadius(css, selector) {
  const rules = rulesFor(css, selector);
  assert.ok(rules.length, `missing consumer ${selector}`);
  for (const rule of rules) {
    assert.match(rule, /border-radius: var\(--panel-inner-radius\)/u, selector);
  }
}

test("Source Intake and Composer consume the same token-bound body", async () => {
  for (const consumer of ["source-intake", "develop-composer"]) {
    const source = await read(`components/${consumer}-readback-workbench.tsx`);
    assert.match(source, /from "\.\/source-intake-readback-workbench.module.css"/u);
    assert.match(source, /<PanelFrameBody className=\{styles.body\}>/u);
  }
  sharedPadding(await read("components/source-intake-readback-workbench.module.css"), ".body");
});

test("Runtime body cannot leave the shared axis at a responsive breakpoint", async () => {
  const source = await read("components/runtime-foundation-not-ready-card.tsx");
  assert.match(source, /<PanelFrameBody className=\{styles.body\}/u);
  sharedPadding(await read("components/runtime-foundation-not-ready-card.module.css"), ".body");
});

test("Schedules joins its interior planes inside one inset body", async () => {
  const css = await read("components/ui/schedule-calendar.module.css");
  for (const selector of [".calendarHeader", ".foot", ".detail header", ".detail section", ".detail details"])
    sharedPadding(css, selector);
  assert.match(rulesFor(css, ".calendarHeader")[0], /border-radius: var\(--panel-inner-radius\) var\(--panel-inner-radius\) 0 0/u);
  assert.match(rulesFor(css, ".foot")[0], /border-radius: 0 0 var\(--panel-inner-radius\) var\(--panel-inner-radius\)/u);
  for (const selector of [".calendar", ".primary", ".detail"])
    assert.match(rulesFor(css, selector)[0], /border-radius: 0;/u, selector);
});

for (const consumer of ["market-data-owner-foundation-card", "portfolio-view-unavailable-card", "exploratory-replay-readback-workbench"]) {
  test(`${consumer} keeps its outer body on the shared axis at every breakpoint`, async () => {
    const source = await read(`components/${consumer}.tsx`);
    assert.ok(source.includes(`from "./${consumer}.module.css"`));
    assert.match(source, /<PanelFrameBody className=\{styles.body\}/u);
    sharedPadding(await read(`components/${consumer}.module.css`), ".body");
  });
}

test("Worker detail keeps its outer cluster grid on the shared content axis", async () => {
  const [css, worker] = await Promise.all([
    read("app/globals.css"),
    read("components/operations-workers-preview.tsx"),
  ]);
  assert.match(worker, /<DetailClusterGrid>/u);
  sharedPadding(css, ".detail-inspector > .detail-cluster-grid");
});

test("Run Detail conditional action fields stay on the shared content axis", async () => {
  const [css, detail] = await Promise.all([
    read("app/globals.css"),
    read("components/operations-run-detail.tsx"),
  ]);
  assert.match(detail, /className="dependency-cancellation-panel"[\s\S]*?className="run-cache-delete-field"/u);
  assert.match(detail, /className="run-cache-delete-panel"[\s\S]*?className="run-cache-delete-confirmation"/u);
  sharedPadding(css, ".detail-inspector > .run-cache-delete-field");
  sharedPadding(css, ".detail-inspector > .run-cache-delete-confirmation");
});

test("Readback and Portfolio body surfaces consume the shared inner radius", async () => {
  const [source, replay, portfolio] = await Promise.all([
    read("components/source-intake-readback-workbench.module.css"),
    read("components/exploratory-replay-readback-workbench.module.css"),
    read("components/portfolio-view-unavailable-card.module.css"),
  ]);
  for (const css of [source, replay]) {
    sharedInnerRadius(css, ".result :global(.empty-state)");
    sharedInnerRadius(css, ".result :global(.unavailable-state)");
    sharedInnerRadius(css, ".group");
  }
  for (const selector of [".resultRail", ".resultRail > div"]) {
    assert.ok(
      rulesFor(replay, selector).some((rule) => /border-radius: var\(--panel-inner-radius\)/u.test(rule)),
      selector,
    );
  }
  sharedInnerRadius(portfolio, ".unavailableBanner");
});
