# ARCHITECTURE AUDIT — StockLocal (Gestion de stock/comptabilité desktop)

**Date :** 29/08/2026
**Version applicative :** 1.0.0
**Modèle :** Electron + React + SQLite (better-sqlite3), offline-first, single-user.

---

## 1. Architecture actuelle

```
Renderer (React + Zustand)
      │  window.api.* (IPC exposé par preload.ts, non typé)
      ▼
Electron IPC (electron/ipc/*.ipc.ts)
      │  validation Zod (src/validation/schemas.ts) + ipcValidation.ts
      ▼
Services (src/services/*.ts)  ← façades métier
      │
      ▼
Repositories (src/repositories/*.ts)
      │
      ▼
SQLite (better-sqlite3, src/database/config/connection.ts)
```

**Stack :**
- `better-sqlite3` 13.0.3 (WAL, `synchronous=NORMAL`, `foreign_keys=ON`)
- React 18 + Zustand 4 + Zod 3 + lucide-react + pdf-lib
- Electron 43.4.1, `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`
- Vitest pour les tests
- Schéma : `src/database/schema/database.sql` + migrations ad-hoc dans `connection.ts`

**Démarrage base :** `connection.ts` ouvre la DB, applique le schéma puis des migrations ad-hoc (`migrateColumns`, `migrateAuditLogs`, `migrateStockMovementV2`, etc.), puis rebuild les balances via `StockLedgerService.rebuildBalances()`.

---

## 2. Architecture cible

```
Presentation (React + Zustand)
      │
      ▼
Electron IPC (typed, validated with Zod)
      │
      ▼
Application (Use Cases)
      │
      ▼
Domain (Entités + Règles métier + Interfaces Repository + Erreurs métier)
      │
      ▼
Infrastructure (Repositories SQLite, Services)
      │
      ▼
SQLite
```

Le Domain ne doit pas dépendre de Electron, React, better-sqlite3, fs. Les Use Cases orchestrent les règles métier. Les Repositories SQLite implémentent les interfaces du Domain.

---

## 3. Problèmes détectés

### 3.1 Critiques (P0)

| # | Problème | Fichier(s) | Impact |
|---|----------|------------|--------|
| 1 | **`average_cost` jamais mis à jour dans `recordMovement()`** : `stmtUpsertBalance` ne met pas à jour `average_cost`. Après une entrée, `total_in_value` change mais `average_cost` reste obsolète. | `StockLedgerService.ts` | **CMUP faux** → valorisation stock, marges et coûts incorrects |
| 2 | **Pas de système de migrations versionné** : migrations ad-hoc exécutées à chaque démarrage, pas de table `schema_migrations`. Impossible de garantir l'ordre/unicité d'exécution. | `connection.ts` | Risque de migration partielle, non reproductible |
| 3 | **`deleteProduct` ne protège pas toutes les références** : n'inclut pas `credit_note_refs`, `inventory_items`, `purchase_order_items`, `price_history`, et ne retourne pas de message détaillé avec les comptes. | `ProductService.ts` | Suppression possible de données historiques |
| 4 | **Inventaire : pas de versioning** : `counted_qty` est écrasé à chaque modification. Pas de `inventory_versions`/`inventory_item_versions`, pas de restore, pas de correction après finalisation. | `InventorySessionRepository.ts`, schéma | Perte d'audit trail, impossible de corriger proprement |
| 5 | **Protection delete clients/suppliers incomplète** : `ClientRepository.remove` ne vérifie que `documents`, pas `client_credits` ; `SupplierRepository.remove` ne vérifie pas `purchase_orders`, `stock_movements`. | `ClientRepository.ts`, `SupplierRepository.ts` | Suppression possible avec historique |
| 6 | **`preload.ts` non typé** : `(data: any)` partout, et `global.d.ts` déclare `api: any`. Le renderer n'a pas de contrat IPC typé. | `preload.ts`, `global.d.ts` | Pas de type safety, risque d'erreurs runtime |
| 7 | **FK `ON DELETE CASCADE` dangereux** : `stock_movements→products`, `inventory_balances→products`, `client_credits→customers`, `payments→documents`, `subcategories→categories`. La suppression d'un parent supprime l'historique. | `database.sql` | Suppression en cascade de données historiques |

### 3.2 Importants (P1)

| # | Problème | Fichier(s) | Impact |
|---|----------|------------|--------|
| 8 | **Import CSV non performant** : `readFileSync` + `split('\n')` + boucle `ProductService.createProduct` (N+1). Pas de batch insert. | `ImportService.ts` | Import lent sur gros fichiers, DoS mémoire |
| 9 | **N+1 queries** : `PurchaseOrderRepository.getReceivings()` boucle et exécute 1 requête par commande ; `DashboardRepository.getMonthlyRevenue()` a une subquery corrélée. | `PurchaseOrderRepository.ts`, `DashboardRepository.ts` | Lenteur sur gros volumes |
| 10 | **Backup auto "naïf"** : `scheduleAutoBackup()` fait `setTimeout(1min)` puis `setInterval(24h)` — ne respecte pas le "dernier backup réussi". Application fermée plusieurs jours → pas de backup. | `BackupService.ts` | Risque de perte de données |
| 11 | **`as any` / `@ts-ignore` / `as unknown as any`** dispersés : `StockMovementRepository.getAllHistory`, `DashboardRepository`, `MigrationService`, `DataStorageService`. | Plusieurs fichiers | Masque les erreurs de type |
| 12 | **Manque d'index** : `document_items(product_id, quantity)`, `documents(entity_id, status, date)` pour certaines requêtes, `stock_movements(product_id, date)`. | `database.sql` | Requêtes lentes sur historique |
| 13 | **`documents:getAll` non paginé côté renderer** : le handler limite à 500 mais le store peut charger tout. | `operations.ipc.ts` | Lenteur/DoS sur gros volumes |
| 14 | **Audit incomplet** : pas d'audit pour `products:confirmImport`, certaines actions d'archivage/suppression d'entités non critiques. | `AuditService.ts` | Traçabilité limitée |

### 3.3 Optimisations (P2)

| # | Problème |
|---|----------|
| 15 | Keyset pagination non utilisée pour les très gros historiques (OK pour l'instant, documenté) |
| 16 | Money en REAL — pas de passage à INTEGER cents (migration trop risquée, documenté) |
| 17 | `console.log` en production |
| 18 | `SELECT *` dans certaines requêtes (peu impactant mais à surveiller) |

---

## 4. Vulnérabilités

- **Path traversal** : bien protégé via `validatePathWithinDataDir` / `validatePathWithinSubDir` pour les chemins IPC. **Reste :** `products:getImageBase64` est confiné (OK), `company:save` logo confiné (OK).
- **IPC validation** : Zod appliqué sur la plupart des handlers critiques. **Manque :** `inventory:create` valide à la main (pas de Zod), `inventory:countItem` de même. Ajouter des schémas.
- **CSP** : prod CSP correcte mais limitée — ajouter `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`.
- **`global.d.ts` `api: any`** : fragilise la sécurité de type.
- **CSV injection** : protégée (`csvEscape`), OK.

---

## 5. Problèmes SQLite

- `average_cost` stocké obsolète (voir P0 #1).
- Pas de `schema_migrations`.
- FK CASCADE dangereuses (voir P0 #7).
- `inventory_items.counted_qty` écrasé (voir P0 #4).
- `quantity`/`REAL` — précision non contrôlée (accepté actuellement, documenté).
- Index manquants (voir P1 #12).

---

## 6. Problèmes stock

- CMUP incorrect après `recordMovement` (P0 #1).
- `getAverageCost()` calcule à la volée `value/qty`, masquant la colonne obsolète.
- Aucun test de cohérence `rebuildBalances` vs `recordMovement`.

---

## 7. Problèmes inventaire

- Pas de versioning.
- Pas de restore.
- Pas de correction après validation.
- Workflow DRAFT → COMPTAGE → CALCUL → VALIDATION existant mais sans historique des modifications.

---

## 8. Problèmes suppression

- `ProductService.deleteProduct` : références incomplètes.
- `ClientRepository.remove` : ne vérifie pas `client_credits`.
- `SupplierRepository.remove` : ne vérifie pas `purchase_orders`, `stock_movements`, `supplier_credits`.
- Pas de distinction claire "Archiver" vs "Supprimer définitivement" dans l'UI pour clients/suppliers.

---

## 9. Problèmes backup

- Auto-backup naïf (P1 #10).
- Restore OK (dépôt marqueur `.restore_pending.db` sur Windows).
- Pas de checksum — valide via integrity_check uniquement (acceptable).

---

## 10. Problèmes IPC

- `preload.ts` non typé.
- Handlers inventaire sans Zod.
- Réponses hétérogènes (`{success, data}`, `{success, error}`, raw) — normalisé par `humanError` mais à documenter.

---

## 11. Problèmes Clean Architecture

- Services font office de façades (acceptable provisoirement) mais Domain/Application non séparés.
- Repositories SQLite importent directement `db` (couplé à better-sqlite3).
- Use Cases non créés.

---

## 12. Problèmes performance

- N+1 dans `getReceivings`, `getMonthlyRevenue`.
- Import CSV non batché.
- Index manquants.

---

## 13. Plan de correction

**P0 — Critique :**
1. Fix `recordMovement` → calcul et persistance de `average_cost` cohérents.
2. Créer un vrai système de migrations versionnées (`schema_migrations`).
3. Renforcer `deleteProduct` (toutes références + message détaillé + erreur métier `EntityCannotBeDeletedError`).
4. Ajouter le versioning inventaire (`inventory_versions`, `inventory_item_versions`) + restore + correction post-finalisation.
5. Protéger delete clients/suppliers.
6. Typer `preload.ts` + `global.d.ts`.
7. Remplacer les FK CASCADE dangereuses par `ON DELETE RESTRICT` (migration sûre).

**P1 — Important :**
8. Import CSV batché (`bulkCreateProducts` + streaming).
9. Supprimer les N+1 (`getReceivings`, `getMonthlyRevenue`).
10. Améliorer backup auto (check last successful backup).
11. Remplacer `as any` / `@ts-ignore` critiques.
12. Ajouter index nécessaires.
13. Pagination dashboard/listes.

**P2 — Optimisation :**
14. Keyset pagination (documenté).
15. Passage money en INTEGER cents (non fait — migration trop risquée, documenté).

---

## 14. Priorités P0/P1/P2

| Priorité | Actions |
|----------|---------|
| **P0** | #1, #2, #3, #4, #5, #6, #7 |
| **P1** | #8, #9, #10, #11, #12, #13 |
| **P2** | #14, #15 |

---

## 15. Décisions architecturales ambiguës documentées

### 15.1 Money en REAL vs INTEGER cents

- **Problem** : les prix/quantités sont en REAL ; les calculs financiers peuvent souffrir d'erreurs flottantes.
- **Options** :
  - A. Passer à INTEGER cents (migration lourde de toutes les tables + conversion UI/DB).
  - B. Conserver REAL + arrondis explicites (`round2()`).
- **Recommendation** : **B** pour l'instant. La migration vers INTEGER cents est trop risquée pour les bases existantes et le gain est faible pour une app mono-utilisateur avec des montants modérés. Documenter pour une future version.
- **Risk** : erreurs d'arrondi possibles en extrême bord. Atténué par `round2()` dans `DocumentRepository`.

### 15.2 `average_cost` colonne stockée ou calculée ?

- **Problem** : `average_cost` est une donnée dérivée (`total_in_value / total_in_qty`) mais stockée, et désynchronisée.
- **Options** :
  - A. La conserver et la mettre à jour à chaque mouvement (garantie transactionnelle).
  - B. La supprimer et la calculer à la lecture.
- **Recommendation** : **A** — la conserver et la maintenir atomiquement dans `recordMovement` (le calcul `value/qty` est trivial, mais la colonne sert aux requêtes agrégées du dashboard `SUM(quantity * average_cost)` sans jointure dynamique).
- **Risk** : si un mouvement oublie la mise à jour, incohérence. Atténué par le test de cohérence `rebuildBalances` vs `recordMovement`.

### 15.3 Remplacement des FK CASCADE

- **Problem** : `ON DELETE CASCADE` supprime l'historique.
- **Options** :
  - A. Passer tout en `ON DELETE RESTRICT`.
  - B. Remplacer uniquement les FK historiques critiques.
- **Recommendation** : **B** — remplacer les CASCADE sur `stock_movements→products`, `inventory_balances→products`, `client_credits→customers`, `payments→documents`, `subcategories→categories` par `ON DELETE RESTRICT`. Les CASCADE sur `document_items→documents` et `purchase_order_items→purchase_orders` restent (suppression d'un brouillon supprime ses lignes, logique).
- **Risk** : si un code tente de supprimer un produit avec mouvements, il recevra une FK error → corrigé par `deleteProduct` qui vérifie les références en amont.

### 15.4 Versioning inventaire

- **Problem** : `counted_qty` écrasé.
- **Options** :
  - A. Tables `inventory_versions` + `inventory_item_versions` avec historique immuable.
  - B. Table unique `inventory_item_versions` suffisante.
- **Recommendation** : **A** — `inventory_versions` stocke les métadonnées de version (session_id, version_number, created_at, note) et `inventory_item_versions` stocke les valeurs par ligne. `inventory_items.counted_qty` reste la valeur courante, l'historique est immuable.
- **Risk** : complexité accrue. Atténué par des tests obligatoires (V1=95, V2=97, V3=96, restore V2 → V4=97, V1/V2/V3 conservés).

---

## 16. Récapitulatif des fichiers à créer / modifier

### À créer
- `migrations/` + runner
- `src/domain/` (erreurs métier, entités, interfaces repository)
- `src/application/` (use cases)
- `src/repositories/interfaces/` (contrats)
- `src/repositories/sqlite/` (implémentations)
- `src/types/` (types partagés IPC)
- Tests supplémentaires

### À modifier
- `StockLedgerService.ts` (average_cost)
- `connection.ts` (migrations versionnées)
- `database.sql` (FK RESTRICT, index)
- `ProductService.ts` (delete protection)
- `ClientRepository.ts` / `SupplierRepository.ts` (delete protection)
- `InventorySessionRepository.ts` (versioning)
- `ImportService.ts` (batch)
- `BackupService.ts` (auto-backup)
- `preload.ts` / `global.d.ts` (types)
- `schemas.ts` (schémas inventaire/backup)

---

*Ce document est un point de départ ; les corrections sont appliquées progressivement, chaque phase compilant et passant les tests.*
