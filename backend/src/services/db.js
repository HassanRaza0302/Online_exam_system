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

function getOdbcDriver() {
  if (odbcLoadFailed) return null;
  if (sqlOdbc) return sqlOdbc;

  try {
    sqlOdbc = require("mssql/msnodesqlv8");
    return sqlOdbc;
  } catch (err) {
    odbcLoadFailed = true;
    console.warn(
      `[db] ODBC fallback disabled (${err.code || "load error"}). Using standard SQL driver only.`
    );
    return null;
  }
}

function getSqlConfig() {
  const useWindowsAuth =
    String(process.env.DB_USE_WINDOWS_AUTH || "").toLowerCase() === "true";

  return {
    server: process.env.DB_SERVER,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 1433,
    database: process.env.DB_DATABASE,
    user: useWindowsAuth ? undefined : process.env.DB_USER,
    password: useWindowsAuth ? undefined : process.env.DB_PASSWORD,
    connectionTimeout: Number(process.env.DB_CONNECTION_TIMEOUT) || 15000,
    requestTimeout: 30000,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true
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

function buildConnectConfig(base, host, port, instanceName) {
  const config = {
    ...base,
    server: host,
    options: {
      ...base.options,
      ...(instanceName ? { instanceName } : {})
    }
  };

  if (instanceName) {
    delete config.port;
  } else if (port) {
    config.port = port;
  } else {
    delete config.port;
  }

  return config;
}

function formatConnectTarget(config) {
  const inst = config.options?.instanceName;
  if (inst) return `${config.server}\\${inst}`;
  return `${config.server}${config.port ? `:${config.port}` : ""}`;
}

function buildWindowsAuthConfig(base, host, port, instanceName) {
  const config = {
    server: host,
    database: base.database,
    connectionTimeout: base.connectionTimeout,
    requestTimeout: base.requestTimeout,
    pool: base.pool,
    authentication: {
      type: "default"
    },
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
      ...(instanceName ? { instanceName } : {})
    }
  };
  if (instanceName) delete config.port;
  else if (port) config.port = port;
  return config;
}

function buildWindowsAuthFullServer(base, serverString) {
  return {
    server: serverString,
    database: base.database,
    connectionTimeout: base.connectionTimeout,
    requestTimeout: base.requestTimeout,
    pool: base.pool,
    authentication: {
      type: "default"
    },
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true
    }
  };
}

function buildCandidateConfigs() {
  const base = getSqlConfig();
  const primary = parseServerSpec(base.server);
  const installed = process.platform === "win32" ? getInstalledInstanceAliases() : [];

  const instanceNames = uniqueNonEmpty([
    primary.instanceName,
    process.env.DB_INSTANCE,
    getPrimaryInstanceAlias(),
    ...installed
  ]);

  let discoveredPorts =
    process.platform === "win32" ? discoverPortsForInstalledInstances() : [];
  for (const name of instanceNames) {
    discoveredPorts = uniqueNonEmpty([...discoveredPorts, ...discoverSqlPorts(name)]);
  }

  const envPort = process.env.DB_PORT ? Number(process.env.DB_PORT) : null;
  const candidatePorts = uniqueNonEmpty([...discoveredPorts, envPort, base.port, 1433]).map(
    Number
  );

  const computerName =
    process.platform === "win32" ? String(process.env.COMPUTERNAME || "").trim() : "";
  const hosts = uniqueNonEmpty([
    primary.host || "localhost",
    computerName,
    "localhost",
    "127.0.0.1",
    "."
  ]);
  const configs = [];
  const seen = new Set();

  function pushConfig(cfg) {
    const key = JSON.stringify({
      s: cfg.server,
      p: cfg.port,
      i: cfg.options?.instanceName,
      w: cfg.options?.trustedConnection
    });
    if (seen.has(key)) return;
    seen.add(key);
    configs.push(cfg);
  }

  const useWindowsAuth =
    String(process.env.DB_USE_WINDOWS_AUTH || "").toLowerCase() === "true";

  if (useWindowsAuth) {
    const fullServer = String(process.env.DB_SERVER || "").trim();
    if (fullServer.includes("\\")) {
      pushConfig(buildWindowsAuthFullServer(base, fullServer));
    }
    for (const host of hosts) {
      for (const inst of instanceNames) {
        if (inst.toUpperCase() !== DEFAULT_INSTANCE) {
          pushConfig(buildWindowsAuthConfig(base, host, null, inst));
        }
      }
      for (const port of candidatePorts) {
        pushConfig(buildWindowsAuthConfig(base, host, port, null));
      }
    }
    return configs;
  }

  for (const host of hosts) {
    for (const port of candidatePorts) {
      pushConfig(buildConnectConfig(base, host, port, null));
    }
    for (const inst of instanceNames) {
      if (inst.toUpperCase() === DEFAULT_INSTANCE) continue;
      pushConfig(buildConnectConfig(base, host, null, inst));
    }
  }

  if (installed.length) {
    console.log(`[db] Installed SQL instance(s): ${installed.join(", ")}`);
  }
  if (discoveredPorts.length) {
    console.log(`[db] Discovered TCP port(s): ${discoveredPorts.join(", ")}`);
  } else if (installed.length) {
    console.warn(
      "[db] No TCP port in registry — enable TCP/IP in SQL Server Configuration Manager, or set DB_USE_WINDOWS_AUTH=true"
    );
  }

  return configs;
}

function buildOdbcFallbackConfigs() {
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
    const connStrSqlAuth1 = `Driver={ODBC Driver 17 for SQL Server};Server=${s};Database=${db};Uid=${user};Pwd=${password};TrustServerCertificate=Yes;`;
    const connStrSqlAuth2 = `Driver={SQL Server Native Client 11.0};Server=${s};Database=${db};Uid=${user};Pwd=${password};TrustServerCertificate=Yes;`;

    const connStrWinAuth1 = `Driver={ODBC Driver 17 for SQL Server};Server=${s};Database=${db};Trusted_Connection=Yes;TrustServerCertificate=Yes;`;
    const connStrWinAuth2 = `Driver={SQL Server Native Client 11.0};Server=${s};Database=${db};Trusted_Connection=Yes;TrustServerCertificate=Yes;`;

    configs.push({
      driver: "msnodesqlv8",
      server: "localhost",
      connectionString: connStrSqlAuth1,
      connectionTimeout: 15000,
      requestTimeout: 30000
    });
    configs.push({
      driver: "msnodesqlv8",
      server: "localhost",
      connectionString: connStrSqlAuth2,
      connectionTimeout: 15000,
      requestTimeout: 30000
    });
    configs.push({
      driver: "msnodesqlv8",
      server: "localhost",
      connectionString: connStrWinAuth1,
      connectionTimeout: 15000,
      requestTimeout: 30000
    });
    configs.push({
      driver: "msnodesqlv8",
      server: "localhost",
      connectionString: connStrWinAuth2,
      connectionTimeout: 15000,
      requestTimeout: 30000
    });
  }

  return configs;
}

function buildConnectionError(attempts, lastErr) {
  const installed = process.platform === "win32" ? getInstalledInstanceAliases() : [];
  const lines = attempts.map((a) => `  - ${a}`).join("\n");
  const instanceHint =
    installed.length === 1
      ? `Your PC has: ${installed[0]}. In .env use DB_SERVER=localhost\\${installed[0]}`
      : installed.length
        ? `Installed: ${installed.join(", ")}`
        : "No SQL instance found in registry";

  return new Error(
    `Could not connect to SQL Server.\n` +
      `Attempts:\n${lines}\n\n` +
      `${instanceHint}\n\n` +
      `Fix:\n` +
      `  1) services.msc → SQL Server (${installed[0] || "MSSQLSERVER"}) = Running\n` +
      `  2) Configuration Manager → Protocols → TCP/IP = Enabled → Restart SQL Server\n` +
      `  3) SSMS: use the same server name that works for you, run database/Project.sql\n` +
      `  4) SQL auth: sa + DB_PASSWORD in .env  OR  Windows auth: DB_USE_WINDOWS_AUTH=true\n` +
      `  5) npm run db:discover\n\n` +
      `Last error: ${lastErr?.message || "unknown"}`
  );
}

async function getPool() {
  if (!poolPromise) {
    const config = getSqlConfig();

    const useWindowsAuth =
      String(process.env.DB_USE_WINDOWS_AUTH || "").toLowerCase() === "true";

    const missing = [];
    if (!config.database) missing.push("DB_DATABASE");
    if (!useWindowsAuth) {
      if (!config.user) missing.push("DB_USER");
      if (!config.password) missing.push("DB_PASSWORD");
    }
    if (missing.length) {
      throw new Error(`Missing environment variables: ${missing.join(", ")}`);
    }

    const candidates = buildCandidateConfigs();

    poolPromise = (async () => {
      let lastErr = null;
      const attempts = [];

      for (const c of candidates) {
        const target = formatConnectTarget(c);
        try {
          const pool = await sqlTedious.connect(c);
          connectedConfig = c;
          activeDriver = "tedious";
          console.log(`[db] Connected: ${target} db=${c.database}`);
          return pool;
        } catch (err) {
          lastErr = err;
          attempts.push(`${target} → ${err.message}`);
        }
      }

      const odbc = getOdbcDriver();
      if (odbc) {
        const odbcCandidates = buildOdbcFallbackConfigs();
        for (const c of odbcCandidates) {
          try {
            const pool = await odbc.connect(c);
            connectedConfig = c;
            activeDriver = "odbc";
            console.log("[db] Connected using ODBC fallback (msnodesqlv8).");
            return pool;
          } catch (err) {
            lastErr = err;
            attempts.push(`ODBC → ${err.message}`);
          }
        }
      }

      throw buildConnectionError(attempts, lastErr);
    })();
  }

  return poolPromise;
}

async function closeDb() {
  if (activeDriver === "odbc" && sqlOdbc) return sqlOdbc.close();
  return sqlTedious.close();
}

module.exports = { getPool, closeDb, connectedConfig };
