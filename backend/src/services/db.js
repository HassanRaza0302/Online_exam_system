const sqlTedious = require("mssql");
const {
  discoverSqlPorts,
  discoverPortsForInstalledInstances,
  getInstalledInstanceAliases,
  getPrimaryInstanceAlias,
  DEFAULT_INSTANCE
} = require("./sql-port-discovery");

let poolPromise = null;
let connectedConfig = null;
let activeDriver = "tedious";
let sqlOdbc = null;
let odbcLoadFailed = false;

const PROBE_TIMEOUT_MS = 8000;

function getOdbcDriver() {
  if (odbcLoadFailed) return null;
  if (sqlOdbc) return sqlOdbc;

  try {
    sqlOdbc = require("mssql/msnodesqlv8");
    return sqlOdbc;
  } catch (err) {
    odbcLoadFailed = true;
    console.warn(
      `[db] Native SQL driver unavailable (${err.code || err.message}). Install with: npm install msnodesqlv8`
    );
    return null;
  }
}

function useWindowsAuth() {
  return String(process.env.DB_USE_WINDOWS_AUTH || "").toLowerCase() === "true";
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

function parseServerSpec(server) {
  const raw = String(server || "").trim();
  if (!raw) return { host: null, instanceName: null };

  const slash = raw.includes("\\") ? "\\" : raw.includes("/") ? "/" : null;
  if (slash) {
    const idx = raw.indexOf(slash);
    return {
      host: raw.slice(0, idx) || "localhost",
      instanceName: raw.slice(idx + 1) || null
    };
  }

  return { host: raw, instanceName: null };
}

function formatConnectTarget(config) {
  const inst = config.options?.instanceName;
  if (inst) return `${config.server}\\${inst}`;
  if (config.connectionString) return "ODBC connection string";
  return `${config.server}${config.port ? `:${config.port}` : ""}`;
}

function buildNamedInstanceServers() {
  const primary = parseServerSpec(process.env.DB_SERVER);
  const instance =
    primary.instanceName ||
    String(process.env.DB_INSTANCE || "").trim() ||
    getPrimaryInstanceAlias() ||
    "SQLEXPRESS";

  const computerName =
    process.platform === "win32" ? String(process.env.COMPUTERNAME || "").trim() : "";

  return uniqueNonEmpty([
    process.env.DB_SERVER,
    primary.host && primary.instanceName ? `${primary.host}\\${primary.instanceName}` : null,
    `localhost\\${instance}`,
    `.\\${instance}`,
    `(local)\\${instance}`,
    computerName ? `${computerName}\\${instance}` : null,
    "localhost",
    ".",
    "(local)"
  ]);
}

function buildWindowsOdbcConfigs() {
  const database = process.env.DB_DATABASE;
  const servers = buildNamedInstanceServers();
  const configs = [];

  for (const server of servers) {
    configs.push({
      driver: "msnodesqlv8",
      server: "localhost",
      connectionString: `Driver={ODBC Driver 17 for SQL Server};Server=${server};Database=${database};Trusted_Connection=Yes;TrustServerCertificate=Yes;`,
      connectionTimeout: PROBE_TIMEOUT_MS,
      requestTimeout: 30000
    });
    configs.push({
      driver: "msnodesqlv8",
      server: "localhost",
      connectionString: `Driver={SQL Server};Server=${server};Database=${database};Trusted_Connection=Yes;TrustServerCertificate=Yes;`,
      connectionTimeout: PROBE_TIMEOUT_MS,
      requestTimeout: 30000
    });
  }

  return configs;
}

function buildWindowsNativeConfigs() {
  const database = process.env.DB_DATABASE;
  const servers = buildNamedInstanceServers();
  const configs = [];

  for (const server of servers) {
    configs.push({
      server,
      database,
      connectionTimeout: PROBE_TIMEOUT_MS,
      requestTimeout: 30000,
      options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        trustedConnection: true
      },
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
    });
  }

  return configs;
}

function buildSqlAuthConfigs() {
  const database = process.env.DB_DATABASE;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const primary = parseServerSpec(process.env.DB_SERVER);

  const instanceNames = uniqueNonEmpty([
    primary.instanceName,
    process.env.DB_INSTANCE,
    getPrimaryInstanceAlias(),
    ...getInstalledInstanceAliases()
  ]);

  let discoveredPorts =
    process.platform === "win32" ? discoverPortsForInstalledInstances() : [];
  for (const name of instanceNames) {
    discoveredPorts = uniqueNonEmpty([...discoveredPorts, ...discoverSqlPorts(name)]);
  }

  const envPort = process.env.DB_PORT ? Number(process.env.DB_PORT) : null;
  const candidatePorts = uniqueNonEmpty([envPort, ...discoveredPorts, 1433]).map(Number);

  const computerName =
    process.platform === "win32" ? String(process.env.COMPUTERNAME || "").trim() : "";
  const hosts = uniqueNonEmpty([primary.host || "localhost", computerName, "localhost", "127.0.0.1"]);

  const configs = [];
  const seen = new Set();

  function pushConfig(cfg) {
    const key = JSON.stringify({ s: cfg.server, p: cfg.port, i: cfg.options?.instanceName });
    if (seen.has(key)) return;
    seen.add(key);
    configs.push(cfg);
  }

  for (const host of hosts) {
    for (const port of candidatePorts) {
      pushConfig({
        server: host,
        port,
        database,
        user,
        password,
        connectionTimeout: PROBE_TIMEOUT_MS,
        requestTimeout: 30000,
        options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
        pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
      });
    }
    for (const inst of instanceNames) {
      if (inst.toUpperCase() === DEFAULT_INSTANCE) continue;
      pushConfig({
        server: host,
        database,
        user,
        password,
        connectionTimeout: PROBE_TIMEOUT_MS,
        requestTimeout: 30000,
        options: {
          encrypt: false,
          trustServerCertificate: true,
          enableArithAbort: true,
          instanceName: inst
        },
        pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
      });
    }
  }

  return configs;
}

function buildConnectionError(attempts, lastErr) {
  const installed = process.platform === "win32" ? getInstalledInstanceAliases() : [];
  const lines = attempts.map((a) => `  - ${a}`).join("\n");
  const instance = installed[0] || "SQLEXPRESS";

  return new Error(
    `Could not connect to SQL Server.\n` +
      `Attempts:\n${lines}\n\n` +
      `Recommended backend/.env:\n` +
      `  DB_SERVER=localhost\\${instance}\n` +
      `  DB_USE_WINDOWS_AUTH=true\n` +
      `  DB_DATABASE=OnlineExamSystem\n\n` +
      `Fix:\n` +
      `  1) services.msc → SQL Server (${instance}) = Running\n` +
      `  2) Run database/Project.sql in SSMS\n` +
      `  3) npm run db:discover\n` +
      `  4) npm run db:test\n\n` +
      `Last error: ${lastErr?.message || "unknown"}`
  );
}

async function tryConnect(driver, configs, label, attempts) {
  let lastErr = null;

  for (const cfg of configs) {
    const target = formatConnectTarget(cfg);
    try {
      const pool = await driver.connect(cfg);
      connectedConfig = cfg;
      activeDriver = label;
      console.log(`[db] Connected (${label}): ${target} db=${cfg.database || process.env.DB_DATABASE}`);
      return pool;
    } catch (err) {
      lastErr = err;
      attempts.push(`${label} ${target} → ${err.message}`);
    }
  }

  return { error: lastErr };
}

async function getPool() {
  if (!poolPromise) {
    const database = process.env.DB_DATABASE;
    const windowsAuth = useWindowsAuth();

    const missing = [];
    if (!database) missing.push("DB_DATABASE");
    if (!windowsAuth) {
      if (!process.env.DB_USER) missing.push("DB_USER");
      if (!process.env.DB_PASSWORD) missing.push("DB_PASSWORD");
    }
    if (missing.length) {
      throw new Error(`Missing environment variables: ${missing.join(", ")}`);
    }

    poolPromise = (async () => {
      const attempts = [];
      let lastErr = null;

      const envPort = process.env.DB_PORT ? Number(process.env.DB_PORT) : null;
      const envServer = String(process.env.DB_SERVER || "localhost").trim();

      if (envPort) {
        const directConfig = {
          server: envServer.includes("\\") ? envServer.split("\\")[0] : envServer,
          port: envPort,
          database,
          connectionTimeout: PROBE_TIMEOUT_MS,
          requestTimeout: 30000,
          options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
          pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
          ...(windowsAuth
            ? { authentication: { type: "default" } }
            : { user: process.env.DB_USER, password: process.env.DB_PASSWORD })
        };

        const direct = await tryConnect(sqlTedious, [directConfig], "direct", attempts);
        if (direct && !direct.error) return direct;
        lastErr = direct?.error || lastErr;
      }

      if (windowsAuth && process.platform === "win32") {
        const odbc = getOdbcDriver();
        if (odbc) {
          const result = await tryConnect(
            odbc,
            buildWindowsOdbcConfigs(),
            "odbc",
            attempts
          );
          if (result && !result.error) return result;
          lastErr = result?.error || lastErr;
        }

        const odbcNative = getOdbcDriver();
        if (odbcNative) {
          const result = await tryConnect(
            odbcNative,
            buildWindowsNativeConfigs(),
            "native",
            attempts
          );
          if (result && !result.error) return result;
          lastErr = result?.error || lastErr;
        }
      }

      const tediousConfigs = windowsAuth
        ? buildWindowsNativeConfigs().map((cfg) => ({
            ...cfg,
            authentication: { type: "default" },
            options: { ...cfg.options, trustedConnection: undefined }
          }))
        : buildSqlAuthConfigs();

      const result = await tryConnect(sqlTedious, tediousConfigs, "tedious", attempts);
      if (result && !result.error) return result;
      lastErr = result?.error || lastErr;

      throw buildConnectionError(attempts, lastErr);
    })();
  }

  return poolPromise;
}

async function closeDb() {
  poolPromise = null;
  if (activeDriver === "odbc" || activeDriver === "native") {
    if (sqlOdbc) return sqlOdbc.close();
  }
  return sqlTedious.close();
}

module.exports = { getPool, closeDb, connectedConfig };
