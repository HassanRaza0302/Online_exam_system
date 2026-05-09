require("dotenv").config();

const { getPool, closeDb } = require("../services/db");

function randomOption() {
  const options = ["A", "B", "C", "D"];
  return options[Math.floor(Math.random() * options.length)];
}

async function createStudentIfMissing(pool, email, fullName) {
  const existing = await pool.request().input("email", email).query(`
    SELECT TOP 1 student_id
    FROM Students
    WHERE email = @email
  `);

  if (existing.recordset.length) return existing.recordset[0].student_id;

  const insert = await pool
    .request()
    .input("full_name", fullName)
    .input("email", email)
    .input("password", "$2b$10$QKf8nXo2m4Qxq2f9X3Y0Auj6c7M5CMYh2Qq9v3l5RmbH1xG8f3QXW") // fixed bcrypt hash
    .query(`
      INSERT INTO Students (full_name, email, password, status)
      OUTPUT INSERTED.student_id
      VALUES (@full_name, @email, @password, 'APPROVED')
    `);

  return insert.recordset[0].student_id;
}

async function runOne(pool, examId, studentId) {
  // Start attempt
  const attemptInsert = await pool
    .request()
    .input("student_id", studentId)
    .input("exam_id", examId)
    .query(`
      INSERT INTO ExamAttempts (student_id, exam_id)
      OUTPUT INSERTED.attempt_id
      VALUES (@student_id, @exam_id)
    `);
  const attemptId = attemptInsert.recordset[0].attempt_id;

  // Fetch exam questions
  const qs = await pool.request().input("exam_id", examId).query(`
    SELECT question_id
    FROM Questions
    WHERE exam_id = @exam_id
    ORDER BY question_id ASC
  `);

  // Save random answers
  for (const q of qs.recordset) {
    await pool
      .request()
      .input("attempt_id", attemptId)
      .input("question_id", q.question_id)
      .input("selected_option", randomOption())
      .query(`
        INSERT INTO StudentAnswers (attempt_id, question_id, selected_option)
        VALUES (@attempt_id, @question_id, @selected_option)
      `);
  }

  // Submit + ranking via procedures (transaction-safe scoring in DB)
  await pool.request().input("attempt_id", attemptId).execute("sp_SubmitExam");
  await pool.request().input("exam_id", examId).execute("sp_GenerateRankings");

  return attemptId;
}

async function main() {
  const examId = Number(process.argv[2] || 1);
  const users = Number(process.argv[3] || 5);

  if (!Number.isInteger(examId) || !Number.isInteger(users) || users <= 0) {
    throw new Error("Usage: node src/scripts/stress-concurrent-exams.js <examId> <users>");
  }

  const pool = await getPool();
  try {
    const studentIds = [];
    for (let i = 1; i <= users; i += 1) {
      const email = `loadtest_user_${Date.now()}_${i}@example.com`;
      const fullName = `Load Test User ${i}`;
      // eslint-disable-next-line no-await-in-loop
      const sid = await createStudentIfMissing(pool, email, fullName);
      studentIds.push(sid);
    }

    const startedAt = Date.now();
    const results = await Promise.all(studentIds.map((sid) => runOne(pool, examId, sid)));
    const elapsedMs = Date.now() - startedAt;

    console.log(`[stress] Exam ID: ${examId}`);
    console.log(`[stress] Concurrent users: ${users}`);
    console.log(`[stress] Attempts created: ${results.length}`);
    console.log(`[stress] Total time (ms): ${elapsedMs}`);
    console.log(`[stress] Attempt IDs: ${results.join(", ")}`);
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error("[stress] Failed:", err.message);
  process.exit(1);
});

