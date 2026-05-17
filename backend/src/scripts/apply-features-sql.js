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
  const sqlFilePath = path.resolve(__dirname, "../../../database/feature_updates.sql");
  if (!fs.existsSync(sqlFilePath)) {
    throw new Error(`SQL file not found: ${sqlFilePath}`);
  }

  const batches = splitSqlBatches(fs.readFileSync(sqlFilePath, "utf8"));
  const pool = await getPool();

  try {
    for (let i = 0; i < batches.length; i += 1) {
      console.log(`[db:features] Running batch ${i + 1}/${batches.length}...`);
      await pool.request().batch(batches[i]);
    }
    console.log("[db:features] Done.");
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error("[db:features] Failed:", err.message);
  process.exit(1);
});
