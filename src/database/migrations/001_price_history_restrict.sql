-- 001_price_history_restrict.sql
--
-- P1-15 — L'historique des prix est une donnée BUSINESS HISTORIQUE.
-- Supprimer un produit ne doit JAMAIS effacer son historique de prix
-- (le prix de vente/achat au moment d'une facture passée est une donnée
-- comptable). On remplace donc `ON DELETE CASCADE` par `ON DELETE RESTRICT`.
--
-- Idempotence : ce script ne s'exécute qu'une seule fois (tracké dans
-- `schema_migrations`). Il reconstruit la table sans détruire les données.

-- 1. Nouvelle table avec RESTRICT
CREATE TABLE IF NOT EXISTS price_history_new (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    purchase_price REAL,
    selling_price REAL,
    wholesale_price REAL,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reason TEXT,
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
);

-- 2. Copier les données existantes (aucune perte)
INSERT INTO price_history_new (id, product_id, purchase_price, selling_price, wholesale_price, changed_at, reason)
  SELECT id, product_id, purchase_price, selling_price, wholesale_price, changed_at, reason
  FROM price_history;

-- 3. Remplacer l'ancienne table
DROP TABLE price_history;

-- 4. Renommer
ALTER TABLE price_history_new RENAME TO price_history;

-- 5. Recréer les index (indispensables aux requêtes du Dashboard/Prices)
CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history (product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history (changed_at);
