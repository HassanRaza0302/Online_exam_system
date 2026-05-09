const express = require("express");
const { getPool } = require("../services/db");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.post("/api/approve-student", requireAdmin, async (req, res) => {
  const studentId = Number(req.body.student_id);
  const status = String(req.body.status || "").toUpperCase().trim();

  if (!Number.isInteger(studentId)) return res.status(400).json({ message: "student_id must be an integer" });
  if (!["APPROVED", "REJECTED"].includes(status)) {
    return res.status(400).json({ message: "status must be APPROVED or REJECTED" });
  }

  try {
    const pool = await getPool();
    const update = await pool
      .request()
      .input("student_id", studentId)
      .input("status", status)
      .input("approved_by", req.session.admin.admin_id)
      .query(`
        UPDATE Students
        SET
          status = @status,
          approved_by = @approved_by,
          approved_at = GETDATE()
        WHERE student_id = @student_id;

        SELECT @@ROWCOUNT AS rows_affected;
      `);

    if (!update.recordset[0].rows_affected) {
      return res.status(404).json({ message: "Student not found" });
    }

    await pool
      .request()
      .input("event_type", `STUDENT_${status}`)
      .input("event_description", `Student ${studentId} marked as ${status} by admin ${req.session.admin.email}`)
      .input("student_id", studentId)
      .input("exam_id", null)
      .execute("sp_LogAuthEvent");

    return res.json({ status: "ok" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get("/api/admin/students/pending", requireAdmin, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT student_id, full_name, email, status, created_at
      FROM Students
      WHERE status = 'PENDING'
      ORDER BY created_at ASC
    `);
    return res.json({ students: result.recordset });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post("/api/admin/exams", requireAdmin, async (req, res) => {
  const examTitle = String(req.body.exam_title || "").trim();
  const subjectName = String(req.body.subject_name || "").trim();
  const durationMinutes = Number(req.body.duration_minutes);
  const totalMarks = Number(req.body.total_marks);
  const createdBy = req.session.admin.admin_id;

  if (!examTitle) return res.status(400).json({ message: "exam_title is required" });
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    return res.status(400).json({ message: "duration_minutes must be a positive integer" });
  }
  if (!Number.isInteger(totalMarks) || totalMarks <= 0) {
    return res.status(400).json({ message: "total_marks must be a positive integer" });
  }
  try {
    const pool = await getPool();
    const insert = await pool
      .request()
      .input("exam_title", examTitle)
      .input("subject_name", subjectName || null)
      .input("duration_minutes", durationMinutes)
      .input("total_marks", totalMarks)
      .input("created_by", createdBy)
      .query(
        `
        INSERT INTO Exams (exam_title, subject_name, duration_minutes, total_marks, created_by)
        OUTPUT INSERTED.exam_id
        VALUES (@exam_title, @subject_name, @duration_minutes, @total_marks, @created_by)
      `
      );

    res.status(201).json({ exam_id: insert.recordset[0].exam_id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/api/create-exam", requireAdmin, async (req, res, next) => {
  req.url = "/api/admin/exams";
  return router.handle(req, res, next);
});

router.post("/api/admin/exams/:examId/questions", requireAdmin, async (req, res) => {
  const examId = Number(req.params.examId);
  if (!Number.isInteger(examId)) return res.status(400).json({ message: "Invalid examId" });

  const questionText = String(req.body.question_text || "").trim();
  const optionA = String(req.body.option_a || "").trim();
  const optionB = String(req.body.option_b || "").trim();
  const optionC = String(req.body.option_c || "").trim();
  const optionD = String(req.body.option_d || "").trim();
  const correctOption = String(req.body.correct_option || "").toUpperCase().trim();
  const marks = req.body.marks === undefined || req.body.marks === null ? 5 : Number(req.body.marks);

  if (!questionText) return res.status(400).json({ message: "question_text is required" });
  if (!optionA || !optionB || !optionC || !optionD) {
    return res.status(400).json({ message: "All options (A, B, C, D) are required" });
  }
  if (!["A", "B", "C", "D"].includes(correctOption)) {
    return res.status(400).json({ message: "correct_option must be A, B, C, or D" });
  }
  if (!Number.isInteger(marks) || marks <= 0) {
    return res.status(400).json({ message: "marks must be a positive integer" });
  }

  try {
    const pool = await getPool();

    const exam = await pool.request().input("examId", examId).query(`
      SELECT TOP 1 exam_id
      FROM Exams
      WHERE exam_id = @examId
    `);
    if (!exam.recordset.length) return res.status(404).json({ message: "Exam not found" });

    const insert = await pool
      .request()
      .input("exam_id", examId)
      .input("question_text", questionText)
      .input("option_a", optionA)
      .input("option_b", optionB)
      .input("option_c", optionC)
      .input("option_d", optionD)
      .input("correct_option", correctOption)
      .input("marks", marks)
      .query(
        `
        INSERT INTO Questions
          (exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks)
        OUTPUT INSERTED.question_id
        VALUES
          (@exam_id, @question_text, @option_a, @option_b, @option_c, @option_d, @correct_option, @marks)
      `
      );

    res.status(201).json({ question_id: insert.recordset[0].question_id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/api/add-question", requireAdmin, async (req, res) => {
  const examId = Number(req.body.exam_id);
  if (!Number.isInteger(examId)) return res.status(400).json({ message: "exam_id is required" });
  req.params.examId = examId;
  req.url = `/api/admin/exams/${examId}/questions`;
  return router.handle(req, res);
});

router.get("/api/admin/exams/:examId/results", requireAdmin, async (req, res) => {
  const examId = Number(req.params.examId);
  if (!Number.isInteger(examId)) return res.status(400).json({ message: "Invalid examId" });

  try {
    const pool = await getPool();

    const results = await pool.request().input("exam_id", examId).query(`
      SELECT
        r.result_id,
        r.attempt_id,
        r.student_id,
        s.full_name,
        s.email,
        r.exam_id,
        r.score,
        r.percentage,
        r.student_rank,
        r.submitted_at
      FROM Results r
      JOIN Students s ON s.student_id = r.student_id
      WHERE r.exam_id = @exam_id
      ORDER BY
        CASE WHEN r.student_rank IS NULL THEN 1 ELSE 0 END,
        r.student_rank ASC,
        r.submitted_at ASC
    `);

    res.json({ exam_id: examId, results: results.recordset });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/api/admin/exams/:examId/rankings/recalculate", requireAdmin, async (req, res) => {
  const examId = Number(req.params.examId);
  if (!Number.isInteger(examId)) return res.status(400).json({ message: "Invalid examId" });

  try {
    const pool = await getPool();
    await pool.request().input("exam_id", examId).execute("sp_GenerateRankings");
    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

