// Supabase configuration
const SUPABASE_URL = 'https://grdpgphdoxngjygentdk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyZHBncGhkb3huZ2p5Z2VudGRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzODE0MjksImV4cCI6MjA5OTk1NzQyOX0.8_6naC041KpupOxH59BkDY6n4Xne7dAmH4IAf15kUSc'; 

// Initialize Supabase Client
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// DOM Elements
const statusBadge = document.getElementById('connection-status');
const tableBody = document.getElementById('table-body');

// Check Connection and Fetch Data
async function init() {
    try {
        // We will try to fetch from a table named 'transactions'. 
        // If this table doesn't exist, it will throw an error, which is fine! 
        // We can then ask the user what the actual table name is.
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .limit(5);
            
        if (error) {
            if (error.code === '42P01') {
                // Table doesn't exist
                statusBadge.textContent = 'Table "transactions" not found';
                statusBadge.className = 'status-badge error';
                tableBody.innerHTML = `<tr><td colspan="5" class="loading-state" style="color: #ef4444;">
                    Connection successful, but the table "transactions" does not exist in your Supabase database. <br>
                    Please create it or tell the AI the correct table name!
                </td></tr>`;
            } else {
                throw error;
            }
            return;
        }

        // Connection successful
        statusBadge.textContent = 'Connected to Supabase';
        statusBadge.className = 'status-badge connected';

        // Render Data
        if (data && data.length > 0) {
            tableBody.innerHTML = '';
            data.forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${item.created_at ? new Date(item.created_at).toLocaleDateString() : 'N/A'}</td>
                    <td>${item.description || item.name || 'No description'}</td>
                    <td>${item.category || item.type || '-'}</td>
                    <td style="font-weight: 500;">$${item.amount || '0.00'}</td>
                    <td><span class="status-badge connected">Completed</span></td>
                `;
                tableBody.appendChild(tr);
            });
        } else {
            tableBody.innerHTML = `<tr><td colspan="5" class="loading-state">
                Table is empty. No transactions found.
            </td></tr>`;
        }

    } catch (err) {
        console.error('Supabase connection error:', err);
        statusBadge.textContent = 'Connection Error';
        statusBadge.className = 'status-badge error';
        tableBody.innerHTML = `<tr><td colspan="5" class="loading-state" style="color: #ef4444;">
            Failed to connect to Supabase. Check your API key or network.
        </td></tr>`;
    }
}

// Run on load
document.addEventListener('DOMContentLoaded', init);
