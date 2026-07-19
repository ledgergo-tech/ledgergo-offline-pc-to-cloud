-- Ledgergo Supabase Database Schema
-- Run this in your Supabase SQL Editor

-- 1. Create tables for your offline-to-cloud app

CREATE TABLE customers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  name text NOT NULL,
  mobile text,
  address text,
  city text,
  gstin text,
  type text DEFAULT 'customer',
  balance numeric DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE products (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  name text NOT NULL,
  sku text,
  item_code text,
  barcode text,
  price numeric DEFAULT 0,
  stock numeric DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE invoices (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  invoice_number text NOT NULL,
  customer_name text,
  customer_mobile text,
  reference_no text,
  invoice_date timestamp with time zone DEFAULT now(),
  items jsonb DEFAULT '[]'::jsonb,
  total_amount numeric DEFAULT 0,
  status text DEFAULT 'Unpaid',
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE purchases (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  supplier_name text,
  invoice_number text,
  total_amount numeric DEFAULT 0,
  items jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE expenses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  category text,
  amount numeric DEFAULT 0,
  description text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) UNIQUE NOT NULL,
  business_name text NOT NULL,
  phone text,
  gstin text,
  currency text DEFAULT '₹',
  created_at timestamp with time zone DEFAULT now()
);

-- Note: In a production environment, you should also enable Row Level Security (RLS)
-- so that users can only see their own data.

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own customers" ON customers FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own products" ON products FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own invoices" ON invoices FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own purchases" ON purchases FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own expenses" ON expenses FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own settings" ON settings FOR ALL USING (auth.uid() = user_id);
