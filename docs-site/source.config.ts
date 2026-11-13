import { defineConfig } from 'fumadocs-mdx/config';
import { codeThemes } from './lib/code-themes';

export default defineConfig({
  mdxOptions: {
    remarkImageOptions: {
      external: false,
    },
    rehypeCodeOptions: {
      themes: codeThemes,
    },
  },
});
