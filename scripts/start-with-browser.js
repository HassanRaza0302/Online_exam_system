const { spawn, exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const backendDir = path.join(__dirname, "..", "backend");

function readPort() {
  if (process.env.PORT) return Number(process.env.PORT);
  try {
    const envText = fs.readFileSync(path.join(backendDir, ".env"), "utf8");
    const match = envText.match(/^PORT=(\d+)\s*$/m);
    if (match) return Number(match[1]);
  } catch {
    // use default
  }
  return 3011;
}

const PORT = readPort();
const url = `http://localhost:${PORT}`;

function openBrowser() {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) console.log(`[app] Open in your browser: ${url}`);
  });
}

const child = spawn("node", ["src/server.js"], {
  cwd: backendDir,
  stdio: "inherit",
  env: process.env
});

setTimeout(openBrowser, 1500);

child.on("exit", (code) => process.exit(code ?? 0));

function shutdown() {
  if (!child.killed) child.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
