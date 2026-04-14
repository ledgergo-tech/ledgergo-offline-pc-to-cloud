/* LEDGERGO - app.js */
console.log("APP.JS LOADED");

// Global Safety Guard: Catch all unhandled errors and show as Toast
window.onerror = function(msg, url, line, col, error) {
  console.error("Critical UI Error:", msg, error);
  if (typeof showToast === 'function') showToast("UI Crash prevented: " + msg, "error");
  return false;
};
window.onunhandledrejection = function(event) {
  console.error("Promise Rejected:", event.reason);
  if (typeof showToast === 'function') showToast("Data sync error: " + event.reason, "error");
};

const state = { 
  customers: [], products: [], banks: [], invoices: [], 
  purchases: [], expenses: [], dashboard: {}, settings: {},
  paymentsIn: [], paymentsOut: [], recentScans: []
};

// Helper for older browser compatibility
function formToJSON(form) {
  const obj = {};
  const fd = new FormData(form);
  fd.forEach((v, k) => obj[k] = v);
  return obj;
}

async function api(path, opts = {}) {
  try {
    const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
    return r.json();
  } catch (e) { showToast("Unable to connect to server", "error"); return {}; }
}

async function loadAll() {
  const endpoints = {
    customers: "/api/customers",
    products: "/api/products",
    banks: "/api/bank",
    invoices: "/api/invoices",
    purchases: "/api/purchases",
    expenses: "/api/expenses",
    dashboard: "/api/dashboard",
    settings: "/api/settings",
    payIn: "/api/payments/list/IN",
    payOut: "/api/payments/list/OUT"
  };

  const results = await Promise.allSettled(
    Object.entries(endpoints).map(async ([key, url]) => {
      const data = await api(url);
      return { key, data };
    })
  );

  results.forEach(res => {
    if (res.status === "fulfilled" && res.value) {
      const { key, data } = res.value;
      if (!data) return;
      if (key === "payIn") state.paymentsIn = Array.isArray(data) ? data : [];
      else if (key === "payOut") state.paymentsOut = Array.isArray(data) ? data : [];
      else if (Array.isArray(data) || (typeof data === 'object' && data !== null)) {
        state[key] = data;
      }
    }
  });

  // Strict sanitation for critical state
  const collections = ['customers', 'products', 'banks', 'invoices', 'purchases', 'expenses', 'paymentsIn', 'paymentsOut'];
  collections.forEach(col => { if (!Array.isArray(state[col])) state[col] = []; });
  if (!state.settings || typeof state.settings !== 'object') state.settings = {};
  if (!state.dashboard || typeof state.dashboard !== 'object') state.dashboard = {};
}

function money(v) {
  try {
    const sets = state && state.settings ? state.settings : {};
    const sym = sets.currency || "₹";
    const val = Number(v || 0);
    if (isNaN(val)) return sym + "0";
    return sym + val.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  } catch (e) {
    return "₹" + (v || 0);
  }
}

function fmtDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function showToast(msg, type = "info") {
  const tc = document.getElementById("toast-container");
  const t = document.createElement("div");
  const icons = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type] || "ℹ️"}</span><span>${msg}</span>`;
  tc.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function confirmDelete(msg, cb) {
  const msgEl = document.getElementById("confirm-message");
  const modalEl = document.getElementById("confirm-modal");
  const btnEl = document.getElementById("confirm-yes-btn");
  
  if (msgEl) msgEl.textContent = msg;
  if (modalEl) modalEl.style.display = "flex";
  if (btnEl) btnEl.onclick = () => { closeConfirmModal(); cb(); };
}
function closeConfirmModal() { document.getElementById("confirm-modal").style.display = "none"; }

function closePrintModal() { document.getElementById("print-modal").style.display = "none"; }
function closeItemModal() { document.getElementById("item-modal").style.display = "none"; }

function toNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function getGstSummary() {
  const businessGstin = String(state.settings?.business_gstin || "").trim();
  return (state.invoices || []).reduce((summary, invoice) => {
    const taxableAmount = Math.max(toNumber(invoice.subtotal) - toNumber(invoice.discount), 0);
    const taxAmount = toNumber(invoice.tax_total);
    const customerGstin = String(invoice.customer_gstin || "").trim();
    const isIntraState = !businessGstin || !customerGstin || businessGstin.slice(0, 2) === customerGstin.slice(0, 2);

    summary.taxable += taxableAmount;
    summary.taxTotal += taxAmount;
    summary.invoiceCount += 1;

    if (taxAmount > 0) summary.taxedInvoices += 1;
    if (toNumber(invoice.due_amount) > 0) summary.pendingReturns += 1;

    if (isIntraState) {
      summary.cgst += taxAmount / 2;
      summary.sgst += taxAmount / 2;
    } else {
      summary.igst += taxAmount;
    }
    return summary;
  }, {
    taxable: 0,
    taxTotal: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    invoiceCount: 0,
    taxedInvoices: 0,
    pendingReturns: 0
  });
}

function getInventoryInsights() {
  return (state.products || []).reduce((summary, product) => {
    const stock = toNumber(product.stock);
    const reorderLevel = toNumber(product.low_stock_limit || product.low_stock_alert || 5);
    const batchCount = Array.isArray(product.batches) ? product.batches.length : 0;

    summary.totalItems += 1;
    summary.totalUnits += stock;
    summary.totalValue += stock * toNumber(product.purchase_price || product.price);
    summary.batchCount += batchCount;

    if (stock <= 0) summary.outOfStock += 1;
  renderAll();
  activatePage(page);
}

function renderAll() {
  const pages = {
    dashboard: renderDashboard, 
    customers: renderParties, 
    products: renderProducts,
    bank: renderBanks, 
    sales: renderSales, 
    invoices: renderInvoices,

    purchase: renderPurchase, 
    expenses: renderExpenses, 
    reports: renderReports,
    daybook: renderDaybook, 
    profit: renderProfitLoss, 
    "e-invoicing": renderEInvoicing,
    settings: renderSettings,
    estimate: renderEstimate, 
    "payment-in": renderPaymentIn,
    "sale-order": renderSaleOrder, 
    challan: renderChallan, 
    "sale-return": renderSaleReturn,
    proforma: renderProforma,
    "inventory-batch": renderInventoryBatch,
    "payment-out": renderPaymentOut, 
    "purchase-order": renderPurchaseOrder, 
    "purchase-return": renderPurchaseReturn,
    users: renderUsers
  };

  // Call all render functions safely
  Object.keys(pages).forEach(pg => {
    try { 
      const func = pages[pg];
      if (typeof func === 'function') func(); 
    } catch (e) { console.error(`Error rendering ${pg}:`, e); }
  });
}

function renderProforma() {
  const el = document.getElementById("page-proforma");
  if (!el) return;

  const gst = getGstSummary();
  const latestInvoices = (state.invoices || []).slice(0, 4);

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Proforma Invoice Desk</div>
        <div class="page-subtitle">Send estimate-style documents before final tax invoice generation</div>
      </div>
      <div class="flex gap-12">
        <button class="btn btn-outline" onclick="navigateTo('estimate')">Open Quotations</button>
        <button class="btn btn-primary" onclick="navigateTo('sales')">Create Final Invoice</button>
      </div>
    </div>

    <div class="module-grid module-grid-3">
      <div class="insight-card accent-emerald">
        <div class="insight-title">Ready For Conversion</div>
        <div class="insight-value">${latestInvoices.length}</div>
        <div class="insight-sub">Recent documents can be reused as tax invoices</div>
      </div>
      <div class="insight-card accent-sky">
        <div class="insight-title">Taxable Pipeline</div>
        <div class="insight-value">${money(gst.taxable)}</div>
        <div class="insight-sub">Potential billed value before GST filing</div>
      </div>
      <div class="insight-card accent-amber">
        <div class="insight-title">GST Impact</div>
        <div class="insight-value">${money(gst.taxTotal)}</div>
        <div class="insight-sub">Expected tax across current sale invoices</div>
      </div>
    </div>

    <div class="grid-2" style="gap:24px; align-items:start;">
      <div class="card">
        <div class="card-title">Proforma Workflow</div>
        <div class="process-list">
          <div class="process-item"><span class="process-step">1</span><div><strong>Create quotation</strong><div class="text-secondary">Use estimate page to finalize items, rates and tax slab.</div></div></div>
          <div class="process-item"><span class="process-step">2</span><div><strong>Share customer-ready document</strong><div class="text-secondary">Keep pricing and GST transparent before goods dispatch.</div></div></div>
          <div class="process-item"><span class="process-step">3</span><div><strong>Convert to final invoice</strong><div class="text-secondary">Raise sale invoice when payment or dispatch is confirmed.</div></div></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Latest Sale Documents</div>
        <div class="stack-list">
          ${latestInvoices.map(inv => `
            <div class="stack-row">
              <div>
                <div class="font-bold">${inv.invoice_number || "#" + inv.id}</div>
                <div class="text-secondary">${inv.customer_name || "Walk-in customer"} • ${fmtDate(inv.createdAt)}</div>
              </div>
              <div style="text-align:right">
                <div class="font-bold">${money(inv.total_amount)}</div>
                <button class="btn btn-ghost btn-xs" onclick="showInvoicePrint(state.invoices.find(i => i.id === ${inv.id}))">Preview</button>
              </div>
            </div>
          `).join("") || `<div class="empty-state-inline">Abhi koi invoice nahi hai. Sales invoice banate hi yahan ready documents dikhenge.</div>`}
        </div>
      </div>
    </div>`;
}

function renderInventoryBatch() {
  const el = document.getElementById("page-inventory-batch");
  if (!el) return;

  const inventory = getInventoryInsights();
  const rows = (state.products || []).map(product => {
    const batches = Array.isArray(product.batches) ? product.batches : [];
    const activeBatches = batches.filter(batch => toNumber(batch.remaining) > 0);
    const nextExpiry = activeBatches
      .map(batch => batch.expiry_date)
      .filter(Boolean)
      .sort()[0];

    return `
      <tr>
        <td class="td-name">
          <div class="font-bold">${product.name}</div>
          <div class="text-secondary">${product.item_code || "No item code"}${product.hsn_code ? " • HSN " + product.hsn_code : ""}</div>
        </td>
        <td>${activeBatches.length}</td>
        <td>${toNumber(product.stock)} ${product.unit || "pcs"}</td>
        <td>${nextExpiry ? fmtDate(nextExpiry) : "Not set"}</td>
        <td>${money(toNumber(product.stock) * toNumber(product.purchase_price || product.price))}</td>
      </tr>`;
  }).join("") || `<tr><td colspan="5" class="table-empty"><div class="table-empty-icon">📦</div><div>No inventory data available.</div></td></tr>`;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Godown & Batch Control</div>
        <div class="page-subtitle">Batch visibility, stock value and expiry focus for inventory operations</div>
      </div>
      <button class="btn btn-primary" onclick="navigateTo('products')">Manage Inventory</button>
    </div>

    <div class="module-grid module-grid-4">
      <div class="insight-card accent-slate"><div class="insight-title">Items</div><div class="insight-value">${inventory.totalItems}</div><div class="insight-sub">Unique SKUs in stock master</div></div>
      <div class="insight-card accent-emerald"><div class="insight-title">Stock Units</div><div class="insight-value">${inventory.totalUnits}</div><div class="insight-sub">Live quantity across products</div></div>
      <div class="insight-card accent-amber"><div class="insight-title">Low Stock</div><div class="insight-value">${inventory.lowStock}</div><div class="insight-sub">Items close to reorder level</div></div>
      <div class="insight-card accent-rose"><div class="insight-title">Out Of Stock</div><div class="insight-value">${inventory.outOfStock}</div><div class="insight-sub">Immediate replenishment required</div></div>
    </div>

    <div class="grid-2" style="gap:24px; align-items:start;">
      <div class="card">
        <div class="card-title">Inventory Control Summary</div>
        <div class="metric-strip">
          <div class="metric-chip">
            <span class="metric-chip-label">Batch Records</span>
            <strong>${inventory.batchCount}</strong>
          </div>
          <div class="metric-chip">
            <span class="metric-chip-label">Stock Value</span>
            <strong>${money(inventory.totalValue)}</strong>
          </div>
        </div>
        <p class="text-secondary" style="margin-top:16px;">Is page se aap fast audit kar sakte hain ki kaunse items reorder ke kareeb hain, kis product ke batch active hain aur kitna inventory value currently locked hai.</p>
      </div>

      <div class="card">
        <div class="card-title">Recommended Actions</div>
        <div class="process-list">
          <div class="process-item"><span class="process-step">A</span><div><strong>Reorder low-stock items</strong><div class="text-secondary">Purchase record page se inward stock add karein.</div></div></div>
          <div class="process-item"><span class="process-step">B</span><div><strong>Check near-expiry batches</strong><div class="text-secondary">Discount offers ya fast-moving sales channel use karein.</div></div></div>
          <div class="process-item"><span class="process-step">C</span><div><strong>Validate HSN & GST</strong><div class="text-secondary">Correct tax slab invoice accuracy ke liye zaroori hai.</div></div></div>
        </div>
      </div>
    </div>

    <div class="table-wrap">
      <div class="table-header">
        <div class="table-title">Product Batch Visibility</div>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Item</th><th>Active Batches</th><th>Available Qty</th><th>Next Expiry</th><th>Stock Value</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderUsers() {
  const el = document.getElementById("page-users");
  if (!el) return;

  const roles = [
    { name: "Owner / Admin", scope: "Full access to billing, GST, accounting and settings", badge: "Primary" },
    { name: "Billing Executive", scope: "Sales invoices, receipts, customer ledgers and PDF print", badge: "Billing" },
    { name: "Store Manager", scope: "Inventory update, batch checks, purchase entry and low-stock review", badge: "Stock" },
    { name: "Accounts Assistant", scope: "Expense, bank reconciliation, payment-in and payment-out", badge: "Accounts" }
  ];

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Access & Team Roles</div>
        <div class="page-subtitle">Organize who handles billing, accounting, inventory and GST tasks</div>
      </div>
      <button class="btn btn-outline" onclick="navigateTo('settings')">Business Settings</button>
    </div>

    <div class="module-grid module-grid-4">
      <div class="insight-card accent-slate"><div class="insight-title">Business Users</div><div class="insight-value">4</div><div class="insight-sub">Suggested roles for small teams</div></div>
      <div class="insight-card accent-emerald"><div class="insight-title">Billing Scope</div><div class="insight-value">${state.invoices.length}</div><div class="insight-sub">Invoices handled in current workspace</div></div>
      <div class="insight-card accent-sky"><div class="insight-title">Accounts Scope</div><div class="insight-value">${state.expenses.length + state.paymentsIn.length + state.paymentsOut.length}</div><div class="insight-sub">Finance entries available for review</div></div>
      <div class="insight-card accent-amber"><div class="insight-title">Inventory Scope</div><div class="insight-value">${state.products.length}</div><div class="insight-sub">Items that store team can maintain</div></div>
    </div>

    <div class="card">
      <div class="card-title">Recommended Permission Matrix</div>
      <div class="role-grid">
        ${roles.map(role => `
          <div class="role-card">
            <div class="role-badge">${role.badge}</div>
            <div class="role-name">${role.name}</div>
            <div class="text-secondary">${role.scope}</div>
          </div>
        `).join("")}
      </div>
    </div>`;
}

function renderEInvoicing() {
  const el = document.getElementById("page-e-invoicing");
  if (!el) return;

  const gst = getGstSummary();
  const taxInvoices = (state.invoices || []).filter(invoice => toNumber(invoice.tax_total) > 0);
  const rows = taxInvoices.slice(0, 8).map(invoice => `
    <tr>
      <td>${invoice.invoice_number || "#" + invoice.id}</td>
      <td>${invoice.customer_name || "Walk-in customer"}</td>
      <td>${invoice.customer_gstin || "Unregistered"}</td>
      <td>${fmtDate(invoice.createdAt)}</td>
      <td>${money(invoice.tax_total)}</td>
      <td><span class="badge ${invoice.customer_gstin ? "badge-success" : "badge-warning"}">${invoice.customer_gstin ? "GST Party" : "B2C"}</span></td>
    </tr>
  `).join("") || `<tr><td colspan="6" class="table-empty"><div class="table-empty-icon">🧾</div><div>GST invoices create hote hi yahan filing-ready summary dikh jayegi.</div></td></tr>`;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">GST & E-Invoicing Desk</div>
        <div class="page-subtitle">Monitor taxable turnover, GST breakup and invoice readiness for compliance</div>
      </div>
      <button class="btn btn-primary" onclick="navigateTo('reports')">Open Reports</button>
    </div>

    <div class="module-grid module-grid-4">
      <div class="insight-card accent-emerald"><div class="insight-title">Taxable Sales</div><div class="insight-value">${money(gst.taxable)}</div><div class="insight-sub">Net taxable amount before GST</div></div>
      <div class="insight-card accent-sky"><div class="insight-title">GST Total</div><div class="insight-value">${money(gst.taxTotal)}</div><div class="insight-sub">${gst.taxedInvoices} invoices carrying GST</div></div>
      <div class="insight-card accent-amber"><div class="insight-title">CGST + SGST</div><div class="insight-value">${money(gst.cgst + gst.sgst)}</div><div class="insight-sub">Intra-state tax liability</div></div>
      <div class="insight-card accent-rose"><div class="insight-title">IGST</div><div class="insight-value">${money(gst.igst)}</div><div class="insight-sub">Inter-state tax liability</div></div>
    </div>

    <div class="grid-2" style="gap:24px; align-items:start;">
      <div class="card">
        <div class="card-title">GST Breakup</div>
        <div class="gst-breakup-grid">
          <div class="gst-breakup-card"><span>CGST</span><strong>${money(gst.cgst)}</strong></div>
          <div class="gst-breakup-card"><span>SGST</span><strong>${money(gst.sgst)}</strong></div>
          <div class="gst-breakup-card"><span>IGST</span><strong>${money(gst.igst)}</strong></div>
          <div class="gst-breakup-card"><span>Pending Follow-up</span><strong>${gst.pendingReturns}</strong></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Compliance Checklist</div>
        <div class="process-list">
          <div class="process-item"><span class="process-step">1</span><div><strong>Validate business GSTIN</strong><div class="text-secondary">Settings page par GSTIN aur invoice prefix updated rakhein.</div></div></div>
          <div class="process-item"><span class="process-step">2</span><div><strong>Check customer GSTIN</strong><div class="text-secondary">Registered parties ke liye correct GSTIN save karein.</div></div></div>
          <div class="process-item"><span class="process-step">3</span><div><strong>Print or save invoice PDF</strong><div class="text-secondary">Every tax invoice ab modal se print-ready/PDF-ready hai.</div></div></div>
        </div>
      </div>
    </div>

    <div class="table-wrap">
      <div class="table-header">
        <div class="table-title">Recent GST Invoices</div>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Invoice</th><th>Party</th><th>GSTIN</th><th>Date</th><th>GST Amount</th><th>Type</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function toggleCreateMenu() {
  const menu = document.getElementById('create-menu');
  if (menu) menu.classList.toggle('show');
}

// Close dropdown if clicking outside
window.onclick = function(event) {
  if (!event.target.closest('#create-dropdown')) {
    const dropdowns = document.getElementsByClassName("dropdown-menu");
    for (let i = 0; i < dropdowns.length; i++) {
      if (dropdowns[i].classList.contains('show')) {
        dropdowns[i].classList.remove('show');
      }
    }
  }
}

/* ========== DASHBOARD ========== */
function renderDashboard() {
  const el = document.getElementById("page-dashboard");
  if (!el) return;

  try {
    // Calculate Financial Highlights safely with strict defaults
    const customers = Array.isArray(state.customers) ? state.customers : [];
    const products = Array.isArray(state.products) ? state.products : [];
    const banks = Array.isArray(state.banks) ? state.banks : [];
    const invoices = Array.isArray(state.invoices) ? state.invoices.filter(i => i) : [];

    const toCollect = customers.reduce((s, c) => s + (c && Number(c.balance || 0) > 0 ? Number(c.balance) : 0), 0);
    const toPay = customers.reduce((s, c) => s + (c && Number(c.balance || 0) < 0 ? Math.abs(Number(c.balance)) : 0), 0);
    const bankBalance = banks.reduce((s, b) => s + (b && Number(b.current_balance || 0) || 0), 0);
    const totalStock = products.reduce((s, p) => s + (p && Number(p.stock || 0) * Number(p.purchase_price || p.price || 0) || 0), 0);
    const totalRevenue = invoices.reduce((s, i) => s + toNumber(i.total_amount), 0);
    const totalCollected = invoices.reduce((s, i) => s + toNumber(i.paid_amount), 0);
    const gst = getGstSummary();
    const inventory = getInventoryInsights();

    // Calculate Expiring Batches defensive
    let expiringBatchesCount = 0;
    try {
      const now = new Date();
      const sixtyDaysFromNow = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
      products.forEach(p => {
        if (p && Array.isArray(p.batches)) {
           p.batches.forEach(b => {
             if (b && Number(b.remaining || 0) > 0) {
               const expDate = new Date(b.expiry_date);
               if (expDate <= sixtyDaysFromNow) expiringBatchesCount++;
             }
           });
        }
      });
    } catch (e) { console.error("Expiring batches calc error", e); }

    el.innerHTML = `
      <div class="snapshot-grid">
        <div class="snapshot-card">
          <div class="snapshot-label">To Collect</div>
          <div class="snapshot-value" style="color: var(--success);">${money(toCollect)}</div>
          <div class="snapshot-sub">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m19 12-7 7-7-7M12 19V5"/></svg>
            Receivable from parties
          </div>
        </div>
        
        <div class="snapshot-card">
          <div class="snapshot-label">To Pay</div>
          <div class="snapshot-value" style="color: var(--danger);">${money(toPay)}</div>
          <div class="snapshot-sub">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m5 12 7-7 7 7M12 5v14"/></svg>
            Payable to suppliers
          </div>
        </div>
        
        <div class="snapshot-card">
          <div class="snapshot-label">Cash & Bank</div>
          <div class="snapshot-value">${money(bankBalance)}</div>
          <div class="snapshot-sub">Available liquid balance</div>
        </div>

        <div class="snapshot-card">
          <div class="snapshot-label">Stock Value</div>
          <div class="snapshot-value" style="color: var(--warning);">${money(totalStock)}</div>
          <div class="snapshot-sub">Calculated at buy price</div>
        </div>

        <div class="snapshot-card" style="cursor: pointer;" onclick="showExpiringSoonModal()">
          <div class="snapshot-label">Expiring Soon</div>
          <div class="snapshot-value" style="color: #8b5cf6;">${expiringBatchesCount}</div>
          <div class="snapshot-sub">
            <svg style="vertical-align:text-bottom; margin-right:2px;" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Batches in next 60 days
          </div>
        </div>
      </div>

      <div class="module-grid module-grid-4" style="margin-bottom: 24px;">
        <div class="insight-card accent-slate">
          <div class="insight-title">Billing</div>
          <div class="insight-value">${money(totalRevenue)}</div>
          <div class="insight-sub">${invoices.length} invoices raised</div>
        </div>
        <div class="insight-card accent-emerald">
          <div class="insight-title">Collection Efficiency</div>
          <div class="insight-value">${totalRevenue ? ((totalCollected / totalRevenue) * 100).toFixed(1) : "0.0"}%</div>
          <div class="insight-sub">${money(totalCollected)} collected</div>
        </div>
        <div class="insight-card accent-sky">
          <div class="insight-title">GST Liability</div>
          <div class="insight-value">${money(gst.taxTotal)}</div>
          <div class="insight-sub">${gst.taxedInvoices} GST invoices</div>
        </div>
        <div class="insight-card accent-amber">
          <div class="insight-title">Inventory Health</div>
          <div class="insight-value">${inventory.lowStock}</div>
          <div class="insight-sub">${inventory.outOfStock} items out of stock</div>
        </div>
      </div>

      <div class="grid-2" style="grid-template-columns: 2fr 1fr; gap: 24px; align-items: start;">
        <div class="flex flex-col gap-24">
          <div class="grid-2" style="gap: 16px;">
            <div class="action-card" style="background: var(--accent);" onclick="navigateTo('sales')">
               <div class="action-card-content">
                 <div class="action-card-title">🚀 Create Sales Invoice</div>
                 <div class="action-card-subtitle">Fastest way to bill your customers</div>
               </div>
               <div class="action-card-bg-icon">🧾</div>
            </div>
            <div class="action-card" style="background: var(--primary);" onclick="showAddProduct()">
               <div class="action-card-content">
                 <div class="action-card-title">📦 New Item Entry</div>
                 <div class="action-card-subtitle">Update your inventory levels</div>
               </div>
               <div class="action-card-bg-icon">📦</div>
            </div>
          </div>

          <div class="table-wrap">
            <div class="table-header">
              <div class="table-title">Recent Transactions</div>
              <button class="btn btn-outline btn-xs" style="color: var(--accent);" onclick="navigateTo('invoices')">VIEW ALL</button>
            </div>
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>DATE</th>
                    <th>REF NO</th>
                    <th>PARTY NAME</th>
                    <th>STATUS</th>
                    <th style="text-align: right;">AMOUNT</th>
                    <th style="text-align: center;">ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  ${invoices.slice(0, 5).map(t => {
                    if (!t) return "";
                    const invoiceStatus = getInvoiceStatusMeta(t);
                    return `
                    <tr>
                      <td>${fmtDate(t.createdAt)}</td>
                      <td class="font-bold">#${t.invoice_number || t.id}</td>
                      <td class="td-name">${t.customer_name || "Cash Sale"}</td>
                      <td><span class="badge ${invoiceStatus.badge}">${invoiceStatus.label}</span></td>
                      <td style="text-align: right;" class="font-bold">${money(t.total_amount)}</td>
                      <td style="text-align:center; white-space:nowrap;">
                        <button class="btn-txn-action" onclick="showInvoicePrint(state.invoices.find(i=>i.id===${t.id}))" title="Print Invoice">🖨️</button>
                        <button class="btn-txn-action btn-txn-edit" onclick="editInvoice(${t.id})" title="Edit Invoice">✏️</button>
                        <button class="btn-txn-action btn-txn-delete" onclick="deleteInvoice(${t.id})" title="Delete Invoice">🗑️</button>
                      </td>
                    </tr>`; }).join("") || '<tr><td colspan="6" class="table-empty">No transactions found.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-24">
           <div class="card" style="padding: 24px;">
              <div class="table-title mb-16" style="font-size: 13px;">Low Stock Alert</div>
              <div class="flex flex-col gap-12">
                 ${products.filter(p => p && Number(p.stock || 0) <= Number(p.low_stock_limit || p.low_stock_alert || 5)).slice(0, 5).map(p => {
                   if (!p) return "";
                   return `
                   <div style="display:flex; justify-content:space-between; align-items:center; padding: 12px; border-radius: var(--radius-md); background: var(--accent-surface); border: 1px solid var(--accent-soft);">
                     <div>
                       <div class="font-bold" style="font-size:12px;">${p.name}</div>
                       <div class="text-secondary" style="font-size:10px;">Stock: ${p.stock || 0} ${p.unit || ''}</div>
                     </div>
                     <div class="badge badge-danger" style="font-size:10px;">REORDER</div>
                   </div>`; }).join("") || '<div class="text-secondary text-center py-20" style="font-size:11px;">All items are well stocked ✅</div>'}
              </div>
           </div>
        </div>
      </div>`;
  } catch (err) {
    console.error("Dashboard render failed:", err);
    el.innerHTML = `<div class="card p-40 text-center"><h2 class="text-danger">Dashboard loading error</h2><p>${err.message}</p><button class="btn btn-accent mt-16" onclick="location.reload()">Retry Refresh</button></div>`;
  }
}

/* ========== PARTIES / CUSTOMERS ========== */
function renderParties() {
  const el = document.getElementById("page-customers");
  if (!el) return;
  const toCollect = state.customers.reduce((s, c) => s + (Number(c.balance) > 0 ? Number(c.balance) : 0), 0);
  const toPay = state.customers.reduce((s, c) => s + (Number(c.balance) < 0 ? Math.abs(Number(c.balance)) : 0), 0);

  const rows = state.customers.length > 0 ? state.customers.map(c => {
    const isReceivable = Number(c.balance || 0) >= 0;
    return `
      <tr>
        <td class="td-name">
          <div style="font-weight: 700; color: var(--text-primary);">${c.name}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${c.mobile || "No Mobile"}</div>
        </td>
        <td><span class="badge ${c.type === 'vendor' ? 'badge-warning' : (c.type === 'both' ? 'badge-info' : 'badge-success')}">${(c.type || 'customer').toUpperCase()}</span></td>
        <td class="text-secondary">${c.gstin || "---"}</td>
        <td style="text-align: right;">
          <div style="font-weight: 800; color: ${isReceivable ? "var(--primary)" : "var(--danger)"};">
            ${money(Math.abs(c.balance || 0))}
          </div>
          <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: ${isReceivable ? "#94a3b8" : "#fca5a5"};">
            ${isReceivable ? "Receivable" : "Payable"}
          </div>
        </td>
        <td>
          <div class="flex gap-8 justify-end">
            <button class="btn btn-ghost btn-xs" style="color: var(--primary);" onclick="showEditParty(${c.id})">✏️ Edit</button>
            <button class="btn btn-ghost btn-xs" style="color: var(--accent);" onclick="viewPartyStatement(${c.id})">📄 Ledger</button>
            <button class="btn btn-ghost btn-xs" style="color: var(--danger);" onclick="deleteParty(${c.id})">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join("") : '<tr><td colspan="5" class="table-empty"><div class="table-empty-icon">👥</div><div>No parties found. Click "+ Add New Party" to get started.</div></td></tr>';

  el.innerHTML = `
    <div class="grid-2 mb-24" style="gap: 20px; max-width: 800px;">
      <div class="card" style="padding: 20px; border-left: 4px solid #10b981; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="color: #10b981; font-size: 12px; font-weight: 700; text-transform: uppercase;">Total Receivable</div>
          <div style="font-size: 24px; font-weight: 800; margin-top: 4px;">${money(toCollect)}</div>
        </div>
        <div style="font-size: 24px; opacity: 0.2;">📈</div>
      </div>
      <div class="card" style="padding: 20px; border-left: 4px solid #ef4444; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="color: #ef4444; font-size: 12px; font-weight: 700; text-transform: uppercase;">Total Payable</div>
          <div style="font-size: 24px; font-weight: 800; margin-top: 4px;">${money(toPay)}</div>
        </div>
        <div style="font-size: 24px; opacity: 0.2;">📉</div>
      </div>
    </div>

    <div class="page-header" style="margin-bottom: 24px;">
      <div>
        <div class="page-title">Parties & Customers</div>
        <div class="page-subtitle">${state.customers.length} total contacts</div>
      </div>
      <button class="btn btn-accent" onclick="showAddParty()">
        + Add New Party
      </button>
    </div>
    
    <div class="table-wrap" style="box-shadow: var(--shadow-sm);">
      <div class="table-header">
        <div class="table-title">Party Management</div>
        <div class="search-bar" style="max-width: 300px;">
          <input type="text" placeholder="Search by name, mobile..." oninput="filterTable(this,'cust-table')" />
        </div>
      </div>
      <div class="table-scroll">
        <table id="cust-table">
          <thead>
            <tr>
              <th>PARTY DETAILS</th>
              <th>TYPE</th>
              <th>GSTIN</th>
              <th style="text-align: right;">BALANCE</th>
              <th style="text-align: right;">ACTIONS</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function showAddParty(existing) {
  const p = existing || null;
  const modal = document.getElementById("print-modal");
  modal.style.display = "flex";
  document.querySelector("#print-modal .modal-title").textContent = p ? "Edit Party" : "Add New Party";

  document.getElementById("print-content").innerHTML = `
    <form id="cust-modal-form">
      <!-- Party Type Selection -->
      <div style="margin-bottom: 24px;">
        <label class="form-group-label" style="margin-bottom: 12px; display: block;">Select Party Type</label>
        <div class="grid-3" style="gap: 12px;">
          <input type="radio" name="type" id="type-customer" value="customer" ${!p || p.type === 'customer' ? 'checked' : ''} style="display:none">
          <label for="type-customer" class="party-type-card ${!p || p.type === 'customer' ? 'active' : ''}" onclick="selectPartyType(this, 'customer')">
            <div class="party-type-card-icon">👤</div>
            <div class="party-type-card-label">Customer</div>
          </label>

          <input type="radio" name="type" id="type-supplier" value="supplier" ${p && p.type === 'supplier' ? 'checked' : ''} style="display:none">
          <label for="type-supplier" class="party-type-card ${p && p.type === 'supplier' ? 'active' : ''}" onclick="selectPartyType(this, 'supplier')">
            <div class="party-type-card-icon">🏭</div>
            <div class="party-type-card-label">Supplier</div>
          </label>

          <input type="radio" name="type" id="type-both" value="both" ${p && p.type === 'both' ? 'checked' : ''} style="display:none">
          <label for="type-both" class="party-type-card ${p && p.type === 'both' ? 'active' : ''}" onclick="selectPartyType(this, 'both')">
            <div class="party-type-card-icon">🔄</div>
            <div class="party-type-card-label">Both</div>
          </label>
        </div>
      </div>

      <div class="form-grid-3">
        <div class="form-group">
          <label class="form-group-label">Party Name <span class="required-star">*</span></label>
          <input name="name" required value="${p ? p.name : ""}" placeholder="Enter party name" />
        </div>
         <div class="form-group">
          <label class="form-group-label">Mobile Number</label>
          <div class="input-group">
            <span class="input-addon">+91</span>
            <input name="mobile" value="${p ? p.mobile : ""}" placeholder="Enter mobile number" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-group-label">GSTIN</label>
          <input name="gstin" value="${p ? p.gstin || "" : ""}" placeholder="22AAAAA0000A1Z5" maxlength="15" />
        </div>
      </div>

      <div class="form-grid-2 mt-16">
        <div class="form-group">
          <label class="form-group-label">Opening Balance (₹)</label>
          <input type="number" name="balance" value="${p ? Math.abs(p.balance || 0) : ""}" placeholder="0.00" step="any" />
        </div>
        <div class="form-group">
          <label class="form-group-label">Balance Type</label>
          <select name="balance_type">
            <option value="to_receive" ${p && (p.balance || 0) >= 0 ? 'selected' : ''}>To Receive (Lena)</option>
            <option value="to_pay" ${p && (p.balance || 0) < 0 ? 'selected' : ''}>To Pay (Dena)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-group-label">Email Address</label>
          <input name="email" type="email" value="${p ? p.email || "" : ""}" placeholder="contact@business.com" />
        </div>
        <div class="form-group">
          <label class="form-group-label">Billing Address</label>
          <input name="address" value="${p ? p.address || "" : ""}" placeholder="Enter full address" />
        </div>
      </div>
    </form>`;
  document.querySelector("#print-modal .modal-footer").innerHTML = `
    <button class="btn btn-primary" onclick="submitAddParty(${p ? 'true' : 'false'})">
      ${p ? '💾 Update Party' : '✅ Save Party'}
    </button>
    <button class="btn btn-outline" onclick="closePrintModal()">Cancel</button>`;
}

function selectPartyType(el, type) {
  const group = el.parentElement;
  if (!group) return;
  
  group.querySelectorAll('.party-type-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  
  // Fix: Target the radio input which may be a sibling or child
  const radio = document.getElementById(el.getAttribute('for')) || el.querySelector('input');
  if (radio) radio.checked = true;
}

function showEditParty(id) {
  const p = (state.customers || []).find(x => x.id === id);
  if (p) showAddParty(p);
}

async function submitAddParty(isEdit) {
  const f = document.getElementById("cust-modal-form");
  if (!f.checkValidity()) { f.reportValidity(); return; }
  const fd = new FormData(f);
  const body = Object.fromEntries(fd);

  // Adjust balance sign based on balance type
  if (body.balance_type === 'to_pay') {
    body.balance = -Math.abs(Number(body.balance || 0));
  } else {
    body.balance = Math.abs(Number(body.balance || 0));
  }
  delete body.balance_type;

  const url = isEdit ? "/api/customers/update" : "/api/customers/create";
  const result = await api(url, { method: "POST", body: JSON.stringify(body) });
  if (result.id || result.message === "success") { 
    showToast(isEdit ? "Party updated successfully! ✅" : "Party saved successfully! ✅", "success"); 
    closePrintModal(); 
    await navigateTo("customers"); 
  }
  else showToast(result.message || "Error saving party", "error");
}

async function deleteParty(id) {
  confirmDelete("Are you sure you want to delete this party?", async () => {
    await api("/api/customers/delete", { method: "POST", body: JSON.stringify({ id }) });
    showToast("Party deleted successfully", "success");
    await navigateTo("customers");
  });
}

function viewPartyStatement(id) {
  const c = state.customers.find(x => x.id === id);
  if (!c) return;
  
  const invs = (state.invoices || []).filter(i => i.customer_id === id).map(i => ({...i, doc_type: 'SALE', amt: Number(i.total_amount), doc_date: i.createdAt || i.date }));
  const pins = (state.paymentsIn || []).filter(p => p.party_id === id).map(p => ({...p, doc_type: 'PAY-IN', amt: Number(p.amount), doc_date: p.createdAt }));
  const pouts = (state.paymentsOut || []).filter(p => p.party_id === id).map(p => ({...p, doc_type: 'PAY-OUT', amt: Number(p.amount), doc_date: p.createdAt }));
  
  // Sort docs chronologically to calculate running balance
  const allDocs = [...invs, ...pins, ...pouts].sort((a,b) => new Date(a.doc_date) - new Date(b.doc_date));

  // Running balance calculation
  let running = 0; 
  const ledgerRows = allDocs.map(t => {
    let debit = 0;
    let credit = 0;
    if (t.doc_type === 'SALE') { debit = t.amt; running += t.amt; }
    if (t.doc_type === 'PAY-IN') { credit = t.amt; running -= t.amt; }
    if (t.doc_type === 'PAY-OUT') { debit = t.amt; running += t.amt; }
    return { ...t, debit, credit, bal: running };
  });

  const modal = document.getElementById("print-modal");
  modal.style.display = "flex";
  document.querySelector("#print-modal .modal-title").textContent = `Statement: ${c.name}`;
  
  const totalSale = invs.reduce((s,i) => s + i.amt, 0);

  document.getElementById("print-content").innerHTML = `
    <div style="display:flex; border:1px solid var(--border); border-radius:12px; overflow:hidden; margin-bottom:24px;">
       <div style="flex:1; padding:16px; border-right:1px solid var(--border);">
         <div style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase;">Business Name</div>
         <div style="font-weight:700; margin-top:4px;">${state.settings.business_name || 'Our Company'}</div>
       </div>
       <div style="flex:1; padding:16px; border-right:1px solid var(--border); background:var(--primary-light);">
         <div style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase;">Total Billed</div>
         <div style="font-weight:800; font-size:18px; margin-top:4px;">${money(totalSale)}</div>
       </div>
       <div style="flex:1; padding:16px; background:var(--accent-soft);">
         <div style="font-size:10px; font-weight:800; color:var(--accent); text-transform:uppercase;">Current Balance</div>
         <div style="font-weight:800; font-size:18px; color:var(--accent); margin-top:4px;">${money(c.balance)}</div>
       </div>
    </div>

    <table class="ledger-table">
      <thead>
        <tr>
          <th>DATE</th>
          <th>REF / TYPE</th>
          <th style="text-align: right;">DEBIT (+)</th>
          <th style="text-align: right;">CREDIT (-)</th>
          <th style="text-align: right;">BALANCE</th>
        </tr>
      </thead>
      <tbody>
        ${ledgerRows.reverse().map(r => `
          <tr>
            <td style="font-size:11px;">${fmtDate(r.doc_date)}</td>
            <td>
              <div class="font-bold" style="font-size:12px;">${r.invoice_number || r.reference || "-"}</div>
              <div class="badge ${r.doc_type==='SALE'?'badge-info':(r.doc_type==='PAY-IN'?'badge-success':'badge-danger')}" style="font-size:9px; margin-top:2px;">${r.doc_type}</div>
            </td>
            <td style="text-align: right;" class="${r.debit > 0 ? 'text-primary font-bold' : 'text-muted'}">${r.debit > 0 ? money(r.debit) : '-'}</td>
            <td style="text-align: right;" class="${r.credit > 0 ? 'text-success font-bold' : 'text-muted'}">${r.credit > 0 ? money(r.credit) : '-'}</td>
            <td style="text-align: right;" class="font-bold">${money(r.bal)}</td>
          </tr>`).join("") || '<tr><td colspan="5" class="table-empty">No transactions found</td></tr>'}
      </tbody>
    </table>`;

  document.querySelector("#print-modal .modal-footer").innerHTML = `
    <button class="btn btn-outline" onclick="closePrintModal()">Close</button>
    <button class="btn btn-accent" onclick="window.print()">Print Statement</button>
  `;
}

/* ========== PAYMENTS & ACCOUNTING ========== */
function showAddPayment(type) {
  const modal = document.getElementById("print-modal");
  modal.style.display = "flex";
  const title = type === 'IN' ? '💰 Record Payment-In (Money Received)' : '💸 Record Payment-Out (Money Paid)';
  const color = type === 'IN' ? 'var(--success)' : 'var(--danger)';
  
  document.querySelector("#print-modal .modal-title").textContent = title;
  document.getElementById("print-content").innerHTML = `
    <form id="payment-form" style="max-width: 500px; margin: 0 auto; padding: 20px;">
      <input type="hidden" name="type" value="${type}">
      
      <div class="mb-20">
        <label class="form-label">Select Party</label>
        <select name="party_id" class="form-input" required>
          <option value="">-- Search Party --</option>
          ${state.customers.map(c => `<option value="${c.id}">${c.name} (Bal: ${money(c.balance)})</option>`).join("")}
        </select>
      </div>

      <div class="grid-2 gap-16 mb-20">
        <div>
          <label class="form-label">Amount</label>
          <div class="input-group">
            <span class="input-icon-left">${state.settings.currency || "₹"}</span>
            <input type="number" name="amount" class="form-input" placeholder="0.00" required step="any">
          </div>
        </div>
        <div>
          <label class="form-label">Date</label>
          <input type="date" name="date" class="form-input" value="${new Date().toISOString().slice(0, 10)}">
        </div>
      </div>

      <div class="mb-20">
        <label class="form-label">Payment Mode</label>
        <div style="display:flex; gap:12px;">
          <label class="flex-1">
             <input type="radio" name="payment_mode" value="CASH" checked style="display:none" onchange="togglePayBank(this)">
             <div class="card p-12 text-center clickable mode-selector active" style="font-size:12px; font-weight:700;">💵 CASH</div>
          </label>
          <label class="flex-1">
             <input type="radio" name="payment_mode" value="BANK" style="display:none" onchange="togglePayBank(this)">
             <div class="card p-12 text-center clickable mode-selector" style="font-size:12px; font-weight:700;">🏦 BANK</div>
          </label>
        </div>
      </div>

      <div id="pay-bank-area" class="mb-20" style="display:none;">
        <label class="form-label">Select Bank Account</label>
        <select name="bank_id" class="form-input">
          ${state.banks.map(b => `<option value="${b.id}">${b.bank_name} (${money(b.current_balance)})</option>`).join("")}
        </select>
      </div>

      <div class="mb-20">
        <label class="form-label">Reference / Notes (Optional)</label>
        <input type="text" name="notes" class="form-input" placeholder="e.g. Received via GPay">
      </div>
    </form>
  `;
  
  document.querySelector("#print-modal .modal-footer").innerHTML = `
    <button class="btn btn-outline" onclick="closePrintModal()">Cancel</button>
    <button class="btn" style="background:${color}; color:white;" onclick="savePayment()">Save Payment</button>
  `;
}

function togglePayBank(el) {
  const selectors = document.querySelectorAll('.mode-selector');
  selectors.forEach(s => s.classList.remove('active'));
  el.nextElementSibling.classList.add('active');
  document.getElementById('pay-bank-area').style.display = el.value === 'BANK' ? 'block' : 'none';
}

async function savePayment() {
  const form = document.getElementById("payment-form");
  const body = formToJSON(form);
  const result = await api("/api/payments/create", { method: "POST", body: JSON.stringify(body) });
  
  if (result.payment) {
    showToast(`Payment ${body.type} saved successfully! ✅`, "success");
    closePrintModal();
    await loadAll();
    await navigateTo("customers");
  } else {
    showToast(result.message || "Error saving payment", "error");
  }
}

function filterTable(input, tableId) {
  const q = input.value.toLowerCase();
  document.querySelectorAll(`#${tableId} tbody tr`).forEach(r => {
    r.style.display = r.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

/* ========== PRODUCTS / INVENTORY ========== */
function renderProducts() {
  const el = document.getElementById("page-products");
  if (!el) return;
  
  const totalItems = state.products.length;
  const lowStockItems = state.products.filter(p => Number(p.stock) < Number(p.low_stock_alert || 5));
  const invValue = state.products.reduce((s, p) => s + (Number(p.stock) * Number(p.purchase_price || 0)), 0);
  const outOfStockItems = state.products.filter(p => Number(p.stock || 0) <= 0);
  const categories = [...new Set(state.products.map(p => p.category).filter(Boolean))].sort();
  const topCategories = categories.slice(0, 5);
  const totalUnits = state.products.reduce((s, p) => s + Number(p.stock || 0), 0);

  const rows = state.products.length > 0 ? state.products.map(p => {
    const isLowStock = Number(p.stock) < Number(p.low_stock_alert || 5);
    const stock = Number(p.stock || 0);
    const stockStatus = stock <= 0 ? "out" : (isLowStock ? "low" : "in");
    return `
      <tr data-category="${(p.category || "general").toLowerCase()}" data-stock-status="${stockStatus}">
        <td class="td-name">
          <div class="font-bold">${p.name}</div>
          <div class="text-xs text-muted">Code: ${p.item_code || "N/A"} | HSN: ${p.hsn_code || "N/A"} | Serial No / IMEI: ${p.sku || "N/A"}</div>
          <div class="text-xs text-muted">${p.category || "General"}${p.barcode ? " | Barcode: " + p.barcode : ""}</div>
        </td>
        <td>
          <div style="font-weight: 700; color: ${stock <= 0 ? "var(--danger)" : (isLowStock ? "var(--warning)" : "var(--accent)")}">
            ${stock} ${p.unit || "Pcs"}
          </div>
          ${stock <= 0 ? '<span class="badge badge-danger">Out of Stock</span>' : (isLowStock ? '<span class="badge badge-warning">Low Stock</span>' : '<span class="badge badge-success">Available</span>')}
        </td>
        <td class="font-bold">${money(p.price)}</td>
        <td class="text-secondary">${money(p.purchase_price || 0)}</td>
        <td>
          <div class="font-semibold">${money(p.wholesale_price || 0)}</div>
          <div class="text-xs text-muted">GST ${Number(p.tax || 0)}%</div>
        </td>
        <td>
          <div class="flex gap-8 justify-end">
            <button class="btn btn-outline btn-sm" onclick="showEditProduct(${p.id})">🖋️ Edit</button>
            <button class="btn btn-outline btn-sm" style="color:var(--danger)" onclick="deleteProduct(${p.id})">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join("") : `<tr><td colspan="6" class="table-empty"><div class="table-empty-icon">📦</div><div>Your inventory is empty. Start by adding your first product.</div></td></tr>`;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Items & Inventory</div>
        <div class="page-subtitle">Finalize your item master with category filters, pricing visibility and stock status</div>
      </div>
      <div class="flex gap-12">
        <button class="btn btn-outline" onclick="navigateTo('inventory-batch')">Batch View</button>
        <button class="btn btn-primary" onclick="showAddProduct()">+ Add New Item</button>
      </div>
    </div>

    <div class="module-grid module-grid-4" style="margin-bottom: 24px;">
      <div class="insight-card accent-slate">
        <div class="insight-title">Catalog Items</div>
        <div class="insight-value">${totalItems}</div>
        <div class="insight-sub">Unique items in your master</div>
      </div>
      <div class="insight-card accent-emerald">
        <div class="insight-title">Stock Units</div>
        <div class="insight-value">${totalUnits}</div>
        <div class="insight-sub">Live quantity across all items</div>
      </div>
      <div class="insight-card accent-amber">
        <div class="insight-title">Low Stock</div>
        <div class="insight-value">${lowStockItems.length}</div>
        <div class="insight-sub">Immediate reorder attention</div>
      </div>
      <div class="insight-card accent-rose">
        <div class="insight-title">Out Of Stock</div>
        <div class="insight-value">${outOfStockItems.length}</div>
        <div class="insight-sub">Unavailable for billing</div>
      </div>
    </div>

    <div class="grid-3 mb-24" style="gap:24px">
      <div class="stat-card">
        <div class="stat-icon" style="background: var(--accent-surface); color: var(--accent);">📦</div>
        <div class="stat-label">Total Unique Items</div>
        <div class="stat-value">${totalItems}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: #fef2f2; color: var(--danger);">⚠️</div>
        <div class="stat-label">Low Stock Alerts</div>
        <div class="stat-value text-danger">${lowStockItems.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: var(--accent-surface); color: var(--success);">💰</div>
        <div class="stat-label">Total Inventory Value</div>
        <div class="stat-value">${money(invValue)}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Item Filters</div>
      <div class="inventory-toolbar">
        <div class="search-bar inventory-search">
          <span class="search-icon">🔍</span>
          <input id="product-search-input" type="text" placeholder="Search by item name, code, HSN, SKU or barcode" oninput="applyProductFilters()" />
        </div>
        <div class="filter-chip-row">
          <button class="filter-chip active" data-filter-group="stock" data-filter-value="all" onclick="setProductFilter('stock', 'all', this)">All Stock</button>
          <button class="filter-chip" data-filter-group="stock" data-filter-value="in" onclick="setProductFilter('stock', 'in', this)">In Stock</button>
          <button class="filter-chip" data-filter-group="stock" data-filter-value="low" onclick="setProductFilter('stock', 'low', this)">Low Stock</button>
          <button class="filter-chip" data-filter-group="stock" data-filter-value="out" onclick="setProductFilter('stock', 'out', this)">Out Of Stock</button>
        </div>
      </div>
      <div class="filter-chip-row" style="margin-top:14px;">
        <button class="filter-chip active" data-filter-group="category" data-filter-value="all" onclick="setProductFilter('category', 'all', this)">All Categories</button>
        ${topCategories.map(category => `<button class="filter-chip" data-filter-group="category" data-filter-value="${category.toLowerCase()}" onclick="setProductFilter('category', '${category.toLowerCase()}', this)">${category}</button>`).join("")}
      </div>
    </div>

    <div class="table-wrap">
      <div class="table-header">
      <div>
        <div class="table-title">Product Catalog</div>
        <div class="text-secondary" style="font-size:12px; margin-top:4px;">Category, barcode, GST and wholesale pricing included</div>
      </div>
        <div class="flex gap-8 items-center" style="flex-wrap:wrap; justify-content:flex-end;">
          <button class="btn btn-outline btn-sm" onclick="showBarcodeQuickAdd()">Barcode Quick Add</button>
          <button class="btn btn-outline btn-sm" onclick="showBulkImportModal()">Bulk Import</button>
          <button class="btn btn-outline btn-sm" onclick="downloadProductsExport('csv')">Export CSV</button>
          <button class="btn btn-outline btn-sm" onclick="downloadProductsExport('json')">Export JSON</button>
          <div id="product-filter-status" class="text-secondary" style="font-size:12px;">Showing ${totalItems} items</div>
        </div>
      </div>
      <div class="table-scroll">
        <table id="prod-table">
          <thead>
            <tr>
              <th>Item Details</th>
              <th>Current Stock</th>
              <th>Sales Price</th>
              <th>Purchase Price</th>
              <th>Wholesale / Tax</th>
              <th style="text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;

  window.productFilters = { stock: "all", category: "all" };
  applyProductFilters();
}

function setProductFilter(group, value, btn) {
  window.productFilters = window.productFilters || { stock: "all", category: "all" };
  window.productFilters[group] = value;
  document.querySelectorAll(`.filter-chip[data-filter-group="${group}"]`).forEach(chip => chip.classList.remove("active"));
  if (btn) btn.classList.add("active");
  applyProductFilters();
}

function applyProductFilters() {
  const table = document.getElementById("prod-table");
  if (!table) return;

  const search = String(document.getElementById("product-search-input")?.value || "").toLowerCase().trim();
  const filters = window.productFilters || { stock: "all", category: "all" };
  let visible = 0;

  table.querySelectorAll("tbody tr").forEach(row => {
    const haystack = row.textContent.toLowerCase();
    const stockOk = filters.stock === "all" || row.dataset.stockStatus === filters.stock;
    const categoryOk = filters.category === "all" || row.dataset.category === filters.category;
    const searchOk = !search || haystack.includes(search);
    const show = stockOk && categoryOk && searchOk;
    row.style.display = show ? "" : "none";
    if (show) visible += 1;
  });

  const status = document.getElementById("product-filter-status");
  if (status) status.textContent = `Showing ${visible} items`;
}

function showBarcodeQuickAdd() {
  const modal = document.getElementById("print-modal");
  if (!modal) return;
  modal.style.display = "flex";

  const title = modal.querySelector(".modal-title");
  if (title) title.textContent = "Barcode Quick Add";

  const content = document.getElementById("print-content");
  if (content) content.innerHTML = `
    <form id="barcode-quick-form" class="form-grid">
      <div class="card" style="margin:0; box-shadow:none; border:1px solid var(--border);">
        <div class="card-title">Scan Or Enter Barcode</div>
        <div class="form-control">
          <label>Barcode / Code *</label>
          <input id="quick-barcode-input" name="barcode" required placeholder="Scan barcode or type item code" oninput="checkBarcodeExisting(this.value)" />
        </div>
        <div id="quick-barcode-status" class="text-secondary" style="font-size:12px; margin-top:8px;">Barcode scan karte hi matching item yahin check hoga.</div>
      </div>
      <div class="form-grid-2" style="margin-top:16px;">
        <div class="form-control"><label>Item Name *</label><input name="name" required placeholder="Item name" /></div>
        <div class="form-control"><label>Category</label><input name="category" placeholder="General / Grocery / Pharma" /></div>
        <div class="form-control"><label>Sale Price *</label><input name="price" type="number" step="any" required placeholder="0.00" /></div>
        <div class="form-control"><label>Purchase Price</label><input name="purchase_price" type="number" step="any" placeholder="0.00" /></div>
        <div class="form-control"><label>Opening Stock</label><input name="stock" type="number" step="any" value="0" /></div>
        <div class="form-control"><label>GST %</label><select name="tax"><option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="28">28%</option></select></div>
      </div>
    </form>
  `;

  const footer = modal.querySelector(".modal-footer");
  if (footer) footer.innerHTML = `
    <button class="btn btn-primary" onclick="submitBarcodeQuickAdd()">Save Item</button>
    <button class="btn btn-outline" onclick="closePrintModal()">Cancel</button>`;

  const barcodeInput = document.getElementById("quick-barcode-input");
  if (barcodeInput) barcodeInput.focus();
}

function checkBarcodeExisting(value) {
  const code = String(value || "").trim().toLowerCase();
  const status = document.getElementById("quick-barcode-status");
  if (!status) return;
  if (!code) {
    status.textContent = "Barcode scan karte hi matching item yahin check hoga.";
    return;
  }

  const existing = (state.products || []).find(product =>
    String(product.barcode || "").toLowerCase() === code ||
    String(product.item_code || "").toLowerCase() === code ||
    String(product.sku || "").toLowerCase() === code
  );

  if (existing) {
    status.innerHTML = `Matching item mil gaya: <strong>${existing.name}</strong>. Save karne ke bajay edit screen open kar sakte ho. <button type="button" class="btn btn-ghost btn-xs" onclick="closePrintModal(); showEditProduct(${existing.id});">Open Item</button>`;
  } else {
    status.textContent = "No matching item found. Naya item create hoga.";
  }
}

async function submitBarcodeQuickAdd() {
  const form = document.getElementById("barcode-quick-form");
  if (!form || !form.checkValidity()) {
    form?.reportValidity();
    return;
  }

  const fd = new FormData(form);
  const body = Object.fromEntries(fd.entries());
  const barcode = String(body.barcode || "").trim();
  const existing = (state.products || []).find(product =>
    String(product.barcode || "").trim().toLowerCase() === barcode.toLowerCase() ||
    String(product.item_code || "").trim().toLowerCase() === barcode.toLowerCase()
  );

  if (existing) {
    showToast("Is barcode ka item pehle se maujood hai. Existing item open kar raha hoon.", "warning");
    closePrintModal();
    showEditProduct(existing.id);
    return;
  }

  body.barcode = barcode;
  body.item_code = barcode;
  body.type = "product";
  body.price = Number(body.price || 0);
  body.purchase_price = Number(body.purchase_price || 0);
  body.stock = Number(body.stock || 0);
  body.tax = Number(body.tax || 0);
  body.low_stock_alert = 5;
  body.unit = "Pieces(PCS)";
  body.tax_type = "with_tax";
  body.purchase_tax_type = "with_tax";

  const res = await api("/api/products/create", { method: "POST", body: JSON.stringify(body) });
  if (res.id) {
    showToast("Barcode se item add ho gaya.", "success");
    closePrintModal();
    await navigateTo("products");
  } else {
    showToast(res.message || "Quick add failed", "error");
  }
}

function showBulkImportModal() {
  const modal = document.getElementById("print-modal");
  if (!modal) return;
  modal.style.display = "flex";

  const title = modal.querySelector(".modal-title");
  if (title) title.textContent = "Bulk Import Items";

  const content = document.getElementById("print-content");
  if (content) content.innerHTML = `
    <div class="card" style="margin:0; box-shadow:none; border:1px solid var(--border);">
      <div class="card-title">Import CSV Or JSON</div>
      <div class="text-secondary" style="font-size:13px; margin-bottom:12px;">Supported columns: name, item_code, barcode, category, stock, price, purchase_price, wholesale_price, tax, unit, hsn_code, sku</div>
      <div class="form-control">
        <label>Choose File</label>
        <input id="bulk-import-file" type="file" accept=".csv,.json,.txt" onchange="loadBulkImportFile(event)" />
      </div>
      <div class="form-control" style="margin-top:14px;">
        <label>Or Paste CSV / JSON</label>
        <textarea id="bulk-import-text" rows="12" placeholder='Example CSV: name,item_code,barcode,category,stock,price&#10;Rice,ITM-1001,89010001,Grocery,25,55'></textarea>
      </div>
      <div id="bulk-import-preview" class="text-secondary" style="font-size:12px; margin-top:10px;">Paste ya file upload ke baad import chala sakte ho.</div>
    </div>
  `;

  const footer = modal.querySelector(".modal-footer");
  if (footer) footer.innerHTML = `
    <button class="btn btn-primary" onclick="submitBulkImport()">Import Items</button>
    <button class="btn btn-outline" onclick="closePrintModal()">Cancel</button>`;
}

function loadBulkImportFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || "");
    const textarea = document.getElementById("bulk-import-text");
    if (textarea) textarea.value = text;
    const preview = document.getElementById("bulk-import-preview");
    if (preview) preview.textContent = `${file.name} loaded. Ready to import.`;
  };
  reader.readAsText(file);
}

function parseProductImportText(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];

  if (text.startsWith("[") || text.startsWith("{")) {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : (Array.isArray(parsed.items) ? parsed.items : []);
  }

  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(",").map(col => col.trim());
    const item = {};
    headers.forEach((header, index) => item[header] = cols[index] || "");
    return item;
  });
}

async function submitBulkImport() {
  const text = document.getElementById("bulk-import-text")?.value || "";
  let items = [];
  try {
    items = parseProductImportText(text);
  } catch (error) {
    showToast("Import format valid nahi hai. CSV ya JSON check karo.", "error");
    return;
  }

  if (!items.length) {
    showToast("Import ke liye valid rows nahi mili.", "warning");
    return;
  }

  let created = 0;
  let skipped = 0;

  for (const rawItem of items) {
    const name = String(rawItem.name || "").trim();
    if (!name) {
      skipped += 1;
      continue;
    }

    const barcode = String(rawItem.barcode || "").trim();
    const itemCode = String(rawItem.item_code || barcode || `ITM-${Date.now()}-${created + 1}`).trim();
    const exists = (state.products || []).find(product =>
      String(product.item_code || "").trim().toLowerCase() === itemCode.toLowerCase() ||
      (barcode && String(product.barcode || "").trim().toLowerCase() === barcode.toLowerCase())
    );
    if (exists) {
      skipped += 1;
      continue;
    }

    const body = {
      type: rawItem.type || "product",
      name,
      item_code: itemCode,
      barcode,
      category: rawItem.category || "",
      stock: Number(rawItem.stock || 0),
      price: Number(rawItem.price || 0),
      purchase_price: Number(rawItem.purchase_price || 0),
      wholesale_price: Number(rawItem.wholesale_price || 0),
      tax: Number(rawItem.tax || 0),
      unit: rawItem.unit || "Pieces(PCS)",
      hsn_code: rawItem.hsn_code || "",
      sku: rawItem.sku || "",
      low_stock_alert: Number(rawItem.low_stock_alert || 5),
      tax_type: rawItem.tax_type || "with_tax",
      purchase_tax_type: rawItem.purchase_tax_type || "with_tax"
    };

    const res = await api("/api/products/create", { method: "POST", body: JSON.stringify(body) });
    if (res.id) {
      created += 1;
      state.products.unshift(res);
    } else {
      skipped += 1;
    }
  }

  showToast(`${created} items import hue, ${skipped} skip hue.`, created ? "success" : "warning");
  closePrintModal();
  await navigateTo("products");
}

function escapeCsvValue(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadProductsExport(format) {
  const products = state.products || [];
  if (!products.length) {
    showToast("Export ke liye items nahi hain.", "warning");
    return;
  }

  let content = "";
  let mime = "application/json";
  let extension = "json";

  if (format === "csv") {
    const headers = ["name", "item_code", "barcode", "category", "stock", "price", "purchase_price", "wholesale_price", "tax", "unit", "hsn_code", "sku"];
    const lines = [
      headers.join(","),
      ...products.map(product => headers.map(header => escapeCsvValue(product[header])).join(","))
    ];
    content = lines.join("\n");
    mime = "text/csv;charset=utf-8";
    extension = "csv";
  } else {
    content = JSON.stringify(products, null, 2);
  }

  const blob = new Blob([content], { type: mime });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `items-export.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  showToast(`Items ${extension.toUpperCase()} export ready hai.`, "success");
}

function showAddProduct(prod) {
  prod = prod || null;
  const modal = document.getElementById("item-modal");
  modal.style.display = "flex";
  document.getElementById("item-modal-title").textContent = prod ? "🖋️ Edit Item" : "Create New Item";

  // Reset Tabs
  switchItemTab('basic');

  // Multi-select context
  const categories = [...new Set(state.products.map(p => p.category).filter(Boolean))];
  const catOptions = categories.map(c => `<option value="${c}">`).join("");
  const units = ["Pieces(PCS)", "Box", "Kg", "Ltr", "Mtr", "Dozen"];
  const taxRates = [0, 5, 12, 18, 28];

  // Auto-generate Item Code if new item
  let generatedCode = "";
  if (!prod) {
    const lastNum = state.products.length > 0 ? Math.max(...state.products.map(p => {
      const match = (p.item_code || "").match(/ITM-(\d+)/);
      return match ? parseInt(match[1]) : 0;
    })) : 0;
    generatedCode = "ITM-" + String(lastNum + 1001).padStart(6, '0');
  }

  // Tab 1: General Info
  document.getElementById("content-basic").innerHTML = `
    <div class="form-grid-2">
      <div class="form-group form-group-full">
        <label class="form-group-label" style="font-weight:700; color:var(--text-primary); font-size:12px; text-transform:uppercase;">Item Type <span class="required-star">*</span></label>
        <div class="radio-group" style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:8px;">
          <div class="radio-card ${!prod || prod.type === 'product' ? 'active' : ''}" style="padding:14px 16px; border:2px solid ${!prod || prod.type === 'product' ? 'var(--accent)' : 'var(--border)'};" onclick="selectItemType(this, 'product')">
            <span style="font-weight:700; font-size:13px;">Product Item</span>
            <div class="radio-circle"></div>
            <input type="radio" name="type" value="product" ${!prod || prod.type === 'product' ? 'checked' : ''}>
          </div>
          <div class="radio-card ${prod && prod.type === 'service' ? 'active' : ''}" style="padding:14px 16px; border:2px solid ${prod && prod.type === 'service' ? 'var(--accent)' : 'var(--border)'};" onclick="selectItemType(this, 'service')">
            <span style="font-weight:700; font-size:13px;">Service Item</span>
            <div class="radio-circle"></div>
            <input type="radio" name="type" value="service" ${prod && prod.type === 'service' ? 'checked' : ''}>
          </div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-group-label">Item Name <span class="required-star">*</span></label>
        <input name="name" required value="${prod ? prod.name : ""}" placeholder="e.g. Maggie 2-Minute Noodles" />
      </div>
      <div class="form-group">
        <label class="form-group-label">Item Code (Auto-generated)</label>
        <div class="input-group">
           <input name="item_code" value="${prod ? prod.item_code || "" : generatedCode}" placeholder="e.g. ITM-00123" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-group-label">HSN Code</label>
        <input name="hsn_code" value="${prod ? prod.hsn_code || "" : ""}" placeholder="e.g. 1902" />
      </div>
      <div class="form-group">
        <label class="form-group-label">Sl no / IMEI no</label>
        <input name="sku" value="${prod ? prod.sku || "" : ""}" placeholder="Enter Serial or IMEI" />
      </div>
      <div class="form-group">
        <label class="form-group-label">Barcode</label>
        <input name="barcode" value="${prod ? prod.barcode || "" : ""}" placeholder="Scan / type barcode" />
      </div>
      <div class="form-group">
        <label class="form-group-label">Category</label>
        <input name="category" list="cat-list" value="${prod ? prod.category || "" : ""}" placeholder="Select or type category" />
        <datalist id="cat-list">${catOptions}</datalist>
      </div>
      <div class="form-group">
        <label class="form-group-label">Unit of Measure</label>
        <select name="unit">
          ${units.map(u => `<option value="${u}" ${prod && prod.unit === u ? 'selected' : ''}>${u}</option>`).join("")}
        </select>
      </div>
    </div>
    ${prod ? `<input type="hidden" name="id" value="${prod.id}" />` : ""}
  `;

  // Tab 2: Stock Details
  document.getElementById("content-stock").innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-group-label">Opening Stock</label>
        <div class="input-group">
          <input name="stock" type="number" step="any" value="${prod ? prod.stock : ""}" placeholder="0" />
          <span class="input-addon">${prod ? prod.unit || "Unit" : "Unit"}</span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-group-label">Low Stock Alert Level</label>
        <input name="low_stock_alert" type="number" value="${prod ? prod.low_stock_alert || 5 : 5}" />
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-group-label">Godown / Location</label>
        <input name="godown" value="${prod ? prod.godown || "" : ""}" placeholder="Main Warehouse" />
      </div>
      <div class="form-group">
        <label class="form-group-label">Shelf Life (Expiry in Months)</label>
        <div class="input-group">
          <input name="expiry_months" type="number" step="1" min="0" value="${prod ? prod.expiry_months || "" : ""}" placeholder="e.g. 6" />
          <span class="input-addon">Months</span>
        </div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Expiry calculated from purchase date. Leave blank if N/A.</div>
      </div>
    </div>

    <div class="content-section mt-24" style="background: rgba(16, 185, 129, 0.05); border: 1px dashed var(--accent);">
      <div class="toggle-group">
        <div>
          <div style="font-weight: 700; color: var(--primary);">Serialisation Tracking</div>
          <div style="font-size: 11px; color: var(--text-secondary);">Track each unit individually (IMEI/Serial)</div>
        </div>
        <label class="switch">
          <input type="checkbox" name="serialisation" ${prod && prod.serialisation ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
    </div>
  `;

  // Tab 3: Pricing & Tax
  document.getElementById("content-pricing").innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-group-label">Sales Price <span class="required-star">*</span></label>
        <div class="input-group">
          <span class="input-addon">₹</span>
          <input name="price" type="number" step="any" required value="${prod ? prod.price : ""}" placeholder="0.00" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-group-label">Purchase Price</label>
        <div class="input-group">
          <span class="input-addon">₹</span>
          <input name="purchase_price" type="number" step="any" value="${prod ? prod.purchase_price : ""}" placeholder="0.00" />
        </div>
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-group-label">Tax Preference</label>
        <select name="tax_type">
          <option value="with_tax" ${!prod || prod.tax_type !== 'without_tax' ? 'selected' : ''}>With Tax</option>
          <option value="without_tax" ${prod && prod.tax_type === 'without_tax' ? 'selected' : ''}>Without Tax</option>
        </select>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Ye option sale aur purchase pricing dono par apply hoga.</div>
      </div>
      <div class="form-group">
        <label class="form-group-label">GST Tax Rate(%)</label>
        <select name="tax">
          <option value="0">None (0%)</option>
          ${taxRates.filter(r => r > 0).map(r => `<option value="${r}" ${prod && Number(prod.tax) === r ? 'selected' : ''}>GST @${r}%</option>`).join("")}
        </select>
      </div>
    </div>

    <div class="content-section mt-16" style="background: rgba(99, 102, 241, 0.05); border: 1px solid rgba(99, 102, 241, 0.1);">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-weight: 700; color: var(--primary);">Profit Margin Analysis</div>
          <div id="margin-label" style="font-size: 12px; color: var(--text-secondary);">Fill prices to see margin</div>
        </div>
        <div id="margin-value" style="font-size: 20px; font-weight: 900; color: var(--primary);">0%</div>
      </div>
    </div>

  `;

  document.getElementById("content-party").innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-group-label">Default Sale Party</label>
        <select name="default_sale_party_id">
          <option value="">Select party</option>
          ${(state.customers || []).map(c => `<option value="${c.id}" ${prod && String(prod.default_sale_party_id || "") === String(c.id) ? 'selected' : ''}>${c.name}${c.mobile ? ` • ${c.mobile}` : ""}</option>`).join("")}
        </select>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Invoice banate waqt suggested customer ke roop me use hoga.</div>
      </div>
      <div class="form-group">
        <label class="form-group-label">Special Sale Price</label>
        <div class="input-group">
          <span class="input-addon">₹</span>
          <input name="default_sale_price" type="number" step="any" value="${prod ? prod.default_sale_price || "" : ""}" placeholder="0.00" />
        </div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-group-label">Default Purchase Party</label>
        <select name="default_purchase_party_id">
          <option value="">Select party</option>
          ${(state.customers || []).map(c => `<option value="${c.id}" ${prod && String(prod.default_purchase_party_id || "") === String(c.id) ? 'selected' : ''}>${c.name}${c.mobile ? ` • ${c.mobile}` : ""}</option>`).join("")}
        </select>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Purchase entry me preferred supplier reference ke liye rahega.</div>
      </div>
      <div class="form-group">
        <label class="form-group-label">Special Purchase Price</label>
        <div class="input-group">
          <span class="input-addon">₹</span>
          <input name="default_purchase_price" type="number" step="any" value="${prod ? prod.default_purchase_price || "" : ""}" placeholder="0.00" />
        </div>
      </div>
    </div>
  `;
  document.getElementById("content-custom").innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-group-label">Item Description / Notes</label>
        <textarea name="notes" placeholder="Short notes, usage, warranty, packing details...">${prod ? prod.notes || "" : ""}</textarea>
      </div>
      <div class="form-group">
        <label class="form-group-label">Tags / Search Keywords</label>
        <input name="tags" value="${prod ? prod.tags || "" : ""}" placeholder="e.g. fast-moving, grocery, combo" />
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Comma-separated tags future search aur filtering ke liye store honge.</div>
      </div>
    </div>
    <div class="content-section mt-16" style="background: rgba(14, 165, 233, 0.06); border: 1px dashed #7dd3fc;">
      <div class="toggle-group">
        <div>
          <div style="font-weight: 700; color: var(--primary);">Show In Online / Catalog</div>
          <div style="font-size: 11px; color: var(--text-secondary);">Online sharing ya future digital catalog me item ko visible rakho.</div>
        </div>
        <label class="switch">
          <input type="checkbox" name="show_online" ${prod && prod.show_online ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
    </div>
  `;

  // Footer Actions
  document.getElementById("save-item-btn").onclick = () => submitProduct(!!prod, false);
  document.getElementById("save-new-btn").onclick = () => submitProduct(!!prod, true);
  initItemPricingPreview();
}

function selectItemType(el, type) {
  const group = el.parentElement;
  group.querySelectorAll('.radio-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  el.querySelector('input').checked = true;
}

function initItemPricingPreview() {
  const form = document.getElementById("item-modal-form");
  if (!form || !form.price || !form.purchase_price) return;
  const marginValue = document.getElementById("margin-value");
  const marginLabel = document.getElementById("margin-label");
  const calculate = () => {
    const salePrice = Number(form.price.value || 0);
    const purchasePrice = Number(form.purchase_price.value || 0);
    if (!marginValue || !marginLabel) return;
    if (salePrice > 0 && purchasePrice > 0) {
      const margin = ((salePrice - purchasePrice) / salePrice) * 100;
      marginValue.textContent = `${margin.toFixed(1)}%`;
      marginValue.style.color = margin >= 0 ? "var(--success)" : "var(--danger)";
      marginLabel.textContent = "Net profit margin on this item";
      return;
    }
    marginValue.textContent = "0%";
    marginValue.style.color = "var(--primary)";
    marginLabel.textContent = "Fill prices to see margin";
  };
  form.price.addEventListener("input", calculate);
  form.purchase_price.addEventListener("input", calculate);
  calculate();
}

function switchItemTab(tabId) {
  document.querySelectorAll('.tab-item').forEach(t => t.classList.toggle('active', t.id === `tab-${tabId}`));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `content-${tabId}`));
}

function showEditProduct(id) {
  const p = state.products.find(x => x.id === id);
  if (p) showAddProduct(p);
}

async function submitProduct(isEdit, stayOpen) {
  const f = document.getElementById("item-modal-form");
  if (!f.checkValidity()) { 
    // If invalid, switch to basic tab where most required fields are
    switchItemTab('basic');
    f.reportValidity(); 
    return; 
  }

  try {
    const fd = new FormData(f);
    const body = {};
    fd.forEach((v, k) => {
      if (k === 'show_online' || k === 'serialisation') body[k] = true;
      else body[k] = v;
    });

    if (body.item_code) body.item_code = body.item_code.trim().toUpperCase();

    // Handle checkboxes
    if (!fd.has('show_online')) body.show_online = false;
    if (!fd.has('serialisation')) body.serialisation = false;

    // Number Parsing
    body.stock = Number(body.stock || 0);
    body.price = Number(body.price || 0);
    body.purchase_price = Number(body.purchase_price || 0);
    body.wholesale_price = Number(body.wholesale_price || 0);
    body.tax = Number(body.tax || 0);
    body.low_stock_alert = Number(body.low_stock_alert || 5);
    body.expiry_months = Number(body.expiry_months || 0);
    body.default_sale_price = Number(body.default_sale_price || 0);
    body.default_purchase_price = Number(body.default_purchase_price || 0);
    body.purchase_tax_type = body.tax_type || "with_tax";

    const url = isEdit ? "/api/products/update" : "/api/products/create";
    const res = await api(url, { method: "POST", body: JSON.stringify(body) });

    if (res.id || res.message === "success") {
      showToast(isEdit ? "Item updated successfully! ✅" : "New Item added successfully! ✅", "success");
      if (!stayOpen) {
        closeItemModal();
        await navigateTo("products");
      } else {
        f.reset();
        showAddProduct(); // Refresh form with new ID etc
      }
    } else {
      showToast(res.message || "Error saving item", "error");
    }
  } catch (err) {
    showToast("Error: " + err.message, "error");
    console.error("Product Save Error:", err);
  }
}

async function deleteProduct(id) {
  confirmDelete("Are you sure you want to delete this product?", async () => {
    await api("/api/products/delete", { method: "POST", body: JSON.stringify({ id }) });
    showToast("Product deleted successfully", "success");
    await navigateTo("products");
  });
}

/* ========== BANKS ========== */
function renderBanks() {
  const el = document.getElementById("page-bank");
  if (!el) return;
  const bankCards = state.banks.map(b => `
    <div class="stat-card blue">
      <div class="stat-icon">🏦</div>
      <div class="stat-label">${b.bank_name}</div>
      <div class="stat-value">${money(b.current_balance)}</div>
      <div class="text-secondary text-sm mt-8">A/C: ${b.account_number || "-"} | IFSC: ${b.ifsc_code || "-"}</div>
      <div class="mt-12"><button class="btn btn-danger btn-xs" onclick="deleteBank(${b.id})">Remove</button></div>
    </div>`).join("") || `<div class="card text-center text-muted">Koi bank account nahi. Add karo.</div>`;
  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Bank Accounts</div><div class="page-subtitle">${state.banks.length} accounts registered</div></div>
      <button class="btn btn-primary" onclick="showAddBank()">+ Add Bank</button>
    </div>
    <div class="grid-3 mb-24" style="gap:16px">${bankCards}</div>`;
}

function showAddBank() {
  const modal = document.getElementById("print-modal");
  if (!modal) return;
  modal.style.display = "flex";
  
  const title = document.getElementById("print-modal-title");
  if (title) title.textContent = "Add Bank Account";
  
  const content = document.getElementById("print-content");
  if (content) content.innerHTML = `
    <form id="bank-modal-form" class="form-grid">
      <div class="form-control"><label>Bank Name *</label><input name="bank_name" required placeholder="e.g. State Bank of India" /></div>
      <div class="form-control"><label>Account Holder</label><input name="account_holder" placeholder="Account holder name" /></div>
      <div class="form-control"><label>Account Number</label><input name="account_number" /></div>
      <div class="form-control"><label>IFSC Code</label><input name="ifsc_code" /></div>
      <div class="form-control"><label>Opening Balance</label><input name="current_balance" type="number" value="0" /></div>
    </form>`;
    
  const footer = document.getElementById("print-modal-footer");
  if (footer) footer.innerHTML = `
    <button class="btn btn-primary" onclick="submitAddBank()">Save Bank</button>
    <button class="btn btn-outline" onclick="closePrintModal()">Cancel</button>`;
}

async function submitAddBank() {
  const f = document.getElementById("bank-modal-form");
  if (!f.checkValidity()) { f.reportValidity(); return; }
  const result = await api("/api/bank/create", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(f))) });
  if (result.id) { showToast("Bank account added successfully!", "success"); closePrintModal(); await navigateTo("bank"); }
}
async function deleteBank(id) {
  confirmDelete("Are you sure you want to remove this bank account?", async () => {
    await api("/api/bank/delete", { method: "POST", body: JSON.stringify({ id }) });
    showToast("Bank account removed", "success");
    await navigateTo("bank");
  });
}

/* ========== SALES / NEW INVOICE ========== */
function renderSales() {
  const el = document.getElementById("page-sales");
  if (!el) return;
  delete el.dataset.editId; 

  const custOpts = state.customers.map(c => `<option value="${c.id}">${c.name} ${c.mobile ? "(" + c.mobile + ")" : ""}</option>`).join("");
  const bankOpts = state.banks.map(b => `<option value="${b.id}">${b.bank_name}</option>`).join("");
  
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Sales Invoice</div>
        <div class="page-subtitle">Premium billing flow: select party, add items, and manage payments.</div>
      </div>
      <button type="button" class="btn btn-primary btn-sm" onclick="showAddParty()">Add New Party</button>
    </div>

    <div class="billing-container">
      <div class="billing-main">
        <div class="billing-card">
          <div class="billing-card-header">Party & Invoice Details</div>
          <div class="billing-card-body">
            <div class="form-grid-premium">
              <div class="form-group">
                <label class="form-label-premium">BILLING PARTY *</label>
                <div style="display:flex; gap:8px; align-items:center;">
                  <select name="customer_id" id="inv-customer" required style="flex:1;" class="input-premium">
                    <option value="">-- Select Party --</option>
                    ${custOpts}
                  </select>
                  <button type="button" class="btn-plus" onclick="showAddParty()">+</button>
                </div>
                <label class="option-check" style="margin-top:8px;"><input type="checkbox" id="inv-cash-sale" onchange="toggleCashSaleMode()" /> Cash Sale / Walk-in Customer</label>
              </div>
              <div class="form-group">
                <label class="form-label-premium">INVOICE NUMBER</label>
                <input type="text" value="INV-${Date.now().toString().slice(-6)}" class="input-premium" readonly style="background: #f8fafc; cursor:not-allowed; font-weight:700;" />
              </div>
              <div class="form-group">
                <label class="form-label-premium">INVOICE DATE</label>
                <input type="date" id="inv-date" class="input-premium" value="${new Date().toISOString().split('T')[0]}" style="font-weight:700;" />
              </div>
              <div id="inv-party-details" class="party-details-strip-premium" style="grid-column: span 3; border-top: 1px solid #f1f5f9; padding-top:16px; display:none;"></div>
            </div>
          </div>
        </div>

        <div class="billing-card">
          <div class="billing-card-header">Items & Pricing</div>
          <div class="billing-card-body" style="padding:0;">
            <div class="item-entry-table">
              <div class="item-entry-header">
                <div>ITEM NAME / PRODUCT</div>
                <div>HSN</div>
                <div>Sl no / IMEI no</div>
                <div>QTY</div>
                <div>Sale Price</div>
                <div>TOTAL</div>
                <div></div>
              </div>
              <div id="invoice-items-body"></div>
              <div class="item-entry-footer" style="padding:12px 24px; border-top:1px solid #f1f5f9; background:#fafafa;">
                <span class="item-entry-hint">Tip: Purchase page ki tarah item select karte hi next blank row auto-add ho jayegi.</span>
              </div>
            </div>
          </div>
        </div>

        <div class="billing-card">
          <div class="billing-card-header">Payment & Extra Info</div>
          <div class="billing-card-body">
            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 40px;">
              <div class="form-group">
                <label class="form-group-label" style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:8px; display:block;">Notes / Terms</label>
                <textarea id="inv-notes" placeholder="Thanks for your business!" style="height: 100px; width:100%; border:1px solid var(--border); border-radius:8px; padding:12px;"></textarea>
              </div>
              <div class="form-group">
                <label class="form-group-label" style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:8px; display:block;">Payment Mode</label>
                <select id="inv-payment-mode" class="input-premium" style="width:100%;">
                  <option value="CASH">💵 Cash</option>
                  <option value="BANK">🏦 Bank Transfer</option>
                  <option value="UPI">📱 UPI Payment</option>
                  <option value="CREDIT">⏳ Credit (Udhaar)</option>
                </select>
                <div id="inv-bank-wrap" style="display:none; margin-top: 12px;">
                  <label style="font-size:11px; font-weight:700;">Select Bank Account</label>
                  <select id="inv-bank-id" class="input-premium" style="width:100%; margin-top:4px;">
                    <option value="">-- Select Bank --</option>
                    ${bankOpts}
                  </select>
                </div>
                <div style="margin-top:12px;">
                  <label style="font-size:11px; font-weight:700;">Dispatch / Vehicle</label>
                  <input type="text" id="inv-dispatch" class="input-premium" style="width:100%; margin-top:4px;" placeholder="Transport, vehicle no." />
                </div>
              </div>
            </div>
            <div class="option-grid" style="margin-top:24px; display:grid; grid-template-columns:1fr 1fr; gap:20px;">
              <div class="option-card" style="background:#f8fafc; padding:16px; border-radius:12px; border:1px solid #e2e8f0;">
                <div class="option-card-title" style="font-weight:800; font-size:11px; text-transform:uppercase; margin-bottom:12px; color:var(--primary);">Sale Controls</div>
                <label class="option-check" style="display:block; margin-bottom:8px;"><input type="checkbox" id="inv-send-whatsapp" /> Mark for WhatsApp sharing</label>
                <label class="option-check"><input type="checkbox" id="inv-round-off" /> Apply round-off in print note</label>
              </div>
              <div class="option-card" style="background:#f0f9ff; padding:16px; border-radius:12px; border:1px solid #e0f2fe;">
                <div class="option-card-title" style="font-weight:800; font-size:11px; text-transform:uppercase; margin-bottom:12px; color:#0369a1;">Billing Guidance</div>
                <div class="option-note" style="font-size:12px; color:#075985;">Party select karte hi details yahin dikhengi. Payment mode ke hisaab se bank choose karein.</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="billing-sidebar">
        <div class="summary-card">
          <div class="summary-header">
            <span>Invoice Summary</span>
            <span id="summary-status-badge" class="badge badge-warning">DRAFT</span>
          </div>
          <div class="summary-body">
            <div class="summary-row">
              <span class="text-secondary">Subtotal Amount</span>
              <span id="sum-subtotal" class="font-bold">₹0.00</span>
            </div>
            <div class="summary-row" style="align-items:center;">
              <span class="text-secondary">Discount (Fixed)</span>
              <div style="position:relative; width:100px;">
                <span style="position:absolute; left:10px; top:50%; transform:translateY(-50%); font-weight:600; color:var(--text-muted);">₹</span>
                <input type="number" id="inv-discount" value="0" style="width:100%; text-align:right; padding:6px 10px 6px 22px; border:1px solid var(--border); border-radius:6px; background:var(--bg-main);" oninput="recalcInvoiceTotal()" />
              </div>
            </div>
            <div class="summary-row">
              <span class="text-secondary">GST Total</span>
              <span id="sum-tax" class="font-bold">₹0.00</span>
            </div>
            <div class="summary-row">
              <span class="text-secondary">Ledger Balance</span>
              <span id="sum-ledger-balance" class="font-bold">₹0.00</span>
            </div>
            <div class="summary-row">
              <span class="text-secondary">After Ledger</span>
              <span id="sum-after-ledger" class="font-bold">₹0.00</span>
            </div>
            <div id="sum-round-row" class="summary-row" style="display:none;">
              <span class="text-secondary">Round Off</span>
              <span id="sum-round" class="font-bold">₹0.00</span>
            </div>
            <div id="sum-change-row" class="summary-row" style="display:none; background: #dbeafe; border-radius: 8px; padding: 12px; margin-top: 8px; border: 1px dashed #3b82f6;">
               <span class="summary-total-label" style="color: #1e40af; font-weight:700;">Change / Return</span>
               <span id="sum-change" class="summary-total-val" style="font-size: 20px; color: #1e40af; font-weight:800;">₹0.00</span>
            </div>
            <div class="summary-row" style="margin-top:20px; align-items:center;">
              <span class="font-semibold" style="font-size:14px;">Received Amount</span>
              <div style="position:relative; width:130px;">
                <span style="position:absolute; left:12px; top:50%; transform:translateY(-50%); font-weight:600; color:var(--primary);">₹</span>
                <input type="number" id="inv-paid" value="0" style="width:100%; text-align:right; padding:8px 12px 8px 24px; border:1.5px solid var(--border); border-radius:8px; background:#f8fafc; font-family:inherit; font-weight:700; font-size:16px; color:var(--primary);" oninput="recalcInvoiceTotal()" />
              </div>
            </div>
            <div style="margin-top:24px;">
              <button class="btn btn-accent btn-block" style="padding:16px; font-size:15px; font-weight:800;" onclick="submitInvoice()">Save Sales Invoice</button>
              <button class="btn btn-outline btn-block mt-12" onclick="navigateTo('dashboard')">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  addInvoiceRow();
  el.insertAdjacentHTML("beforeend", `
    <datalist id="sales-prod-datalist">
      ${state.products.map(p => `<option value="${p.name}">Cost: ${money(p.purchase_price || 0)} | Sale: ${money(p.price || 0)} | Stock: ${Number(p.stock || 0)} ${p.unit || ""}</option>`).join("")}
    </datalist>
  `);
  document.getElementById("inv-customer")?.addEventListener("change", updateInvoicePartyDetails);
  document.getElementById("inv-payment-mode")?.addEventListener("change", handleInvoicePaymentMode);
  updateInvoicePartyDetails();
  handleInvoicePaymentMode();
  setInvoiceItemEntryState();
  recalcInvoiceTotal();
}

function toggleCashSaleMode() {
  const isCashSale = document.getElementById("inv-cash-sale")?.checked;
  const customer = document.getElementById("inv-customer");
  if (!customer) return;
  customer.disabled = !!isCashSale;
  if (isCashSale) customer.value = "";
  updateInvoicePartyDetails();
  setInvoiceItemEntryState();
}

function updateInvoicePartyDetails() {
  const customerId = Number(document.getElementById("inv-customer")?.value || 0);
  const party = (state.customers || []).find(c => Number(c.id) === customerId);
  const strip = document.getElementById("inv-party-details");
  const isCashSale = document.getElementById("inv-cash-sale")?.checked;
  if (!strip) return;

  if (isCashSale) {
    strip.style.display = "";
    strip.innerHTML = `
      <div class="party-detail-chip"><span>Mobile</span><strong>Walk-in Customer</strong></div>
      <div class="party-detail-chip"><span>GSTIN</span><strong>Unregistered</strong></div>
      <div class="party-detail-chip"><span>Supply</span><strong>Counter Sale</strong></div>
      <div class="party-detail-chip balance-chip"><span>Ledger Balance</span>${ledgerBalanceMarkup(0)}</div>
    `;
    const summaryLedger = document.getElementById("sum-ledger-balance");
    if (summaryLedger) summaryLedger.textContent = money(0);
    setInvoiceItemEntryState();
    recalcInvoiceTotal();
    return;
  }

  if (!party) {
    strip.style.display = "none";
    strip.innerHTML = "";
    const summaryLedger = document.getElementById("sum-ledger-balance");
    if (summaryLedger) {
      summaryLedger.textContent = money(0);
      summaryLedger.style.color = "";
    }
    const afterLedger = document.getElementById("sum-after-ledger");
    if (afterLedger) {
      afterLedger.textContent = money(0);
      afterLedger.style.color = "";
    }
    setInvoiceItemEntryState();
    recalcInvoiceTotal();
    return;
  }

  strip.style.display = "";
  strip.innerHTML = `
    <div class="party-detail-chip"><span>Mobile</span><strong>${party?.mobile || "Not available"}</strong></div>
    <div class="party-detail-chip"><span>GSTIN</span><strong>${party?.gstin || "Unregistered"}</strong></div>
    <div class="party-detail-chip"><span>Supply</span><strong>${party?.city || party?.address || "Not set"}</strong></div>
    <div class="party-detail-chip balance-chip"><span>Ledger Balance</span>${ledgerBalanceMarkup(party?.balance || 0)}</div>
  `;
  const summaryLedger = document.getElementById("sum-ledger-balance");
  if (summaryLedger) summaryLedger.textContent = money(party?.balance || 0);
  setInvoiceItemEntryState();
  recalcInvoiceTotal();
}

function handleInvoicePaymentMode() {
  const mode = document.getElementById("inv-payment-mode")?.value || "CASH";
  const bankWrap = document.getElementById("inv-bank-wrap");
  if (bankWrap) bankWrap.style.display = (mode === "BANK" || mode === "UPI") ? "block" : "none";
}

function setInvoiceItemEntryState() {
  const isCashSale = document.getElementById("inv-cash-sale")?.checked;
  const customerId = Number(document.getElementById("inv-customer")?.value || 0);
  const enabled = !!isCashSale || !!customerId;
  const table = document.querySelector("#page-sales .item-entry-table");
  const hint = document.querySelector("#page-sales .item-entry-hint");

  if (table) {
    table.style.opacity = enabled ? "1" : "0.65";
  }
  if (hint && !enabled) {
    hint.textContent = "Pehle Billing Party select karo, tab item entry active hogi.";
  } else if (hint) {
    hint.textContent = "Tip: Purchase page ki tarah item select karte hi next blank row auto-add ho jayegi.";
  }

  document.querySelectorAll("#invoice-items-body .sales-row").forEach(row => {
    row.querySelectorAll("input:not(.hsn-inp):not(.sku-inp)").forEach(input => {
      input.disabled = !enabled;
    });
    const removeBtn = row.querySelector(".btn-remove-square");
    if (removeBtn) removeBtn.disabled = !enabled;
  });
}

function addInvoiceRow() {
  const body = document.getElementById("invoice-items-body");
  if (!body) return;
  const row = document.createElement("div");
  row.className = "sales-row item-row";
  row.style.display = "grid";
  row.style.gridTemplateColumns = "1.4fr 100px 140px 70px 100px 90px 44px";
  row.style.gap = "10px";
  row.style.alignItems = "start";
  row.style.padding = "10px 14px 14px";
  row.innerHTML = `
    <div class="sales-cell sales-product-cell" data-label="Item Name / Product"><input type="text" class="prod-inp input-premium" style="width:100%;" placeholder="Search item..." list="sales-prod-datalist" onchange="handleItemSelection(this)" required /></div>
    <div class="sales-cell" data-label="HSN"><input type="text" class="hsn-inp input-premium" style="width:100%;" placeholder="HSN" readonly /></div>
    <div class="sales-cell" data-label="Sl no / IMEI no"><input type="text" class="sku-inp input-premium" style="width:100%;" placeholder="Sl no / IMEI" readonly /></div>
    <div class="sales-cell" data-label="Qty"><input type="number" class="qty-inp input-premium" value="1" min="1" step="any" style="width:100%; text-align:center;" oninput="recalcInvoiceTotal()" /></div>
    <div class="sales-cell" data-label="Sale Price"><input type="number" class="price-inp input-premium" placeholder="0.00" step="any" style="width:100%; text-align:right;" oninput="recalcInvoiceTotal()" /></div>
    <div class="sales-cell sales-total-cell" data-label="Total" style="display:flex; align-items:center; min-height:44px;"><div class="row-total-box item-row-total">₹0</div></div>
    <div class="sales-cell sales-delete-cell" data-label="Delete" style="display:flex; align-items:center; min-height:44px;"><button type="button" class="btn-remove-square remove-btn" onclick="this.closest('.sales-row').remove(); recalcInvoiceTotal();">✕</button></div>
  `;
  body.appendChild(row);
  setInvoiceItemEntryState();
  recalcInvoiceTotal();
  return row;
}

function handleItemSelection(inp) {
  const product = (state.products || []).find(p => p.name === inp.value);
  const row = inp.closest(".sales-row");
  if (!row) return;

  if (product) {
    row.dataset.productId = product.id;
    row.dataset.tax = product.tax || 0;
    const hsnInput = row.querySelector(".hsn-inp");
    const skuInput = row.querySelector(".sku-inp");
    const priceInput = row.querySelector(".price-inp");
    if (hsnInput) hsnInput.value = product.hsn_code || "";
    if (skuInput) skuInput.value = product.sku || product.barcode || "---";
    if (priceInput) priceInput.value = product.price || 0;

    if (row.parentElement && row === row.parentElement.lastElementChild) {
      addInvoiceRow();
    }
  } else {
    delete row.dataset.productId;
    delete row.dataset.tax;
  }

  recalcInvoiceTotal();
}

function recalcInvoiceTotal() {
  let subtotal = 0;
  let totalTax = 0;

  document.querySelectorAll("#invoice-items-body .sales-row").forEach(row => {
    const qty = parseFloat(row.querySelector(".qty-inp")?.value) || 0;
    const price = parseFloat(row.querySelector(".price-inp")?.value) || 0;
    const taxPct = parseFloat(row.dataset.tax) || 0;
    const taxable = qty * price;
    const tax = (taxable * taxPct) / 100;
    subtotal += taxable;
    totalTax += tax;
    const totalNode = row.querySelector(".item-row-total");
    if (totalNode) totalNode.textContent = money(taxable + tax);
  });

  const discount = parseFloat(document.getElementById("inv-discount")?.value) || 0;
  const paid = parseFloat(document.getElementById("inv-paid")?.value) || 0;
  const isCashSale = document.getElementById("inv-cash-sale")?.checked;
  const customerId = Number(document.getElementById("inv-customer")?.value || 0);
  const party = (state.customers || []).find(c => Number(c.id) === customerId);
  const ledgerBalance = isCashSale ? 0 : Number(party?.balance || 0);
  const total = Math.max(subtotal - discount, 0) + totalTax;
  const afterLedger = total + ledgerBalance;
  const due = Math.max(total - paid, 0);
  const change = Math.max(paid - total, 0);
  const setText = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  };

  setText("sum-subtotal", money(subtotal));
  setText("sum-tax", money(totalTax));
  setSignedMoney("sum-ledger-balance", ledgerBalance);
  setSignedMoney("sum-after-ledger", afterLedger);
  setText("sum-change", money(change));

  const changeRow = document.getElementById("sum-change-row");
  const badge = document.getElementById("summary-status-badge");
  if (changeRow) changeRow.style.display = change > 0 ? "flex" : "none";
  if (badge) {
    if (total <= 0) {
      badge.textContent = "DRAFT";
      badge.className = "badge badge-warning";
    } else if (due > 0) {
      if (paid <= 0) {
        badge.textContent = "UNPAID";
        badge.className = "badge badge-danger";
      } else {
        badge.textContent = "PARTIAL";
        badge.className = "badge badge-warning";
      }
    } else {
      badge.textContent = "PAID";
      badge.className = "badge badge-success";
    }
  }
}

function setSignedMoney(id, amount) {
  const el = document.getElementById(id);
  if (!el) return;
  const value = Number(amount || 0);
  const text = money(Math.abs(value));
  el.textContent = value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
  el.style.color = value > 0 ? "#dc2626" : value < 0 ? "#10b981" : "";
}

function ledgerBalanceMarkup(amount) {
  const value = Number(amount || 0);
  const color = value > 0 ? "#dc2626" : value < 0 ? "#10b981" : "#0f172a";
  return `<strong style="color:${color};">${money(value)}</strong>`;
}

function updateItemRowBadges() {
  return;
}

function getInvoiceStatusMeta(inv) {
  const total = Number(inv?.total_amount || 0);
  const paid = Number(inv?.paid_amount || 0);
  const due = Number(inv?.due_amount || 0);
  
  if (total <= 0) return { label: "DRAFT", badge: "badge-warning" };
  if (due <= 0) return { label: "PAID", badge: "badge-success" };
  if (paid <= 0) return { label: "UNPAID", badge: "badge-danger" };
  return { label: "PARTIAL", badge: "badge-warning" };
}

async function submitInvoice() {
  const salesPage = document.getElementById("page-sales");
  const editId = Number(salesPage?.dataset.editId || 0);
  const isCashSale = document.getElementById("inv-cash-sale")?.checked;
  const customerId = Number(document.getElementById("inv-customer")?.value || 0);
  if (!isCashSale && !customerId) {
    showToast("Please select a party", "warning");
    return;
  }

  const items = [];
  document.querySelectorAll("#invoice-items-body .sales-row").forEach(row => {
    const productId = Number(row.dataset.productId || 0);
    const quantity = parseFloat(row.querySelector(".qty-inp")?.value) || 0;
    const price = parseFloat(row.querySelector(".price-inp")?.value) || 0;
    if (productId && quantity > 0) items.push({ product_id: productId, quantity, price });
  });

  if (!items.length) {
    showToast("Add at least one item", "error");
    return;
  }

  const invoiceDate = document.getElementById("inv-date")?.value || new Date().toISOString().slice(0, 10);
  const payload = {
    id: editId || undefined,
    customer_id: isCashSale ? 0 : customerId,
    cash_sale: !!isCashSale,
    invoice_date: invoiceDate,
    due_date: invoiceDate,
    payment_mode: document.getElementById("inv-payment-mode")?.value || "CASH",
    bank_id: Number(document.getElementById("inv-bank-id")?.value || 0),
    paid_amount: parseFloat(document.getElementById("inv-paid")?.value) || 0,
    discount: parseFloat(document.getElementById("inv-discount")?.value) || 0,
    dispatch_details: document.getElementById("inv-dispatch")?.value || "",
    share_whatsapp: document.getElementById("inv-send-whatsapp")?.checked || false,
    round_off_note: document.getElementById("inv-round-off")?.checked || false,
    notes: document.getElementById("inv-notes")?.value || "",
    items
  };

  const endpoint = editId ? "/api/invoices/update" : "/api/invoices/create";
  const result = await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
  if (result.invoice) {
    showToast(editId ? "Sales invoice updated" : "Sales invoice saved", "success");
    await loadAll();
    navigateTo("sales");
  } else {
    showToast(result.message || "Error saving invoice", "error");
  }
}

async function editInvoice(id) {
  const invoice = (state.invoices || []).find(inv => Number(inv.id) === Number(id));
  if (!invoice) {
    showToast("Invoice not found", "error");
    return;
  }
  await navigateTo("sales");
  populateInvoiceEditor(invoice);
}

function populateInvoiceEditor(invoice) {
  const salesPage = document.getElementById("page-sales");
  if (!salesPage) return;
  salesPage.dataset.editId = String(invoice.id);

  const isCashSale = !!invoice.cash_sale || !invoice.customer_id;
  const cashSaleInput = document.getElementById("inv-cash-sale");
  const customerInput = document.getElementById("inv-customer");
  const dateInput = document.getElementById("inv-date");
  const paymentModeInput = document.getElementById("inv-payment-mode");
  const bankInput = document.getElementById("inv-bank-id");
  const dispatchInput = document.getElementById("inv-dispatch");
  const notesInput = document.getElementById("inv-notes");
  const paidInput = document.getElementById("inv-paid");
  const discountInput = document.getElementById("inv-discount");
  const body = document.getElementById("invoice-items-body");

  if (cashSaleInput) cashSaleInput.checked = isCashSale;
  if (customerInput) customerInput.value = isCashSale ? "" : String(invoice.customer_id || "");
  if (dateInput) dateInput.value = invoice.invoice_date || new Date().toISOString().slice(0, 10);
  if (paymentModeInput) paymentModeInput.value = invoice.payment_mode || "CASH";
  if (bankInput) bankInput.value = String(invoice.bank_id || "");
  if (dispatchInput) dispatchInput.value = invoice.dispatch_details || "";
  if (notesInput) notesInput.value = invoice.notes || "";
  if (paidInput) paidInput.value = Number(invoice.paid_amount || 0);
  if (discountInput) discountInput.value = Number(invoice.discount || 0);

  toggleCashSaleMode();
  handleInvoicePaymentMode();
  updateInvoicePartyDetails();

  if (body) body.innerHTML = "";
  (invoice.items || []).forEach(item => {
    const row = addInvoiceRow();
    const product = (state.products || []).find(p => Number(p.id) === Number(item.product_id));
    const prodInput = row?.querySelector(".prod-inp");
    const hsnInput = row?.querySelector(".hsn-inp");
    const skuInput = row?.querySelector(".sku-inp");
    const qtyInput = row?.querySelector(".qty-inp");
    const priceInput = row?.querySelector(".price-inp");
    if (prodInput) prodInput.value = item.product_name || product?.name || "";
    if (hsnInput) hsnInput.value = product?.hsn_code || "";
    if (skuInput) skuInput.value = product?.sku || product?.barcode || "---";
    if (qtyInput) qtyInput.value = Number(item.quantity || 0);
    if (priceInput) priceInput.value = Number(item.price || 0);
    if (row) {
      row.dataset.productId = item.product_id;
      row.dataset.tax = Number(item.tax_pct || product?.tax || 0);
    }
  });
  addInvoiceRow();
  recalcInvoiceTotal();
}

function deleteInvoice(id) {
  confirmDelete("Are you sure you want to delete this invoice?", async () => {
    await api("/api/invoices/delete", { method: "POST", body: JSON.stringify({ id }) });
    showToast("Invoice deleted", "success");
    await loadAll();
    navigateTo("invoices");
  });
}

function renderInlineGstBreakup(targetId, totalTax) {
  const el = document.getElementById(targetId);
  if (!el) return;
  if (!totalTax || totalTax <= 0) {
    el.textContent = "No GST on current items.";
    return;
  }
  const halfTax = totalTax / 2;
  el.textContent = `CGST ${money(halfTax)} | SGST ${money(halfTax)}`;
}

function renderPurchase() {
  const el = document.getElementById("page-purchase");
  if (!el) return;
  const vendorOpts = `<option value="">-- Select Supplier --</option>` +
    (state.customers || []).map(c => `<option value="${c.name}">${c.name}${c.mobile ? " ("+c.mobile+")" : ""}</option>`).join("");
  const bankOpts = (state.banks || []).map(b => `<option value="${b.id}">${b.bank_name}</option>`).join("");

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Purchase Record</div>
        <div class="page-subtitle">Track inward stock, supplier bills, and payment follow-up.</div>
      </div>
      <button type="button" class="btn btn-primary btn-sm" onclick="showAddParty()">Add Supplier</button>
    </div>

    <div class="billing-container">
      <div class="billing-main">
        <div class="billing-card">
          <div class="billing-card-header">Supplier & Bill Details</div>
          <div class="billing-card-body">
            <div class="form-grid-premium sales-form-grid">
              <div class="form-group">
                <label class="form-label-premium">SUPPLIER NAME *</label>
                <div class="sales-party-select-wrap">
                  <select name="supplier_name" id="pur-vendor" required style="flex:1;" class="input-premium" onchange="updatePurchaseSupplierDetails()">
                    ${vendorOpts}
                  </select>
                  <button type="button" class="btn-plus" onclick="showAddParty()">+</button>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label-premium">PURCHASE DATE</label>
                <input type="date" name="date" class="input-premium" value="${new Date().toISOString().split('T')[0]}" />
              </div>
              <div class="form-group">
                <label class="form-label-premium">BILL NUMBER</label>
                <input type="text" name="bill_no" class="input-premium" placeholder="e.g. BILL-9932" />
              </div>
              <div id="pur-party-details" class="party-details-strip-premium" style="grid-column: span 3; border-top: 1px solid #f1f5f9; padding-top:16px; display:none;"></div>
            </div>
          </div>
        </div>

        <div class="billing-card">
          <div class="billing-card-header">Item Entry</div>
          <div class="billing-card-body" style="padding:0;">
            <div class="item-entry-table">
	              <div class="item-entry-header" style="grid-template-columns: 1.4fr 100px 140px 70px 100px 90px 44px;">
	                <div>ITEM NAME / PRODUCT</div>
	                <div>HSN</div>
	                <div>Sl no / IMEI no</div>
                <div style="text-align:center;">QTY</div>
                <div style="text-align:right;">PUR. PRICE</div>
                <div style="text-align:right;">TOTAL</div>
                <div></div>
              </div>
	              <div id="purchase-items-body"></div>
	              <div class="item-entry-footer" style="padding:12px 24px; border-top:1px solid #f1f5f9; background:#fafafa;">
	                <span class="item-entry-hint">New rows will append automatically as you add items.</span>
	              </div>
            </div>
          </div>
        </div>

        <div class="billing-card">
          <div class="billing-card-header">Payment & Controls</div>
          <div class="billing-card-body">
            <div style="display:grid; grid-template-columns: 2fr 1fr; gap: 40px;">
              <div class="form-group">
                <label class="form-group-label" style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:8px; display:block;">Notes / Terms</label>
                <textarea id="pur-notes" placeholder="Received goods in good condition." style="height:100px; width:100%; border:1px solid var(--border); border-radius:8px; padding:12px;"></textarea>
              </div>
              <div class="form-group">
                <label class="form-group-label" style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:8px; display:block;">Payment Mode</label>
                <select id="pur-pay-mode" class="input-premium" style="width:100%;" onchange="handlePurchasePaymentMode()">
                  <option value="CASH">💵 Cash</option>
                  <option value="BANK">🏦 Bank Transfer</option>
                  <option value="UPI">📱 UPI Payment</option>
                  <option value="CREDIT">⏳ Credit (Udhaar)</option>
                </select>
                <div id="pur-bank-wrap" style="display:none; margin-top:12px;">
                  <label style="font-size:11px; font-weight:700;">Select Bank Account</label>
                  <select id="pur-bank-id" class="input-premium" style="width:100%; margin-top:4px;">
                    <option value="">-- Select Bank --</option>
                    ${bankOpts}
                  </select>
                </div>
                <div style="margin-top:12px;">
                  <label style="font-size:11px; font-weight:700;">Purchase Reference</label>
                  <input type="text" id="pur-reference" class="input-premium" style="width:100%; margin-top:4px;" placeholder="Supplier ref / challan no." />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="billing-sidebar">
        <div class="summary-card">
          <div class="summary-header">
            <span>Purchase Summary</span>
            <span id="pur-status-badge" class="badge badge-warning">DRAFT</span>
          </div>
          <div class="summary-body">
            <div class="summary-row">
              <span class="text-secondary">Subtotal Amount</span>
              <span id="pur-sum-subtotal" class="font-bold">₹0.00</span>
            </div>
            <div class="summary-row" style="align-items:center;">
              <span class="text-secondary">Discount (Fixed)</span>
              <div style="position:relative; width:100px;">
                <span style="position:absolute; left:10px; top:50%; transform:translateY(-50%); font-weight:600; color:var(--text-muted);">₹</span>
                <input type="number" id="pur-discount" value="0" style="width:100%; text-align:right; padding:6px 10px 6px 22px; border:1px solid var(--border); border-radius:6px; background:var(--bg-main);" oninput="recalcPurchaseTotal()" />
              </div>
            </div>
            <div class="summary-row">
              <span class="text-secondary">GST Total</span>
              <span id="pur-sum-tax" class="font-bold">₹0.00</span>
            </div>
            <div id="purchase-gst-breakup" class="gst-inline-row"></div>
            <div id="pur-due-row" class="summary-row due-box" style="display:none;">
               <span class="summary-total-label" style="color:#991b1b;">Balance Due</span>
               <span id="pur-sum-due" class="summary-total-val" style="color:#991b1b;">₹0.00</span>
            </div>
            <div class="summary-row" style="margin-top:20px; align-items:center;">
              <span class="font-semibold" style="font-size:14px;">Amount Paid</span>
              <div style="position:relative; width:130px;">
                <span style="position:absolute; left:12px; top:50%; transform:translateY(-50%); font-weight:600; color:var(--primary);">₹</span>
                <input type="number" id="pur-paid" value="0" style="width:100%; text-align:right; padding:8px 12px 8px 24px; border:1.5px solid var(--border); border-radius:8px; background:#f8fafc; font-weight:700; font-size:16px; color:var(--primary);" oninput="recalcPurchaseTotal()" />
              </div>
            </div>
            <div style="margin-top:24px;">
              <button class="btn btn-primary btn-block" style="padding:16px; font-size:15px; font-weight:800;" onclick="submitPurchase()">Save Purchase Record</button>
              <button class="btn btn-outline btn-block mt-12" onclick="showPurchasePrint({ supplier_name: document.getElementById('pur-vendor')?.value || '', items: [], total_amount: getPurchaseGrandTotal(), paid_amount: parseFloat(document.getElementById('pur-paid')?.value || 0), notes: document.getElementById('pur-notes')?.value || '', createdAt: new Date().toISOString(), id: 'PREVIEW' })">Preview Voucher</button>
              <button class="btn btn-outline btn-block mt-12" onclick="navigateTo('dashboard')">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <datalist id="prod-datalist">
      ${state.products.map(p => `<option value="${p.name}">Cost: ${money(p.purchase_price || 0)} | Sale: ${money(p.price)} | Stock: ${Number(p.stock || 0)} ${p.unit || ""}</option>`).join("")}
    </datalist>
  `;
  addPurchaseRow();
  document.getElementById("pur-vendor").addEventListener("change", updatePurchaseSupplierDetails);
  handlePurchasePaymentMode();
  updatePurchaseSupplierDetails();
}

function updatePurchaseSupplierDetails() {
  const supplierName = document.getElementById("pur-vendor")?.value || "";
  const party = (state.customers || []).find(c => c.name === supplierName);
  const strip = document.getElementById("pur-party-details");
  if (!strip) return;

  if (!party) {
    strip.style.display = "none";
    strip.innerHTML = "";
    return;
  }

  strip.style.display = "";
  strip.innerHTML = `
    <div class="party-detail-chip"><span>Contact</span><strong>${party?.mobile || "Not available"}</strong></div>
    <div class="party-detail-chip"><span>GSTIN</span><strong>${party?.gstin || "Unregistered"}</strong></div>
    <div class="party-detail-chip"><span>City</span><strong>${party?.city || party?.address || "Not set"}</strong></div>
    <div class="party-detail-chip balance-chip"><span>Ledger Balance</span>${ledgerBalanceMarkup(party?.balance || 0)}</div>
  `;
}

function handlePurchasePaymentMode() {
  const mode = document.getElementById("pur-pay-mode")?.value || "CASH";
  const bankWrap = document.getElementById("pur-bank-wrap");
  if (bankWrap) bankWrap.style.display = (mode === "BANK" || mode === "UPI") ? "block" : "none";
  handlePurchaseFill();
}


function addPurchaseRow() {
  const body = document.getElementById("purchase-items-body");
  if (!body) return;
  const row = document.createElement("div");
  row.className = "purchase-row item-row";
  row.style.display = "grid";
  row.style.gridTemplateColumns = "1.4fr 100px 140px 70px 100px 90px 44px";
  row.style.gap = "10px";
  row.style.alignItems = "start";
  row.style.padding = "10px 14px 14px";
  row.innerHTML = `
    <div class="purchase-cell purchase-product-cell" data-label="Item Name / Product"><input type="text" class="prod-inp input-premium" style="width:100%;" placeholder="Search item..." list="prod-datalist" onchange="handlePurchaseItemSelect(this)" required /></div>
    <div class="purchase-cell" data-label="HSN"><input type="text" class="hsn-inp input-premium" style="width:100%;" placeholder="HSN" readonly /></div>
    <div class="purchase-cell" data-label="Sl no / IMEI no"><input type="text" class="sku-inp input-premium" style="width:100%;" placeholder="Sl no / IMEI" readonly /></div>
    <div class="purchase-cell" data-label="Qty"><input type="number" class="qty-inp input-premium" value="1" min="1" step="any" style="text-align: center; width:100%;" oninput="recalcPurchaseTotal()" /></div>
    <div class="purchase-cell" data-label="Pur. Price"><input type="number" class="price-inp input-premium" placeholder="0.00" step="any" style="text-align: right; width:100%;" oninput="recalcPurchaseTotal()" /></div>
    <div class="purchase-cell purchase-total-cell" data-label="Total" style="display:flex; align-items:center; min-height:44px;"><div class="row-total-box item-row-total">₹0</div></div>
    <div class="purchase-cell purchase-delete-cell" data-label="Delete" style="display:flex; align-items:center; min-height:44px;">
      <button type="button" class="btn-remove-square" onclick="this.closest('.purchase-row').remove(); recalcPurchaseTotal();">✕</button>
    </div>
  `;
  body.appendChild(row);
  recalcPurchaseTotal();
  return row;
}

function handlePurchaseItemSelect(inp) {
  const name = inp.value;
  const p = state.products.find(x => x.name === name);
  const row = inp.closest(".purchase-row");
  if (p) {
    const hsn = row.querySelector(".hsn-inp");
    if (hsn) hsn.value = p.hsn_code || "";
    const sku = row.querySelector(".sku-inp");
    if (sku) {
       sku.value = p.sku || p.barcode || "---";
    }
    const price = row.querySelector(".price-inp");
    if (price) price.value = p.purchase_price || p.price || 0;
    row.dataset.tax = p.tax || 0;
    row.dataset.productId = p.id;
    updateItemRowBadges(row, p, "purchase");
    
    // Auto-add new row if this is the last row
    if (row.parentElement && row === row.parentElement.lastElementChild) {
       addPurchaseRow();
    }
    recalcPurchaseTotal();

  }
}

function recalcPurchaseTotal() {
  let subtotal = 0, totalTax = 0;
  const rows = document.querySelectorAll(".purchase-row");
  rows.forEach((row, idx) => {
    const qty = parseFloat(row.querySelector(".qty-inp")?.value) || 0;
    const price = parseFloat(row.querySelector(".price-inp")?.value) || 0;
    const taxPct = parseFloat(row.dataset.tax) || 0;
    const lineTotal = qty * price;
    const lineTax = (lineTotal * taxPct) / 100;
    subtotal += lineTotal;
    totalTax += lineTax;
    const rowTot = row.querySelector(".item-row-total");
    if (rowTot) rowTot.textContent = money(lineTotal + lineTax);
  });

  const discount = parseFloat(document.getElementById("pur-discount")?.value) || 0;
  const taxable = Math.max(subtotal - discount, 0);
  const grandTotal = taxable + totalTax;
  const paid = parseFloat(document.getElementById("pur-paid")?.value) || 0;
  const balanceDue = Math.max(grandTotal - paid, 0);

  const setT = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setT("pur-sum-subtotal", money(subtotal));
  setT("pur-sum-taxable", money(taxable));
  setT("pur-sum-tax", money(totalTax));
  renderInlineGstBreakup("purchase-gst-breakup", totalTax);

  const dueRow = document.getElementById("pur-due-row");
  const badge = document.getElementById("pur-status-badge");
  if (balanceDue > 0) {
    if (dueRow) dueRow.style.display = "flex";
    setT("pur-sum-due", money(balanceDue));
    if (badge) { badge.textContent = balanceDue === grandTotal ? "UNPAID" : "PARTIAL"; badge.className = balanceDue === grandTotal ? "badge badge-danger" : "badge badge-warning"; }
  } else {
    if (dueRow) dueRow.style.display = "none";
    if (badge) { badge.textContent = grandTotal > 0 ? "PAID" : "DRAFT"; badge.className = grandTotal > 0 ? "badge badge-success" : "badge badge-warning"; }
  }
}


function handlePurchaseFill() {
  const grandTotal = getPurchaseGrandTotal();
  const tot = Number(grandTotal || 0);
  document.getElementById("pur-paid").value = tot.toFixed(2);
}

function getPurchaseGrandTotal() {
  let subtotal = 0;
  let totalTax = 0;
  document.querySelectorAll(".purchase-row").forEach(row => {
    const qty = parseFloat(row.querySelector(".qty-inp")?.value) || 0;
    const price = parseFloat(row.querySelector(".price-inp")?.value) || 0;
    const taxPct = parseFloat(row.dataset.tax) || 0;
    const lineTotal = qty * price;
    const lineTax = (lineTotal * taxPct) / 100;
    subtotal += lineTotal;
    totalTax += lineTax;
  });
  const discount = parseFloat(document.getElementById("pur-discount")?.value) || 0;
  const taxable = Math.max(subtotal - discount, 0);
  return taxable + totalTax;
}

async function submitPurchase() {
  const vendor = document.getElementById("pur-vendor").value;
  if (!vendor) { showToast("Please select a supplier", "warning"); return; }
  
  const items = [];
  document.querySelectorAll("#purchase-items-body .purchase-row").forEach(row => {
    const prodEl = row.querySelector(".prod-inp");
    if (!prodEl) return;
    
    const name = prodEl.value;
    const productId = Number(row.dataset.productId || 0);
    const qty = parseFloat(row.querySelector(".qty-inp")?.value) || 0;
    const price = parseFloat(row.querySelector(".price-inp")?.value) || 0;
    const taxPct = parseFloat(row.dataset.tax) || 0;
    if (name && qty > 0 && productId) items.push({ product_id: productId, product_name: name, quantity: qty, purchase_price: price, tax_pct: taxPct });
  });

  if (!items.length) { showToast("Add at least one item", "error"); return; }

  const paid = parseFloat(document.getElementById("pur-paid").value) || 0;
  const total = getPurchaseGrandTotal();

  const payload = {
    supplier_name: vendor,
    supplier_mobile: (state.customers.find(c => c.name === vendor) || {}).mobile || "",
    date: document.querySelector("[name='date']").value,
    bill_no: document.querySelector("[name='bill_no']").value,
    invoice_date: document.getElementById("pur-invoice-date")?.value || "",
    due_date: document.getElementById("pur-due-date")?.value || "",
    reference: document.getElementById("pur-reference")?.value || "",
    transport_details: document.getElementById("pur-transport")?.value || "",
    items,
    total_amount: total,
    paid_amount: paid,
    due_amount: Math.max(total - paid, 0),
    status: paid >= total ? "PAID" : "DUE",
    payment_mode: document.getElementById("pur-pay-mode").value,
    bank_id: parseInt(document.getElementById("pur-bank-id")?.value || 0),
    notes: document.getElementById("pur-notes")?.value || "",
    print_copy: document.getElementById("pur-print-copy")?.checked || false
  };

  const result = await api("/api/purchases/create", { method: "POST", body: JSON.stringify(payload) });
  if (result.purchase) {
    showToast("Purchase Invoice Saved!", "success");
    await loadAll();
    if (payload.print_copy) showPurchasePrint(result.purchase);
    navigateTo("purchase");
  } else {
    showToast(result.message || "Error saving purchase", "error");
  }
}

function deletePurchase(id) {
  confirmDelete("Are you sure you want to delete this purchase record?", async () => {
    await api("/api/purchases/delete", { method: "POST", body: JSON.stringify({ id }) });
    showToast("Purchase deleted", "success");
    await loadAll();
    navigateTo("purchase");
  });
}

function renderInvoices() {
  const el = document.getElementById("page-invoices");
  if (!el) return;

  const rows = (state.invoices || []).map(inv => {
    const invoiceStatus = getInvoiceStatusMeta(inv);
    return `
    <tr>
      <td class="text-muted">${inv.invoice_number || "INV-" + inv.id}</td>
      <td>${fmtDate(inv.invoice_date || inv.createdAt)}</td>
      <td class="td-name">${inv.customer_name || (inv.cash_sale ? "Walk-in Customer" : "-")}</td>
      <td>${inv.payment_mode || "-"}</td>
      <td><span class="badge ${invoiceStatus.badge}">${invoiceStatus.label}</span></td>
      <td class="font-bold">${money(inv.total_amount || 0)}</td>
      <td>
        <button class="btn btn-ghost btn-xs" onclick="showInvoicePrint(state.invoices.find(x => x.id === ${inv.id}))">Preview</button>
        <button class="btn btn-outline btn-xs" onclick="editInvoice(${inv.id})">Edit</button>
      </td>
    </tr>
  `}).join("") || `<tr><td colspan="7" class="table-empty"><div class="table-empty-icon">🧾</div><div>No invoices found.</div></td></tr>`;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">All Transactions</div>
        <div class="page-subtitle">View and manage all saved sales invoices.</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="navigateTo('sales')">New Sales Invoice</button>
    </div>
    <div class="table-wrap">
      <div class="table-header">
        <div class="table-title">Sales Invoice Records</div>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Invoice No</th>
              <th>Date</th>
              <th>Party</th>
              <th>Payment</th>
              <th>Status</th>
              <th>Amount</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/* ========== EXPENSES ========== */
function renderExpenses() {
  const el = document.getElementById("page-expenses");
  if (!el) return;
  const bankOpts = state.banks.map(b => `<option value="${b.id}">${b.bank_name}</option>`).join("");
  const rows = state.expenses.map(e => `
    <tr>
      <td class="text-muted">EXP-${e.id}</td>
      <td class="td-name">${e.category}</td>
      <td>${e.description || "-"}</td>
      <td>${fmtDate(e.createdAt)}</td>
      <td>${e.payment_mode || "-"}</td>
      <td class="font-bold text-danger">${money(e.amount)}</td>
      <td>
        <button class="btn btn-ghost btn-xs" onclick="showExpensePrint(state.expenses.find(x=>x.id===${e.id}))">🖨️ Print</button>
        <button class="btn btn-danger btn-xs" onclick="deleteExpense(${e.id})">Delete</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="7" class="table-empty"><div class="table-empty-icon">💸</div><div>No expenses recorded yet.</div></td></tr>`;
  const categories = ["Rent", "Salaries", "Electricity", "Internet", "Petrol", "Office Supplies", "Marketing", "Maintenance", "Transport", "Food", "Other"];
  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Expenses</div><div class="page-subtitle">Track and manage your business expenses</div></div>
    </div>
    <div class="grid-2" style="gap:20px;align-items:start">
      <div class="card">
        <div class="form-section-title">Add Expense</div>
        <form id="expense-form" class="form-grid">
          <div class="form-control">
            <label>Category *</label>
            <select name="category" required>
              ${categories.map(c => `<option>${c}</option>`).join("")}
            </select>
          </div>
          <div class="form-control"><label>Amount (Rs.) *</label><input name="amount" type="number" step="0.01" required placeholder="0.00" /></div>
          <div class="form-control full"><label>Description</label><input name="description" placeholder="Expense detail..." /></div>
          <div class="form-control">
            <label>Payment Mode</label>
            <select name="payment_mode" id="exp-pay-mode">
              <option value="CASH">💵 Cash</option>
              <option value="BANK">🏦 Bank</option>
              <option value="UPI">📱 UPI</option>
            </select>
          </div>
          <div class="form-control" id="exp-bank-wrap" style="display:none">
            <label>Bank</label><select name="bank_id">${bankOpts}</select>
          </div>
          <div class="form-control full">
            <button class="btn btn-primary btn-block" type="submit">💸 Add Expense</button>
          </div>
        </form>
        <div id="exp-message"></div>
      </div>
      <div class="table-wrap">
        <div class="table-header"><div class="table-title">Expense History</div></div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Ref</th><th>Category</th><th>Date</th><th>Amount</th><th>Actions</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  document.getElementById("exp-pay-mode").addEventListener("change", function () {
    document.getElementById("exp-bank-wrap").style.display = this.value === "BANK" ? "flex" : "none";
  });
  document.getElementById("expense-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const result = await api("/api/expenses/create", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
    if (result.expense) { showToast("Expense added successfully!", "success"); await navigateTo("expenses"); }
    else document.getElementById("exp-message").innerHTML = `<div class="alert alert-danger">${result.message || "Error"}</div>`;
  });
}

async function deleteExpense(id) {
  confirmDelete("Are you sure you want to delete this expense?", async () => {
    await api("/api/expenses/delete", { method: "POST", body: JSON.stringify({ id }) });
    showToast("Expense deleted successfully", "success");
    await navigateTo("expenses");
  });
}

function showPurchasePrint(p) {
  if (!p) return;
  const s = state.settings;
  const items = (p.items || []).map(i => `<tr><td>${i.product_name}</td><td>${i.quantity}</td><td style="text-align:right">${money(i.purchase_price)}</td><td style="text-align:right">${money(i.line_total)}</td></tr>`).join("");
  document.getElementById("print-content").innerHTML = `
    <div class="voucher-box">
      <div class="voucher-header">
        <div class="voucher-title">Purchase Voucher</div>
        <div style="font-size:18px;font-weight:700;margin-top:5px">${s.business_name}</div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:15px">
        <div><strong>Supplier:</strong> ${p.supplier_name}<br>${p.reference ? `<strong>Reference:</strong> ${p.reference}` : ""}</div>
        <div style="text-align:right"><strong>Date:</strong> ${fmtDate(p.createdAt)}<br><strong>Ref:</strong> PUR-${p.id}<br>${p.bill_no ? `<strong>Bill No:</strong> ${p.bill_no}` : ""}</div>
      </div>
      <table class="print-table" style="width:100%;margin-bottom:15px">
        <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
        <tbody>${items}</tbody>
      </table>
      <div style="text-align:right;font-size:16px"><strong>Total Amount: ${money(p.total_amount)}</strong></div>
      <div style="text-align:right;color:#059669">Paid: ${money(p.paid_amount)}</div>
      ${p.transport_details ? `<div style="margin-top:10px">Transport: ${p.transport_details}</div>` : ""}
      ${p.notes ? `<div style="margin-top:10px;font-style:italic">Note: ${p.notes}</div>` : ""}
    </div>`;
  document.getElementById("print-modal").style.display = "flex";
  document.querySelector("#print-modal .modal-title").textContent = "Purchase Voucher: PUR-" + p.id;
  document.querySelector("#print-modal .modal-footer").innerHTML = `<button class="btn btn-primary" onclick="openPrintDialog('Purchase PDF')">Print / Save PDF</button><button class="btn btn-outline" onclick="closePrintModal()">Close</button>`;
}

function showExpensePrint(e) {
  if (!e) return;
  const s = state.settings;
  document.getElementById("print-content").innerHTML = `
    <div class="voucher-box">
      <div class="voucher-header">
        <div class="voucher-title">Payment Voucher</div>
        <div style="font-size:18px;font-weight:700;margin-top:5px">${s.business_name}</div>
      </div>
      <div style="margin-bottom:20px;line-height:1.8">
        <div><strong>Voucher No:</strong> EXP-${e.id}</div>
        <div><strong>Date:</strong> ${fmtDate(e.createdAt)}</div>
        <div style="margin-top:10px"><strong>Paid For:</strong> ${e.category}</div>
        <div><strong>Description:</strong> ${e.description || "-"}</div>
        <div><strong>Payment Mode:</strong> ${e.payment_mode}</div>
      </div>
      <div style="border:2px dashed #e5e7eb;padding:15px;text-align:center;background:#f9fafb">
        <div style="font-size:12px;text-transform:uppercase;color:#6b7280">Amount Paid</div>
        <div style="font-size:32px;font-weight:900">${money(e.amount)}</div>
      </div>
      <div style="margin-top:40px;display:flex;justify-content:space-between">
        <div style="border-top:1px solid #111;width:150px;text-align:center;padding-top:5px">Authorized Sign</div>
        <div style="border-top:1px solid #111;width:150px;text-align:center;padding-top:5px">Receiver Sign</div>
      </div>
    </div>`;
  document.getElementById("print-modal").style.display = "flex";
  document.querySelector("#print-modal .modal-title").textContent = "Expense Voucher: EXP-" + e.id;
  document.querySelector("#print-modal .modal-footer").innerHTML = `<button class="btn btn-primary" onclick="window.print()">🖨️ Print Voucher</button><button class="btn btn-outline" onclick="closePrintModal()">Close</button>`;
}

/* ========== REPORTS ========== */
function renderReports() {
  const el = document.getElementById("page-reports");
  if (!el) return;
  const invoices = state.invoices;
  const gst = getGstSummary();
  const inventory = getInventoryInsights();
  
  const totalSales = invoices.reduce((s, i) => s + Number(i.total_amount || 0), 0);
  const totalCollected = invoices.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
  const totalDue = invoices.reduce((s, i) => s + Number(i.due_amount || 0), 0);
  
  const rows = invoices.map(inv => {
    const invoiceStatus = getInvoiceStatusMeta(inv);
    return `
    <tr>
      <td><span class="font-bold">#${inv.invoice_number || inv.id}</span></td>
      <td class="td-name">${inv.customer_name}</td>
      <td class="text-secondary">${fmtDate(inv.createdAt)}</td>
      <td><span class="badge badge-outline">${inv.payment_mode}</span></td>
      <td class="font-semibold">${money(inv.total_amount)}</td>
      <td class="text-success font-semibold">${money(inv.paid_amount)}</td>
      <td class="text-danger font-semibold">${money(inv.due_amount)}</td>
      <td><span class="badge ${invoiceStatus.badge}">${invoiceStatus.label}</span></td>
    </tr>`}).join("") || `<tr><td colspan="8" class="table-empty"><div class="table-empty-icon">📈</div><div>No sales data found for the selected period.</div></td></tr>`;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Business Reports</div>
        <div class="page-subtitle">Billing, accounting, inventory and GST performance in one place</div>
      </div>
      <div class="flex gap-10">
        <button class="btn btn-outline btn-sm" onclick="navigateTo('daybook')">Open Daybook</button>
        <button class="btn btn-outline btn-sm" onclick="navigateTo('profit')">Profit & Loss</button>
        <button class="btn btn-primary btn-sm" onclick="navigateTo('e-invoicing')">GST Desk</button>
      </div>
    </div>

    <div class="module-grid module-grid-4" style="margin-bottom: 24px;">
      <div class="insight-card accent-slate"><div class="insight-title">Sales</div><div class="insight-value">${money(totalSales)}</div><div class="insight-sub">Gross revenue booked</div></div>
      <div class="insight-card accent-emerald"><div class="insight-title">Collections</div><div class="insight-value">${money(totalCollected)}</div><div class="insight-sub">Cash realized from invoices</div></div>
      <div class="insight-card accent-amber"><div class="insight-title">Inventory Value</div><div class="insight-value">${money(inventory.totalValue)}</div><div class="insight-sub">${inventory.lowStock} low stock alerts</div></div>
      <div class="insight-card accent-sky"><div class="insight-title">GST Total</div><div class="insight-value">${money(gst.taxTotal)}</div><div class="insight-sub">${gst.taxedInvoices} tax invoices</div></div>
    </div>

    <div class="grid-3 mb-24" style="gap:16px">
      <div class="stat-card" style="border-left: 4px solid var(--info);">
        <div class="stat-label">Total Sales</div>
        <div class="stat-value" style="color: var(--primary);">${money(totalSales)}</div>
        <div class="stat-sub">From ${invoices.length} Invoices</div>
      </div>
      <div class="stat-card" style="border-left: 4px solid var(--success);">
        <div class="stat-label">Total Collected</div>
        <div class="stat-value" style="color: var(--success);">${money(totalCollected)}</div>
        <div class="stat-sub">${((totalCollected/totalSales)*100 || 0).toFixed(1)}% of total sales</div>
      </div>
      <div class="stat-card" style="border-left: 4px solid var(--danger);">
        <div class="stat-label">Total Outstanding</div>
        <div class="stat-value" style="color: var(--danger);">${money(totalDue)}</div>
        <div class="stat-sub">Action required for ${invoices.filter(i => i.due_amount > 0).length} parties</div>
      </div>
    </div>

    <div class="grid-2" style="gap:24px; align-items:start; margin-bottom:24px;">
      <div class="card">
        <div class="card-title">Accounting Snapshot</div>
        <div class="metric-strip">
          <div class="metric-chip"><span class="metric-chip-label">Expenses</span><strong>${money(state.expenses.reduce((s, e) => s + toNumber(e.amount), 0))}</strong></div>
          <div class="metric-chip"><span class="metric-chip-label">Purchases</span><strong>${money(state.purchases.reduce((s, p) => s + toNumber(p.total_amount), 0))}</strong></div>
          <div class="metric-chip"><span class="metric-chip-label">Bank Entries</span><strong>${state.banks.length}</strong></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">GST Snapshot</div>
        <div class="metric-strip">
          <div class="metric-chip"><span class="metric-chip-label">CGST</span><strong>${money(gst.cgst)}</strong></div>
          <div class="metric-chip"><span class="metric-chip-label">SGST</span><strong>${money(gst.sgst)}</strong></div>
          <div class="metric-chip"><span class="metric-chip-label">IGST</span><strong>${money(gst.igst)}</strong></div>
        </div>
      </div>
    </div>

    <div class="table-wrap">
      <div class="table-header">
        <div class="table-title">Transaction History</div>
        <div class="search-bar">
          <span class="search-icon">🔍</span>
          <input type="text" placeholder="Search invoices..." oninput="filterTable(this,'rep-table')" />
        </div>
      </div>
      <div class="table-scroll">
        <table id="rep-table">
          <thead>
            <tr>
              <th>Invoice No</th>
              <th>Customer Name</th>
              <th>Date</th>
              <th>Method</th>
              <th>Amount</th>
              <th>Collected</th>
              <th>Balance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderDaybook() {
  const today = new Date().toISOString().slice(0, 10);
  const el = document.getElementById("page-daybook");
  if (!el) return;
  
  const todayInv = state.invoices.filter(i => (i.createdAt || "").slice(0, 10) === today);
  const todayExp = state.expenses.filter(e => (e.createdAt || "").slice(0, 10) === today);
  const todayPur = state.purchases.filter(p => (p.createdAt || "").slice(0, 10) === today);
  
  const totalIn = todayInv.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
  const totalOut = todayExp.reduce((s, e) => s + Number(e.amount || 0), 0) + todayPur.reduce((s, p) => s + Number(p.paid_amount || 0), 0);
  const netCash = totalIn - totalOut;

  const rows = [
    ...todayInv.map(i => { const invoiceStatus = getInvoiceStatusMeta(i); return `<tr><td><span class="badge badge-success-light">Sale</span></td><td><span class="font-semibold">${i.invoice_number || "#" + i.id}</span></td><td>${i.customer_name}</td><td class="text-success font-bold">+ ${money(i.paid_amount)}</td><td><span class="badge ${invoiceStatus.badge}">${invoiceStatus.label}</span></td></tr>`; }),
    ...todayExp.map(e => `<tr><td><span class="badge badge-danger-light">Expense</span></td><td>EXP-${e.id}</td><td>${e.category}</td><td class="text-danger font-bold">- ${money(e.amount)}</td><td><span class="badge badge-success">PAID</span></td></tr>`),
    ...todayPur.map(p => `<tr><td><span class="badge badge-warning-light">Purchase</span></td><td>PUR-${p.id}</td><td>${p.supplier_name}</td><td class="text-danger font-bold">- ${money(p.paid_amount)}</td><td><span class="badge badge-outline">BOUGHT</span></td></tr>`)
  ].join("") || `<tr><td colspan="5" class="table-empty"><div class="table-empty-icon">📅</div><div>No transactions recorded today.</div></td></tr>`;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Daybook</div>
        <div class="page-subtitle">${new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="window.print()">🖨️ Print Daily Summary</button>
    </div>

    <div class="grid-3 mb-24" style="gap:16px">
      <div class="stat-card">
        <div class="stat-label">Cash In (Collections)</div>
        <div class="stat-value text-success">${money(totalIn)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Cash Out (Payments)</div>
        <div class="stat-value text-danger">${money(totalOut)}</div>
      </div>
      <div class="stat-card" style="background: ${netCash >= 0 ? "rgba(16, 185, 129, 0.05)" : "rgba(239, 68, 68, 0.05)"}">
        <div class="stat-label">Net Daily Cash Flow</div>
        <div class="stat-value" style="color: ${netCash >= 0 ? "var(--success)" : "var(--danger)"}">${money(netCash)}</div>
      </div>
    </div>

    <div class="table-wrap">
      <div class="table-header">
        <div class="table-title">Today's Transactions</div>
      </div>
      <table>
        <thead>
          <tr>
            <th width="120">Type</th>
            <th width="150">Reference</th>
            <th>Party / Category</th>
            <th>Amount</th>
            <th width="120">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderProfitLoss() {
  const el = document.getElementById("page-profit");
  if (!el) return;
  const totalSales = state.invoices.reduce((s, i) => s + Number(i.total_amount || 0), 0);
  const totalExpenses = state.expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalPurchases = state.purchases.reduce((s, p) => s + Number(p.total_amount || 0), 0);
  const grossProfit = totalSales - totalPurchases;
  const netProfit = grossProfit - totalExpenses;
  el.innerHTML = `
    <div class="page-header"><div><div class="page-title">Profit & Loss</div><div class="page-subtitle">Complete financial overview of your business</div></div></div>
    <div class="grid-2 mb-24" style="gap:16px">
      <div class="grid-2" style="gap:16px">
        <div class="stat-card blue"><div class="stat-icon">📈</div><div class="stat-label">Total Sales</div><div class="stat-value">${money(totalSales)}</div></div>
        <div class="stat-card orange"><div class="stat-icon">🛒</div><div class="stat-label">Total Purchases</div><div class="stat-value">${money(totalPurchases)}</div></div>
        <div class="stat-card red"><div class="stat-icon">💸</div><div class="stat-label">Total Expenses</div><div class="stat-value">${money(totalExpenses)}</div></div>
        <div class="stat-card ${netProfit >= 0 ? "green" : "red"}">
          <div class="stat-icon">${netProfit >= 0 ? "🎉" : "📉"}</div>
          <div class="stat-label">Net Profit/Loss</div>
          <div class="stat-value">${money(netProfit)}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-title mb-12">Profit & Loss Statement</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;justify-content:space-between;padding:10px;background:rgba(99,102,241,0.08);border-radius:8px">
            <span class="font-semibold">Total Revenue (Sales)</span><span class="text-success font-bold">${money(totalSales)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:10px;background:rgba(245,158,11,0.08);border-radius:8px">
            <span class="font-semibold">(-) Purchase Cost</span><span class="text-warning font-bold">${money(totalPurchases)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:10px;background:rgba(16,185,129,0.08);border-radius:8px">
            <span class="font-semibold">Gross Profit</span><span class="${grossProfit >= 0 ? "text-success" : "text-danger"} font-bold">${money(grossProfit)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:10px;background:rgba(239,68,68,0.08);border-radius:8px">
            <span class="font-semibold">(-) Expenses</span><span class="text-danger font-bold">${money(totalExpenses)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:14px;background:rgba(99,102,241,0.15);border-radius:10px;border:1px solid rgba(99,102,241,0.3)">
            <span style="font-size:16px;font-weight:800">Net Profit / Loss</span>
            <span style="font-size:18px;font-weight:900;color:${netProfit >= 0 ? "#10b981" : "#ef4444"}">${money(netProfit)}</span>
          </div>
        </div>
      </div>
    </div>`;
}

function renderSettings() {
  const el = document.getElementById("page-settings");
  if (!el) return;
  const s = state.settings;
  
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Settings</div>
        <div class="page-subtitle">Configure your business workspace and invoice templates</div>
      </div>
    </div>

    <div class="grid-2" style="gap:24px; align-items: flex-start;">
      <div class="card p-0" style="overflow: hidden;">
        <div style="padding: 20px; background: #f8fafc; border-bottom: 1px solid var(--border); font-weight: 700; display: flex; align-items: center; gap: 8px;">
          🏢 Business Profile
        </div>
        <form id="settings-form" style="padding: 24px;">
          <div class="grid-2" style="gap: 16px;">
            <div class="form-control full">
              <label>Legal Business Name</label>
              <input name="business_name" value="${s.business_name || ""}" required placeholder="e.g. Acme Corporation" />
            </div>
            <div class="form-control full">
              <label>Business Address</label>
              <textarea name="business_address" rows="3" placeholder="Street, City, State, ZIP">${s.business_address || ""}</textarea>
            </div>
            <div class="form-control">
              <label>Contact Number</label>
              <input name="business_mobile" value="${s.business_mobile || ""}" placeholder="+91 00000 00000" />
            </div>
            <div class="form-control">
});

const dateEl = document.getElementById("topbar-date");
if (dateEl) {
  dateEl.textContent = new Date().toLocaleDateString("en-IN", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });
}

/* ========== ADVANCED SALES MODULES (Fully Functional) ========== */

function renderEstimate() {
  const el = document.getElementById("page-estimate");
  const custOpts = state.customers.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  const estimates = readLocalList("estimates");
  const rows = estimates.map(e => `
    <tr>
      <td class="font-bold">EST-${e.id}</td>
      <td class="td-name">${e.customer_name || "-"}</td>
      <td>${fmtDate(e.date)}</td>
      <td class="font-bold">${money(e.total)}</td>
      <td><span class="badge badge-info">${e.status || "DRAFT"}</span></td>
      <td><button class="btn btn-danger btn-xs" onclick="deleteLocalDoc('estimates',${e.id},'estimate')">Delete</button></td>
    </tr>`).join("") || '<tr><td colspan="6" class="table-empty">No estimates yet. Create one above.</td></tr>';
  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Estimate / Quotation</div><div class="page-subtitle">Create estimates to share with customers before invoicing</div></div>
    </div>
    <div class="grid-2" style="gap:20px;align-items:start">
      <div class="card">
        <div class="form-section-title">New Estimate</div>
        <form id="estimate-form" class="form-grid">
          <div class="form-control full"><label>Select Party *</label><select name="customer_id" required><option value="">-- Choose --</option>${custOpts}</select></div>
          <div class="form-control"><label>Date</label><input name="date" type="date" value="${new Date().toISOString().split('T')[0]}" /></div>
          <div class="form-control"><label>Valid Until</label><input name="valid_until" type="date" /></div>
          <div class="form-control"><label>Item Description *</label><input name="description" required placeholder="e.g. Website Development" /></div>
          <div class="form-control"><label>Amount (₹) *</label><input name="total" type="number" step="any" required placeholder="0.00" /></div>
          <div class="form-control full"><label>Notes</label><textarea name="notes" placeholder="Terms & conditions..."></textarea></div>
          <div class="form-control full"><button class="btn btn-primary btn-block" type="submit">📄 Save Estimate</button></div>
        </form>
      </div>
      <div class="table-wrap">
        <div class="table-header"><div class="table-title">Estimate History</div></div>
        <div class="table-scroll"><table><thead><tr><th>Ref</th><th>Party</th><th>Date</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>
    </div>`;
  document.getElementById("estimate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    fd.customer_name = state.customers.find(c => c.id == fd.customer_id)?.name || "";
    fd.status = "DRAFT";
    saveLocalDoc("estimates", fd);
    showToast("Estimate saved successfully!", "success");
    await navigateTo("estimate");
  });
}

function renderPaymentIn() {
  const el = document.getElementById("page-payment-in");
  if (!el) return;
  const custOpts = state.customers.map(c => `<option value="${c.id}">${c.name} (Due: ${money(c.balance)})</option>`).join("");
  const bankOpts = state.banks.map(b => `<option value="${b.id}">${b.bank_name}</option>`).join("");
  const records = readLocalList("payment_in");
  const rows = records.map(r => `
    <tr>
      <td class="text-muted">PIN-${r.id}</td>
      <td class="td-name">${r.customer_name || "-"}</td>
      <td>${fmtDate(r.date)}</td>
      <td>${r.payment_mode || "-"}</td>
      <td class="font-bold text-success">${money(r.amount)}</td>
      <td><button class="btn btn-danger btn-xs" onclick="deleteLocalDoc('payment_in',${r.id},'payment-in')">Delete</button></td>
    </tr>`).join("") || '<tr><td colspan="6" class="table-empty">No payments received yet.</td></tr>';
  el.innerHTML = `
    <div class="page-header"><div><div class="page-title">Payment-In</div><div class="page-subtitle">Record payments received from customers</div></div></div>
    <div class="grid-2" style="gap:20px;align-items:start">
      <div class="card">
        <div class="form-section-title">Receive Payment</div>
        <form id="payin-form" class="form-grid">
          <div class="form-control full"><label>Select Customer *</label><select name="customer_id" required><option value="">-- Choose --</option>${custOpts}</select></div>
          <div class="form-control"><label>Amount Received (₹) *</label><input name="amount" type="number" step="any" required placeholder="0.00" /></div>
          <div class="form-control"><label>Date</label><input name="date" type="date" value="${new Date().toISOString().split('T')[0]}" /></div>
          <div class="form-control"><label>Payment Mode</label>
            <select name="payment_mode"><option value="CASH">💵 Cash</option><option value="BANK">🏦 Bank Transfer</option><option value="UPI">📱 UPI</option></select>
          </div>
          <div class="form-control full"><label>Description / Receipt No.</label><input name="notes" placeholder="e.g. Advance payment for Order #5" /></div>
          <div class="form-control full"><button class="btn btn-primary btn-block" type="submit">💰 Record Payment-In</button></div>
        </form>
      </div>
      <div class="table-wrap">
        <div class="table-header"><div class="table-title">Payment-In History</div></div>
        <div class="table-scroll"><table><thead><tr><th>Ref</th><th>Customer</th><th>Date</th><th>Mode</th><th>Amount</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>
    </div>`;
  document.getElementById("payin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    fd.customer_name = state.customers.find(c => c.id == fd.customer_id)?.name || "";
    saveLocalDoc("payment_in", fd);
    showToast("Payment-In recorded successfully!", "success");
    await navigateTo("payment-in");
  });
}

function renderPaymentOut() {
  const el = document.getElementById("page-payment-out");
  if (!el) return;
  const vendorOpts = state.customers.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  const bankOpts = state.banks.map(b => `<option value="${b.id}">${b.bank_name}</option>`).join("");
  const records = readLocalList("payment_out");
  const rows = records.map(r => `
    <tr>
      <td class="text-muted">POUT-${r.id}</td>
      <td class="td-name">${r.supplier_name || "-"}</td>
      <td>${fmtDate(r.date)}</td>
      <td>${r.payment_mode || "-"}</td>
      <td class="font-bold text-danger">${money(r.amount)}</td>
      <td><button class="btn btn-danger btn-xs" onclick="deleteLocalDoc('payment_out',${r.id},'payment-out')">Delete</button></td>
    </tr>`).join("") || '<tr><td colspan="6" class="table-empty">No outgoing payments yet.</td></tr>';
  el.innerHTML = `
    <div class="page-header"><div><div class="page-title">Payment-Out</div><div class="page-subtitle">Record payments made to suppliers</div></div></div>
    <div class="grid-2" style="gap:20px;align-items:start">
      <div class="card">
        <div class="form-section-title">Make Payment</div>
        <form id="payout-form" class="form-grid">
          <div class="form-control full"><label>Select Supplier *</label><select name="supplier_id" required><option value="">-- Choose --</option>${vendorOpts}</select></div>
          <div class="form-control"><label>Amount Paid (₹) *</label><input name="amount" type="number" step="any" required placeholder="0.00" /></div>
          <div class="form-control"><label>Date</label><input name="date" type="date" value="${new Date().toISOString().split('T')[0]}" /></div>
          <div class="form-control"><label>Payment Mode</label>
            <select name="payment_mode"><option value="CASH">💵 Cash</option><option value="BANK">🏦 Bank Transfer</option><option value="UPI">📱 UPI</option></select>
          </div>
          <div class="form-control full"><label>Description / Reference</label><input name="notes" placeholder="e.g. Balance payment cleared" /></div>
          <div class="form-control full"><button class="btn btn-primary btn-block" type="submit">💸 Record Payment-Out</button></div>
        </form>
      </div>
      <div class="table-wrap">
        <div class="table-header"><div class="table-title">Payment-Out History</div></div>
        <div class="table-scroll"><table><thead><tr><th>Ref</th><th>Supplier</th><th>Date</th><th>Mode</th><th>Amount</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>
    </div>`;
  document.getElementById("payout-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    fd.supplier_name = state.customers.find(c => c.id == fd.supplier_id)?.name || "";
    saveLocalDoc("payment_out", fd);
    showToast("Payment-Out recorded successfully!", "success");
    await navigateTo("payment-out");
  });
}

function renderSaleReturn() {
  const el = document.getElementById("page-sale-return");
  const custOpts = state.customers.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  const prodOpts = state.products.map(p => `<option value="${p.id}">${p.name} - ${money(p.price)}</option>`).join("");
  const records = readLocalList("sale_returns");
  const rows = records.map(r => `
    <tr>
      <td class="text-muted">SR-${r.id}</td>
      <td class="td-name">${r.customer_name || "-"}</td>
      <td>${fmtDate(r.date)}</td>
      <td>${r.item_name || "-"}</td>
      <td class="font-bold text-danger">${money(r.amount)}</td>
      <td><button class="btn btn-danger btn-xs" onclick="deleteLocalDoc('sale_returns',${r.id},'sale-return')">Delete</button></td>
    </tr>`).join("") || '<tr><td colspan="6" class="table-empty">No sale returns recorded.</td></tr>';
  el.innerHTML = `
    <div class="page-header"><div><div class="page-title">Sales Return / Credit Note</div><div class="page-subtitle">Record returns and adjust customer balances</div></div></div>
    <div class="grid-2" style="gap:20px;align-items:start">
      <div class="card">
        <div class="form-section-title">New Sales Return</div>
        <form id="salereturn-form" class="form-grid">
          <div class="form-control full"><label>Select Customer *</label><select name="customer_id" required><option value="">-- Choose --</option>${custOpts}</select></div>
          <div class="form-control"><label>Date</label><input name="date" type="date" value="${new Date().toISOString().split('T')[0]}" /></div>
          <div class="form-control"><label>Original Invoice #</label><input name="original_invoice" placeholder="INV-001" /></div>
          <div class="form-control"><label>Item Returned *</label><select name="product_id" required><option value="">-- Choose --</option>${prodOpts}</select></div>
          <div class="form-control"><label>Quantity</label><input name="quantity" type="number" value="1" min="1" /></div>
          <div class="form-control"><label>Return Amount (₹) *</label><input name="amount" type="number" step="any" required placeholder="0.00" /></div>
          <div class="form-control full"><label>Reason for Return</label><input name="reason" placeholder="e.g. Defective product" /></div>
          <div class="form-control full"><button class="btn btn-warning btn-block" type="submit">↩️ Save Sales Return</button></div>
        </form>
      </div>
      <div class="table-wrap">
        <div class="table-header"><div class="table-title">Sales Return History</div></div>
        <div class="table-scroll"><table><thead><tr><th>Ref</th><th>Customer</th><th>Date</th><th>Item</th><th>Amount</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>
    </div>`;
  document.getElementById("salereturn-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    fd.customer_name = state.customers.find(c => c.id == fd.customer_id)?.name || "";
    fd.item_name = state.products.find(p => p.id == fd.product_id)?.name || "";
    saveLocalDoc("sale_returns", fd);
    showToast("Sales Return recorded successfully!", "success");
    await navigateTo("sale-return");
  });
}

function renderChallan() {
  const el = document.getElementById("page-challan");
  if (!el) return;
  const custOpts = state.customers.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  const prodOpts = state.products.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
  const records = readLocalList("challans");
  const rows = records.map(r => `
    <tr>
      <td class="text-muted">DC-${r.id}</td>
      <td class="td-name">${r.customer_name || "-"}</td>
      <td>${fmtDate(r.date)}</td>
      <td>${r.item_name || "-"}</td>
      <td>${r.quantity || "-"}</td>
      <td><span class="badge badge-info">${r.status || "IN TRANSIT"}</span></td>
      <td><button class="btn btn-danger btn-xs" onclick="deleteLocalDoc('challans',${r.id},'challan')">Delete</button></td>
    </tr>`).join("") || '<tr><td colspan="7" class="table-empty">No delivery challans created.</td></tr>';
  el.innerHTML = `
    <div class="page-header"><div><div class="page-title">Delivery Challan</div><div class="page-subtitle">Document goods dispatched to customers without invoice</div></div></div>
    <div class="grid-2" style="gap:20px;align-items:start">
      <div class="card">
        <div class="form-section-title">New Delivery Challan</div>
        <form id="challan-form" class="form-grid">
          <div class="form-control full"><label>Select Party *</label><select name="customer_id" required><option value="">-- Choose --</option>${custOpts}</select></div>
          <div class="form-control"><label>Date</label><input name="date" type="date" value="${new Date().toISOString().split('T')[0]}" /></div>
          <div class="form-control"><label>Vehicle / Transport</label><input name="vehicle" placeholder="e.g. MH-12-AB-1234" /></div>
          <div class="form-control"><label>Item *</label><select name="product_id" required><option value="">-- Choose --</option>${prodOpts}</select></div>
          <div class="form-control"><label>Quantity *</label><input name="quantity" type="number" min="1" value="1" required /></div>
          <div class="form-control full"><label>Notes</label><input name="notes" placeholder="Delivery instructions..." /></div>
          <div class="form-control full"><button class="btn btn-primary btn-block" type="submit">🚚 Save Delivery Challan</button></div>
        </form>
      </div>
      <div class="table-wrap">
        <div class="table-header"><div class="table-title">Challan History</div></div>
        <div class="table-scroll"><table><thead><tr><th>Ref</th><th>Party</th><th>Date</th><th>Item</th><th>Qty</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>
    </div>`;
  document.getElementById("challan-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    fd.customer_name = state.customers.find(c => c.id == fd.customer_id)?.name || "";
    fd.item_name = state.products.find(p => p.id == fd.product_id)?.name || "";
    fd.status = "IN TRANSIT";
    saveLocalDoc("challans", fd);
    showToast("Delivery Challan saved successfully!", "success");
    await navigateTo("challan");
  });
}

function renderSaleOrder() {
  const el = document.getElementById("page-sale-order");
  if (!el) return;
  const custOpts = state.customers.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  const records = readLocalList("sale_orders");
  const rows = records.map(r => `
    <tr>
      <td class="text-muted">SO-${r.id}</td>
      <td class="td-name">${r.customer_name || "-"}</td>
      <td>${fmtDate(r.date)}</td>
      <td class="font-bold">${money(r.total)}</td>
      <td><span class="badge badge-warning">${r.status || "PENDING"}</span></td>
      <td><button class="btn btn-danger btn-xs" onclick="deleteLocalDoc('sale_orders',${r.id},'sale-order')">Delete</button></td>
    </tr>`).join("") || '<tr><td colspan="6" class="table-empty">No sale orders yet.</td></tr>';
  el.innerHTML = `
    <div class="page-header"><div><div class="page-title">Sale Order</div><div class="page-subtitle">Confirm customer orders before creating invoices</div></div></div>
    <div class="grid-2" style="gap:20px;align-items:start">
      <div class="card">
        <div class="form-section-title">Create Sale Order</div>
        <form id="saleorder-form" class="form-grid">
          <div class="form-control full"><label>Select Customer *</label><select name="customer_id" required><option value="">-- Choose --</option>${custOpts}</select></div>
          <div class="form-control"><label>Date</label><input name="date" type="date" value="${new Date().toISOString().split('T')[0]}" /></div>
          <div class="form-control"><label>Expected Delivery</label><input name="delivery_date" type="date" /></div>
          <div class="form-control"><label>Item Description *</label><input name="description" required placeholder="e.g. 50 pcs Widget A" /></div>
          <div class="form-control"><label>Order Amount (₹) *</label><input name="total" type="number" step="any" required placeholder="0.00" /></div>
          <div class="form-control full"><label>Notes</label><textarea name="notes" placeholder="Special instructions..."></textarea></div>
          <div class="form-control full"><button class="btn btn-primary btn-block" type="submit">📋 Save Sale Order</button></div>
        </form>
      </div>
      <div class="table-wrap">
        <div class="table-header"><div class="table-title">Sale Order History</div></div>
        <div class="table-scroll"><table><thead><tr><th>Ref</th><th>Customer</th><th>Date</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>
    </div>`;
  document.getElementById("saleorder-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    fd.customer_name = state.customers.find(c => c.id == fd.customer_id)?.name || "";
    fd.status = "PENDING";
    saveLocalDoc("sale_orders", fd);
    showToast("Sale Order saved successfully!", "success");
    await navigateTo("sale-order");
  });
}

function renderPurchaseOrder() {
  const el = document.getElementById("page-purchase-order");
  if (!el) return;
  const vendorOpts = state.customers.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  const records = readLocalList("purchase_orders");
  const rows = records.map(r => `
    <tr>
      <td class="text-muted">PO-${r.id}</td>
      <td class="td-name">${r.supplier_name || "-"}</td>
      <td>${fmtDate(r.date)}</td>
      <td class="font-bold">${money(r.total)}</td>
      <td><span class="badge badge-warning">${r.status || "PENDING"}</span></td>
      <td><button class="btn btn-danger btn-xs" onclick="deleteLocalDoc('purchase_orders',${r.id},'purchase-order')">Delete</button></td>
    </tr>`).join("") || '<tr><td colspan="6" class="table-empty">No purchase orders yet.</td></tr>';
  el.innerHTML = `
    <div class="page-header"><div><div class="page-title">Purchase Order</div><div class="page-subtitle">Create orders to send to your suppliers</div></div></div>
    <div class="grid-2" style="gap:20px;align-items:start">
      <div class="card">
        <div class="form-section-title">Create Purchase Order</div>
        <form id="purchaseorder-form" class="form-grid">
          <div class="form-control full"><label>Select Supplier *</label><select name="supplier_id" required><option value="">-- Choose --</option>${vendorOpts}</select></div>
          <div class="form-control"><label>Date</label><input name="date" type="date" value="${new Date().toISOString().split('T')[0]}" /></div>
          <div class="form-control"><label>Expected Arrival</label><input name="arrival_date" type="date" /></div>
          <div class="form-control"><label>Item Description *</label><input name="description" required placeholder="e.g. 100 units Raw Material" /></div>
          <div class="form-control"><label>Order Amount (₹) *</label><input name="total" type="number" step="any" required placeholder="0.00" /></div>
          <div class="form-control full"><label>Notes</label><textarea name="notes" placeholder="Special instructions..."></textarea></div>
          <div class="form-control full"><button class="btn btn-warning btn-block" type="submit">📋 Save Purchase Order</button></div>
        </form>
      </div>
      <div class="table-wrap">
        <div class="table-header"><div class="table-title">Purchase Order History</div></div>
        <div class="table-scroll"><table><thead><tr><th>Ref</th><th>Supplier</th><th>Date</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>
    </div>`;
  document.getElementById("purchaseorder-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    fd.supplier_name = state.customers.find(c => c.id == fd.supplier_id)?.name || "";
    fd.status = "PENDING";
    saveLocalDoc("purchase_orders", fd);
    showToast("Purchase Order saved successfully!", "success");
    await navigateTo("purchase-order");
  });
}

function renderSaleReturn() {
  const el = document.getElementById("page-sale-return");
  const custOpts = state.customers.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  const prodOpts = state.products.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
  const records = readLocalList("sale_returns");
  const rows = records.map(r => `
    <tr>
      <td class="text-muted">SR-${r.id}</td>
      <td class="td-name">${r.customer_name || "-"}</td>
      <td>${fmtDate(r.date)}</td>
      <td>${r.item_name || "-"}</td>
      <td class="font-bold text-danger">${money(r.amount)}</td>
      <td><button class="btn btn-danger btn-xs" onclick="deleteLocalDoc('sale_returns',${r.id},'sale-return')">Delete</button></td>
    </tr>`).join("") || '<tr><td colspan="6" class="table-empty">No sales returns recorded.</td></tr>';
  el.innerHTML = `
    <div class="page-header"><div><div class="page-title">Sales Return / Credit Note</div><div class="page-subtitle">Record returns from customers and adjust balances</div></div></div>
    <div class="grid-2" style="gap:20px;align-items:start">
      <div class="card">
        <div class="form-section-title">New Sales Return</div>
        <form id="salereturn-form" class="form-grid">
          <div class="form-control full"><label>Select Customer *</label><select name="customer_id" required><option value="">-- Choose --</option>${custOpts}</select></div>
          <div class="form-control"><label>Date</label><input name="date" type="date" value="${new Date().toISOString().split('T')[0]}" /></div>
          <div class="form-control"><label>Original Invoice Ref</label><input name="original_ref" placeholder="INV-001" /></div>
          <div class="form-control"><label>Item Returned *</label><select name="product_id" required><option value="">-- Choose --</option>${prodOpts}</select></div>
          <div class="form-control"><label>Quantity</label><input name="quantity" type="number" value="1" min="1" /></div>
          <div class="form-control"><label>Return Amount (₹) *</label><input name="amount" type="number" step="any" required placeholder="0.00" /></div>
          <div class="form-control full"><label>Reason</label><input name="reason" placeholder="e.g. Defective item" /></div>
          <div class="form-control full"><button class="btn btn-danger btn-block" type="submit">↩️ Save Sales Return</button></div>
        </form>
      </div>
      <div class="table-wrap">
        <div class="table-header"><div class="table-title">Sales Return History</div></div>
        <div class="table-scroll"><table><thead><tr><th>Ref</th><th>Customer</th><th>Date</th><th>Item</th><th>Amount</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>
    </div>`;
  document.getElementById("salereturn-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    fd.customer_name = state.customers.find(c => c.id == fd.customer_id)?.name || "";
    fd.item_name = state.products.find(p => p.id == fd.product_id)?.name || "";
    saveLocalDoc("sale_returns", fd);
    showToast("Sales Return recorded successfully!", "success");
    await navigateTo("sale-return");
  });
}


/* ========== END OF PAGE RENDERERS ========== */

function renderPurchaseReturn() {
  const el = document.getElementById("page-purchase-return");
  const vendorOpts = state.customers.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  const prodOpts = state.products.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
  const records = readLocalList("purchase_returns");
  const rows = records.map(r => `
    <tr>
      <td class="text-muted">PR-${r.id}</td>
      <td class="td-name">${r.supplier_name || "-"}</td>
      <td>${fmtDate(r.date)}</td>
      <td>${r.item_name || "-"}</td>
      <td class="font-bold text-success">${money(r.amount)}</td>
      <td><button class="btn btn-danger btn-xs" onclick="deleteLocalDoc('purchase_returns',${r.id},'purchase-return')">Delete</button></td>
    </tr>`).join("") || '<tr><td colspan="6" class="table-empty">No purchase returns recorded.</td></tr>';
  el.innerHTML = `
    <div class="page-header"><div><div class="page-title">Purchase Return / Debit Note</div><div class="page-subtitle">Record returns to suppliers and adjust balances</div></div></div>
    <div class="grid-2" style="gap:20px;align-items:start">
      <div class="card">
        <div class="form-section-title">New Purchase Return</div>
        <form id="purchasereturn-form" class="form-grid">
          <div class="form-control full"><label>Select Supplier *</label><select name="supplier_id" required><option value="">-- Choose --</option>${vendorOpts}</select></div>
          <div class="form-control"><label>Date</label><input name="date" type="date" value="${new Date().toISOString().split('T')[0]}" /></div>
          <div class="form-control"><label>Original Purchase Ref</label><input name="original_ref" placeholder="PUR-001" /></div>
          <div class="form-control"><label>Item Returned *</label><select name="product_id" required><option value="">-- Choose --</option>${prodOpts}</select></div>
          <div class="form-control"><label>Quantity</label><input name="quantity" type="number" value="1" min="1" /></div>
          <div class="form-control"><label>Return Amount (₹) *</label><input name="amount" type="number" step="any" required placeholder="0.00" /></div>
          <div class="form-control full"><label>Reason</label><input name="reason" placeholder="e.g. Wrong specifications" /></div>
          <div class="form-control full"><button class="btn btn-warning btn-block" type="submit">↩️ Save Purchase Return</button></div>
        </form>
      </div>
      <div class="table-wrap">
        <div class="table-header"><div class="table-title">Purchase Return History</div></div>
        <div class="table-scroll"><table><thead><tr><th>Ref</th><th>Supplier</th><th>Date</th><th>Item</th><th>Amount</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>
    </div>`;
  document.getElementById("purchasereturn-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    fd.supplier_name = state.customers.find(c => c.id == fd.supplier_id)?.name || "";
    fd.item_name = state.products.find(p => p.id == fd.product_id)?.name || "";
    saveLocalDoc("purchase_returns", fd);
    showToast("Purchase Return recorded successfully!", "success");
    await navigateTo("purchase-return");
  });
}

/* ========== LOCAL DOCUMENT STORAGE (for modules without dedicated server APIs) ========== */
function readLocalList(key) {
  try { return JSON.parse(localStorage.getItem("sbd_" + key) || "[]"); }
  catch { return []; }
}

function saveLocalDoc(key, doc) {
  const list = readLocalList(key);
  doc.id = list.length ? Math.max(...list.map(i => Number(i.id || 0))) + 1 : 1;
  doc.createdAt = new Date().toISOString();
  list.push(doc);
  localStorage.setItem("sbd_" + key, JSON.stringify(list));
}

async function deleteLocalDoc(key, id, page) {
  confirmDelete("Are you sure you want to delete this record?", async () => {
    let list = readLocalList(key);
    list = list.filter(x => x.id !== id);
    localStorage.setItem("sbd_" + key, JSON.stringify(list));
    showToast("Record deleted successfully", "success");
    await navigateTo(page);
  });
}



(async function init() {
  // Bind global navigation listeners
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-page]");
    if (btn) {
      e.preventDefault();
      navigateTo(btn.dataset.page);
    }
  });

  try {
    startHeaderClock();
    await navigateTo("dashboard");
    updateHeaderInfo();
  } catch (err) {
    console.error("Init failed:", err);
    showToast("Application init error: " + err.message, "error");
  }
})();

/* ========== QUICK SHORTCUTS ENGINE ========== */
function toggleShortcutsModal() {
  const m = document.getElementById("shortcuts-modal");
  if (!m) return;
  m.style.display = (m.style.display === "none") ? "flex" : "none";
}

function closeShortcutsModal(e) {
  if (e && e.target && e.target.id !== "shortcuts-modal" && !e.target.closest('.modal-box')) return;
  const m = document.getElementById("shortcuts-modal");
  if (m) m.style.display = "none";
}

window.addEventListener("keydown", (e) => {
  const activePage = document.querySelector(".page.active")?.id || "";

  // Ctrl + Enter: Toggle Shortcuts Menu
  if (e.ctrlKey && e.key === "Enter") {
    e.preventDefault();
    toggleShortcutsModal();
  }

  if (activePage === "page-sales") {
    if (e.key === "F9") {
      e.preventDefault();
      submitInvoice();
    }
  }


  // Alt + Keys: Global Navigation
  if (e.altKey && !e.ctrlKey) {
    const k = e.key.toLowerCase();
    const maps = {
      s: "sales", i: "payment-in", r: "sale-return", f: "sale-order",
      m: "estimate", k: "invoices", d: "challan", p: "purchase",
      o: "payment-out", l: "purchase-return", g: "purchase-order",
      e: "expenses", j: "customers", t: "products", h: "dashboard"
    };
    if (maps[k]) {
      e.preventDefault();
      const modal = document.getElementById("shortcuts-modal");
      if (modal) modal.style.display = "none";
      navigateTo(maps[k]);
    }
  }

  // Escape to close all modals
  if (e.key === "Escape") {
    const modal = document.getElementById("shortcuts-modal");
    if (modal) modal.style.display = "none";
    if (typeof closePrintModal === "function") closePrintModal();
    if (typeof closeConfirmModal === "function") closeConfirmModal();
  }
});

/* ========== EXPIRING SOON SYSTEM ========== */
function showExpiringSoonModal() {
  const now = new Date();
  const sixtyDaysFromNow = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  let expiringRows = [];
  
  state.products.forEach(p => {
    if (p.batches && p.batches.length > 0) {
       p.batches.forEach(b => {
         if (b.remaining > 0) {
           const expDate = new Date(b.expiry_date);
           if (expDate <= sixtyDaysFromNow) {
             expiringRows.push({
               productName: p.name,
               batchId: b.id,
               remaining: b.remaining,
               expiryDate: b.expiry_date,
               unit: p.unit || 'Pcs'
             });
           }
         }
       });
    }
  });
  
  expiringRows.sort((a,b) => new Date(a.expiryDate) - new Date(b.expiryDate));
  
  const tbody = document.getElementById('expiring-table-body');
  tbody.innerHTML = expiringRows.length > 0 ? expiringRows.map(r => `
    <tr style="border-bottom: 1px solid var(--border);">
      <td style="padding: 14px 20px; font-weight: 700; color: var(--text-primary);">${r.productName}</td>
      <td style="padding: 14px 20px; text-align: center; color: var(--text-secondary); font-family: monospace;">...${String(r.batchId).slice(-4)}</td>
      <td style="padding: 14px 20px; text-align: right; font-weight: 700;">${r.remaining} <span style="font-size:11px; font-weight:normal; color:var(--text-muted);">${r.unit}</span></td>
      <td style="padding: 14px 20px; text-align: right; color: var(--danger); font-weight: 700;">${fmtDate(r.expiryDate)}</td>
    </tr>`).join('') : '<tr><td colspan="4" style="padding: 24px; text-align:center; color: var(--text-muted);">No batches expiring soon.</td></tr>';
  
  document.getElementById('expiring-modal').style.display = 'flex';
}

function closeExpiringModal() {
  document.getElementById('expiring-modal').style.display = 'none';
}

function startHeaderClock() {
  const update = () => {
    const now = new Date();
    const dateEl = document.getElementById("header-date");
    const timeEl = document.getElementById("header-time");
    if (dateEl) dateEl.textContent = now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    if (timeEl) timeEl.textContent = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
  };
  update();
  setInterval(update, 1000);
}

function updateHeaderInfo() {
  const nameEl = document.getElementById("header-business-name");
  if (nameEl) {
  nameEl.textContent = state.settings?.business_name || "LEDGERGO";
  }
}
