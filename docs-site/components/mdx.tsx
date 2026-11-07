import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { File, Files, Folder } from 'fumadocs-ui/components/files';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import type { ComponentProps } from 'react';
import { Mermaid } from './mdx/mermaid';
import { Ref } from './mdx/ref';
import { ChapterMap } from './mdx/chapter-map';
import { ArchitectureOverview } from './mdx/architecture-overview';
import { TypeTable } from './mdx/type-table';

export function getMDXComponents(components?: MDXComponents, lang = 'en') {
  return {
    ...defaultMdxComponents,
    ArchitectureOverview,
    Accordion,
    Accordions,
    ChapterMap: (props: ComponentProps<typeof ChapterMap>) => <ChapterMap {...props} lang={lang} />,
    File,
    Files,
    Folder,
    Mermaid,
    Ref,
    Step,
    Steps,
    TypeTable: (props: ComponentProps<typeof TypeTable>) => <TypeTable {...props} lang={lang} />,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
