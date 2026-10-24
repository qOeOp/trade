/** Copies text; resolves false where the browser refuses (file:// pages may not grant clipboard access). */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  try {
    const area = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(area); area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch { return false; }
}
