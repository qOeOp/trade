import { remarkDirectiveAdmonition } from 'fumadocs-core/mdx-plugins/remark-directive-admonition';
import { defineConfig } from 'fumadocs-mdx/config';
import remarkDirective from 'remark-directive';

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkDirective, remarkDirectiveAdmonition],
  },
});
