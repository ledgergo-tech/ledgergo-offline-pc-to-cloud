const { app, BrowserWindow, dialog } = require("electron");
const http = require("http");
const path = require("path");
const fs = require("fs");

let server;

const REQUIRED_DATA_FILES = [
  "settings.json", "customers.json", "products.json", "banks.json",
  "invoices.json", "purchases.json", "expenses.json",
  "estimates.json", "proformas.json", "payment_in.json",
  "sale_orders.json", "challans.json", "sale_returns.json",
  "payment_out.json", "purchase_orders.json", "purchase_returns.json"
];

function getAppContentDir() {
  const base = app.getAppPath();
  const candidates = ["Ledgergo Offline PC", "LEDGERGO Offline PC"];
  for (const name of candidates) {
    const full = path.join(base, name);
    if (fs.existsSync(full)) return full;
  }
  return path.join(base, "Ledgergo Offline PC");
}

function getServerEntry() {
  return path.join(getAppContentDir(), "server.js");
}

function getWindowIcon() {
  const candidates = [
    path.join(process.resourcesPath || "", "icon.ico"),
    path.join(process.resourcesPath || "", "icon.png"),
    path.join(__dirname, "assets", "icon.ico"),
    path.join(__dirname, "assets", "icon.png"),
    path.join(getAppContentDir(), "public", "logo.png")
  ];

  for (const iconPath of candidates) {
    if (!iconPath) continue;
    if (fs.existsSync(iconPath)) return iconPath;
  }

  return undefined;
}

function parseJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function hasMeaningfulData(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

function getDataScore(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  return REQUIRED_DATA_FILES.reduce((score, fileName) => {
    const parsed = parseJsonFile(path.join(dirPath, fileName));
    return score + (hasMeaningfulData(parsed) ? 1 : 0);
  }, 0);
}

function hydrateMissingFiles(targetDir, sourceDirs) {
  const existingSources = sourceDirs.filter(dirPath => fs.existsSync(dirPath));
  if (!existingSources.length) return;

  REQUIRED_DATA_FILES.forEach((fileName) => {
    const targetFile = path.join(targetDir, fileName);
    const targetValue = parseJsonFile(targetFile);
    if (hasMeaningfulData(targetValue)) return;

    for (const sourceDir of existingSources) {
      const sourceFile = path.join(sourceDir, fileName);
      if (!fs.existsSync(sourceFile)) continue;

      const sourceValue = parseJsonFile(sourceFile);
      if (!hasMeaningfulData(sourceValue)) continue;

      try {
        fs.copyFileSync(sourceFile, targetFile);
      } catch (error) {
        // Ignore copy issues and continue checking other sources.
      }
      break;
    }
  });
}

function hydrateSharedDataDir(targetDir) {
  const appDataRoot = app.getPath("appData");
  const legacyDirs = [
    path.join(getAppContentDir(), "data"),
    path.join(appDataRoot, "ledgergo", "data")
  ].filter(dirPath => path.resolve(dirPath).toLowerCase() !== path.resolve(targetDir).toLowerCase());

  const prioritizedSources = legacyDirs
    .filter(dirPath => fs.existsSync(dirPath))
    .sort((a, b) => getDataScore(b) - getDataScore(a));

  hydrateMissingFiles(targetDir, prioritizedSources);
}

function resolveDataDir() {
  const sharedDir = path.join(app.getPath("appData"), "LEDGERGO", "data");
  try {
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.accessSync(sharedDir, fs.constants.W_OK);
    hydrateSharedDataDir(sharedDir);
    return sharedDir;
  } catch (error) {
    return path.join(app.getPath("userData"), "data");
  }
}

function waitForServer(urlToCheck, timeoutMs = 15000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const req = http.get(urlToCheck, (res) => {
        res.resume();
        resolve();
      });

      req.on("error", () => {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error("Local server start nahi ho paya."));
          return;
        }
        setTimeout(tryConnect, 300);
      });
    };

    tryConnect();
  });
}

function startLocalServer() {
  if (server) return server;

  process.env.SBD_DATA_DIR = resolveDataDir();
  const serverEntry = getServerEntry();
  // Requiring the local server keeps the packaged desktop app self-contained.
  server = require(serverEntry);
  return server;
}

async function createWindow() {
  startLocalServer();

  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: "#0f172a",
    icon: getWindowIcon(),
    title: "LEDGERGO",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  try {
    await waitForServer("http://localhost:3000");
    await win.loadURL("http://localhost:3000");
  } catch (error) {
    dialog.showErrorBox("LEDGERGO", error.message || "Desktop app load nahi ho payi.");
    app.quit();
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (server && typeof server.close === "function") {
    try {
      server.close();
    } catch (error) {
      // Ignore shutdown errors during app exit.
    }
  }
});


