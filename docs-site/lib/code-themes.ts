import type { ThemeRegistration } from 'shiki';

// IntelliJ's Python colours (Islands light and dark), the ones the trade IDE's source view uses
// (ide/web/src/theme/tokens.css, --code-*). The background is left to the page's code block.
const palette = {
  light: { fg: '#1c1a18', keyword: '#0033B3', string: '#067D17', escape: '#0037A6', number: '#1750EB', comment: '#8C8C8C', function: '#00627A', decorator: '#9E880D' },
  dark: { fg: '#dfdeda', keyword: '#CF8E6D', string: '#6AAB73', escape: '#CF8E6D', number: '#2AACB8', comment: '#7A7E85', function: '#56A8F5', decorator: '#B3AE60' },
};

function theme(name: string, type: 'light' | 'dark'): ThemeRegistration {
  const c = palette[type];
  return {
    name,
    type,
    colors: { 'editor.foreground': c.fg, 'editor.background': '#00000000' },
    tokenColors: [
      { settings: { foreground: c.fg } },
      { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: c.comment, fontStyle: 'italic' } },
      { scope: ['keyword', 'storage.type', 'storage.modifier', 'constant.language', 'support.type.primitive', 'keyword.operator.logical', 'keyword.operator.new', 'variable.language.self', 'support.constant'], settings: { foreground: c.keyword } },
      { scope: ['string', 'string.quoted', 'punctuation.definition.string'], settings: { foreground: c.string } },
      { scope: ['constant.character.escape', 'constant.other.placeholder'], settings: { foreground: c.escape } },
      { scope: ['constant.numeric'], settings: { foreground: c.number } },
      { scope: ['entity.name.function', 'support.function', 'meta.function-call.generic'], settings: { foreground: c.function } },
      { scope: ['entity.name.function.decorator', 'meta.function.decorator', 'punctuation.definition.decorator'], settings: { foreground: c.decorator } },
      { scope: ['support.type.property-name', 'entity.name.tag'], settings: { foreground: c.keyword } },
      { scope: ['keyword.operator', 'punctuation'], settings: { foreground: c.fg } },
    ],
  };
}

export const codeThemes = { light: theme('intellij-light', 'light'), dark: theme('intellij-dark', 'dark') };
