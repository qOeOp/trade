import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { File, Files, Folder } from 'fumadocs-ui/components/files';
import { InlineTOC } from 'fumadocs-ui/components/inline-toc';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import type { ComponentProps } from 'react';
import { Mermaid } from './mdx/mermaid';
import { Ref } from './mdx/ref';
import { Cap, Tier, Kind } from './mdx/cap';
import { ChapterMap } from './mdx/chapter-map';
import { ArchitectureOverview } from './mdx/architecture-overview';
import { TypeTable } from './mdx/type-table';

export function getMDXComponents(components?: MDXComponents, lang = 'en') {
  return {
    ...defaultMdxComponents,
    ArchitectureOverview,
    Accordion,
    Accordions,
    Cap,
    ChapterMap,
    File,
    Files,
    Folder,
    InlineTOC,
    Kind,
    Mermaid,
    Ref,
    Step,
    Steps,
    Tab,
    Tabs,
    Tier,
    TypeTable: (props: ComponentProps<typeof TypeTable>) => <TypeTable {...props} lang={lang} />,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
