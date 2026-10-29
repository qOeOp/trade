'use client';

import { useEffect, useId, useState } from 'react';
import { useTheme } from 'next-themes';

type MermaidRender = {
  svg: string;
  bindFunctions?: (element: Element) => void;
};

// Hex copies of the IDE tokens (mermaid derives its shades from literal colours, not CSS variables):
// --island-alt, --island, --line-strong, --fg, --fg-muted, --edge-path and the frame and hover neutrals;
// keep them in step with global.css.
const PALETTE = {
  light: { background: '#f9f7f3', node: '#ffffff', border: '#d6d4d0', text: '#1c1a18', muted: '#646360', line: '#8d8c89', cluster: '#f4f2ee', note: '#ebe9e6' },
  dark: { background: '#22211e', node: '#1a1917', border: '#3e3d3a', text: '#dfdeda', muted: '#a6a4a1', line: '#93928f', cluster: '#262522', note: '#2b2a27' },
};

let renderQueue = Promise.resolve();

function scheduleRender<T>(task: () => Promise<T>): Promise<T> {
  const result = renderQueue.then(task, task);
  renderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function Mermaid({ chart }: { chart: string }) {
  const reactId = useId();
  const { resolvedTheme } = useTheme();
  const [rendered, setRendered] = useState<MermaidRender>();
  const [failed, setFailed] = useState(false);
  const id = `mermaid-${reactId.replace(/[^A-Za-z0-9_-]/g, '')}`;

  useEffect(() => {
    let active = true;
    setRendered(undefined);
    setFailed(false);

    scheduleRender(async () => {
      const { default: mermaid } = await import('mermaid');
      // labels are measured in the page's face, so wait for it before laying the chart out
      await document.fonts.ready;
      const c = PALETTE[resolvedTheme === 'dark' ? 'dark' : 'light'];
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        fontFamily: 'inherit',
        theme: 'base',
        // charts keep their natural size and scroll in their frame instead of shrinking past legibility
        flowchart: { useMaxWidth: false },
        er: { useMaxWidth: false },
        sequence: { useMaxWidth: false },
        state: { useMaxWidth: false },
        class: { useMaxWidth: false },
        themeVariables: {
          darkMode: resolvedTheme === 'dark',
          fontFamily: 'inherit',
          fontSize: '12px',
          background: c.background,
          primaryColor: c.node,
          primaryBorderColor: c.border,
          primaryTextColor: c.text,
          secondaryColor: c.note,
          secondaryBorderColor: c.border,
          secondaryTextColor: c.text,
          tertiaryColor: c.cluster,
          tertiaryBorderColor: c.border,
          tertiaryTextColor: c.text,
          lineColor: c.line,
          textColor: c.text,
          mainBkg: c.node,
          nodeBorder: c.border,
          clusterBkg: c.cluster,
          clusterBorder: c.border,
          titleColor: c.text,
          edgeLabelBackground: c.background,
          noteBkgColor: c.note,
          noteBorderColor: c.border,
          noteTextColor: c.text,
          actorBkg: c.node,
          actorBorder: c.border,
          actorTextColor: c.text,
          signalColor: c.muted,
          signalTextColor: c.text,
          labelBoxBkgColor: c.node,
          labelBoxBorderColor: c.border,
        },
      });
      return mermaid.render(id, chart.replaceAll('\\n', '\n'));
    }).then(
      (result) => {
        if (active) setRendered(result);
      },
      () => {
        if (active) setFailed(true);
      },
    );

    return () => {
      active = false;
    };
  }, [chart, id, resolvedTheme]);

  if (failed) {
    return (
      <figure className="my-6 overflow-auto rounded-md border border-fd-border bg-fd-card p-4" data-mermaid-chart="true" data-mermaid-status="error">
        <figcaption className="mb-2 text-sm font-medium text-fd-muted-foreground">
          Mermaid diagram could not be rendered.
        </figcaption>
        <pre className="text-xs">{chart}</pre>
      </figure>
    );
  }

  if (!rendered) {
    return (
      <div
        aria-busy="true"
        aria-label="Rendering Mermaid diagram"
        className="my-6 min-h-24 rounded-md border border-fd-border bg-fd-muted/30"
        data-mermaid-chart="true"
        data-mermaid-status="loading"
        role="img"
      />
    );
  }

  return (
    <div
      aria-label="Mermaid diagram"
      className="rd-mermaid my-6 overflow-auto rounded-md border border-[var(--line-strong)] bg-fd-card p-4 [&_svg]:mx-auto"
      data-mermaid-chart="true"
      data-mermaid-status="rendered"
      dangerouslySetInnerHTML={{ __html: rendered.svg }}
      ref={(element) => {
        if (element) rendered.bindFunctions?.(element);
      }}
      role="img"
    />
  );
}
