import { zhCN } from '@fumadocs/language/zh-cn';
import { defineI18n } from 'fumadocs-core/i18n';
import { i18nProvider } from 'fumadocs-ui/i18n';

export const i18n = defineI18n({
  languages: ['en', 'zh'],
  defaultLanguage: 'en',
  hideLocale: 'never',
  parser: 'dot',
  fallbackLanguage: null,
});

const translations = i18n.translations().preset('zh', zhCN());

export type Locale = (typeof i18n.languages)[number];

export function isLocale(value: string): value is Locale {
  return i18n.languages.some((locale) => locale === value);
}

export function i18nProviderProps(locale: Locale) {
  return i18nProvider(translations, locale);
}
