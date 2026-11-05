// What the tests read from fixtures/: endpoints' answers as they were recorded.
import { readFileSync } from "node:fs";

export const raw = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
export const fixture = (name: string) => JSON.parse(raw(name));
