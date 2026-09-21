/**
 * Upload changed canonical wiki pages into the Campaign HQ vault bucket.
 * Skips sources/ and any .bak name. Does not print secrets.
 *
 *   node scripts/publish-vault.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(here, "../.env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq);
    if (process.env[key] == null) process.env[key] = trimmed.slice(eq + 1);
  }
}

const root = process.argv[2] || "/Users/tanaymehta/Desktop/QEA Vault";
const { publishVault } = await import("../lib/vault-store.js");
const result = await publishVault(root);
console.log(`vault pages ${result.pages}, uploaded ${result.uploaded}, unchanged ${result.skipped}`);
