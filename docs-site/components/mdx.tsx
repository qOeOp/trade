import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { File, Files, Folder } from 'fumadocs-ui/components/files';
import { InlineTOC } from 'fumadocs-ui/components/inline-toc';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { TypeTable } from 'fumadocs-ui/components/type-table';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { Mermaid } from './mdx/mermaid';
import { Ref } from './mdx/ref';
import { Cap, Tier, Kind } from './mdx/cap';
import { ChapterMap } from './mdx/chapter-map';
import { ArchitectureOverview } from './mdx/architecture-overview';

export function getMDXComponents(components?: MDXComponents) {
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
    TypeTable,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
