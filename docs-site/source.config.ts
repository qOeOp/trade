import { remarkDirectiveAdmonition } from 'fumadocs-core/mdx-plugins/remark-directive-admonition';
import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins/remark-mdx-mermaid';
import { defineConfig } from 'fumadocs-mdx/config';
import remarkDirective from 'remark-directive';
import { codeThemes } from './lib/code-themes';

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkMdxMermaid, remarkDirective, remarkDirectiveAdmonition],
    remarkImageOptions: {
      external: false,
    },
    rehypeCodeOptions: {
      themes: codeThemes,
    },
  },
});
