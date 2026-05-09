const express = require("express");
const cors = require("cors");
const path = require("path");
const session = require("express-session");

const healthRoutes = require("./routes/health.routes");
const examsRoutes = require("./routes/exams.routes");
const attemptsRoutes = require("./routes/attempts.routes");
const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const profilesRoutes = require("./routes/profiles.routes");

function createApp() {
  const app = express();

  // Beginner-friendly defaults
  app.use(
    cors({
      origin: true,
      credentials: true
    })
  );
  app.use(express.json({ limit: "1mb" }));

  // Sessions (beginner-friendly, in-memory store)
  // NOTE: In production you should use a persistent session store.
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "dev_secret_change_me",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax"
      }
    })
  );

  // Serve frontend (so you can open http://localhost:3001/ in browser)
  const frontendPath = path.join(__dirname, "../../frontend");
  app.use(express.static(frontendPath));

  // Routes
  app.use(healthRoutes);
  app.use(authRoutes);
  app.use(adminRoutes);
  app.use(profilesRoutes);
  app.use(examsRoutes);
  app.use(attemptsRoutes);

  // 404
  app.use((req, res) => {
    res.status(404).json({ message: "Route not found" });
  });

  return app;
}

module.exports = { createApp };

