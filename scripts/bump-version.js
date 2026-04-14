const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const rootPackagePath = path.join(ROOT, "package.json");
const offlinePackagePath = path.join(ROOT, "Ledgergo Offline PC", "package.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function bumpPatchVersion(version) {
  const match = String(version || "").trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return "1.0.1";
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]) + 1;
  return `${major}.${minor}.${patch}`;
}

if (String(process.env.SKIP_VERSION_BUMP || "").trim() === "1") {
  console.log("[version] skipped (SKIP_VERSION_BUMP=1)");
  process.exit(0);
}

if (!fs.existsSync(rootPackagePath)) {
  throw new Error(`package.json not found: ${rootPackagePath}`);
}

const rootPackage = readJson(rootPackagePath);
const nextVersion = bumpPatchVersion(rootPackage.version);
rootPackage.version = nextVersion;
writeJson(rootPackagePath, rootPackage);

if (fs.existsSync(offlinePackagePath)) {
  const offlinePackage = readJson(offlinePackagePath);
  offlinePackage.version = nextVersion;
  writeJson(offlinePackagePath, offlinePackage);
}

console.log(`[version] bumped to ${nextVersion}`);

