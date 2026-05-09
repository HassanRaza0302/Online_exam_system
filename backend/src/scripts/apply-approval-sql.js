require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getPool, closeDb } = require("../services/db");

function splitSqlBatches(scriptText) {
  const lines = scriptText.split(/\r?\n/);
  const batches = [];
  let current = [];

  for (const line of lines) {
    if (/^\s*GO\s*$/i.test(line)) {
      const batch = current.join("\n").trim();
      if (batch) batches.push(batch);
      current = [];
      continue;
    }
    current.push(line);
  }

  const last = current.join("\n").trim();
  if (last) batches.push(last);
  return batches;
}

async function main() {
  const sqlFilePath = path.resolve(__dirname, "../../../database/approval_migration.sql");
  if (!fs.existsSync(sqlFilePath)) throw new Error(`SQL file not found: ${sqlFilePath}`);

  const sqlText = fs.readFileSync(sqlFilePath, "utf8");
  const batches = splitSqlBatches(sqlText);

  console.log(`[db:approval] Applying SQL file: ${sqlFilePath}`);
  console.log(`[db:approval] Total batches: ${batches.length}`);

  const pool = await getPool();
  try {
    for (let i = 0; i < batches.length; i += 1) {
      console.log(`[db:approval] Running batch ${i + 1}/${batches.length}...`);
      await pool.request().batch(batches[i]);
    }
    console.log("[db:approval] Done.");
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error("[db:approval] Failed:", err.message);
  process.exit(1);
});

