import { loader } from 'fumadocs-core/source';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { defineDocs } from 'fumadocs-mdx/macro';
import { i18n } from '@/lib/i18n';

const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema,
  },
  meta: {
    schema: metaSchema,
  },
});

export const source = loader({
  baseUrl: '/docs',
  i18n,
  source: docs.toFumadocsSource(),
});
