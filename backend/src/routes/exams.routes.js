const express = require("express");
const { getPool } = require("../services/db");
const { requireStudent } = require("../middleware/auth");

const router = express.Router();

// List exams (basic)
router.get("/api/exams", async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT exam_id, exam_title, subject_name, duration_minutes, total_marks, created_at
      FROM Exams
      ORDER BY created_at DESC
    `);
    res.json({ exams: result.recordset });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get one exam + questions (for starting exam UI)
router.get("/api/exams/:examId", async (req, res) => {
  const examId = Number(req.params.examId);
  if (!Number.isInteger(examId)) return res.status(400).json({ message: "Invalid examId" });

  try {
    const pool = await getPool();

    const examResult = await pool.request().input("examId", examId).query(`
      SELECT exam_id, exam_title, subject_name, duration_minutes, total_marks
      FROM Exams
      WHERE exam_id = @examId
    `);

    if (examResult.recordset.length === 0) {
      return res.status(404).json({ message: "Exam not found" });
    }

    const questionsResult = await pool.request().input("examId", examId).query(`
      SELECT question_id, question_text, option_a, option_b, option_c, option_d, marks
      FROM Questions
      WHERE exam_id = @examId
      ORDER BY question_id ASC
    `);

    res.json({
      exam: examResult.recordset[0],
      questions: questionsResult.recordset
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Start exam attempt
// Body: { "student_id": 1 }
router.post("/api/exams/:examId/start", requireStudent, async (req, res) => {
  const examId = Number(req.params.examId);
  const studentId = req.session.student.student_id;

  if (!Number.isInteger(examId)) return res.status(400).json({ message: "Invalid examId" });
  // studentId comes from session

  try {
    const pool = await getPool();

    // Ensure student is still approved in DB
    const studentCheck = await pool
      .request()
      .input("studentId", studentId)
      .query(`
        SELECT TOP 1 status
        FROM Students
        WHERE student_id = @studentId
      `);
    if (!studentCheck.recordset.length) return res.status(404).json({ message: "Student not found" });
    if (studentCheck.recordset[0].status !== "APPROVED") {
      return res.status(403).json({ message: `Account is ${studentCheck.recordset[0].status}` });
    }

    // SINGLE ATTEMPT restriction: if any attempt exists, block re-entry.
    const existing = await pool
      .request()
      .input("studentId", studentId)
      .input("examId", examId)
      .query(`
      SELECT TOP 1 attempt_id, status, start_time
      FROM ExamAttempts
      WHERE student_id = @studentId
        AND exam_id = @examId
      ORDER BY start_time DESC
    `);

    if (existing.recordset.length) {
      return res.status(409).json({
        message: "You already attempted this exam",
        attempt_id: existing.recordset[0].attempt_id,
        status: existing.recordset[0].status
      });
    }

    // Ensure exam exists and fetch duration for timer metadata
    const exam = await pool.request().input("examId", examId).query(`
      SELECT TOP 1 exam_id, duration_minutes
      FROM Exams
      WHERE exam_id = @examId
    `);
    if (!exam.recordset.length) return res.status(404).json({ message: "Exam not found" });

    const insert = await pool
      .request()
      .input("studentId", studentId)
      .input("examId", examId)
      .query(`
      INSERT INTO ExamAttempts (student_id, exam_id, start_time)
      OUTPUT INSERTED.attempt_id, INSERTED.start_time
      VALUES (@studentId, @examId, GETDATE())
    `);

    await pool
      .request()
      .input("event_type", "EXAM_START")
      .input("event_description", `Student ${studentId} started exam ${examId}`)
      .input("student_id", studentId)
      .input("exam_id", examId)
      .query(`
        INSERT INTO AuditLogs (student_id, exam_id, event_type, event_description)
        VALUES (@student_id, @exam_id, @event_type, @event_description)
      `);

    const startedAt = insert.recordset[0].start_time;
    const durationMinutes = exam.recordset[0].duration_minutes;
    const expiresAt = new Date(new Date(startedAt).getTime() + durationMinutes * 60 * 1000).toISOString();

    res.status(201).json({
      attempt_id: insert.recordset[0].attempt_id,
      status: "IN_PROGRESS",
      started_at: startedAt,
      duration_minutes: durationMinutes,
      expires_at: expiresAt
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Alias required by prompt:
// POST /api/start-exam
// Body: { exam_id }
router.post("/api/start-exam", requireStudent, async (req, res, next) => {
  const examId = Number(req.body.exam_id);
  if (!Number.isInteger(examId)) return res.status(400).json({ message: "exam_id is required" });
  req.params.examId = examId;
  req.url = `/api/exams/${examId}/start`;
  return router.handle(req, res, next);
});

module.exports = router;

