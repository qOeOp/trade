// Private files in the service's data directory: the directory is 0700, every file 0600, and a write
// goes to a temporary file that replaces the old one by rename, so a reader never sees half a file.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function privateDir(path: string): string {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  return path;
}

export function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export function writeJson(path: string, value: unknown): void {
  privateDir(dirname(path));
  const temporary = join(dirname(path), `.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(temporary, path);
}
