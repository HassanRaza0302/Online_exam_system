require("dotenv").config();

const { createApp } = require("./app");

const PORT = Number(process.env.PORT) || 3011;

const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`[backend] Server running on http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`[backend] Port ${PORT} is already in use.`);
  } else {
    console.error("[backend] Failed to start server:", err.message);
  }
  process.exit(1);
});

