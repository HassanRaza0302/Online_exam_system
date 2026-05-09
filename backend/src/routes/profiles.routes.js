const express = require("express");
const { getPool } = require("../services/db");
const { requireStudent, requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.get("/api/profile/student", requireStudent, async (req, res) => {
  const studentId = req.session.student.student_id;

  try {
    const pool = await getPool();

    const studentResult = await pool.request().input("student_id", studentId).query(`
      SELECT student_id, full_name, email, status, created_at
      FROM Students
      WHERE student_id = @student_id
    `);

    const attemptsResult = await pool.request().input("student_id", studentId).query(`
      SELECT
        ea.attempt_id,
        ea.exam_id,
        e.exam_title,
        ea.status,
        r.score,
        r.percentage,
        r.student_rank,
        r.submitted_at
      FROM ExamAttempts ea
      JOIN Exams e ON e.exam_id = ea.exam_id
      LEFT JOIN Results r ON r.attempt_id = ea.attempt_id
      WHERE ea.student_id = @student_id
      ORDER BY ea.start_time DESC
    `);

    res.json({
      student: studentResult.recordset[0] || null,
      attempts: attemptsResult.recordset
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/api/profile/admin", requireAdmin, async (req, res) => {
  const adminId = req.session.admin.admin_id;

  try {
    const pool = await getPool();

    const adminResult = await pool.request().input("admin_id", adminId).query(`
      SELECT admin_id, full_name, email, status
      FROM Admins
      WHERE admin_id = @admin_id
    `);

    const examsResult = await pool.request().input("admin_id", adminId).query(`
      SELECT exam_id, exam_title, subject_name, duration_minutes, total_marks, created_at
      FROM Exams
      WHERE created_by = @admin_id
      ORDER BY created_at DESC
    `);

    const studentStats = await pool.request().query(`
      SELECT
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending_students,
        SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved_students,
        SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected_students,
        COUNT(*) AS total_students
      FROM Students
    `);

    res.json({
      admin: adminResult.recordset[0] || null,
      created_exams: examsResult.recordset,
      student_stats: studentStats.recordset[0] || null
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

