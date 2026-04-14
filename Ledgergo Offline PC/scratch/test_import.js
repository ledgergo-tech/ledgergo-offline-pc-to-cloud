const normalizeImportHeader = (value) => {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
};

function detectImportDelimiter(line) {
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  if (line.includes("|")) return "|";
  if (line.includes(",")) return ",";
  return ","; // Default as fallback for single column
}

function parseDelimitedRows(text) {
  const lines = String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const delimiter = detectImportDelimiter(lines[0]);
  const headers = lines[0].split(delimiter).map(normalizeImportHeader);
  
  if (headers.length === 1 && !lines[0].includes(delimiter) && lines.some(l => l.includes(":"))) {
    const rows = [];
    let current = {};
    lines.forEach(line => {
      const match = line.match(/^([^:]+):\s*(.+)$/);
      if (!match) return;
      const key = normalizeImportHeader(match[1]);
      if (current[key]) { rows.push(current); current = {}; }
      current[key] = match[2].trim();
    });
    if (Object.keys(current).length) rows.push(current);
    if (rows.length) return rows;
  }

  return lines.slice(1).map(line => {
    const cells = line.split(delimiter).map(cell => cell.trim());
    return headers.reduce((row, header, index) => {
      row[header || `column_${index + 1}`] = cells[index] || "";
      return row;
    }, {});
  }).filter(row => Object.values(row).some(Boolean));
}

function getInventoryImportScore(row) {
  let score = 0;
  if (row.item_code || row.code || row.product_code || row.barcode || row.sku || row.item_id) score += 3;
  if (row.stock || row.qty || row.quantity || row.opening_stock || row.available) score += 3;
  if (row.price || row.sale_price || row.purchase_price || row.cost || row.mrp || row.rate || row.unit_price) score += 3;
  if (row.hsn_code || row.hsn || row.category || row.group || row.unit || row.uom || row.tax || row.gst) score += 2;
  if (row.name || row.product_name || row.item_name || row.product || row.item) score += 2;
  return score;
}

function getPartyImportScore(row) {
  let score = 0;
  if (row.balance || row.due_amount || row.opening_balance || row.amount || row.due || row.customer_balance) score += 4;
  if (row.mobile || row.phone || row.contact || row.mobile_number || row.phone_number) score += 3;
  if (row.gstin || row.gst || row.address || row.city || row.email || row.pan || row.pincode) score += 2;
  if (row.name || row.party_name || row.customer_name || row.party || row.party_type || row.balance_type || row.due_type) score += 2;
  return score;
}


// Test case 1: Single column CSV
const csv1 = "Name\nItem 1\nItem 2";
console.log("Test 1 (Single column):", parseDelimitedRows(csv1));

// Test 2: Standard CSV
const csv2 = "Name, Stock, Price\nApple, 10, 50";
const rows2 = parseDelimitedRows(csv2);
const normalizedRows2 = rows2.map(row =>
    Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [normalizeImportHeader(key), value]))
);
console.log("Test 2 (Standard):", normalizedRows2);
console.log("Test 2 Score (Inv):", getInventoryImportScore(normalizedRows2[0]));
console.log("Test 2 Score (Party):", getPartyImportScore(normalizedRows2[0]));

// Test 3: Party CSV
const csv3 = "Customer Name, Mobile, Balance\nJohn Doe, 1234567890, 500";
const rows3 = parseDelimitedRows(csv3);
const normalizedRows3 = rows3.map(row =>
    Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [normalizeImportHeader(key), value]))
);
console.log("Test 3 (Party):", normalizedRows3);
console.log("Test 3 Score (Inv):", getInventoryImportScore(normalizedRows3[0]));
console.log("Test 3 Score (Party):", getPartyImportScore(normalizedRows3[0]));
