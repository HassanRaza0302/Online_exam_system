require("dotenv").config();

const { getPool, closeDb } = require("../services/db");

const ALLOWED_MODES = ["attempts", "exams", "all"];

async function main() {
  const mode = String(process.argv[2] || "attempts").toLowerCase();
  if (!ALLOWED_MODES.includes(mode)) {
    throw new Error(`Usage: node src/scripts/clean-database.js <${ALLOWED_MODES.join("|")}>`);
  }

  const pool = await getPool();
  try {
    await pool.request().input("mode", mode).execute("sp_CleanDatabase");
    console.log(`[db:clean] Cleanup completed (mode: ${mode}).`);
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error("[db:clean] Failed:", err.message);
  process.exit(1);
});
