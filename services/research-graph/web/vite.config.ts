import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// HarmonyOS Sans SC sets the Chinese in ledger text. The npm package harmonyos-sans-sc-webfont-splitted
// cuts each weight by unicode-range into 82 woff2 slices; fonts/harmonyos-sans-sc/ keeps its CSS for two
// weights (the package is not installed: it declares its own build tool as a dependency). The page is
// one file opened from disk, so the slices stay on jsDelivr at that version and a browser fetches only
// those holding characters on screen; offline, Chinese falls through to the system face. The page sets
// only 400 and 600, so Regular and Medium cover it, split where Supply's are; size-adjust sizes its
// Chinese beside Supply's letters.
const HARMONY = "https://cdn.jsdelivr.net/npm/harmonyos-sans-sc-webfont-splitted@1.1.0/dist/";
const HARMONY_WEIGHTS = { Regular: "100 449", Medium: "450 900" };
const HARMONY_SIZE = "94%";

function harmonyOsSans(): Plugin {
  const id = "virtual:harmonyos-sans-sc.css";
  return {
    name: "harmonyos-sans-sc",
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    async load(resolved) {
      if (resolved !== `\0${id}`) return;
      const weights = await Promise.all(Object.entries(HARMONY_WEIGHTS).map(async ([name, range]) => {
        const file = new URL(`fonts/harmonyos-sans-sc/${name}.css`, import.meta.url);
        const css = await this.fs.readFile(decodeURIComponent(file.pathname), { encoding: "utf8" });
        return [...css.matchAll(/url\("\.\/([^"]+\.woff2)"\)[^;]*;[\s\S]*?unicode-range:([^;]+);/g)].map(([, slice, unicodes]) =>
          `@font-face{font-family:"HarmonyOS Sans SC";font-style:normal;font-weight:${range};font-display:swap;` +
          `size-adjust:${HARMONY_SIZE};src:url("${HARMONY}${slice}") format("woff2");unicode-range:${unicodes};}`).join("\n");
      }));
      return weights.join("\n");
    },
  };
}

// One self-contained index.html: the Python renderer replaces the view placeholder with view.json.
export default defineConfig({
  plugins: [harmonyOsSans(), react(), tailwindcss(), viteSingleFile()],
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 4096 },
});
