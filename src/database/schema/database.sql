-- Création des tables et des relations
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subcategories (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    reference TEXT NOT NULL UNIQUE,
    designation TEXT NOT NULL,
    description TEXT,
    category_id TEXT,
    subcategory_id TEXT,
    barcode TEXT UNIQUE,
    image_path TEXT,
    purchase_price REAL NOT NULL DEFAULT 0.0,
    selling_price REAL NOT NULL DEFAULT 0.0,
    wholesale_price REAL NOT NULL DEFAULT 0.0,
    min_stock INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL,
    FOREIGN KEY (subcategory_id) REFERENCES subcategories (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    type TEXT NOT NULL, -- IN, OUT, INVENTORY
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reference_doc TEXT,
    supplier_id TEXT,
    user_id TEXT NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    ice TEXT,
    payment_conditions TEXT,
    credit_limit REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    ice TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Table pour la gestion directe des crédits/dettes (نسيئة) sans facture
CREATE TABLE IF NOT EXISTS client_credits (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    type TEXT NOT NULL,            -- 'CREDIT' (dette) ou 'PAYMENT' (paiement reçu)
    amount REAL NOT NULL,
    description TEXT,
    date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
);


CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL, -- QUOTE, DELIVERY_NOTE, INVOICE, CREDIT_NOTE
    document_number TEXT NOT NULL UNIQUE,
    entity_id TEXT NOT NULL, -- Customer ID ou Supplier ID
    date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    due_date DATETIME,
    total_excl_tax REAL NOT NULL DEFAULT 0.0,
    total_incl_tax REAL NOT NULL DEFAULT 0.0,
    status TEXT NOT NULL DEFAULT 'UNPAID', -- PAID, UNPAID, PARTIAL
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document_items (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    discount REAL DEFAULT 0.0,
    total REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL, -- CASH, CHECK, TRANSFER
    date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reference TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Étape 4 : Création des index pour garantir des performances ultra-rapides (< 100ms)

-- Index pour la recherche des produits
CREATE INDEX IF NOT EXISTS idx_products_reference ON products (reference);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode);
CREATE INDEX IF NOT EXISTS idx_products_designation ON products (designation);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_subcategory ON products (subcategory_id);

-- Index pour les mouvements de stock
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements (product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_date ON stock_movements (date);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements (type);

-- Index pour les documents et lignes de documents
CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents (entity_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents (status);
CREATE INDEX IF NOT EXISTS idx_documents_date ON documents (date);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents (type);
CREATE INDEX IF NOT EXISTS idx_document_items_document ON document_items (document_id);
CREATE INDEX IF NOT EXISTS idx_document_items_product ON document_items (product_id);

-- Index pour les paiements
CREATE INDEX IF NOT EXISTS idx_payments_document ON payments (document_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments (date);

-- Index pour l'audit
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_date ON audit_logs (created_at);

-- Index pour les clients et crédits
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (name);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone);
CREATE INDEX IF NOT EXISTS idx_client_credits_customer ON client_credits (customer_id);
CREATE INDEX IF NOT EXISTS idx_client_credits_date ON client_credits (date);
CREATE INDEX IF NOT EXISTS idx_client_credits_type ON client_credits (type);
