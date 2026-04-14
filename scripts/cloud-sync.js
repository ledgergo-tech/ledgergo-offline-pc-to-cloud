const fs = require('fs');
const path = require('path');
const { supabase } = require('./supabase');

async function syncAll() {
  const dataDir = path.join(__dirname, 'Ledgergo Offline PC', 'data');
  const files = [
    'settings.json', 'customers.json', 'products.json', 'banks.json',
    'invoices.json', 'purchases.json', 'expenses.json'
  ];

  console.log('🚀 Starting One-Time Cloud Sync...');

  for (const file of files) {
    const table = file.replace('.json', '');
    const filePath = path.join(dataDir, file);
    
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️ Skip: ${file} (not found)`);
      continue;
    }

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      console.log(`📡 Syncing ${table} (${Array.isArray(data) ? data.length : 1} records)...`);
      
      const { error } = await supabase.from(table).upsert(data);
      if (error) {
        console.error(`❌ Error syncing ${table}:`, error.message);
      } else {
        console.log(`✅ ${table} synced successfully!`);
      }
    } catch (e) {
      console.error(`❌ Failed to read or parse ${file}:`, e.message);
    }
  }

  console.log('🏁 Cloud Sync Complete!');
  process.exit(0);
}

syncAll();
