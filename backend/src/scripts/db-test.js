require("dotenv").config();

const { getPool, closeDb } = require("../services/db");

async function main() {
  const pool = await getPool();
  const result = await pool.request().query("SELECT DB_NAME() AS db_name, @@VERSION AS version");
  const row = result.recordset[0];
  console.log("[db:test] OK — connected with Windows Authentication");
  console.log("[db:test] Database:", row.db_name);
  console.log("[db:test] Server:", String(row.version).split("\n")[0]);
  await closeDb();
}

main().catch((err) => {
  console.error("[db:test] FAILED\n");
  console.error(err.message);
  process.exit(1);
});
