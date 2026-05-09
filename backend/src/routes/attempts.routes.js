const express = require("express");
const { getPool, connectedConfig } = require("../services/db");
const { requireStudent } = require("../middleware/auth");

const router = express.Router();

async function fetchAttemptState(pool, attemptId) {
  const result = await pool.request().input("attemptId", attemptId).query(`
    SELECT
      ea.attempt_id,
      ea.student_id,
      ea.exam_id,
      ea.start_time,
      ea.status,
      e.duration_minutes,
      DATEDIFF(SECOND, ea.start_time, GETDATE()) AS elapsed_seconds
    FROM ExamAttempts ea
    JOIN Exams e ON e.exam_id = ea.exam_id
    WHERE ea.attempt_id = @attemptId
  `);
  return result.recordset[0] || null;
}

async function autoSubmitIfExpired(pool, attemptState) {
  if (!attemptState) return { expired: false, autoSubmitted: false };

  const timeLimitSeconds = attemptState.duration_minutes * 60;
  const isExpired = attemptState.elapsed_seconds >= timeLimitSeconds;

  if (!isExpired || attemptState.status === "SUBMITTED") {
    return { expired: isExpired, autoSubmitted: false };
  }

  await pool.request().input("attempt_id", attemptState.attempt_id).execute("sp_SubmitExam");
  await pool.request().input("exam_id", attemptState.exam_id).execute("sp_GenerateRankings");

  await pool
    .request()
    .input("student_id", attemptState.student_id)
    .input("exam_id", attemptState.exam_id)
    .input("event_type", "EXAM_AUTO_SUBMIT")
    .input("event_description", `Attempt ${attemptState.attempt_id} auto-submitted due to timer expiry`)
    .query(`
      INSERT INTO AuditLogs (student_id, exam_id, event_type, event_description)
      VALUES (@student_id, @exam_id, @event_type, @event_description)
    `);

  return { expired: true, autoSubmitted: true };
}

// Save/Update one answer
// POST /api/attempts/:attemptId/answer
// Body: { "question_id": 10, "selected_option": "A" }
router.post("/api/attempts/:attemptId/answer", requireStudent, async (req, res) => {
  const attemptId = Number(req.params.attemptId);
  const questionId = Number(req.body.question_id);
  const selectedOption = String(req.body.selected_option || "").toUpperCase();

  if (!Number.isInteger(attemptId)) return res.status(400).json({ message: "Invalid attemptId" });
  if (!Number.isInteger(questionId)) return res.status(400).json({ message: "Invalid question_id" });
  if (!["A", "B", "C", "D"].includes(selectedOption)) {
    return res.status(400).json({ message: "selected_option must be A, B, C, or D" });
  }

  try {
    const pool = await getPool();

    // Timer enforcement from backend
    const attempt = await fetchAttemptState(pool, attemptId);
    if (!attempt) return res.status(404).json({ message: "Attempt not found" });
    if (attempt.student_id !== req.session.student.student_id) {
      return res.status(403).json({ message: "This attempt does not belong to you" });
    }

    const timerState = await autoSubmitIfExpired(pool, attempt);
    if (timerState.expired) {
      return res.status(400).json({ message: "Time is over. Exam was auto-submitted." });
    }

    if (attempt.status !== "IN_PROGRESS") {
      return res.status(400).json({ message: "Attempt already submitted" });
    }

    // UPSERT pattern (SQL Server 2014 friendly): update first, if nothing updated then insert
    const update = await pool
      .request()
      .input("attemptId", attemptId)
      .input("questionId", questionId)
      .input("selectedOption", selectedOption)
      .query(`
      UPDATE StudentAnswers
      SET selected_option = @selectedOption
      WHERE attempt_id = @attemptId AND question_id = @questionId;

      SELECT @@ROWCOUNT AS rows_affected;
    `);

    const rows = update.recordset?.[0]?.rows_affected || 0;

    if (rows === 0) {
      await pool
        .request()
        .input("attemptId", attemptId)
        .input("questionId", questionId)
        .input("selectedOption", selectedOption)
        .query(`
        INSERT INTO StudentAnswers (attempt_id, question_id, selected_option)
        VALUES (@attemptId, @questionId, @selectedOption)
      `);
    }

    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Submit exam attempt (transaction happens inside stored procedure)
// POST /api/attempts/:attemptId/submit
router.post("/api/attempts/:attemptId/submit", requireStudent, async (req, res) => {
  const attemptId = Number(req.params.attemptId);
  if (!Number.isInteger(attemptId)) return res.status(400).json({ message: "Invalid attemptId" });

  try {
    const pool = await getPool();

    let attemptInfo = await fetchAttemptState(pool, attemptId);
    if (!attemptInfo) return res.status(404).json({ message: "Attempt not found" });

    if (attemptInfo.student_id !== req.session.student.student_id) {
      return res.status(403).json({ message: "This attempt does not belong to you" });
    }

    const timerState = await autoSubmitIfExpired(pool, attemptInfo);
    attemptInfo = await fetchAttemptState(pool, attemptId);

    const { exam_id: examId, status } = attemptInfo;
    if (status === "SUBMITTED") {
      // idempotent-ish: just return existing result
      const result = await pool.request().input("attemptId", attemptId).query(`
        SELECT TOP 1 result_id, attempt_id, student_id, exam_id, score, percentage, student_rank, submitted_at
        FROM Results
        WHERE attempt_id = @attemptId
      `);
      return res.json({
        status: "ok",
        alreadySubmitted: true,
        autoSubmitted: timerState.autoSubmitted,
        result: result.recordset[0] || null
      });
    }

    // Call your stored procedures
    // Note: we don't need BEGIN TRAN here because sp_SubmitExam already does it.
    await pool.request().input("attempt_id", attemptId).execute("sp_SubmitExam");
    await pool.request().input("exam_id", examId).execute("sp_GenerateRankings");

    await pool
      .request()
      .input("student_id", attemptInfo.student_id)
      .input("exam_id", examId)
      .input("event_type", "EXAM_SUBMIT_MANUAL")
      .input("event_description", `Attempt ${attemptId} submitted manually`)
      .query(`
        INSERT INTO AuditLogs (student_id, exam_id, event_type, event_description)
        VALUES (@student_id, @exam_id, @event_type, @event_description)
      `);

    // Return final result
    const final = await pool.request().input("attemptId", attemptId).query(`
      SELECT TOP 1 result_id, attempt_id, student_id, exam_id, score, percentage, student_rank, submitted_at
      FROM Results
      WHERE attempt_id = @attemptId
    `);

    res.json({
      status: "ok",
      result: final.recordset[0] || null,
      dbConfigUsed: connectedConfig ? "auto-detected" : "env"
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Alias required by prompt:
// POST /api/submit-answer
// Body: { attempt_id, question_id, selected_option }
router.post("/api/submit-answer", requireStudent, async (req, res, next) => {
  const attemptId = Number(req.body.attempt_id);
  if (!Number.isInteger(attemptId)) return res.status(400).json({ message: "attempt_id is required" });
  req.params.attemptId = attemptId;
  req.url = `/api/attempts/${attemptId}/answer`;
  return router.handle(req, res, next);
});

// Alias required by prompt:
// POST /api/submit-exam
// Body: { attempt_id }
router.post("/api/submit-exam", requireStudent, async (req, res, next) => {
  const attemptId = Number(req.body.attempt_id);
  if (!Number.isInteger(attemptId)) return res.status(400).json({ message: "attempt_id is required" });
  req.params.attemptId = attemptId;
  req.url = `/api/attempts/${attemptId}/submit`;
  return router.handle(req, res, next);
});

// Required by prompt:
// GET /api/result?attempt_id=...
router.get("/api/result", requireStudent, async (req, res) => {
  const attemptId = Number(req.query.attempt_id);
  if (!Number.isInteger(attemptId)) return res.status(400).json({ message: "attempt_id is required" });

  try {
    const pool = await getPool();
    const attemptInfo = await pool.request().input("attemptId", attemptId).query(`
      SELECT attempt_id, student_id
      FROM ExamAttempts
      WHERE attempt_id = @attemptId
    `);
    if (!attemptInfo.recordset.length) return res.status(404).json({ message: "Attempt not found" });
    if (attemptInfo.recordset[0].student_id !== req.session.student.student_id) {
      return res.status(403).json({ message: "This result does not belong to you" });
    }

    const result = await pool.request().input("attemptId", attemptId).query(`
      SELECT TOP 1 result_id, attempt_id, student_id, exam_id, score, percentage, student_rank, submitted_at
      FROM Results
      WHERE attempt_id = @attemptId
    `);

    res.json({ result: result.recordset[0] || null });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Required by prompt:
// GET /api/ranking?exam_id=...
router.get("/api/ranking", requireStudent, async (req, res) => {
  const examId = Number(req.query.exam_id);
  if (!Number.isInteger(examId)) return res.status(400).json({ message: "exam_id is required" });

  try {
    const pool = await getPool();
    const ranking = await pool.request().input("exam_id", examId).query(`
      SELECT
        r.student_id,
        s.full_name,
        r.score,
        r.percentage,
        r.student_rank,
        r.submitted_at
      FROM Results r
      JOIN Students s ON s.student_id = r.student_id
      WHERE r.exam_id = @exam_id
      ORDER BY r.student_rank ASC, r.submitted_at ASC
    `);

    res.json({ exam_id: examId, ranking: ranking.recordset });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

