/**
 * Put a snapshot back in place of the live game file.
 * Stop the server first. A running server keeps the old pages open.
 *
 *   node scripts/restore-db.mjs --data /var/data
 *   node scripts/restore-db.mjs --data /var/data --file /var/data/backups/uhoh-....sqlite --yes
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = parseArgs(process.argv.slice(2));

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const code = await main();
  process.exit(code);
}

async function main() {
  const dataDir = args.data || process.env.DATA_DIR || path.join(process.cwd(), "data");
  const files = listBackupFiles(dataDir);
  if (!args.file) {
    if (files.length === 0) {
      console.error(`No snapshots in ${path.join(dataDir, "backups")}.`);
      return 1;
    }
    console.log(`Snapshots in ${path.join(dataDir, "backups")}, newest first:`);
    for (const file of files) {
      const info = statSync(file);
      console.log(`  ${file}  ${info.size} bytes  ${info.mtime.toISOString()}`);
    }
    console.log("Stop the server, then run again with --file <one of those> --yes");
    return 0;
  }
  if (!args.yes) {
    console.error("Refusing to replace the live file without --yes. Stop the server first.");
    return 1;
  }
  const backup = await import("../packages/server/dist/backup.js");
  const result = backup.restoreDatabase(dataDir, path.resolve(args.file));
  console.log(`Restored ${args.file}`);
  console.log(`Live file: ${result.live}`);
  console.log(`Previous file: ${result.saved}`);
  console.log("Start the server. It will open the restored games.");
  return 0;
}

export function listBackupFiles(dataDir) {
  const dir = path.join(dataDir, "backups");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^uhoh-.*\.sqlite$/.test(name))
    .map((name) => path.join(dir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

function parseArgs(argv) {
  const out = { data: "", file: "", yes: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--yes") out.yes = true;
    else if (arg === "--data") out.data = argv[++index] ?? "";
    else if (arg === "--file") out.file = argv[++index] ?? "";
  }
  return out;
}
