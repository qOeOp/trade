// The tests' loader for src/: each TypeScript file transpiled as its extension says (.tsx with JSX) and linked
// as an ES module in node:vm, so a test can replace any import. Node's own type stripping cannot load src/: its
// relative imports have no extension.
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SourceTextModule, SyntheticModule } from "node:vm";
import ts from "typescript";

export const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const transpiled = new Map();
const transpile = (path) => {
  if (!transpiled.has(path)) transpiled.set(path, ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText);
  return transpiled.get(path);
};
const synthetic = (values, context) => new SyntheticModule(Object.keys(values), function () {
  for (const [key, value] of Object.entries(values)) this.setExport(key, value);
}, { context });

/**
 * One module map over src/. `stubs` gives a dependency's exports, keyed by its path under src/ without extension
 * ("state/shown") or by package name ("react"). An import without a stub loads its source (.ts, else .tsx), or
 * Node's package; `sources` and `packages`, when lists, name the only ones that may (`[]`: none). `context` is the
 * vm context every module runs in.
 */
export function loader({ stubs = {}, sources = true, packages = true, context } = {}) {
  const modules = new Map(), stubbed = (key) => Object.hasOwn(stubs, key);
  const load = (path) => {
    if (!modules.has(path)) modules.set(path, new SourceTextModule(transpile(path), { identifier: path, context }));
    return modules.get(path);
  };
  const refuse = (from, specifier) => { throw new Error(`${relative(src, from.identifier)} imports ${specifier}, which this test neither stubs nor loads`); };
  const link = (specifier, from) => {
    if (!specifier.startsWith(".")) {
      if (!stubbed(specifier) && packages !== true && !packages.includes(specifier)) refuse(from, specifier);
      if (!modules.has(specifier)) modules.set(specifier, stubbed(specifier) ? synthetic(stubs[specifier], context)
        : import(specifier).then((found) => synthetic(found, context)));
      return modules.get(specifier);
    }
    const stem = resolve(dirname(from.identifier), specifier), key = relative(src, stem);
    if (stubbed(key)) {
      if (!modules.has(stem)) modules.set(stem, synthetic(stubs[key], context));
      return modules.get(stem);
    }
    if (sources !== true && !sources.includes(key)) refuse(from, specifier);
    const path = [`${stem}.ts`, `${stem}.tsx`].find(existsSync);
    if (!path) throw new Error(`${relative(src, from.identifier)} imports ${specifier}, which has no .ts or .tsx source`);
    return load(path);
  };
  /** The exports of `path` (under src/), linked and evaluated with what it imports. */
  async function namespace(path) {
    const root = load(resolve(src, path));
    if (root.status === "unlinked") await root.link(link);
    if (root.status !== "evaluated") await root.evaluate();
    return root.namespace;
  }
  /** The exports of `path` (under src/) as some namespace() already loaded them. */
  const loaded = (path) => modules.get(resolve(src, path)).namespace;
  return { namespace, loaded, link };
}

/** The exports of `path` (under src/) in a module map of its own; `options` as loader() takes them. */
export const namespace = (path, options) => loader(options).namespace(path);
