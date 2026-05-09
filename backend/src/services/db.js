const sqlTedious = require("mssql");
const sqlOdbc = require("mssql/msnodesqlv8");

let poolPromise = null;
let connectedConfig = null;
let activeDriver = "tedious";

function getSqlConfig() {
  return {
    server: process.env.DB_SERVER,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 1433,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionTimeout: 5000,
    requestTimeout: 30000,
    options: {
      // Common for local SQL Server dev.
      encrypt: false,
      trustServerCertificate: true
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    }
  };
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    if (!v) continue;
    const key = String(v).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function buildCandidateConfigs() {
  const base = getSqlConfig();

  // If student didn't set these, provide sensible defaults.
  const candidateServers = uniqueNonEmpty([
    base.server,
    "localhost",
    "127.0.0.1",
    "localhost\\SQLEXPRESS"
  ]);

  const candidatePorts = uniqueNonEmpty([base.port, 1433]).map((p) => Number(p));

  const configs = [];
  for (const server of candidateServers) {
    const isNamedInstance = server.includes("\\");
    if (isNamedInstance) {
      // Named instances usually rely on SQL Browser; specifying a port can break it.
      configs.push({ ...base, server, port: undefined });
    } else {
      for (const port of candidatePorts) {
        configs.push({ ...base, server, port });
      }
    }
  }

  return configs;
}

function buildOdbcFallbackConfigs() {
  // ODBC can connect to local named instances without SQL Browser in some setups.
  // This is a pragmatic fallback for student machines.
  const db = process.env.DB_DATABASE;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;

  const servers = uniqueNonEmpty([
    process.env.DB_SERVER,
    ".\\SQLEXPRESS",
    "(local)\\SQLEXPRESS",
    "localhost\\SQLEXPRESS",
    ".",
    "(local)"
  ]);

  const configs = [];
  for (const s of servers) {
    // Try newer driver name first; if not installed, the connect attempt will fail and we try next.
    const connStrSqlAuth1 = `Driver={ODBC Driver 17 for SQL Server};Server=${s};Database=${db};Uid=${user};Pwd=${password};TrustServerCertificate=Yes;`;
    const connStrSqlAuth2 = `Driver={SQL Server Native Client 11.0};Server=${s};Database=${db};Uid=${user};Pwd=${password};TrustServerCertificate=Yes;`;

    // Integrated Security (Windows Authentication) - often works even when TCP is disabled
    const connStrWinAuth1 = `Driver={ODBC Driver 17 for SQL Server};Server=${s};Database=${db};Trusted_Connection=Yes;TrustServerCertificate=Yes;`;
    const connStrWinAuth2 = `Driver={SQL Server Native Client 11.0};Server=${s};Database=${db};Trusted_Connection=Yes;TrustServerCertificate=Yes;`;

    configs.push({
      driver: "msnodesqlv8",
      server: "localhost",
      connectionString: connStrSqlAuth1,
      connectionTimeout: 5000,
      requestTimeout: 30000
    });
    configs.push({
      driver: "msnodesqlv8",
      server: "localhost",
      connectionString: connStrSqlAuth2,
      connectionTimeout: 5000,
      requestTimeout: 30000
    });
    configs.push({
      driver: "msnodesqlv8",
      server: "localhost",
      connectionString: connStrWinAuth1,
      connectionTimeout: 5000,
      requestTimeout: 30000
    });
    configs.push({
      driver: "msnodesqlv8",
      server: "localhost",
      connectionString: connStrWinAuth2,
      connectionTimeout: 5000,
      requestTimeout: 30000
    });
  }

  return configs;
}

async function getPool() {
  if (!poolPromise) {
    const config = getSqlConfig();

    // Basic config validation to fail fast (helpful for beginners)
    const missing = [];
    if (!config.database) missing.push("DB_DATABASE");
    if (!config.user) missing.push("DB_USER");
    if (!config.password) missing.push("DB_PASSWORD");
    // DB_SERVER can be auto-detected, so don't hard-fail when it's missing.
    if (missing.length) {
      throw new Error(`Missing environment variables: ${missing.join(", ")}`);
    }

    const candidates = buildCandidateConfigs();

    poolPromise = (async () => {
      let lastErr = null;
      for (const c of candidates) {
        try {
          const pool = await sqlTedious.connect(c);
          connectedConfig = c;
          activeDriver = "tedious";
          console.log(
            `[db] Connected to SQL Server: server=${c.server}${
              c.port ? ` port=${c.port}` : ""
            } db=${c.database}`
          );
          return pool;
        } catch (err) {
          lastErr = err;
          // continue trying next candidate
        }
      }

      // Fallback: ODBC driver (msnodesqlv8)
      try {
        const odbcCandidates = buildOdbcFallbackConfigs();
        for (const c of odbcCandidates) {
          try {
            const pool = await sqlOdbc.connect(c);
            connectedConfig = c;
            activeDriver = "odbc";
            console.log("[db] Connected using ODBC fallback (msnodesqlv8).");
            return pool;
          } catch (err) {
            lastErr = err;
          }
        }
      } catch (err) {
        // ignore; keep lastErr from connect attempts
      }
      throw lastErr || new Error("Failed to connect to SQL Server");
    })();
  }

  return poolPromise;
}

async function closeDb() {
  if (activeDriver === "odbc") return sqlOdbc.close();
  return sqlTedious.close();
}

module.exports = { getPool, closeDb, connectedConfig };

