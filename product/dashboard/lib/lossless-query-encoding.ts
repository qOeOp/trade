// True when every key and value in a raw query string percent-decodes. `URLSearchParams` replaces a
// malformed escape with U+FFFD instead of failing, so a selector read through it alone could silently
// become a different identity from the one the caller sent.
export function losslessQueryEncoding(search: string): boolean {
  try {
    for (const field of search.slice(1).split("&")) {
      const separator = field.indexOf("=");
      const key = separator < 0 ? field : field.slice(0, separator);
      const value = separator < 0 ? "" : field.slice(separator + 1);
      decodeURIComponent(key.replaceAll("+", " "));
      decodeURIComponent(value.replaceAll("+", " "));
    }
    return true;
  } catch {
    return false;
  }
}
