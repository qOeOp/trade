export function mermaidCharts(source) {
  return [...source.matchAll(/^(?<fence>`{3,}|~{3,})mermaid[^\n]*\n(?<chart>[\s\S]*?)^\k<fence>[ \t]*$/gm)]
    .map((match) => match.groups.chart.trim());
}

function normalizeVisibleLabels(line, { inClass = false } = {}) {
  if (/^\s*%%/.test(line)) return line.replace(/%%.*$/, '%% <label>');
  if (inClass && !/^\s*[+\-#~]/.test(line) && !/[()]/.test(line) && !/^\s*}\s*$/.test(line)) {
    const identifiers = line.match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? [];
    return `${line.match(/^\s*/)[0]}<class-label:${identifiers.join(',')}>`;
  }

  let normalized = line.replace(/"(?:\\.|[^"\\])*"/g, '"<label>"');
  if (/^\s*state\s+"<label>"\s+as\s+[A-Za-z_][\w.-]*\s*$/.test(normalized)) {
    return null;
  }
  normalized = normalized.replace(
    /^(\s*(?:participant|actor)\s+[A-Za-z_][\w.-]*)(?:\s+as\s+.+)?$/i,
    '$1',
  );
  normalized = normalized.replace(
    /^(\s*subgraph\s+[A-Za-z_][\w.-]*)(?:\s+(?:\[.*\]|".*"|.+))?$/i,
    '$1',
  );
  normalized = normalized.replace(/\|[^|\n]*\|/g, '|<label>|');
  normalized = normalized.replace(
    /(\b[A-Za-z_][\w.-]*)(\s*)(\[\[|\[\(|\[|\(\[|\(\(|\(|\{\{|\{)(.*?)(\]\]|\]\)|\]|\)\]|\)\)|\)|\}\}|\})/g,
    '$1',
  );
  normalized = normalized.replace(
    /(\s(?:--+|-\.+-))\s+.+?\s+((?:--+|-\.+-)>)/g,
    '$1 <label> $2',
  );
  normalized = normalized.replace(
    /^(\s*(?:alt|else|opt|loop|par|and|critical|break|rect)\b).*$/i,
    '$1 <label>',
  );

  const colon = normalized.indexOf(':');
  if (colon >= 0) {
    const prefix = normalized.slice(0, colon + 1);
    if (
      /(?:--|\.\.|->|-x|-\)|=>)/.test(prefix) ||
      /^\s*(?:Note\b|title\b|accTitle\b|accDescr\b)/i.test(prefix) ||
      /^\s*[A-Za-z_][\w.-]*\s*:/.test(prefix)
    ) {
      normalized = `${prefix}<label>`;
    }
  }
  return normalized.trimEnd();
}

export function mermaidSkeleton(source) {
  return mermaidCharts(source).map((chart) => {
    let inClass = false;
    return chart.split('\n').map((line) => {
      const normalized = normalizeVisibleLabels(line, { inClass });
      if (/^\s*class\s+[A-Za-z_][\w.-]*\s*\{\s*$/.test(line)) inClass = true;
      else if (inClass && /^\s*}\s*$/.test(line)) inClass = false;
      return normalized;
    }).filter((line) => line !== null);
  });
}
