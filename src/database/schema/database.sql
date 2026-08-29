-- Création des tables et des relations
PRAGMA foreign_keys = ON;

-- NOTE: La table users a été supprimée. StockLocal est une application single-user.
-- L'audit trail fonctionne sans compte utilisateur.

-- ──────────────────────────────────────────────────────────────────────────────
-- Architecture cible : schéma unique consolidé.
--  - FK historiques en ON DELETE RESTRICT (jamais de cascade destructrice)
--  - colonnes `status` sur customers / suppliers pour l'archivage
--  - Précision REAL conservée (documenté ARCHITECTURE_AUDIT.md §15.1)
-- ──────────────────────────────────────────────────────────────────────────────

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
    FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT
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
    unit TEXT NOT NULL DEFAULT 'PIÈCE',
    purchase_price REAL NOT NULL DEFAULT 0.0,
    selling_price REAL NOT NULL DEFAULT 0.0,
    wholesale_price REAL NOT NULL DEFAULT 0.0,
    min_stock INTEGER NOT NULL DEFAULT 0,
    max_stock INTEGER NOT NULL DEFAULT 0,
    vat_rate REAL NOT NULL DEFAULT 20.0,
    location TEXT,
    brand TEXT,
    supplier_id TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL,
    FOREIGN KEY (subcategory_id) REFERENCES subcategories (id) ON DELETE SET NULL
);

-- Mouvements de stock :
--   type          → IN (entrée) / OUT (sortie) — ancien format conservé pour compatibilité
--   movement_type → type métier explicite et auditable :
--                   PURCHASE_IN, SALE_OUT, RETURN_IN, RETURN_OUT,
--                   ADJUSTMENT_IN, ADJUSTMENT_OUT, TRANSFER_IN, TRANSFER_OUT,
--                   DAMAGE_OUT, LOSS_OUT, OPENING_BALANCE
CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    type TEXT NOT NULL,
    movement_type TEXT NOT NULL DEFAULT 'ADJUSTMENT_IN', -- type métier explicite (cf. StockLedgerService)
    quantity REAL NOT NULL CHECK (quantity > 0),
    unit_price REAL NOT NULL DEFAULT 0,
    date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reference_doc TEXT,
    document_id TEXT, -- lien vers le document source (facture, avoir, commande, session inventaire)
    supplier_id TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
);

-- ══════════════════════════════════════════════════════════════════════════════
-- Solde de stock précalculé par produit (§14).
--
-- Évite de rescanner tout l'historique de stock_movements à chaque lecture :
--   - quantity        → stock physique actuel (= SUM(sign × qty))
--   - total_in_qty    → cumul des quantités ENTRÉE (base du CMUP)
--   - total_in_value  → cumul des valeurs ENTRÉE (base du CMUP)
--   - average_cost    → coût moyen pondéré = total_in_value / total_in_qty
--                        (logique comptable CMUP conservée à l'identique)
--
-- Cette table est maintenue TRANSACTIONNELLEMENT par StockLedgerService :
-- chaque mouvement met à jour le solde dans la même transaction SQLite.
-- UNIQUE(product_id) est garanti par PRIMARY KEY.
CREATE TABLE IF NOT EXISTS inventory_balances (
    product_id TEXT PRIMARY KEY,
    quantity REAL NOT NULL DEFAULT 0,
    total_in_qty REAL NOT NULL DEFAULT 0,
    total_in_value REAL NOT NULL DEFAULT 0,
    average_cost REAL NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
);

-- ══════════════════════════════════════════════════════════════════════════════
-- Séquences de numérotation des documents (§20).
--
-- Remplace le fragile `COUNT(*) + 1` : la génération est transactionnelle et
-- atomique (INSERT ... ON CONFLICT DO UPDATE) — aucun chevauchement après
-- rollback, suppression ou import. Format des numéros CONSERVÉ :
--   prefixe type (FAC/BL/DEV/AV/PA) - année - numéro à 5 chiffres.
CREATE TABLE IF NOT EXISTS document_sequences (
    type TEXT NOT NULL,
    year INTEGER NOT NULL,
    last_number INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (type, year)
);

CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    ice TEXT,
    payment_conditions TEXT,
    credit_limit REAL DEFAULT 0.0,
    category TEXT NOT NULL DEFAULT 'DÉTAIL',
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE / ARCHIVED
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    ice TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE / ARCHIVED
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Crédits/dettes clients (نسيئة)
CREATE TABLE IF NOT EXISTS client_credits (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    type TEXT NOT NULL,            -- 'CREDIT' (dette) ou 'PAYMENT' (paiement reçu)
    amount REAL NOT NULL,
    description TEXT,
    date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS supplier_credits (
    id TEXT PRIMARY KEY,
    supplier_id TEXT NOT NULL,
    type TEXT NOT NULL,            -- 'DEBT' (on doit de l'argent) ou 'PAYMENT' (on a payé)
    amount REAL NOT NULL,
    description TEXT,
    date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL, -- QUOTE, DELIVERY_NOTE, INVOICE, CREDIT_NOTE
    document_number TEXT NOT NULL UNIQUE,
    entity_id TEXT NOT NULL, -- Customer ID
    original_document_id TEXT, -- lien avoir → facture d'origine (null pour les autres types)
    date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    due_date DATETIME,
    total_excl_tax REAL NOT NULL DEFAULT 0.0,
    total_tax REAL NOT NULL DEFAULT 0.0,     -- TVA totale (montant)
    total_incl_tax REAL NOT NULL DEFAULT 0.0,
    discount_amount REAL NOT NULL DEFAULT 0.0, -- Remise globale appliquée
    status TEXT NOT NULL DEFAULT 'UNPAID', -- PAID, UNPAID, PARTIAL, CANCELLED
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Retours liés à une facture (anti double retour / sur-retour)
CREATE TABLE IF NOT EXISTS credit_note_refs (
    id TEXT PRIMARY KEY,
    credit_note_id TEXT NOT NULL,            -- l'avoir
    original_document_id TEXT NOT NULL,      -- la facture d'origine
    product_id TEXT NOT NULL,
    quantity REAL NOT NULL CHECK (quantity > 0),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (credit_note_id) REFERENCES documents (id) ON DELETE CASCADE,
    FOREIGN KEY (original_document_id) REFERENCES documents (id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_credit_note_refs_original ON credit_note_refs (original_document_id);
CREATE INDEX IF NOT EXISTS idx_credit_note_refs_credit ON credit_note_refs (credit_note_id);

CREATE TABLE IF NOT EXISTS document_items (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity REAL NOT NULL CHECK (quantity > 0),
    unit_price REAL NOT NULL,
    discount REAL DEFAULT 0.0,
    total REAL NOT NULL,
    vat_rate REAL NOT NULL DEFAULT 0.0,   -- Taux TVA figé au moment de la vente
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
    FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE RESTRICT
);

-- Audit trail (sans user_id, single-user actuel)
-- §11 : old_value / new_value JSON pour tracer les modifications avant/après
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    details TEXT,
    old_value TEXT,
    new_value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Paramètres de l'entreprise
CREATE TABLE IF NOT EXISTS company_settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Remises par volume (tarification)
CREATE TABLE IF NOT EXISTS volume_discounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    min_qty REAL NOT NULL DEFAULT 1,
    max_qty REAL,
    discount_pct REAL NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index pour les produits
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
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_date ON audit_logs (created_at);

-- Index pour les clients et crédits
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (name);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone);
CREATE INDEX IF NOT EXISTS idx_client_credits_customer ON client_credits (customer_id);
CREATE INDEX IF NOT EXISTS idx_client_credits_date ON client_credits (date);
CREATE INDEX IF NOT EXISTS idx_client_credits_type ON client_credits (type);

-- Index pour les fournisseurs et crédits fournisseurs
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers (name);
CREATE INDEX IF NOT EXISTS idx_supplier_credits_supplier ON supplier_credits (supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_credits_date ON supplier_credits (date);

-- Index pour les remises par volume
CREATE INDEX IF NOT EXISTS idx_volume_discounts_qty ON volume_discounts (min_qty);

-- ══════════════════════════════════════════════════════════════════════════════
-- NOUVELLES TABLES (Phase 1+ : unités, historique prix, achats, inventaire)
-- ══════════════════════════════════════════════════════════════════════════════

-- Multi-dépôts (§19) : préparation sans casser le fonctionnement actuel.
CREATE TABLE IF NOT EXISTS warehouses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    address TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Lots / expiration (§20) : numéro de lot, date de péremption.
CREATE TABLE IF NOT EXISTS product_batches (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    lot_number TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0,
    expiry_date DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_product_batches_product ON product_batches (product_id);
CREATE INDEX IF NOT EXISTS idx_product_batches_expiry ON product_batches (expiry_date);

-- Conversions d'unités (CARTON = 24 PIÈCES, etc.)
CREATE TABLE IF NOT EXISTS unit_conversions (
    id TEXT PRIMARY KEY,
    from_unit TEXT NOT NULL,
    to_unit TEXT NOT NULL,
    factor REAL NOT NULL,
    product_id TEXT, -- NULL = conversion globale, défini = spécifique à un produit
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
);

-- Historique des prix d'un produit
CREATE TABLE IF NOT EXISTS price_history (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    purchase_price REAL,
    selling_price REAL,
    wholesale_price REAL,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reason TEXT,
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
);

-- Commandes d'achat fournisseurs
CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY,
    order_number TEXT NOT NULL UNIQUE,
    supplier_id TEXT NOT NULL,
    date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expected_date DATETIME,
    status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT, CONFIRMED, RECEIVED, CANCELLED
    total REAL NOT NULL DEFAULT 0.0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT
);

-- Lignes de commandes d'achat
CREATE TABLE IF NOT EXISTS purchase_order_items (
    id TEXT PRIMARY KEY,
    purchase_order_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit_price REAL NOT NULL,
    received_qty REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders (id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
);

-- Sessions d'inventaire (workflow multi-étapes)
CREATE TABLE IF NOT EXISTS inventory_sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT, COMPTAGE, CALCUL, VALIDATION
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Lignes d'inventaire
CREATE TABLE IF NOT EXISTS inventory_items (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    expected_qty REAL NOT NULL DEFAULT 0,
    counted_qty REAL,
    difference REAL,
    status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, COUNTED, ADJUSTED
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES inventory_sessions (id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
);

-- Paramètres globaux (seuils d'alerte, etc.)
CREATE TABLE IF NOT EXISTS global_settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Index pour les nouvelles tables
CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history (product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history (changed_at);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders (supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders (status);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order ON purchase_order_items (purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product ON purchase_order_items (product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_sessions_status ON inventory_sessions (status);
CREATE INDEX IF NOT EXISTS idx_inventory_items_session ON inventory_items (session_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_product ON inventory_items (product_id);
CREATE INDEX IF NOT EXISTS idx_unit_conversions_product ON unit_conversions (product_id);

-- Versioning de l'inventaire physique
CREATE TABLE IF NOT EXISTS inventory_versions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    note TEXT,
    FOREIGN KEY (session_id) REFERENCES inventory_sessions (id) ON DELETE CASCADE,
    UNIQUE (session_id, version_number)
);

CREATE TABLE IF NOT EXISTS inventory_item_versions (
    id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    counted_qty REAL NOT NULL,
    FOREIGN KEY (version_id) REFERENCES inventory_versions (id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_inventory_versions_session ON inventory_versions (session_id);
CREATE INDEX IF NOT EXISTS idx_inventory_item_versions_version ON inventory_item_versions (version_id);
CREATE INDEX IF NOT EXISTS idx_inventory_item_versions_product ON inventory_item_versions (product_id);
