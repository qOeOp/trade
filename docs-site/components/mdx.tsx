import { Step, Steps } from 'fumadocs-ui/components/steps';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import type { ComponentType } from 'react';
import type { Locale } from '@/lib/i18n';
import { Mermaid } from './mdx/mermaid';
import { Ref } from './mdx/ref';
import { ChapterMap } from './mdx/chapter-map';
import { ArchitectureOverview } from './mdx/architecture-overview';
import { TypeTable } from './mdx/type-table';

/** The page's locale reaches every component that has one; MDX sources never write it. */
function withLang<P extends { lang: Locale }>(Component: ComponentType<P>, lang: Locale) {
  return function Localized(props: Omit<P, 'lang'>) {
    return <Component {...(props as P)} lang={lang} />;
  };
}

export function getMDXComponents(lang: Locale, components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    ArchitectureOverview: withLang(ArchitectureOverview, lang),
    ChapterMap: withLang(ChapterMap, lang),
    Mermaid,
    Ref: withLang(Ref, lang),
    Step,
    Steps,
    TypeTable: withLang(TypeTable, lang),
    ...components,
  } satisfies MDXComponents;
}

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
