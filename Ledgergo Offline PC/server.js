const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const url = require("url");

const PORT = 3001;
const PUBLIC_DIR = path.join(__dirname, "public");

// Core JSON files used by the offline data store.
const requiredFiles = [
  "settings.json", "customers.json", "products.json", "banks.json",
  "invoices.json", "purchases.json", "expenses.json",
  "estimates.json", "proformas.json", "payment_in.json",
  "sale_orders.json", "challans.json", "sale_returns.json",
  "payment_out.json", "purchase_orders.json", "purchase_returns.json"
];

function ensureWritableDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch (error) {
    return false;
  }
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

function getDirDataScore(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  return requiredFiles.reduce((score, fileName) => {
    const parsed = parseJsonFile(path.join(dirPath, fileName));
    return score + (hasMeaningfulData(parsed) ? 1 : 0);
  }, 0);
}

function hydrateMissingFiles(targetDir, sourceDirs) {
  const existingSources = sourceDirs.filter(dirPath => fs.existsSync(dirPath));
  if (!existingSources.length) return;

  requiredFiles.forEach((fileName) => {
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

function resolveDefaultDataDir() {
  const appDataRoot = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const sharedDir = path.join(appDataRoot, "LEDGERGO", "data");

  if (!ensureWritableDir(sharedDir)) {
    const localDir = path.join(__dirname, "data");
    ensureWritableDir(localDir);
    return localDir;
  }

  const legacyDirs = [
    path.join(__dirname, "data"),
    path.join(appDataRoot, "ledgergo", "data")
  ].filter(dirPath => path.resolve(dirPath).toLowerCase() !== path.resolve(sharedDir).toLowerCase());

  const prioritizedSources = legacyDirs
    .filter(dirPath => fs.existsSync(dirPath))
    .sort((a, b) => getDirDataScore(b) - getDirDataScore(a));

  hydrateMissingFiles(sharedDir, prioritizedSources);

  return sharedDir;
}

function resolveDataDir() {
  const envDataDir = String(process.env.SBD_DATA_DIR || "").trim();
  if (envDataDir) {
    const resolved = path.resolve(envDataDir);
    if (ensureWritableDir(resolved)) return resolved;
  }
  return resolveDefaultDataDir();
}

const DATA_DIR = resolveDataDir();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

// Ensure data files exist
requiredFiles.forEach(f => {
  const p = path.join(DATA_DIR, f);
  if (!fs.existsSync(p)) fs.writeFileSync(p, f === "settings.json" ? "{}" : "[]");
});

function readJson(fileName, defaultValue = []) {
  const fullPath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(fullPath)) return defaultValue;
  try {
    const raw = fs.readFileSync(fullPath, "utf8");
    return raw ? JSON.parse(raw) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

function writeJson(fileName, data) {
  const fullPath = path.join(DATA_DIR, fileName);
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), "utf8");
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}

function sendPdf(res, fileName, buffer) {
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${fileName}"`,
    "Content-Length": buffer.length,
    "Access-Control-Allow-Origin": "*"
  });
  res.end(buffer);
}

function sanitizePdfText(value) {
  return String(value || "")
    .replace(/[^\x20-\x7E\r\n]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function formatPdfMoney(value, currency = "Rs") {
  const amount = Number(value || 0);
  return `${currency} ${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function wrapPdfLine(label, value = "", maxWidth = 88) {
  const raw = `${label}${value === undefined || value === null || value === "" ? "" : value}`;
  const cleaned = String(raw).replace(/\s+/g, " ").trim();
  if (!cleaned) return [""];

  const words = cleaned.split(" ");
  const lines = [];
  let current = "";
  words.forEach(word => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });
  if (current) lines.push(current);
  return lines;
}

function buildInvoicePdfBuffer(invoice, settings = {}) {
  const currency = settings.currency || "Rs";
  const invoiceNumber = invoice.invoice_number || `INV-${invoice.id}`;
  const invoiceDate = invoice.invoice_date || (invoice.createdAt || "").slice(0, 10);
  const dueDate = invoice.due_date || invoiceDate;
  const businessName = settings.business_name || "LEDGERGO";
  const businessAddress = settings.business_address || "";
  const businessMobile = settings.business_mobile || "";
  const businessEmail = settings.business_email || "";
  const businessGstin = settings.business_gstin || "";
  const customerName = invoice.customer_name || "Customer";
  const customerMobile = invoice.customer_mobile || "";
  const customerAddress = invoice.customer_address || "";
  const customerGstin = invoice.customer_gstin || "";
  const lines = [];

  lines.push("TAX INVOICE");
  lines.push("");
  lines.push(...wrapPdfLine("", businessName));
  if (businessAddress) lines.push(...wrapPdfLine("Address: ", businessAddress));
  if (businessMobile) lines.push(...wrapPdfLine("Mobile: ", businessMobile));
  if (businessEmail) lines.push(...wrapPdfLine("Email: ", businessEmail));
  if (businessGstin) lines.push(...wrapPdfLine("GSTIN: ", businessGstin));
  lines.push("");
  lines.push(...wrapPdfLine("Invoice No: ", invoiceNumber));
  lines.push(...wrapPdfLine("Invoice Date: ", invoiceDate));
  lines.push(...wrapPdfLine("Due Date: ", dueDate));
  lines.push(...wrapPdfLine("Payment Mode: ", invoice.payment_mode || "CASH"));
  lines.push("");
  lines.push(...wrapPdfLine("Bill To: ", customerName));
  if (customerMobile) lines.push(...wrapPdfLine("Customer Mobile: ", customerMobile));
  if (customerAddress) lines.push(...wrapPdfLine("Customer Address: ", customerAddress));
  if (customerGstin) lines.push(...wrapPdfLine("Customer GSTIN: ", customerGstin));
  lines.push("");
  lines.push("Items");
  lines.push("----------------------------------------------------------------------");

  (Array.isArray(invoice.items) ? invoice.items : []).forEach((item, index) => {
    const itemName = item.product_name || item.name || `Item ${index + 1}`;
    const qty = Number(item.quantity || 0);
    const rate = Number(item.price || 0);
    const taxPct = Number(item.tax_pct || item.tax || 0);
    const amount = Number(item.line_total || qty * rate || 0);
    const itemCode = item.sku || item.item_code || item.product_id || "";

    lines.push(...wrapPdfLine(`${index + 1}. `, itemName));
    if (itemCode) lines.push(...wrapPdfLine("   Code: ", itemCode));
    lines.push(...wrapPdfLine("   Qty/Rate: ", `${qty} x ${formatPdfMoney(rate, currency)}`));
    lines.push(...wrapPdfLine("   Tax/Amount: ", `${taxPct}% | ${formatPdfMoney(amount, currency)}`));
    lines.push("");
  });

  lines.push("----------------------------------------------------------------------");
  lines.push(...wrapPdfLine("Subtotal: ", formatPdfMoney(invoice.subtotal || 0, currency)));
  lines.push(...wrapPdfLine("Tax: ", formatPdfMoney(invoice.tax_total || 0, currency)));
  lines.push(...wrapPdfLine("Discount: ", formatPdfMoney(invoice.discount || 0, currency)));
  lines.push(...wrapPdfLine("Total Amount: ", formatPdfMoney(invoice.total_amount || 0, currency)));
  lines.push(...wrapPdfLine("Paid Amount: ", formatPdfMoney(invoice.paid_amount || 0, currency)));
  lines.push(...wrapPdfLine("Balance Due: ", formatPdfMoney(invoice.due_amount || 0, currency)));
  if (invoice.notes) {
    lines.push("");
    lines.push("Notes");
    lines.push(...wrapPdfLine("", invoice.notes));
  }

  const linesPerPage = 46;
  const pageGroups = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pageGroups.push(lines.slice(i, i + linesPerPage));
  }

  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = [];
  let nextObjectId = 3;

  const fontObjectId = 3 + pageGroups.length * 2;
  pageGroups.forEach((group) => {
    const pageObjectId = nextObjectId++;
    const contentObjectId = nextObjectId++;
    kids.push(`${pageObjectId} 0 R`);

    const contentLines = [
      "BT",
      "/F1 11 Tf",
      "40 800 Td",
      "14 TL"
    ];

    group.forEach((line, index) => {
      const safeLine = sanitizePdfText(line);
      if (index === 0) contentLines.push(`(${safeLine}) Tj`);
      else contentLines.push(`T* (${safeLine}) Tj`);
    });
    contentLines.push("ET");

    const stream = contentLines.join("\n");
    objects[contentObjectId] = `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`;
    objects[pageObjectId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
  });

  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  objects[fontObjectId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 1; i < objects.length; i++) {
    if (!objects[i]) continue;
    offsets[i] = Buffer.byteLength(pdf, "utf8");
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < objects.length; i++) {
    const offset = String(offsets[i] || 0).padStart(10, "0");
    pdf += `${offset} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(content);
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => body += chunk.toString());
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function nextId(items) {
  return items.length ? Math.max(...items.map(i => Number(i.id || 0))) + 1 : 1;
}

function sanitizeAmount(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function clampAmount(value, min = 0, max = Number.POSITIVE_INFINITY) {
  const num = sanitizeAmount(value);
  return Math.min(Math.max(num, min), max);
}

function isBankLikeMode(mode) {
  const normalized = String(mode || "").toUpperCase();
  return normalized === "BANK" || normalized === "UPI";
}

function paymentStatus(total, paid) {
  const safeTotal = Math.max(sanitizeAmount(total), 0);
  const safePaid = clampAmount(paid, 0, safeTotal);
  if (safeTotal <= 0) return "DRAFT";
  if (safePaid <= 0) return "DUE";
  if (safePaid < safeTotal) return "PARTIAL";
  return "PAID";
}

function sameId(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a).trim() === String(b).trim();
}

function normalizeProductPayload(body, existing = {}) {
  return {
    ...existing,
    type: body.type || existing.type || "product",
    item_code: body.item_code || existing.item_code || "",
    name: body.name || existing.name || "",
    hsn_code: body.hsn_code || existing.hsn_code || "",
    sku: body.sku || existing.sku || "",
    barcode: body.barcode || existing.barcode || "",
    category: body.category || existing.category || "",
    stock: Number(body.stock ?? existing.stock ?? 0),
    price: Number(body.price ?? existing.price ?? 0),
    purchase_price: Number(body.purchase_price ?? existing.purchase_price ?? 0),
    wholesale_price: Number(body.wholesale_price ?? existing.wholesale_price ?? 0),
    tax: Number(body.tax ?? existing.tax ?? 0),
    tax_type: body.tax_type || existing.tax_type || "without_tax",
    purchase_tax_type: body.purchase_tax_type || body.tax_type || existing.purchase_tax_type || "without_tax",
    unit: body.unit || existing.unit || "Pcs",
    low_stock_alert: Number(body.low_stock_alert ?? existing.low_stock_alert ?? 2),
    expiry_months: Number(body.expiry_months ?? existing.expiry_months ?? 0),
    godown: body.godown || existing.godown || "",
    serialisation: body.serialisation !== undefined ? Boolean(body.serialisation) : Boolean(existing.serialisation),
    show_online: body.show_online !== undefined ? Boolean(body.show_online) : Boolean(existing.show_online),
    notes: body.notes !== undefined ? String(body.notes || "") : (existing.notes || ""),
    tags: body.tags !== undefined ? String(body.tags || "") : (existing.tags || ""),
    default_sale_party_id: body.default_sale_party_id !== undefined ? String(body.default_sale_party_id || "") : String(existing.default_sale_party_id || ""),
    default_sale_price: Number(body.default_sale_price ?? existing.default_sale_price ?? 0),
    default_purchase_party_id: body.default_purchase_party_id !== undefined ? String(body.default_purchase_party_id || "") : String(existing.default_purchase_party_id || ""),
    default_purchase_price: Number(body.default_purchase_price ?? existing.default_purchase_price ?? 0),
    batches: Array.isArray(body.batches) ? body.batches : (existing.batches || [])
  };
}

function normalizeCustomerPayload(body, existing = {}) {
  let balanceInput = body.balance;
  let balance;
  if (balanceInput === undefined || balanceInput === "") {
    balance = Number(existing.balance ?? 0);
  } else {
    balance = Number(balanceInput);
    const balanceType = String(body.balance_type || "").toLowerCase();
    if (balanceType === "to_pay" || balanceType === "payable" || balanceType === "dena") {
      balance = -Math.abs(balance);
    } else if (balanceType === "to_receive" || balanceType === "receivable" || balanceType === "lena") {
      balance = Math.abs(balance);
    }
  }

  return {
    ...existing,
    name: body.name || existing.name || "",
    type: body.type || existing.type || "customer",
    mobile: body.mobile || existing.mobile || "",
    email: body.email || existing.email || "",
    address: body.address || existing.address || "",
    gstin: body.gstin || existing.gstin || "",
    pan: body.pan || existing.pan || "",
    city: body.city || existing.city || "",
    pincode: body.pincode || existing.pincode || "",
    place_of_supply: body.place_of_supply || existing.place_of_supply || "",
    credit_limit: body.credit_limit !== undefined && body.credit_limit !== "" ? Number(body.credit_limit) : (existing.credit_limit ?? null),
    balance
  };
}

function deriveImportedCustomerName(body) {
  const explicitName = String(
    body.name ||
    body.party_name ||
    body.customer_name ||
    body.party ||
    body.client ||
    body.vendor ||
    body.supplier ||
    body.party_details ||
    ""
  ).trim();
  if (explicitName) return explicitName;

  const primaryContact = String(
    body.mobile ||
    body.phone ||
    body.contact ||
    body.mobile_number ||
    body.phone_number ||
    body.phone_no ||
    body.mobile_no ||
    body.contact_no ||
    body.tel ||
    body.cell ||
    ""
  ).trim();
  if (primaryContact) return `Party ${primaryContact}`;

  const fallbackIdentity = String(body.email || body.gstin || body.gst || "").trim();
  return fallbackIdentity ? `Party ${fallbackIdentity}` : "";
}

function handleApi(req, res, pathname) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    return res.end();
  }

  // ===================== SETTINGS =====================
  if (pathname === "/api/settings" && req.method === "GET") {
    return sendJson(res, 200, readJson("settings.json", {
      business_name: "My Business",
      business_address: "",
      business_mobile: "",
      business_email: "",
      business_gstin: "",
      currency: "₹",
      invoice_prefix: "INV-",
      tax_enabled: true
    }));
  }

  if (pathname === "/api/settings/save" && req.method === "POST") {
    return parseBody(req).then(body => {
      writeJson("settings.json", body);
      sendJson(res, 200, { message: "Settings saved successfully" });
    }).catch(err => sendJson(res, 400, { message: "Invalid request", error: err.message }));
  }

  // ===================== DASHBOARD =====================
  if (pathname === "/api/dashboard" && req.method === "GET") {
    const customers = readJson("customers.json");
    const products = readJson("products.json");
    const banks = readJson("banks.json");
    const invoices = readJson("invoices.json");
    const purchases = readJson("purchases.json");
    const expenses = readJson("expenses.json");

    const today = new Date().toISOString().slice(0, 10);
    const thisMonth = new Date().toISOString().slice(0, 7);

    const todaySales = invoices
      .filter(inv => (inv.createdAt || "").slice(0, 10) === today)
      .reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

    const monthSales = invoices
      .filter(inv => (inv.createdAt || "").slice(0, 7) === thisMonth)
      .reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

    const totalReceivable = customers.reduce((sum, c) => sum + Number(c.balance || 0), 0);
    const lowStock = products.filter(p => Number(p.stock) < (Number(p.low_stock_alert) || 2)).length;

    const monthExpenses = expenses
      .filter(e => (e.createdAt || "").slice(0, 7) === thisMonth)
      .reduce((sum, e) => sum + Number(e.amount || 0), 0);

    const recentInvoices = invoices.slice(0, 5);
    const recentTransactions = [...invoices.map(i => ({
      type: "sale",
      name: i.customer_name,
      amount: i.total_amount,
      date: i.createdAt,
      status: i.status
    })), ...expenses.map(e => ({
      type: "expense",
      name: e.category,
      amount: e.amount,
      date: e.createdAt,
      status: "PAID"
    }))].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);

    // Monthly sales chart data (last 6 months)
    const monthlyData = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthKey = d.toISOString().slice(0, 7);
      const monthName = d.toLocaleString("default", { month: "short" });
      const total = invoices
        .filter(inv => (inv.createdAt || "").slice(0, 7) === monthKey)
        .reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);
      monthlyData.push({ month: monthName, total });
    }

    return sendJson(res, 200, {
      todaySales,
      monthSales,
      totalReceivable,
      customerCount: customers.length,
      productCount: products.length,
      bankCount: banks.length,
      lowStock,
      invoiceCount: invoices.length,
      monthExpenses,
      recentInvoices,
      recentTransactions,
      monthlyData
    });
  }

  // ===================== CUSTOMERS =====================
  if (pathname === "/api/customers" && req.method === "GET") {
    return sendJson(res, 200, readJson("customers.json"));
  }

  if (pathname === "/api/customers/create" && req.method === "POST") {
    return parseBody(req).then(body => {
      const customers = readJson("customers.json");
      const customer = {
        id: nextId(customers),
        name: body.name || "",
        type: body.type || "customer",
        mobile: body.mobile || "",
        email: body.email || "",
        address: body.address || "",
        gstin: body.gstin || "",
        pan: body.pan || "",
        city: body.city || "",
        pincode: body.pincode || "",
        place_of_supply: body.place_of_supply || "",
        credit_limit: body.credit_limit ? Number(body.credit_limit) : null,
        balance: Number(body.balance || 0),
        createdAt: new Date().toISOString()
      };
      customers.unshift(customer);
      writeJson("customers.json", customers);
      sendJson(res, 200, customer);
    }).catch(err => sendJson(res, 400, { message: "Invalid request", error: err.message }));
  }

  if (pathname === "/api/customers/update" && req.method === "POST") {
    return parseBody(req).then(body => {
      const customers = readJson("customers.json");
      const idx = customers.findIndex(c => Number(c.id) === Number(body.id));
      if (idx === -1) return sendJson(res, 404, { message: "Customer not found" });
      customers[idx] = normalizeCustomerPayload(body, customers[idx]);
      writeJson("customers.json", customers);
      sendJson(res, 200, customers[idx]);
    }).catch(err => sendJson(res, 400, { message: "Invalid request", error: err.message }));
  }

  if (pathname === "/api/customers/delete" && req.method === "POST") {
    return parseBody(req).then(body => {
      let customers = readJson("customers.json");
      customers = customers.filter(c => Number(c.id) !== Number(body.id));
      writeJson("customers.json", customers);
      sendJson(res, 200, { message: "Customer deleted" });
    }).catch(err => sendJson(res, 400, { message: "Invalid request", error: err.message }));
  }

  if (pathname === "/api/customers/import" && req.method === "POST") {
    return parseBody(req).then(body => {
      const customers = readJson("customers.json");
      const items = Array.isArray(body.items) ? body.items : [];
      let created = 0;
      let updated = 0;
      let skipped = 0;

      items.forEach(raw => {
        const payload = normalizeCustomerPayload({
          ...(raw || {}),
          name: raw?.name || deriveImportedCustomerName(raw || {})
        });
        if (!payload.name) {
          skipped += 1;
          return;
        }

        const existingIdx = customers.findIndex(customer => {
          const sameMobile = payload.mobile && customer.mobile && String(customer.mobile).trim() === String(payload.mobile).trim();
          const sameName = String(customer.name || "").trim().toLowerCase() === String(payload.name || "").trim().toLowerCase();
          return sameMobile || sameName;
        });

        if (existingIdx >= 0) {
          customers[existingIdx] = {
            ...customers[existingIdx],
            ...payload,
            id: customers[existingIdx].id,
            createdAt: customers[existingIdx].createdAt
          };
          updated += 1;
        } else {
          customers.unshift({
            id: nextId(customers),
            ...payload,
            createdAt: new Date().toISOString()
          });
          created += 1;
        }
      });

      writeJson("customers.json", customers);
      sendJson(res, 200, { message: "Party import complete", created, updated, skipped, total: items.length });
    }).catch(err => sendJson(res, 400, { message: "Invalid request", error: err.message }));
  }

  // ===================== PRODUCTS =====================
  if (pathname === "/api/products" && req.method === "GET") {
    return sendJson(res, 200, readJson("products.json"));
  }

  if (pathname === "/api/products/create" && req.method === "POST") {
    return parseBody(req).then(body => {
      const products = readJson("products.json");
      const product = {
        id: nextId(products),
        ...normalizeProductPayload(body),
        createdAt: new Date().toISOString()
      };
      products.unshift(product);
      writeJson("products.json", products);
      sendJson(res, 200, product);
    }).catch(err => sendJson(res, 400, { message: "Invalid request", error: err.message }));
  }

  if (pathname === "/api/products/update" && req.method === "POST") {
    return parseBody(req).then(body => {
      const products = readJson("products.json");
      const idx = products.findIndex(p => Number(p.id) === Number(body.id));
      if (idx === -1) return sendJson(res, 404, { message: "Product not found" });
      products[idx] = {
        ...products[idx],
        ...normalizeProductPayload(body, products[idx]),
        id: products[idx].id,
        createdAt: products[idx].createdAt
      };
      writeJson("products.json", products);
      sendJson(res, 200, products[idx]);
    }).catch(err => sendJson(res, 400, { message: "Invalid request", error: err.message }));
  }

  if (pathname === "/api/products/delete" && req.method === "POST") {
    return parseBody(req).then(body => {
      let products = readJson("products.json");
      products = products.filter(p => Number(p.id) !== Number(body.id));
      writeJson("products.json", products);
      sendJson(res, 200, { message: "Product deleted" });
    }).catch(err => sendJson(res, 400, { message: "Invalid request", error: err.message }));
  }

  if (pathname === "/api/products/import" && req.method === "POST") {
    return parseBody(req).then(body => {
      const products = readJson("products.json");
      const items = Array.isArray(body.items) ? body.items : [];
      let created = 0;
      let updated = 0;
      let skipped = 0;

      items.forEach(raw => {
        const payload = normalizeProductPayload(raw || {});
        if (!payload.name) {
          skipped += 1;
          return;
        }

        const existingIdx = products.findIndex(product => {
          const sameCode = payload.item_code && product.item_code && String(product.item_code).trim().toLowerCase() === String(payload.item_code).trim().toLowerCase();
          const sameBarcode = payload.barcode && product.barcode && String(product.barcode).trim().toLowerCase() === String(payload.barcode).trim().toLowerCase();
          const sameName = String(product.name || "").trim().toLowerCase() === String(payload.name || "").trim().toLowerCase();
          return sameCode || sameBarcode || sameName;
        });

        if (existingIdx >= 0) {
          products[existingIdx] = {
            ...products[existingIdx],
            ...normalizeProductPayload(payload, products[existingIdx]),
            id: products[existingIdx].id,
            createdAt: products[existingIdx].createdAt
          };
          updated += 1;
        } else {
          products.unshift({
            id: nextId(products),
            ...payload,
            createdAt: new Date().toISOString()
          });
          created += 1;
        }
      });

      writeJson("products.json", products);
      sendJson(res, 200, { message: "Inventory import complete", created, updated, skipped, total: items.length });
    }).catch(err => sendJson(res, 400, { message: "Invalid request", error: err.message }));
  }

  // ===================== BANKS =====================
  if (pathname === "/api/bank" && req.method === "GET") {
    return sendJson(res, 200, readJson("banks.json"));
  }

  if (pathname === "/api/bank/create" && req.method === "POST") {
    return parseBody(req).then(body => {
      const banks = readJson("banks.json");
      const bank = {
        id: nextId(banks),
        bank_name: body.bank_name || "",
        account_number: body.account_number || "",
        ifsc_code: body.ifsc_code || "",
        account_holder: body.account_holder || "",
        current_balance: Number(body.current_balance || 0),
        createdAt: new Date().toISOString()
      };
      banks.unshift(bank);
      writeJson("banks.json", banks);
      sendJson(res, 200, bank);
    }).catch(err => sendJson(res, 400, { message: "Invalid request", error: err.message }));
  }

  if (pathname === "/api/bank/delete" && req.method === "POST") {
    return parseBody(req).then(body => {
      let banks = readJson("banks.json");
      banks = banks.filter(b => Number(b.id) !== Number(body.id));
      writeJson("banks.json", banks);
      sendJson(res, 200, { message: "Bank deleted" });
    }).catch(err => sendJson(res, 400, { message: "Invalid request", error: err.message }));
  }

  // ===================== INVOICES / SALES =====================
  if (pathname === "/api/invoices" && req.method === "GET") {
    return sendJson(res, 200, readJson("invoices.json"));
  }

  if (pathname.startsWith("/api/invoices/pdf/") && req.method === "GET") {
    const invoiceId = Number(pathname.split("/").pop() || 0);
    const invoices = readJson("invoices.json");
    const settings = readJson("settings.json", {});
    const invoice = invoices.find(inv => Number(inv.id) === invoiceId);
    if (!invoice) return sendJson(res, 404, { message: "Invoice nahi mila" });

    const fileName = `${String(invoice.invoice_number || `INV-${invoice.id}`).replace(/[^a-zA-Z0-9_-]+/g, "_")}.pdf`;
    const pdfBuffer = buildInvoicePdfBuffer(invoice, settings);
    return sendPdf(res, fileName, pdfBuffer);
  }

  if (pathname === "/api/invoices/create" && req.method === "POST") {
    return parseBody(req).then(body => {
      const customers = readJson("customers.json");
      const products = readJson("products.json");
      const banks = readJson("banks.json");
      const invoices = readJson("invoices.json");
      const settings = readJson("settings.json", { invoice_prefix: "INV-" });

      const customerId = Number(body.customer_id || 0);
      const paymentMode = String(body.payment_mode || "CASH").toUpperCase();
      const bankId = Number(body.bank_id || 0);
      const rawPaidAmount = sanitizeAmount(body.paid_amount);
      const discount = Math.max(sanitizeAmount(body.discount), 0);
      const notes = body.notes || "";
      const invoiceDate = body.invoice_date || new Date().toISOString().slice(0, 10);
      const dueDate = body.due_date || invoiceDate;
      const items = Array.isArray(body.items) ? body.items : [];

      if (!items.length) return sendJson(res, 400, { message: "Kam se kam ek product chahiye" });
      if (isBankLikeMode(paymentMode) && !bankId) return sendJson(res, 400, { message: "Bank/UPI payment ke liye bank account select karein" });
      const isCashSale = Boolean(body.cash_sale) || !customerId;
      const customer = isCashSale ? { id: null, name: "Cash Sale", mobile: "", address: "", gstin: "", balance: 0 } : customers.find(c => Number(c.id) === customerId);
      if (!customer) return sendJson(res, 404, { message: "Customer nahi mila" });

      let subtotal = 0;
      let totalTax = 0;
      const invoiceItems = [];

      for (const row of items) {
        const productId = Number(row.product_id || 0);
        const quantity = sanitizeAmount(row.quantity || row.qty || 0);
        const product = products.find(p => Number(p.id) === productId);

        if (!product) return sendJson(res, 404, { message: `Product nahi mila: ${productId}` });
        if (quantity <= 0) return sendJson(res, 400, { message: "Quantity 0 se zyada honi chahiye" });
        if (Number(product.stock) < quantity) return sendJson(res, 400, { message: `${product.name} ka stock kam hai (Available: ${product.stock})` });

        const unitPrice = sanitizeAmount(row.price || product.price);
        const taxPct = sanitizeAmount(product.tax || 0);
        const lineTotal = unitPrice * quantity;
        const taxAmount = (lineTotal * taxPct) / 100;

        subtotal += lineTotal;
        totalTax += taxAmount;

        invoiceItems.push({
          product_id: product.id,
          product_name: product.name,
          sku: product.sku || "",
          unit: product.unit || "Pcs",
          quantity,
          price: unitPrice,
          tax_pct: taxPct,
          tax_amount: taxAmount,
          line_total: lineTotal
        });
      }

      for (const item of invoiceItems) {
        const product = products.find(p => Number(p.id) === Number(item.product_id));
        product.stock = Number(product.stock) - Number(item.quantity);

        if (product.batches && product.batches.length > 0) {
          let qtyToDeduct = Number(item.quantity);
          product.batches.sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));
          for (let i = 0; i < product.batches.length && qtyToDeduct > 0; i++) {
            const b = product.batches[i];
            if (b.remaining > 0) {
              if (b.remaining <= qtyToDeduct) {
                qtyToDeduct -= b.remaining;
                b.remaining = 0;
              } else {
                b.remaining -= qtyToDeduct;
                qtyToDeduct = 0;
              }
            }
          }
          product.batches = product.batches.filter(b => b.remaining > 0);
        }
      }

      const total = Math.max(subtotal + totalTax - discount, 0);
      const paidAmount = clampAmount(rawPaidAmount, 0, total);
      const dueAmount = Math.max(total - paidAmount, 0);

      if (!isCashSale && dueAmount > 0) customer.balance = Number(customer.balance || 0) + dueAmount;

      if (isBankLikeMode(paymentMode) && bankId && paidAmount > 0) {
        const bank = banks.find(b => Number(b.id) === bankId);
        if (!bank) return sendJson(res, 404, { message: "Selected bank account nahi mila" });
        bank.current_balance = Number(bank.current_balance || 0) + paidAmount;
      }

      const invoiceId = nextId(invoices);
      const invoiceNumber = `${settings.invoice_prefix || "INV-"}${String(invoiceId).padStart(4, "0")}`;

      const invoice = {
        id: invoiceId,
        invoice_number: invoiceNumber,
        customer_id: customer.id,
        customer_name: customer.name,
        customer_mobile: customer.mobile || "",
        customer_address: customer.address || "",
        customer_gstin: customer.gstin || "",
        items: invoiceItems,
        subtotal,
        tax_total: totalTax,
        discount,
        total_amount: total,
        paid_amount: paidAmount,
        due_amount: dueAmount,
        payment_mode: paymentMode,
        bank_id: bankId || null,
        invoice_date: invoiceDate,
        due_date: dueDate,
        reference_no: body.reference_no || "",
        sales_person: body.sales_person || "",
        dispatch_details: body.dispatch_details || "",
        share_whatsapp: Boolean(body.share_whatsapp),
        round_off_note: Boolean(body.round_off_note),
        cash_sale: isCashSale,
        notes,
        status: paymentStatus(total, paidAmount),
        createdAt: new Date(`${invoiceDate}T10:00:00`).toISOString()
      };

      invoices.unshift(invoice);
      if (!isCashSale) writeJson("customers.json", customers);
      writeJson("products.json", products);
      writeJson("banks.json", banks);
      writeJson("invoices.json", invoices);

      sendJson(res, 200, { message: "Invoice ban gaya!", invoice });
    }).catch(err => sendJson(res, 400, { message: "Invalid request", error: err.message }));
  }
if (pathname === "/api/invoices/update" && req.method === "POST") {
    return parseBody(req).then(body => {
      const customers = readJson("customers.json");
      const products = readJson("products.json");
      const banks = readJson("banks.json");
      const invoices = readJson("invoices.json");

      const id = Number(body.id || 0);
      const invoiceIdx = invoices.findIndex(i => Number(i.id) === id);
      if (invoiceIdx === -1) return sendJson(res, 404, { message: "Invoice nahi mila" });

      const oldInvoice = invoices[invoiceIdx];

      (oldInvoice.items || []).forEach(item => {
        const p = products.find(prod => Number(prod.id) === Number(item.product_id));
        if (p) p.stock = Number(p.stock) + Number(item.quantity);
      });

      if (!oldInvoice.cash_sale && oldInvoice.customer_id) {
        const c = customers.find(cust => Number(cust.id) === Number(oldInvoice.customer_id));
        if (c) c.balance = Number(c.balance || 0) - Number(oldInvoice.due_amount || 0);
      }

      if (isBankLikeMode(oldInvoice.payment_mode) && oldInvoice.bank_id && oldInvoice.paid_amount > 0) {
        const b = banks.find(bk => Number(bk.id) === Number(oldInvoice.bank_id));
        if (b) b.current_balance = Number(b.current_balance || 0) - Number(oldInvoice.paid_amount);
      }

      const customerId = Number(body.customer_id || 0);
      const isCashSale = Boolean(body.cash_sale) || !customerId;
      const customer = isCashSale
        ? { id: null, name: "Cash Sale", mobile: "", address: "", gstin: "", balance: 0 }
        : customers.find(c => Number(c.id) === customerId);
      if (!customer) return sendJson(res, 404, { message: "Customer nahi mila" });

      const rows = Array.isArray(body.items) ? body.items : [];
      if (!rows.length) return sendJson(res, 400, { message: "Kam se kam ek product chahiye" });

      let subtotal = 0;
      let totalTax = 0;
      const newItems = [];

      for (const row of rows) {
        const p = products.find(prod => Number(prod.id) === Number(row.product_id));
        if (!p) return sendJson(res, 404, { message: `Product nahi mila: ${row.product_id}` });

        const qty = sanitizeAmount(row.quantity || row.qty || 0);
        if (qty <= 0) return sendJson(res, 400, { message: "Quantity 0 se zyada honi chahiye" });
        if (Number(p.stock) < qty) return sendJson(res, 400, { message: `${p.name} ka stock kam hai (Available: ${p.stock})` });

        const price = sanitizeAmount(row.price || p.price);
        const taxPct = sanitizeAmount(p.tax || 0);
        const lineTotal = qty * price;
        const taxAmount = (lineTotal * taxPct) / 100;
        subtotal += lineTotal;
        totalTax += taxAmount;

        newItems.push({
          product_id: p.id,
          product_name: p.name,
          sku: p.sku || "",
          unit: p.unit || "Pcs",
          quantity: qty,
          price,
          tax_pct: taxPct,
          tax_amount: taxAmount,
          line_total: lineTotal
        });

        p.stock = Number(p.stock) - qty;
      }

      const discount = Math.max(sanitizeAmount(body.discount || 0), 0);
      const total = Math.max(subtotal + totalTax - discount, 0);
      const paidAmount = clampAmount(sanitizeAmount(body.paid_amount || 0), 0, total);
      const dueAmount = Math.max(total - paidAmount, 0);
      const paymentMode = String(body.payment_mode || "CASH").toUpperCase();
      const bankId = Number(body.bank_id || 0) || null;

      if (isBankLikeMode(paymentMode) && !bankId) {
        return sendJson(res, 400, { message: "Bank/UPI payment ke liye bank account select karein" });
      }

      const updatedInvoice = {
        ...oldInvoice,
        customer_id: isCashSale ? null : customerId,
        customer_name: customer.name,
        customer_mobile: customer.mobile || "",
        customer_address: customer.address || "",
        customer_gstin: customer.gstin || "",
        items: newItems,
        subtotal,
        tax_total: totalTax,
        discount,
        total_amount: total,
        paid_amount: paidAmount,
        due_amount: dueAmount,
        payment_mode: paymentMode,
        bank_id: bankId,
        invoice_date: body.invoice_date || oldInvoice.invoice_date,
        due_date: body.due_date || body.invoice_date || oldInvoice.due_date,
        reference_no: body.reference_no || oldInvoice.reference_no || "",
        sales_person: body.sales_person || oldInvoice.sales_person || "",
        dispatch_details: body.dispatch_details || oldInvoice.dispatch_details || "",
        share_whatsapp: body.share_whatsapp !== undefined ? Boolean(body.share_whatsapp) : Boolean(oldInvoice.share_whatsapp),
        round_off_note: body.round_off_note !== undefined ? Boolean(body.round_off_note) : Boolean(oldInvoice.round_off_note),
        notes: body.notes || "",
        status: paymentStatus(total, paidAmount),
        cash_sale: isCashSale
      };

      if (!isCashSale && dueAmount > 0) {
        const c = customers.find(cust => Number(cust.id) === customerId);
        if (c) c.balance = Number(c.balance || 0) + dueAmount;
      }

      if (isBankLikeMode(updatedInvoice.payment_mode) && updatedInvoice.bank_id && paidAmount > 0) {
        const b = banks.find(bk => Number(bk.id) === Number(updatedInvoice.bank_id));
        if (!b) return sendJson(res, 404, { message: "Selected bank account nahi mila" });
        b.current_balance = Number(b.current_balance || 0) + paidAmount;
      }

      invoices[invoiceIdx] = updatedInvoice;
      writeJson("customers.json", customers);
      writeJson("products.json", products);
      writeJson("banks.json", banks);
      writeJson("invoices.json", invoices);

      sendJson(res, 200, { message: "Invoice updated!", invoice: updatedInvoice });
    }).catch(err => sendJson(res, 400, { message: "Update fail", error: err.message }));
  }

if (pathname === "/api/invoices/delete" && req.method === "POST") {
    return parseBody(req).then(body => {
      const customers = readJson("customers.json");
      const products = readJson("products.json");
      const banks = readJson("banks.json");
      const invoices = readJson("invoices.json");

      const id = Number(body.id || 0);
      const invoice = invoices.find(i => Number(i.id) === id);
      if (!invoice) return sendJson(res, 404, { message: "Invoice nahi mila" });

      (invoice.items || []).forEach(item => {
        const product = products.find(p => Number(p.id) === Number(item.product_id));
        if (product) product.stock = Number(product.stock || 0) + Number(item.quantity || 0);
      });

      if (!invoice.cash_sale && invoice.customer_id && Number(invoice.due_amount || 0) > 0) {
        const customer = customers.find(c => Number(c.id) === Number(invoice.customer_id));
        if (customer) customer.balance = Number(customer.balance || 0) - Number(invoice.due_amount || 0);
      }

      if (isBankLikeMode(invoice.payment_mode) && invoice.bank_id && Number(invoice.paid_amount || 0) > 0) {
        const bank = banks.find(b => Number(b.id) === Number(invoice.bank_id));
        if (bank) bank.current_balance = Number(bank.current_balance || 0) - Number(invoice.paid_amount || 0);
      }

      const remaining = invoices.filter(i => Number(i.id) !== id);
      writeJson("customers.json", customers);
      writeJson("products.json", products);
      writeJson("banks.json", banks);
      writeJson("invoices.json", remaining);
      sendJson(res, 200, { message: "Invoice deleted" });
    }).catch(err => sendJson(res, 400, { message: "Invalid request", error: err.message }));
  }
  // ===================== PURCHASES =====================
  if (pathname === "/api/purchases" && req.method === "GET") {
    return sendJson(res, 200, readJson("purchases.json"));
  }

  if (pathname === "/api/purchases/create" && req.method === "POST") {
    return parseBody(req).then(body => {
      const customers = readJson("customers.json");
      const products = readJson("products.json");
      const banks = readJson("banks.json");
      const purchases = readJson("purchases.json");

      const supplierName = body.supplier_name || "";
      const supplierId = Number(body.supplier_id || 0) || null;
      const paymentMode = String(body.payment_mode || "CASH").toUpperCase();
      const bankId = Number(body.bank_id || 0);
      const rawPaidAmount = sanitizeAmount(body.paid_amount || 0);
      const discount = Math.max(sanitizeAmount(body.discount || 0), 0);
      const purchaseDate = body.date || new Date().toISOString().slice(0, 10);
      const items = Array.isArray(body.items) ? body.items : [];

      if (!supplierName) return sendJson(res, 400, { message: "Supplier name zaroori hai" });
      if (!items.length) return sendJson(res, 400, { message: "Kam se kam ek item chahiye" });
      if (isBankLikeMode(paymentMode) && !bankId) return sendJson(res, 400, { message: "Bank/UPI payment ke liye bank account select karein" });

      const normalizedSupplierName = String(supplierName || "").trim().toLowerCase();
      const supplierParty = customers.find(customer => {
        if (supplierId && Number(customer.id) === Number(supplierId)) return true;
        if (!normalizedSupplierName) return false;
        return String(customer.name || "").trim().toLowerCase() === normalizedSupplierName;
      });
      const resolvedSupplierId = supplierParty ? Number(supplierParty.id) : supplierId;

      let total = 0;
      let totalTax = 0;
      const purchaseItems = [];

      for (const row of items) {
        const productId = Number(row.product_id || 0);
        const quantity = sanitizeAmount(row.quantity || 0);
        const product = products.find(p => Number(p.id) === productId);

        if (!product) return sendJson(res, 404, { message: `Product nahi mila: ${productId}` });
        if (quantity <= 0) return sendJson(res, 400, { message: "Quantity 0 se zyada honi chahiye" });

        const unitPrice = sanitizeAmount(row.purchase_price || product.purchase_price || 0);
        const lineTotal = unitPrice * quantity;
        const taxPct = sanitizeAmount(row.tax_pct || product.tax || 0);
        const taxAmount = (lineTotal * taxPct) / 100;
        total += lineTotal;
        totalTax += taxAmount;

        product.stock = Number(product.stock) + quantity;
        if (unitPrice > 0) product.purchase_price = unitPrice;

        if (Number(product.expiry_months) > 0) {
          if (!product.batches) product.batches = [];
          const expiryDate = new Date();
          expiryDate.setMonth(expiryDate.getMonth() + Number(product.expiry_months));
          product.batches.push({
            id: Date.now() + Math.floor(Math.random() * 1000),
            added: quantity,
            remaining: quantity,
            purchase_date: new Date().toISOString(),
            expiry_date: expiryDate.toISOString()
          });
        }

        purchaseItems.push({
          product_id: product.id,
          product_name: product.name,
          quantity,
          purchase_price: unitPrice,
          tax_pct: taxPct,
          tax_amount: taxAmount,
          line_total: lineTotal
        });
      }

      const grandTotal = Math.max(total + totalTax - discount, 0);
      const paidAmount = clampAmount(rawPaidAmount, 0, grandTotal);
      const dueAmount = Math.max(grandTotal - paidAmount, 0);

      if (isBankLikeMode(paymentMode) && bankId && paidAmount > 0) {
        const bank = banks.find(b => Number(b.id) === bankId);
        if (!bank) return sendJson(res, 404, { message: "Selected bank account nahi mila" });
        bank.current_balance = Number(bank.current_balance || 0) - paidAmount;
      }

      if (supplierParty && dueAmount > 0) {
        supplierParty.balance = Number(supplierParty.balance || 0) - dueAmount;
      }

      const purchase = {
        id: nextId(purchases),
        supplier_id: resolvedSupplierId || null,
        supplier_name: supplierParty?.name || supplierName,
        supplier_mobile: body.supplier_mobile || supplierParty?.mobile || "",
        items: purchaseItems,
        subtotal_amount: total,
        tax_total: totalTax,
        discount,
        total_amount: grandTotal,
        paid_amount: paidAmount,
        due_amount: dueAmount,
        payment_mode: paymentMode,
        bank_id: bankId || null,
        bill_no: body.bill_no || "",
        invoice_date: body.invoice_date || purchaseDate,
        due_date: body.due_date || purchaseDate,
        reference: body.reference || "",
        transport_details: body.transport_details || "",
        notes: body.notes || "",
        print_copy: Boolean(body.print_copy),
        status: paymentStatus(grandTotal, paidAmount),
        createdAt: new Date(`${purchaseDate}T10:00:00`).toISOString()
      };

      purchases.unshift(purchase);
      writeJson("customers.json", customers);
      writeJson("products.json", products);
      writeJson("banks.json", banks);
      writeJson("purchases.json", purchases);

      sendJson(res, 200, { message: "Purchase record ho gaya!", purchase });
    }).catch(err => sendJson(res, 400, { message: "Invalid request", error: err.message }));
  }
if (pathname === "/api/purchases/delete" && req.method === "POST") {
    return parseBody(req).then(body => {
      const customers = readJson("customers.json");
      const products = readJson("products.json");
      const banks = readJson("banks.json");
      const purchases = readJson("purchases.json");

      const id = Number(body.id || 0);
      const purchase = purchases.find(p => Number(p.id) === id);
      if (!purchase) return sendJson(res, 404, { message: "Purchase nahi mila" });

      (purchase.items || []).forEach(item => {
        const product = products.find(p => Number(p.id) === Number(item.product_id));
        if (product) {
          const current = Number(product.stock || 0);
          const deduction = Number(item.quantity || 0);
          product.stock = Math.max(current - deduction, 0);
        }
      });

      if (isBankLikeMode(purchase.payment_mode) && purchase.bank_id && Number(purchase.paid_amount || 0) > 0) {
        const bank = banks.find(b => Number(b.id) === Number(purchase.bank_id));
        if (bank) bank.current_balance = Number(bank.current_balance || 0) + Number(purchase.paid_amount || 0);
      }

      const supplierNameNorm = String(purchase.supplier_name || "").trim().toLowerCase();
      const supplier = customers.find(c => Number(c.id) === Number(purchase.supplier_id))
        || customers.find(c => supplierNameNorm && String(c.name || "").trim().toLowerCase() === supplierNameNorm);
      if (supplier && Number(purchase.due_amount || 0) > 0) {
        supplier.balance = Number(supplier.balance || 0) + Number(purchase.due_amount || 0);
      }

      const remaining = purchases.filter(p => Number(p.id) !== id);
      writeJson("customers.json", customers);
      writeJson("products.json", products);
      writeJson("banks.json", banks);
      writeJson("purchases.json", remaining);
      sendJson(res, 200, { message: "Purchase deleted" });
    }).catch(err => sendJson(res, 400, { message: "Invalid request", error: err.message }));
  }
  // ===================== EXPENSES =====================
  if (pathname === "/api/expenses" && req.method === "GET") {
    return sendJson(res, 200, readJson("expenses.json"));
  }

  if (pathname === "/api/expenses/create" && req.method === "POST") {
    return parseBody(req).then(body => {
      const expenses = readJson("expenses.json");
      const banks = readJson("banks.json");

      const expense = {
        id: nextId(expenses),
        category: body.category || "Other",
        description: body.description || "",
        amount: sanitizeAmount(body.amount || 0),
        payment_mode: String(body.payment_mode || "CASH").toUpperCase(),
        bank_id: Number(body.bank_id || 0) || null,
        createdAt: new Date().toISOString()
      };

      if (isBankLikeMode(expense.payment_mode) && !expense.bank_id) {
        return sendJson(res, 400, { message: "Bank/UPI expense ke liye bank account select karein" });
      }

      if (isBankLikeMode(expense.payment_mode) && expense.bank_id) {
        const bank = banks.find(b => Number(b.id) === expense.bank_id);
        if (!bank) return sendJson(res, 404, { message: "Selected bank account nahi mila" });
        bank.current_balance = Number(bank.current_balance || 0) - expense.amount;
        writeJson("banks.json", banks);
      }

      expenses.unshift(expense);
      writeJson("expenses.json", expenses);
      sendJson(res, 200, { message: "Expense record ho gaya!", expense });
    }).catch(err => sendJson(res, 400, { message: "Invalid request", error: err.message }));
  }
if (pathname === "/api/expenses/delete" && req.method === "POST") {
    return parseBody(req).then(body => {
      const banks = readJson("banks.json");
      const expenses = readJson("expenses.json");

      const id = Number(body.id || 0);
      const expense = expenses.find(e => Number(e.id) === id);
      if (!expense) return sendJson(res, 404, { message: "Expense nahi mila" });

      if (isBankLikeMode(expense.payment_mode) && expense.bank_id && Number(expense.amount || 0) > 0) {
        const bank = banks.find(b => Number(b.id) === Number(expense.bank_id));
        if (bank) bank.current_balance = Number(bank.current_balance || 0) + Number(expense.amount || 0);
      }

      const remaining = expenses.filter(e => Number(e.id) !== id);
      writeJson("banks.json", banks);
      writeJson("expenses.json", remaining);
      sendJson(res, 200, { message: "Expense deleted" });
    }).catch(err => sendJson(res, 400, { message: "Invalid request", error: err.message }));
  }
  // ===================== PAYMENTS (Accounting) =====================
  if (pathname === "/api/payments/create" && req.method === "POST") {
    return parseBody(req).then(body => {
      const type = String(body.type || "").toUpperCase();
      if (type !== "IN" && type !== "OUT") return sendJson(res, 400, { message: "Invalid payment type. IN ya OUT bhejein" });

      const file = type === "IN" ? "payment_in.json" : "payment_out.json";
      const payments = readJson(file);
      const customers = readJson("customers.json");
      const banks = readJson("banks.json");
      const invoices = readJson("invoices.json");
      const purchases = readJson("purchases.json");

      const partyId = Number(body.party_id || body.customer_id || body.supplier_id || 0);
      const amount = sanitizeAmount(body.amount || 0);
      const paymentMode = String(body.payment_mode || "CASH").toUpperCase();
      const bankId = Number(body.bank_id || 0);
      const invoiceId = Number(body.invoice_id || 0);
      const purchaseId = Number(body.purchase_id || 0);
      const paymentDate = String(body.date || "").trim() || new Date().toISOString().slice(0, 10);

      if (!partyId) return sendJson(res, 400, { message: "Party select karna zaroori hai" });
      if (amount <= 0) return sendJson(res, 400, { message: "Amount 0 se zyada honi chahiye" });
      if (isBankLikeMode(paymentMode) && !bankId) return sendJson(res, 400, { message: "Bank/UPI payment ke liye bank account select karein" });

      const party = customers.find(c => Number(c.id) === partyId);
      if (!party) return sendJson(res, 404, { message: "Party nahi mili" });

      let linkedInvoice = null;
      let linkedPurchase = null;

      if (type === "IN") {
        if (purchaseId) return sendJson(res, 400, { message: "Payment-IN ko purchase se link nahi kar sakte" });

        if (invoiceId) {
          linkedInvoice = invoices.find(inv => Number(inv.id) === invoiceId);
          if (!linkedInvoice) return sendJson(res, 404, { message: "Linked invoice nahi mila" });
          if (!linkedInvoice.customer_id) return sendJson(res, 400, { message: "Cash invoice ko payment link nahi kar sakte" });
          if (!sameId(linkedInvoice.customer_id, party.id)) return sendJson(res, 400, { message: "Selected invoice is party ka nahi hai" });

          const invoiceDue = Math.max(sanitizeAmount(linkedInvoice.due_amount), 0);
          if (invoiceDue <= 0) return sendJson(res, 400, { message: "Ye invoice already settled hai" });
          if (amount - invoiceDue > 0.0001) return sendJson(res, 400, { message: `Amount invoice due (${invoiceDue}) se zyada nahi ho sakta` });

          const totalAmount = Math.max(sanitizeAmount(linkedInvoice.total_amount), 0);
          const newPaid = clampAmount(sanitizeAmount(linkedInvoice.paid_amount) + amount, 0, totalAmount);
          const newDue = Math.max(totalAmount - newPaid, 0);
          linkedInvoice.paid_amount = newPaid;
          linkedInvoice.due_amount = newDue;
          linkedInvoice.status = paymentStatus(totalAmount, newPaid);
        }
      } else {
        if (invoiceId) return sendJson(res, 400, { message: "Payment-OUT ko sale invoice se link nahi kar sakte" });

        if (purchaseId) {
          linkedPurchase = purchases.find(pur => Number(pur.id) === purchaseId);
          if (!linkedPurchase) return sendJson(res, 404, { message: "Linked purchase nahi mila" });
          if (linkedPurchase.supplier_id && !sameId(linkedPurchase.supplier_id, party.id)) {
            return sendJson(res, 400, { message: "Selected purchase is party ka nahi hai" });
          }

          const purchaseDue = Math.max(sanitizeAmount(linkedPurchase.due_amount), 0);
          if (purchaseDue <= 0) return sendJson(res, 400, { message: "Ye purchase already settled hai" });
          if (amount - purchaseDue > 0.0001) return sendJson(res, 400, { message: `Amount purchase due (${purchaseDue}) se zyada nahi ho sakta` });

          const totalAmount = Math.max(sanitizeAmount(linkedPurchase.total_amount), 0);
          const newPaid = clampAmount(sanitizeAmount(linkedPurchase.paid_amount) + amount, 0, totalAmount);
          const newDue = Math.max(totalAmount - newPaid, 0);
          linkedPurchase.paid_amount = newPaid;
          linkedPurchase.due_amount = newDue;
          linkedPurchase.status = paymentStatus(totalAmount, newPaid);
        }
      }

      if (type === "IN") party.balance = Number(party.balance || 0) - amount;
      else party.balance = Number(party.balance || 0) + amount;

      if (isBankLikeMode(paymentMode) && bankId) {
        const bank = banks.find(b => Number(b.id) === bankId);
        if (!bank) return sendJson(res, 404, { message: "Selected bank account nahi mila" });
        if (type === "IN") bank.current_balance = Number(bank.current_balance || 0) + amount;
        else bank.current_balance = Number(bank.current_balance || 0) - amount;
      }

      const payment = {
        id: nextId(payments),
        type,
        party_id: party.id,
        party_name: party.name,
        amount,
        payment_mode: paymentMode,
        bank_id: bankId || null,
        invoice_id: linkedInvoice ? linkedInvoice.id : null,
        purchase_id: linkedPurchase ? linkedPurchase.id : null,
        reference: body.reference || "",
        notes: body.notes || "",
        date: paymentDate,
        createdAt: new Date(`${paymentDate}T10:00:00`).toISOString()
      };

      payments.unshift(payment);
      writeJson(file, payments);
      writeJson("customers.json", customers);
      writeJson("banks.json", banks);
      if (linkedInvoice) writeJson("invoices.json", invoices);
      if (linkedPurchase) writeJson("purchases.json", purchases);

      sendJson(res, 200, { message: `Payment-${type} record ho gaya!`, payment });
    }).catch(err => sendJson(res, 400, { message: "Invalid request", error: err.message }));
  }
if (pathname === "/api/payments/delete" && req.method === "POST") {
    return parseBody(req).then(body => {
      const type = String(body.type || "").toUpperCase();
      if (type !== "IN" && type !== "OUT") return sendJson(res, 400, { message: "Invalid payment type. IN ya OUT bhejein" });

      const file = type === "IN" ? "payment_in.json" : "payment_out.json";
      const payments = readJson(file);
      const customers = readJson("customers.json");
      const banks = readJson("banks.json");
      const invoices = readJson("invoices.json");
      const purchases = readJson("purchases.json");

      const paymentId = Number(body.id || 0);
      const payment = payments.find(p => Number(p.id) === paymentId);
      if (!payment) return sendJson(res, 404, { message: "Payment record nahi mila" });

      const amount = sanitizeAmount(payment.amount || 0);
      const party = customers.find(c => Number(c.id) === Number(payment.party_id));
      if (party) {
        if (type === "IN") party.balance = Number(party.balance || 0) + amount;
        else party.balance = Number(party.balance || 0) - amount;
      }

      if (isBankLikeMode(payment.payment_mode) && payment.bank_id) {
        const bank = banks.find(b => Number(b.id) === Number(payment.bank_id));
        if (bank) {
          if (type === "IN") bank.current_balance = Number(bank.current_balance || 0) - amount;
          else bank.current_balance = Number(bank.current_balance || 0) + amount;
        }
      }

      if (payment.invoice_id) {
        const invoice = invoices.find(inv => Number(inv.id) === Number(payment.invoice_id));
        if (invoice) {
          const totalAmount = Math.max(sanitizeAmount(invoice.total_amount), 0);
          const newPaid = clampAmount(sanitizeAmount(invoice.paid_amount) - amount, 0, totalAmount);
          invoice.paid_amount = newPaid;
          invoice.due_amount = Math.max(totalAmount - newPaid, 0);
          invoice.status = paymentStatus(totalAmount, newPaid);
        }
      }

      if (payment.purchase_id) {
        const purchase = purchases.find(pur => Number(pur.id) === Number(payment.purchase_id));
        if (purchase) {
          const totalAmount = Math.max(sanitizeAmount(purchase.total_amount), 0);
          const newPaid = clampAmount(sanitizeAmount(purchase.paid_amount) - amount, 0, totalAmount);
          purchase.paid_amount = newPaid;
          purchase.due_amount = Math.max(totalAmount - newPaid, 0);
          purchase.status = paymentStatus(totalAmount, newPaid);
        }
      }

      const remaining = payments.filter(p => Number(p.id) !== paymentId);
      writeJson(file, remaining);
      writeJson("customers.json", customers);
      writeJson("banks.json", banks);
      writeJson("invoices.json", invoices);
      writeJson("purchases.json", purchases);

      sendJson(res, 200, { message: "Payment deleted" });
    }).catch(err => sendJson(res, 400, { message: "Invalid request", error: err.message }));
  }
if (pathname.startsWith("/api/payments/list/") && req.method === "GET") {
    const type = pathname.split("/").pop(); // 'IN' or 'OUT'
    const file = type === 'IN' ? 'payment_in.json' : 'payment_out.json';
    return sendJson(res, 200, readJson(file));
  }

  // ===================== REPORTS =====================
  if (pathname === "/api/reports/sales" && req.method === "GET") {
    const invoices = readJson("invoices.json");
    return sendJson(res, 200, invoices);
  }

  if (pathname === "/api/reports/daybook" && req.method === "GET") {
    const invoices = readJson("invoices.json");
    const expenses = readJson("expenses.json");
    const purchases = readJson("purchases.json");

    const today = new Date().toISOString().slice(0, 10);
    const entries = [
      ...invoices.filter(i => (i.createdAt || "").slice(0, 10) === today).map(i => ({
        type: "Sale", ref: i.invoice_number || `#${i.id}`, party: i.customer_name, amount: i.total_amount, date: i.createdAt
      })),
      ...expenses.filter(e => (e.createdAt || "").slice(0, 10) === today).map(e => ({
        type: "Expense", ref: `EXP-${e.id}`, party: e.category, amount: -e.amount, date: e.createdAt
      })),
      ...purchases.filter(p => (p.createdAt || "").slice(0, 10) === today).map(p => ({
        type: "Purchase", ref: `PUR-${p.id}`, party: p.supplier_name, amount: -p.total_amount, date: p.createdAt
      }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    return sendJson(res, 200, entries);
  }

  if (pathname === "/api/reports/profit-loss" && req.method === "GET") {
    const invoices = readJson("invoices.json");
    const expenses = readJson("expenses.json");
    const purchases = readJson("purchases.json");

    const totalSales = invoices.reduce((s, i) => s + Number(i.total_amount || 0), 0);
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const totalPurchases = purchases.reduce((s, p) => s + Number(p.total_amount || 0), 0);
    const netProfit = totalSales - totalExpenses - totalPurchases;

    return sendJson(res, 200, { totalSales, totalExpenses, totalPurchases, netProfit });
  }

  sendJson(res, 404, { message: "API route nahi mila" });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname.startsWith("/api/")) {
    return handleApi(req, res, pathname);
  }

  let filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Forbidden");
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (!fs.existsSync(filePath)) {
    filePath = path.join(PUBLIC_DIR, "index.html");
  }

  sendFile(res, filePath);
});

server.listen(PORT, () => {
  console.log("===========================================");
  console.log("  LEDGERGO - Offline PC Version");
  console.log("===========================================");
  console.log(`  Server running at: http://localhost:${PORT}`);
  console.log(`  Data directory: ${DATA_DIR}`);
  console.log("===========================================");
});

module.exports = server;

