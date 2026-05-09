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
  const sqlFilePath = path.resolve(__dirname, "../../../database/auth_procedures.sql");
  if (!fs.existsSync(sqlFilePath)) {
    throw new Error(`SQL file not found: ${sqlFilePath}`);
  }

  const scriptText = fs.readFileSync(sqlFilePath, "utf8");
  const batches = splitSqlBatches(scriptText);

  console.log(`[db:auth] Applying SQL file: ${sqlFilePath}`);
  console.log(`[db:auth] Total batches: ${batches.length}`);

  const pool = await getPool();
  try {
    for (let i = 0; i < batches.length; i += 1) {
      console.log(`[db:auth] Running batch ${i + 1}/${batches.length}...`);
      await pool.request().batch(batches[i]);
    }
    console.log("[db:auth] Done.");
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error("[db:auth] Failed:", err.message);
  process.exit(1);
});

