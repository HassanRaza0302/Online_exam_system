const express = require("express");
const { getPool } = require("../services/db");

const router = express.Router();

// Basic server health
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "online-exam-system-backend",
    time: new Date().toISOString()
  });
});

// Database health (tests a simple SELECT 1)
router.get("/db/health", async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query("SELECT 1 AS ok");
    res.json({ status: "ok", db: "connected", result: result.recordset[0] });
  } catch (err) {
    res.status(500).json({
      status: "error",
      db: "disconnected",
      message: err.message
    });
  }
});

module.exports = router;

