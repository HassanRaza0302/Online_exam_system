require("dotenv").config();

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { getPool, closeDb } = require("../services/db");

function splitSqlBatchesSafe(scriptText) {
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

function isLikelyBcryptHash(value) {
  return typeof value === "string" && /^\$2[aby]\$\d{2}\$/.test(value);
}

async function hashPlaintextPasswords(pool) {
  let updated = 0;

  for (const table of ["Students", "Admins"]) {
    const idCol = table === "Students" ? "student_id" : "admin_id";
    const rows = await pool.request().query(`SELECT ${idCol}, password FROM ${table}`);

    for (const row of rows.recordset) {
      if (isLikelyBcryptHash(row.password)) continue;
      const passwordHash = await bcrypt.hash(String(row.password), 10);
      await pool
        .request()
        .input("id", row[idCol])
        .input("password_hash", passwordHash)
        .query(`UPDATE ${table} SET password = @password_hash WHERE ${idCol} = @id`);
      updated += 1;
    }
  }

  return updated;
}

async function main() {
  const sqlFilePath = path.resolve(__dirname, "../../../database/Project.sql");

  if (!fs.existsSync(sqlFilePath)) {
    console.error(`[db:apply] SQL file not found: ${sqlFilePath}`);
    process.exit(1);
  }

  const scriptText = fs.readFileSync(sqlFilePath, "utf8");
  const batches = splitSqlBatchesSafe(scriptText);

  console.log(`[db:apply] Applying SQL file: ${sqlFilePath}`);
  console.log(`[db:apply] Total batches: ${batches.length}`);

  const pool = await getPool();

  try {
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`[db:apply] Running batch ${i + 1}/${batches.length}...`);
      await pool.request().batch(batch);
    }

    const hashed = await hashPlaintextPasswords(pool);
    console.log(`[db:apply] Passwords hashed: ${hashed}`);
    console.log("[db:apply] Done.");
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error("[db:apply] Failed:", err.message);
  process.exit(1);
});
