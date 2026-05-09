require("dotenv").config();

const bcrypt = require("bcryptjs");
const { getPool, closeDb } = require("../services/db");

const SALT_ROUNDS = 10;

function isLikelyBcryptHash(value) {
  return typeof value === "string" && /^\$2[aby]\$\d{2}\$/.test(value);
}

async function hashStudents(pool) {
  const students = await pool.request().query(`
    SELECT student_id, password
    FROM Students
  `);

  let updated = 0;
  for (const row of students.recordset) {
    if (isLikelyBcryptHash(row.password)) continue;
    const passwordHash = await bcrypt.hash(String(row.password), SALT_ROUNDS);
    await pool
      .request()
      .input("student_id", row.student_id)
      .input("password_hash", passwordHash)
      .query(`
        UPDATE Students
        SET password = @password_hash
        WHERE student_id = @student_id
      `);
    updated += 1;
  }
  return updated;
}

async function hashAdmins(pool) {
  const admins = await pool.request().query(`
    SELECT admin_id, password
    FROM Admins
  `);

  let updated = 0;
  for (const row of admins.recordset) {
    if (isLikelyBcryptHash(row.password)) continue;
    const passwordHash = await bcrypt.hash(String(row.password), SALT_ROUNDS);
    await pool
      .request()
      .input("admin_id", row.admin_id)
      .input("password_hash", passwordHash)
      .query(`
        UPDATE Admins
        SET password = @password_hash
        WHERE admin_id = @admin_id
      `);
    updated += 1;
  }
  return updated;
}

async function main() {
  const pool = await getPool();
  try {
    const updatedStudents = await hashStudents(pool);
    const updatedAdmins = await hashAdmins(pool);
    console.log(`[db:hash-passwords] Students updated: ${updatedStudents}`);
    console.log(`[db:hash-passwords] Admins updated: ${updatedAdmins}`);
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error("[db:hash-passwords] Failed:", err.message);
  process.exit(1);
});

