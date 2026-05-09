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

  app.use(
    cors({
      origin: true,
      credentials: true
    })
  );
  app.use(express.json({ limit: "1mb" }));

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

  const frontendPath = path.join(__dirname, "../../frontend");
  app.use(express.static(frontendPath));

  app.use(healthRoutes);
  app.use(authRoutes);
  app.use(adminRoutes);
  app.use(profilesRoutes);
  app.use(examsRoutes);
  app.use(attemptsRoutes);

  app.use((req, res) => {
    res.status(404).json({ message: "Route not found" });
  });

  return app;
}

module.exports = { createApp };

