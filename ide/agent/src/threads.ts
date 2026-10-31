// Chat threads: one JSON file per thread under threads/ in the data directory, holding its title,
// status and messages in the row shape assistant-ui's history adapter writes (id, parent_id,
// format, content). A conversation is a working copy, not research data, so it lives only here.
import { randomUUID } from "node:crypto";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { privateDir, readJson, writeJson } from "./files.ts";

export type Row = { id: string; parent_id: string | null; format: string; content: unknown };
export type Thread = { id: string; title: string | null; status: "regular" | "archived"; created: string; updated: string; messages: Row[] };
export type ThreadMeta = Omit<Thread, "messages">;

const ID = /^[a-f0-9-]{36}$/;

export class ThreadStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = privateDir(join(dataDir, "threads"));
  }

  private path(id: string): string | null {
    return ID.test(id) ? join(this.dir, `${id}.json`) : null;
  }

  list(): ThreadMeta[] {
    return readdirSync(this.dir).filter((n) => n.endsWith(".json"))
      .map((n) => readJson<Thread | null>(join(this.dir, n), null))
      .filter((t): t is Thread => t !== null)
      .map(({ messages: _, ...meta }) => meta)
      .sort((a, b) => b.updated.localeCompare(a.updated));
  }

  get(id: string): Thread | null {
    const path = this.path(id);
    return path ? readJson<Thread | null>(path, null) : null;
  }

  create(): Thread {
    const now = new Date().toISOString();
    const thread: Thread = { id: randomUUID(), title: null, status: "regular", created: now, updated: now, messages: [] };
    writeJson(this.path(thread.id)!, thread);
    return thread;
  }

  patch(id: string, change: { title?: string; status?: Thread["status"] }): Thread | null {
    return this.change(id, (t) => ({ ...t, ...change }));
  }

  /** Adds a message row, or replaces the row with the same id (a message finished after an edit). */
  append(id: string, row: Row): Thread | null {
    return this.change(id, (t) => {
      const index = t.messages.findIndex((m) => m.id === row.id);
      const messages = index < 0 ? [...t.messages, row] : t.messages.map((m, i) => (i === index ? row : m));
      return { ...t, messages };
    });
  }

  remove(id: string): boolean {
    const path = this.path(id);
    if (!path || !this.get(id)) return false;
    rmSync(path);
    return true;
  }

  private change(id: string, f: (t: Thread) => Thread): Thread | null {
    const thread = this.get(id);
    if (!thread) return null;
    const next = { ...f(thread), updated: new Date().toISOString() };
    writeJson(this.path(id)!, next);
    return next;
  }
}
