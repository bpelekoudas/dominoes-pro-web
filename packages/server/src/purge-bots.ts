import path from "node:path";
import { Store } from "./db.js";

const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const dbFile = process.env.DB_FILE ?? path.join(dataDir, "uhoh.sqlite");
const store = new Store(dbFile);
const deleted = store.purgeBots();
console.log(`Removed ${deleted} bot accounts and their stats.`);
