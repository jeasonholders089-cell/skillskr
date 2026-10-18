/**
 * Drop every local table and re-apply the schema, then re-seed the plan rows.
 *
 *   npm run db:reset            # asks for confirmation
 *   npm run db:reset -- --yes   # non-interactive
 */
import { rmSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { config } from "../src/config.ts";
import { closeDatabase, migrate, openDatabase } from "../src/db.ts";
import { PLAN_CATALOG } from "../src/billing/plans.ts";
import { seedPlanCatalog } from "../src/billing/seed.ts";
import { upsertPlan } from "../src/repos/billing.ts";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

async function confirm(): Promise<boolean> {
  if (process.argv.includes("--yes") || process.argv.includes("-y")) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`  Delete ${config.databasePath} and start over? [y/N] `);
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

async function main(): Promise<void> {
  const path = config.databasePath;

  if (path === ":memory:") {
    console.log("  Nothing to reset for an in-memory database.");
    return;
  }

  if (!(await confirm())) {
    console.log("  Aborted.");
    return;
  }

  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${path}${suffix}`, { force: true });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "EPERM" || code === "EBUSY") {
        console.error(
          `\n  Could not delete ${path}${suffix} -- the file is still open.\n` +
            "  Stop the running server (Ctrl+C) and run this again.\n"
        );
        process.exitCode = 1;
        return;
      }
      throw err;
    }
  }

  mkdirSync(dirname(resolve(path)), { recursive: true });
  const handle = openDatabase(path);
  migrate(handle);

  seedPlanCatalog();

  console.log(`  Recreated ${path} with the schema and ${PLAN_CATALOG.length} plans.`);
  console.log("  Run `npm run pancake:setup` to link the Pancake product IDs again.");
  closeDatabase();
}

main().catch((err: unknown) => {
  console.error(`  Reset failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
