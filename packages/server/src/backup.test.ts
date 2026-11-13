import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listBackups, pruneBackups, restoreDatabase, writeBackup } from "./backup.js";
import { Store } from "./db.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "uhoh-backup-"));
  dirs.push(dir);
  return dir;
}

function user(id: string) {
  const now = new Date().toISOString();
  return {
    id,
    display_name: id,
    avatar_id: "homescreen",
    created_at: now,
    updated_at: now,
    is_guest: 1,
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("sqlite backups", () => {
  it("copies the database and restores it over a newer write", async () => {
    const dir = tempDir();
    const store = new Store(path.join(dir, "uhoh.sqlite"));
    store.insertUser(user("ada"));
    const snap = await writeBackup(store.db, dir);
    store.insertUser(user("bea"));
    store.db.close();

    const restored = restoreDatabase(dir, snap);
    const again = new Store(restored.live);
    expect(again.user("ada")?.display_name).toBe("ada");
    expect(again.user("bea")).toBeNull();
    again.db.close();
  });

  it("keeps the newest snapshots and drops the rest", async () => {
    const dir = tempDir();
    const store = new Store(path.join(dir, "uhoh.sqlite"));
    store.insertUser(user("ada"));
    const stamps = [1, 2, 3].map((hour) => new Date(Date.UTC(2026, 9, 26, hour, 0, 0)));
    for (const stamp of stamps) await writeBackup(store.db, dir, stamp);
    store.db.close();
    pruneBackups(dir, 2, 400 * 1024 * 1024);
    const left = listBackups(dir).map((file) => path.basename(file));
    expect(left).toHaveLength(2);
    expect(left.some((name) => name.includes("T01-00-00"))).toBe(false);
    expect(readdirSync(path.join(dir, "backups")).filter((name) => name.endsWith(".sqlite"))).toHaveLength(2);
  });
});
