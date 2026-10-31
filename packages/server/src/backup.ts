import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { backup, type DatabaseSync } from "node:sqlite";

/** Snapshots kept on the same disk. Older ones are deleted. */
export const BACKUP_KEEP = 8;
/** Leave room on the 1 GB disk for the live file and the write-ahead log. */
export const BACKUP_BUDGET_BYTES = 400 * 1024 * 1024;

export function backupDir(dataDir: string): string {
  return path.join(dataDir, "backups");
}

export function listBackups(dataDir: string): string[] {
  const dir = backupDir(dataDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^uhoh-.*\.sqlite$/.test(name))
    .map((name) => path.join(dir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs || path.basename(b).localeCompare(path.basename(a)));
}

/** Consistent copy of the open database. Safe to run while games are being saved. */
export async function writeBackup(db: DatabaseSync, dataDir: string, now = new Date()): Promise<string> {
  const dir = backupDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const dest = path.join(dir, `uhoh-${stamp}.sqlite`);
  await backup(db, dest, { rate: 64 });
  pruneBackups(dataDir);
  return dest;
}

export function pruneBackups(dataDir: string, keep = BACKUP_KEEP, budget = BACKUP_BUDGET_BYTES): string[] {
  const files = listBackups(dataDir);
  const removed: string[] = [];
  const drop = (file: string) => {
    rmSync(file, { force: true });
    removed.push(file);
  };
  for (const extra of files.slice(keep)) drop(extra);
  const kept = files.slice(0, keep);
  let total = kept.reduce((sum, file) => sum + (existsSync(file) ? statSync(file).size : 0), 0);
  while (kept.length > 1 && total > budget) {
    const oldest = kept.pop();
    if (!oldest) break;
    total -= existsSync(oldest) ? statSync(oldest).size : 0;
    drop(oldest);
  }
  return removed;
}

/**
 * Replace the live database with a snapshot. The server must be stopped first.
 * A copy of the file being replaced is left next to it.
 */
export function restoreDatabase(dataDir: string, file: string): { live: string; saved: string } {
  if (!existsSync(file)) throw new Error(`No backup at ${file}.`);
  const live = path.join(dataDir, "uhoh.sqlite");
  const saved = path.join(dataDir, "uhoh.sqlite.before-restore");
  mkdirSync(dataDir, { recursive: true });
  if (existsSync(live)) copyFileSync(live, saved);
  for (const suffix of ["-wal", "-shm"]) rmSync(`${live}${suffix}`, { force: true });
  copyFileSync(file, live);
  return { live, saved };
}
