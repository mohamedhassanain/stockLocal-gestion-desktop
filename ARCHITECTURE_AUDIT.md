# ARCHITECTURE_AUDIT.md — StockLocal Desktop

Audit réalisé avant toute modification. Baseline vérifiée : `tsc --noEmit` ✅, `npm test` ✅ (5 fichiers, 70 tests).

---

## 1. Vue d'ensemble de l'architecture actuelle

```
React UI (src/pages, src/components, src/stores)
   ↓  window.api (preload.ts, contextBridge, sandbox:true)
Electron IPC (electron/main.ts : ~90 handlers dans un seul fichier)
   ↓
Services métier (src/services : StockLedgerService, DocumentService, ProductService, …)
   ↓
Repositories (src/repositories : adapters better-sqlite3)
   ↓
SQLite (src/database/config/connection.ts, schema/database.sql)
```

**Points forts constatés :**
- Sécurité Electron correcte : `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, CSP prod, navigation verrouillée, `setWindowOpenHandler`.
- `electron/ipcValidation.ts` : validation de chaînes/IDs, anti-traversal (`..`, `~`), confinement au dossier de données (`validatePathWithinDataDir`), erreurs humaines.
- Zod pour les payloads critiques (produits, clients, fournisseurs, ventes, paiements, stock entrée/sortie).
- `StockLedgerService` : moteur central avec `movement_type` explicites, transactions atomiques, stock suffisant vérifié, lien `document_id`.
- Exports CSV par batch SQL (anti plafond), inflation de formule CSV dans `ExportService`.
- Pagination SQL pour historique stock, documents, paiements.
- Backup VACUUM INTO + restauration différée via `.restore_pending.db` + integrity_check + rollback automatique.
- 5 fichiers de tests (70 tests) : validation, moteur stock, hardening, backup/restore, volumétrie.

---

## 2. Problèmes & risques identifiés

### 2.1 Sécurité — IPC non validés (risque élevé)
Beaucoup de handlers acceptent `any` cru du renderer sans schéma Zod :
- `products:createWithStock` → `productData` cru (contrairement à `products:create`).
- `documents:create` → SaleSchema existe mais n'est jamais utilisé.
- `documents:createCreditNote` → `returnItems` non validé.
- `purchases:create` (PurchaseSchema existe, inutilisé), `purchases:receive`.
- `stock:addInventory` → InventorySchema existe, inutilisé.
- `clients:addDebt/addPayment`, `suppliers:addDebt/addPayment`, `clients:update`, `suppliers:update` → montants/IDs non validés.
- `categories:create/update/addSub/updateSub`, `discounts:create/update`, `conversions:create/update`, `company:save`, `globalSettings:save` → `any` cru.
- `products:update`, `products:updateWithStock` → `id` non passé par `requireId`.

### 2.2 Sécurité — Filesystem
- **`backup:now(destinationDir)`** : le renderer fournit un chemin de destination arbitraire → écriture arbitraire (mkdir + copie).
- **`backup:restore/delete/validate`** : seule validation structurelle (`validateFilePath`) ; un renderer compromis pourrait **supprimer un fichier arbitraire** via `backup:delete` (`fs.unlinkSync`) ou copier n'importe quel fichier dans la base via restore. Il faut confiner aux dossiers `backups/` autorisés.
- **`products:pickImage` / `products:getImageBase64`** : copie/lecture sans limite de taille → DoS mémoire (base64 via IPC) ; le chemin image est bien confiné, mais pas la taille.
- **`products:importCsv` / `previewImportCsv`** : `fs.readFileSync` entier sans limite (50 Mo max recommandé) ; parser non-streaming (acceptable si borné).
- **`company:save` → `logo_path`** : chemin renderer utilisé ensuite par `PDFService` via `fs.readFileSync(logo_path)` → **lecture arbitraire de fichier** (ex. `C:\Windows\System32\...` enregistré puis embarqué dans un PDF). Doit être confiné à `attachments/`.
- **`csvEscape` de `reports:exportCsv` (dans main.ts)** : ne protège PAS contre l'injection de formule CSV (`=`, `+`, `-`, `@`) contrairement à `ExportService`.
- `require('fs')` / `require('path')` inline dans main.ts (ESM incohérent).

### 2.3 Performances SQLite
- **N+1 — `StockLedgerService.getStockValue()`** : boucle sur tous les produits et appelle `getAverageCost()` par produit (1 requête cumulée par produit ; avec 10k produits × 1M mouvements, des milliers de requêtes agrégées).
- **Dashboard `total_stock_value`** : valorise `quantité × purchase_price` (SQL) alors que le reste de l'appli utilise le **CMUP** (`StockLedgerService`). Deux valeurs différentes pour le même KPI → incohérence comptable.
- **Sous-requêtes corrélées pour `current_stock`** dans `ProductRepository` (×4) et `ExportService.exportProducts` : 1 agrégation par ligne retournée.
- **`CategoryRepository.getAll()`** : 1 requête de sous-catégories par catégorie (N+1, faible mais gratuit à corriger).
- **Dashboard** : `low_stock`, `alert_summary.low_stock_count` agglomèrent la totalité de `stock_movements` par produit à chaque appel.
- Pas de table de balances précalculée (`inventory_balances`) → chaque lecture de stock/scanne tout l'historique.

### 2.4 Numérotation des documents (fragile)
- `DocumentRepository.generateNumber()` et `PurchaseOrderRepository.generateNumber()` utilisent `COUNT(*) + 1` : les numéros se chevauchent après suppression/rollback/import, et le format dépend d'un COUNT par année.
- Aucune table de séquences transactionnelle.

### 2.5 Architecture / types
- `electron/main.ts` : ~1000 lignes, ~90 handlers — composition root mélangée à la logique.
- `electron/` n'est **pas couvert par `tsc --noEmit`** (tsconfig.json n'inclut que `src`) → les erreurs de types du process principal passent inaperçues au typecheck.
- `src/global.d.ts` déclare `window.api: any` : le renderer appelle l'IPC sans types ; aucun type de domaine partagé.
- Le frontend importe ses types métier depuis `src/repositories/*` (fichiers qui embarquent de la logique SQL) au lieu d'un module `domain` neutre. (`import type` est effacé au build → pas de fuite better-sqlite3 dans le bundle, mais couplage de types.)

### 2.6 Divers
- Migration "maison" dans `connection.ts` (fonctions `migrateXxx` séquentielles, non versionnées) — fonctionnelle et idempotente, mais pas une table de versions.
- `DemoDataService.seedIfEmpty()` insère avec `notes` pour reclasser ensuite — OK.
- `stock:addInventory` renvoie `error.message` brut (pas `toHumanError`) dans certains handlers ; plusieurs autres ramènent `error.message` (détail technique) au lieu de `toHumanError` — cohérence à améliorer sans changer l'UX.

---

## 3. Plan de migration (par phase)

| Phase | Contenu | Fichiers principaux |
|---|---|---|
| 2 — Security hardening | Schémas Zod manquants sur tous les IPC critiques ; limites de taille fichiers (image 5 Mo, CSV 50 Mo) ; confinement `backup:*` aux dossiers `backups/` ; `logo_path` confiné à `attachments/` ; `csvEscape` centralisé anti-injection partout ; remplacement de `require()` inline | `electron/ipcValidation.ts`, `src/validation/schemas.ts`, `electron/main.ts` (puis `electron/ipc/*`) |
| 3 — Modularisation IPC + types | Découpage `main.ts` en `electron/ipc/*.ipc.ts` ; `main.ts` = composition root ; types de domaine partagés (`src/domain/types.ts`) + `window.api` typé ; `tsconfig.json` inclut `electron` (typecheck du process principal) | `electron/main.ts` → `electron/ipc/*`, `src/domain/*`, `src/global.d.ts`, `tsconfig.json` |
| 4 — SQLite perf | Table `inventory_balances` (UNIQUE(product_id), quantity, average_cost, total_in_qty, total_in_value) maintenue transactionnellement ; `getStockLevel/getAverageCost/getStockValue` sur balances ; dashboard valorisé au CMUP ; `current_stock` via JOIN balances ; `CategoryRepository` sans N+1 ; table `document_sequences` transactionnelle (format conservé) ; indexes ciblés | `src/database/schema/database.sql`, `src/database/config/connection.ts`, `src/services/StockLedgerService.ts`, `src/repositories/{Product,Document,PurchaseOrder,Category,Dashboard,InventorySession}*.ts`, `src/services/ExportService.ts` |
| 5 — Tests | sequences, balances/rollback, confinement backups, limites fichiers, benchmark 100k+ mouvements | `tests/*.test.ts` |
| 6 — Benchmark | Mesure avant/après `getStockValue`, search, ping | `tests/performance-benchmark.test.ts` + résultats dans le rapport |
| 7 — Nettoyage final | Audit TODO/FIXME/any/@ts-ignore/fs brut + `REFACTORING_REPORT.md` | — |

---

## 4. Contraintes respectées

- **Pas de SaaS** : aucune introduction de PostgreSQL/Redis/K8s/cloud/multi-tenancy.
- **Offline & single-user** conservés.
- **Compatibilité données** : toutes les modifications de schéma sont additives/idempotentes (`CREATE TABLE IF NOT EXISTS`, backfill conditionnel) ; aucune suppression de table existante ; les anciennes bases démarrent et sont migrées sans perte.
- **Format des numéros conservé** : `PREFIX-YYYY-#####`.

## 5. Fichiers concernés par le plan

- Modifiés : `electron/main.ts`, `electron/preload.ts`, `electron/ipcValidation.ts`, `src/validation/schemas.ts`, `src/database/schema/database.sql`, `src/database/config/connection.ts`, `src/services/StockLedgerService.ts`, `src/repositories/*`, `src/services/ExportService.ts`, `src/global.d.ts`, `tsconfig.json`, `tests/*`.
- Créés : `electron/ipc/*.ipc.ts`, `src/domain/types.ts`, `tests/sequences.test.ts`, `tests/inventory-balances.test.ts`, `tests/security-ipc.test.ts`, `tests/performance-benchmark.test.ts`, `ARCHITECTURE_AUDIT.md`, `REFACTORING_REPORT.md`.
