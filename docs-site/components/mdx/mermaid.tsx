'use client';

import { useEffect, useId, useState } from 'react';
import { useTheme } from 'next-themes';

type MermaidRender = {
  svg: string;
  bindFunctions?: (element: Element) => void;
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
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        fontFamily: 'inherit',
        theme: resolvedTheme === 'dark' ? 'dark' : 'default',
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
      <figure className="my-6 overflow-auto rounded-lg border border-fd-border bg-fd-card p-4" data-mermaid-chart="true" data-mermaid-status="error">
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
        className="my-6 min-h-24 animate-pulse rounded-lg border border-fd-border bg-fd-muted/30"
        data-mermaid-chart="true"
        data-mermaid-status="loading"
        role="img"
      />
    );
  }

  return (
    <div
      aria-label="Mermaid diagram"
      className="my-6 overflow-auto rounded-lg border border-fd-border bg-fd-card p-4 [&_svg]:mx-auto [&_svg]:max-w-full"
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
