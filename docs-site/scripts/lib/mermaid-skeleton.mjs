export function mermaidCharts(source) {
  return [...source.matchAll(/^(?<fence>`{3,}|~{3,})mermaid[^\n]*\n(?<chart>[\s\S]*?)^\k<fence>[ \t]*$/gm)]
    .map((match) => match.groups.chart.trim());
}
