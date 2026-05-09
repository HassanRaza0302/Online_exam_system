const express = require("express");
const { getPool } = require("../services/db");
const bcrypt = require("bcryptjs");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.get("/api/auth/me", (req, res) => {
  res.json({
    student: req.session?.student || null,
    admin: req.session?.admin || null
  });
});

router.post("/api/register-student", async (req, res) => {
  const fullName = String(req.body.full_name || "").trim();
  const email = String(req.body.email || "").trim();
  const password = String(req.body.password || "");

  if (!fullName || !email || !password) {
    return res.status(400).json({ message: "full_name, email and password are required" });
  }

  try {
    const pool = await getPool();
    const passwordHash = await bcrypt.hash(password, 10);

    const insert = await pool
      .request()
      .input("full_name", fullName)
      .input("email", email)
      .input("password_hash", passwordHash)
      .query(`
        INSERT INTO Students (full_name, email, password, status)
        OUTPUT INSERTED.student_id
        VALUES (@full_name, @email, @password_hash, 'PENDING')
      `);

    await pool
      .request()
      .input("event_type", "STUDENT_REGISTER")
      .input("event_description", `Student registered (pending approval): ${email}`)
      .input("student_id", insert.recordset[0].student_id)
      .input("exam_id", null)
      .execute("sp_LogAuthEvent");

    res.status(201).json({
      status: "PENDING",
      message: "Registration submitted. Wait for admin approval."
    });
  } catch (err) {
    if (String(err.message).toLowerCase().includes("duplicate")) {
      return res.status(409).json({ message: "Email already exists" });
    }
    return res.status(500).json({ message: err.message });
  }
});

router.post("/api/register-admin", requireAdmin, async (req, res) => {
  const fullName = String(req.body.full_name || "").trim();
  const email = String(req.body.email || "").trim();
  const password = String(req.body.password || "");

  if (!fullName || !email || !password) {
    return res.status(400).json({ message: "full_name, email and password are required" });
  }

  try {
    const pool = await getPool();
    const passwordHash = await bcrypt.hash(password, 10);

    await pool
      .request()
      .input("full_name", fullName)
      .input("email", email)
      .input("password_hash", passwordHash)
      .query(`
        INSERT INTO Admins (full_name, email, password, status)
        VALUES (@full_name, @email, @password_hash, 'APPROVED')
      `);

    res.status(201).json({ status: "APPROVED", message: "Admin registered successfully." });
  } catch (err) {
    if (String(err.message).toLowerCase().includes("duplicate")) {
      return res.status(409).json({ message: "Email already exists" });
    }
    return res.status(500).json({ message: err.message });
  }
});

router.post("/api/auth/student/login", async (req, res) => {
  const email = String(req.body.email || "").trim();
  const password = String(req.body.password || "");

  if (!email || !password) return res.status(400).json({ message: "Email and password are required" });

  try {
    const pool = await getPool();

    const result = await pool
      .request()
      .input("email", email)
      .query(`
        SELECT TOP 1 student_id, full_name, email, password, status
        FROM Students
        WHERE email = @email
      `);

    if (!result.recordset.length) return res.status(401).json({ message: "Invalid email or password" });

    const row = result.recordset[0];
    const isValid = await bcrypt.compare(password, row.password);
    if (!isValid) return res.status(401).json({ message: "Invalid email or password" });
    if (row.status !== "APPROVED") {
      return res.status(403).json({ message: `Account is ${row.status}. Wait for admin approval.` });
    }

    const loginResult = await pool
      .request()
      .input("email", email)
      .input("password_hash", row.password)
      .execute("sp_StudentLogin");

    if (!loginResult.recordset.length) return res.status(401).json({ message: "Invalid email or password" });

    const student = loginResult.recordset[0];

    req.session.student = student;
    req.session.admin = null;

    await pool
      .request()
      .input("event_type", "STUDENT_LOGIN")
      .input("event_description", `Student logged in: ${student.email}`)
      .input("student_id", student.student_id)
      .input("exam_id", null)
      .execute("sp_LogAuthEvent");

    res.json({ student });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/api/auth/admin/login", async (req, res) => {
  const email = String(req.body.email || "").trim();
  const password = String(req.body.password || "");

  if (!email || !password) return res.status(400).json({ message: "Email and password are required" });

  try {
    const pool = await getPool();

    const result = await pool
      .request()
      .input("email", email)
      .query(`
        SELECT TOP 1 admin_id, full_name, email, password, status
        FROM Admins
        WHERE email = @email
      `);

    if (!result.recordset.length) return res.status(401).json({ message: "Invalid email or password" });

    const row = result.recordset[0];
    const isValid = await bcrypt.compare(password, row.password);
    if (!isValid) return res.status(401).json({ message: "Invalid email or password" });
    if (row.status !== "APPROVED") {
      return res.status(403).json({ message: `Account is ${row.status}.` });
    }

    const loginResult = await pool
      .request()
      .input("email", email)
      .input("password_hash", row.password)
      .execute("sp_AdminLogin");

    if (!loginResult.recordset.length) return res.status(401).json({ message: "Invalid email or password" });

    const admin = loginResult.recordset[0];

    req.session.admin = admin;
    req.session.student = null;

    await pool
      .request()
      .input("event_type", "ADMIN_LOGIN")
      .input("event_description", `Admin logged in: ${admin.email}`)
      .input("student_id", null)
      .input("exam_id", null)
      .execute("sp_LogAuthEvent");

    res.json({ admin });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/api/login", async (req, res) => {
  const role = String(req.body.role || "").toLowerCase();
  if (role === "student") {
    req.url = "/api/auth/student/login";
    return router.handle(req, res);
  }
  if (role === "admin") {
    req.url = "/api/auth/admin/login";
    return router.handle(req, res);
  }
  return res.status(400).json({ message: "role must be 'student' or 'admin'" });
});

router.post("/api/auth/student/logout", (req, res) => {
  if (req.session) req.session.student = null;
  res.json({ status: "ok" });
});

router.post("/api/auth/admin/logout", (req, res) => {
  if (req.session) req.session.admin = null;
  res.json({ status: "ok" });
});

module.exports = router;

