# Multi-dépôts — ventilation réelle du stock (implémenté)

Ce document décrit la fonctionnalité **multi-dépôts complète** : chaque dépôt
possède son propre stock, les mouvements/ventes/achats/inventaires sont rattachés
à un dépôt précis, et des **transferts** déplacent le stock d'un dépôt à un autre.
La ventilation est **transparente** pour un utilisateur mono-dépôt.

## 1. Schéma & migration

- `stock_movements.warehouse_id TEXT NOT NULL` — FK → `warehouses(id)`
  `ON DELETE RESTRICT` (l'historique n'est jamais effacé avec un dépôt).
- `inventory_balances` — clé primaire **composite `(product_id, warehouse_id)`** :
  un solde PAR (produit, dépôt).
- `stock_transfers(id, product_id, from_warehouse_id, to_warehouse_id, quantity,
  date, notes, created_at)` — historique des transferts.
- `inventory_sessions.warehouse_id` — un inventaire physique porte sur UN dépôt.

**Migration des bases existantes** (`src/database/config/connection.ts`), exécutée
au démarrage après un backup pré-migration automatique (`createPreMigrationBackup`) :

1. `ensureDefaultWarehouse()` — crée « Dépôt principal » (`is_default = 1`) si
   aucun dépôt n'existe.
2. `migrateStockMovementsToWarehouses()` — ajoute `warehouse_id` (NOT NULL + FK) et
   rattache **tous** les mouvements existants au dépôt par défaut (aucune perte).
3. `migrateInventoryBalancesToWarehouses()` — reconstruit `inventory_balances` avec
   la clé composite, en rattachant les soldes existants au dépôt par défaut.
4. `rebuildBalances()` (StockLedgerService) recalcule les soldes par
   `(product_id, warehouse_id)` depuis l'historique migré.
5. `verifyDatabaseIntegrity()` — `foreign_key_check` + `integrity_check`.

Idempotent (skip si les colonnes sont déjà présentes). Preuve automatisée :
`tests/migration-legacy-warehouses.test.ts` construit une base **legacy** (sans
`warehouse_id`, `inventory_balances` à clé simple), la migre via le vrai `initDb()`
et vérifie que **les soldes avant/après sont identiques**, rattachés au dépôt par
défaut.

## 2. Moteur de stock warehouse-aware (`StockLedgerService`)

- `recordMovement()` résout le dépôt : explicite, sinon **dépôt actif**
  (`global_settings.active_warehouse_id`), sinon dépôt par défaut. Le solde du
  `(produit, dépôt)` est mis à jour dans la **même transaction**.
- Types : `PURCHASE_IN`, `SALE_OUT`, `RETURN_IN/OUT`, `ADJUSTMENT_IN/OUT`,
  **`TRANSFER_IN` / `TRANSFER_OUT`**, `DAMAGE_OUT`, `LOSS_OUT`, `OPENING_BALANCE`.
- **Lectures** : sans dépôt → CONSOLIDÉ (somme des dépôts) ; avec `warehouseId`
  → restreint à ce dépôt. Pour un utilisateur mono-dépôt, consolidé = dépôt unique
  → comportement identique à avant.
- `transferStock(productId, from, to, quantity, notes)` : vérifie le stock source,
  refuse source = destination, puis crée **dans UNE transaction** `TRANSFER_OUT` +
  `TRANSFER_IN` + une ligne `stock_transfers`. Jamais l'un sans l'autre.

## 3. « Dépôt actif » (UI)

- `src/stores/useWarehouseStore.ts` : charge la liste des dépôts + le dépôt actif
  (persisté) ; `setActive()`.
- `src/components/layout/WarehouseSelector.tsx` : sélecteur **visible et
  persistant** dans la barre latérale, **masqué automatiquement** s'il n'y a qu'un
  seul dépôt (cas mono-dépôt majoritaire → aucune complexité visible).
- Toutes les écritures sans dépôt explicite (ventes POS/factures, réceptions
  d'achat, mouvements de stock) s'appliquent au **dépôt actif**.

## 4. Écrans impactés

| Écran | Gestion du dépôt |
|---|---|
| **POS / Factures (Invoice)** | La vente décrémente le stock du **dépôt actif** (via `StockLedgerService` SALE_OUT). |
| **Commandes fournisseurs / Réceptions** | La réception incrémente le stock du **dépôt actif** (PURCHASE_IN). |
| **InventoryPage** | Choix du dépôt à la création de session ; stock attendu lu dans **ce dépôt** ; validation applique les écarts dans **ce dépôt**. |
| **StockPage** | Sélecteur « Dépôt des opérations » + **répartition par dépôt** du produit sélectionné (`stock:getWarehouseBreakdown`). Les entrées/sorties/inventaire s'appliquent au dépôt choisi. |
| **StockAlertsPage** | Filtre par dépôt : les alertes de stock bas sont calculées **par dépôt** (un produit peut être bas dans un dépôt et suffisant dans un autre). |
| **WarehousesPage** | CRUD dépôts + « dépôt actif » + **section Transferts** (formulaire + historique). |
| **Dashboard / Rapports** | Vue **CONSOLIDÉE par défaut** (tous dépôts) avec **filtre optionnel** par dépôt (valeur du stock + alertes). |

**Décision documentée** : le Dashboard et les Rapports affichent une vue
**consolidée par défaut** (vue d'ensemble utile au commerçant multi-dépôts), avec
un filtre par dépôt disponible. Les filtres n'apparaissent que s'il existe plus
d'un dépôt.

## 5. Tests

- `tests/multi-warehouse.test.ts` : mouvements/soldes par dépôt, transferts
  (réussis, refusés si stock insuffisant, refusés si source = destination),
  cohérence `rebuildBalances`, alertes par dépôt, répartition, inventaire par dépôt.
- `tests/migration-legacy-warehouses.test.ts` : migration d'une base legacy,
  soldes identiques avant/après.
- `tests/warehouses.test.ts` : CRUD référentiel + unicité du dépôt par défaut.
