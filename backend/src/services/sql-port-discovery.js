const { execSync } = require("child_process");

const DEFAULT_INSTANCE = "MSSQLSERVER";

function parseRegPort(output) {
  const match = String(output).match(/REG_SZ\s+(\d+)/);
  if (!match) return null;
  const port = Number(match[1]);
  return port > 0 ? port : null;
}

function queryRegValue(keyPath, valueName) {
  try {
    const out = execSync(`reg query "${keyPath}" /v ${valueName}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return parseRegPort(out);
  } catch {
    return null;
  }
}

function discoverInstanceTcpPort(internalName) {
  if (process.platform !== "win32" || !internalName) return null;

  const versions = ["MSSQL12", "MSSQL13", "MSSQL14", "MSSQL15", "MSSQL16"];
  for (const ver of versions) {
    const key = `HKLM\\SOFTWARE\\Microsoft\\Microsoft SQL Server\\${ver}.${internalName}\\MSSQLServer\\SuperSocketNetLib\\Tcp\\IPAll`;
    const staticPort = queryRegValue(key, "TcpPort");
    if (staticPort) return staticPort;
    const dynamicPort = queryRegValue(key, "TcpDynamicPorts");
    if (dynamicPort) return dynamicPort;
  }

  return null;
}

function listInstalledInstances() {
  if (process.platform !== "win32") return [];

  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Microsoft SQL Server\\Instance Names\\SQL"',
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    const instances = [];
    for (const line of out.split(/\r?\n/)) {
      const match = line.match(/^\s+(\S+)\s+REG_SZ\s+(\S+)\s*$/);
      if (match) instances.push({ alias: match[1], internal: match[2] });
    }
    return instances;
  } catch {
    return [];
  }
}

function resolveInstanceInternalName(instanceAlias) {
  const alias = String(instanceAlias || "").trim();
  if (!alias) return null;

  const instances = listInstalledInstances();
  const found = instances.find((i) => i.alias.toUpperCase() === alias.toUpperCase());
  if (found) return found.internal;

  if (alias.toUpperCase() === DEFAULT_INSTANCE) return DEFAULT_INSTANCE;
  return alias;
}

function discoverSqlPorts(instanceAlias) {
  const internal = resolveInstanceInternalName(instanceAlias);
  if (!internal) return [];

  const port = discoverInstanceTcpPort(internal);
  return port ? [port] : [];
}

function getInstalledInstanceAliases() {
  return listInstalledInstances().map((i) => i.alias);
}

function getPrimaryInstanceAlias() {
  const envInstance = String(process.env.DB_INSTANCE || "").trim();
  if (envInstance) return envInstance;

  const fromServer = String(process.env.DB_SERVER || "");
  if (fromServer.includes("\\")) {
    return fromServer.split("\\")[1];
  }

  const installed = getInstalledInstanceAliases();
  if (installed.length === 1) return installed[0];

  if (installed.includes(DEFAULT_INSTANCE)) return DEFAULT_INSTANCE;
  if (installed.length) return installed[0];

  return DEFAULT_INSTANCE;
}

function discoverPortsForInstalledInstances() {
  const ports = [];
  for (const alias of getInstalledInstanceAliases()) {
    for (const p of discoverSqlPorts(alias)) {
      if (!ports.includes(p)) ports.push(p);
    }
  }
  return ports;
}

module.exports = {
  DEFAULT_INSTANCE,
  discoverSqlPorts,
  discoverInstanceTcpPort,
  listInstalledInstances,
  getInstalledInstanceAliases,
  getPrimaryInstanceAlias,
  discoverPortsForInstalledInstances,
  resolveInstanceInternalName
};
