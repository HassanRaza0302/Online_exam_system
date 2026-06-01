require("dotenv").config();

const {
  listInstalledInstances,
  discoverSqlPorts,
  getPrimaryInstanceAlias
} = require("../services/sql-port-discovery");

const instances = listInstalledInstances();
const primary = getPrimaryInstanceAlias();
const ports = discoverSqlPorts(primary);
const allPorts = [];
for (const inst of instances) {
  for (const p of discoverSqlPorts(inst.alias)) {
    if (!allPorts.includes(p)) allPorts.push(p);
  }
}

console.log("=== SQL Server discovery ===\n");

if (!instances.length) {
  console.log("No SQL Server instances found in Windows registry.");
  console.log("Install SQL Server or check services.msc.\n");
  process.exit(1);
}

console.log("Installed on this PC:");
instances.forEach((i) => {
  const p = discoverSqlPorts(i.alias);
  console.log(`  - ${i.alias} (${i.internal})${p.length ? ` → TCP port ${p.join(", ")}` : " → TCP port not set (enable TCP/IP)"}`);
});

if (instances.length === 1 && instances[0].alias === "SQLEXPRESS") {
  console.log(
    "\nNote: SQLEXPRESS is SQL Server 2014 Express (same product family, named instance)."
  );
  console.log("There is NO default instance on port 1433 on this machine.\n");
}

console.log("Recommended backend/.env:\n");
if (allPorts.length) {
  console.log("DB_SERVER=localhost");
  console.log(`DB_PORT=${allPorts[0]}`);
} else {
  console.log(`DB_SERVER=localhost\\${primary}`);
  console.log("# Enable TCP/IP in Configuration Manager, then run db:discover again");
}
console.log("DB_DATABASE=OnlineExamSystem");
console.log("DB_USER=sa");
console.log("DB_PASSWORD=<your password>");
console.log("\n# If you log into SSMS with Windows Authentication:");
console.log("# DB_USE_WINDOWS_AUTH=true");
