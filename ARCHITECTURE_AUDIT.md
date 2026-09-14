> [!WARNING] DOCUMENT HISTORIQUE - PERIME (Historical / superseded).
> HISTORIQUE / PÉRIMÉ — voir `FINAL_PRODUCTION_AUDIT.md` pour l'état actuel.
> Ce document décrit un état ANTÉRIEUR du projet ; son compteur de tests et son
> statut de production ne sont plus valides (le compteur de tests réel est tenu à
> jour dans `FINAL_PRODUCTION_AUDIT.md`).

---

# ARCHITECTURE AUDIT â€” StockLocal (Gestion de stock/comptabilitÃ© desktop)

**Date :** 29/08/2026
**Version applicative :** 1.0.0
**ModÃ¨le :** Electron + React + SQLite (better-sqlite3), offline-first, single-user.

---

## 1. Architecture actuelle

```
Renderer (React + Zustand)
      â”‚  window.api.* (IPC exposÃ© par preload.ts, non typÃ©)
      â–¼
Electron IPC (electron/ipc/*.ipc.ts)
      â”‚  validation Zod (src/validation/schemas.ts) + ipcValidation.ts
      â–¼
Services (src/services/*.ts)  â† faÃ§ades mÃ©tier
      â”‚
      â–¼
Repositories (src/repositories/*.ts)
      â”‚
      â–¼
SQLite (better-sqlite3, src/database/config/connection.ts)
```

**Stack :**
- `better-sqlite3` 13.0.3 (WAL, `synchronous=NORMAL`, `foreign_keys=ON`)
- React 18 + Zustand 4 + Zod 3 + lucide-react + pdf-lib
- Electron 43.4.1, `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`
- Vitest pour les tests
- SchÃ©ma : `src/database/schema/database.sql` + migrations ad-hoc dans `connection.ts`

**DÃ©marrage base :** `connection.ts` ouvre la DB, applique le schÃ©ma puis des migrations ad-hoc (`migrateColumns`, `migrateAuditLogs`, `migrateStockMovementV2`, etc.), puis rebuild les balances via `StockLedgerService.rebuildBalances()`.

---

## 2. Architecture cible

```
Presentation (React + Zustand)
      â”‚
      â–¼
Electron IPC (typed, validated with Zod)
      â”‚
      â–¼
Application (Use Cases)
      â”‚
      â–¼
Domain (EntitÃ©s + RÃ¨gles mÃ©tier + Interfaces Repository + Erreurs mÃ©tier)
      â”‚
      â–¼
Infrastructure (Repositories SQLite, Services)
      â”‚
      â–¼
SQLite
```

Le Domain ne doit pas dÃ©pendre de Electron, React, better-sqlite3, fs. Les Use Cases orchestrent les rÃ¨gles mÃ©tier. Les Repositories SQLite implÃ©mentent les interfaces du Domain.

---

## 3. ProblÃ¨mes dÃ©tectÃ©s

### 3.1 Critiques (P0)

| # | ProblÃ¨me | Fichier(s) | Impact |
|---|----------|------------|--------|
| 1 | **`average_cost` jamais mis Ã  jour dans `recordMovement()`** : `stmtUpsertBalance` ne met pas Ã  jour `average_cost`. AprÃ¨s une entrÃ©e, `total_in_value` change mais `average_cost` reste obsolÃ¨te. | `StockLedgerService.ts` | **CMUP faux** â†’ valorisation stock, marges et coÃ»ts incorrects |
| 2 | **Pas de systÃ¨me de migrations versionnÃ©** : migrations ad-hoc exÃ©cutÃ©es Ã  chaque dÃ©marrage, pas de table `schema_migrations`. Impossible de garantir l'ordre/unicitÃ© d'exÃ©cution. | `connection.ts` | Risque de migration partielle, non reproductible |
| 3 | **`deleteProduct` ne protÃ¨ge pas toutes les rÃ©fÃ©rences** : n'inclut pas `credit_note_refs`, `inventory_items`, `purchase_order_items`, `price_history`, et ne retourne pas de message dÃ©taillÃ© avec les comptes. | `ProductService.ts` | Suppression possible de donnÃ©es historiques |
| 4 | **Inventaire : pas de versioning** : `counted_qty` est Ã©crasÃ© Ã  chaque modification. Pas de `inventory_versions`/`inventory_item_versions`, pas de restore, pas de correction aprÃ¨s finalisation. | `InventorySessionRepository.ts`, schÃ©ma | Perte d'audit trail, impossible de corriger proprement |
| 5 | **Protection delete clients/suppliers incomplÃ¨te** : `ClientRepository.remove` ne vÃ©rifie que `documents`, pas `client_credits` ; `SupplierRepository.remove` ne vÃ©rifie pas `purchase_orders`, `stock_movements`. | `ClientRepository.ts`, `SupplierRepository.ts` | Suppression possible avec historique |
| 6 | **`preload.ts` non typÃ©** : `(data: any)` partout, et `global.d.ts` dÃ©clare `api: any`. Le renderer n'a pas de contrat IPC typÃ©. | `preload.ts`, `global.d.ts` | Pas de type safety, risque d'erreurs runtime |
| 7 | **FK `ON DELETE CASCADE` dangereux** : `stock_movementsâ†’products`, `inventory_balancesâ†’products`, `client_creditsâ†’customers`, `paymentsâ†’documents`, `subcategoriesâ†’categories`. La suppression d'un parent supprime l'historique. | `database.sql` | Suppression en cascade de donnÃ©es historiques |

### 3.2 Importants (P1)

| # | ProblÃ¨me | Fichier(s) | Impact |
|---|----------|------------|--------|
| 8 | **Import CSV non performant** : `readFileSync` + `split('\n')` + boucle `ProductService.createProduct` (N+1). Pas de batch insert. | `ImportService.ts` | Import lent sur gros fichiers, DoS mÃ©moire |
| 9 | **N+1 queries** : `PurchaseOrderRepository.getReceivings()` boucle et exÃ©cute 1 requÃªte par commande ; `DashboardRepository.getMonthlyRevenue()` a une subquery corrÃ©lÃ©e. | `PurchaseOrderRepository.ts`, `DashboardRepository.ts` | Lenteur sur gros volumes |
| 10 | **Backup auto "naÃ¯f"** : `scheduleAutoBackup()` fait `setTimeout(1min)` puis `setInterval(24h)` â€” ne respecte pas le "dernier backup rÃ©ussi". Application fermÃ©e plusieurs jours â†’ pas de backup. | `BackupService.ts` | Risque de perte de donnÃ©es |
| 11 | **`as any` / `@ts-ignore` / `as unknown as any`** dispersÃ©s : `StockMovementRepository.getAllHistory`, `DashboardRepository`, `MigrationService`, `DataStorageService`. | Plusieurs fichiers | Masque les erreurs de type |
| 12 | **Manque d'index** : `document_items(product_id, quantity)`, `documents(entity_id, status, date)` pour certaines requÃªtes, `stock_movements(product_id, date)`. | `database.sql` | RequÃªtes lentes sur historique |
| 13 | **`documents:getAll` non paginÃ© cÃ´tÃ© renderer** : le handler limite Ã  500 mais le store peut charger tout. | `operations.ipc.ts` | Lenteur/DoS sur gros volumes |
| 14 | **Audit incomplet** : pas d'audit pour `products:confirmImport`, certaines actions d'archivage/suppression d'entitÃ©s non critiques. | `AuditService.ts` | TraÃ§abilitÃ© limitÃ©e |

### 3.3 Optimisations (P2)

| # | ProblÃ¨me |
|---|----------|
| 15 | Keyset pagination non utilisÃ©e pour les trÃ¨s gros historiques (OK pour l'instant, documentÃ©) |
| 16 | Money en REAL â€” pas de passage Ã  INTEGER cents (migration trop risquÃ©e, documentÃ©) |
| 17 | `console.log` en production |
| 18 | `SELECT *` dans certaines requÃªtes (peu impactant mais Ã  surveiller) |

---

## 4. VulnÃ©rabilitÃ©s

- **Path traversal** : bien protÃ©gÃ© via `validatePathWithinDataDir` / `validatePathWithinSubDir` pour les chemins IPC. **Reste :** `products:getImageBase64` est confinÃ© (OK), `company:save` logo confinÃ© (OK).
- **IPC validation** : Zod appliquÃ© sur la plupart des handlers critiques. **Manque :** `inventory:create` valide Ã  la main (pas de Zod), `inventory:countItem` de mÃªme. Ajouter des schÃ©mas.
- **CSP** : prod CSP correcte mais limitÃ©e â€” ajouter `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`.
- **`global.d.ts` `api: any`** : fragilise la sÃ©curitÃ© de type.
- **CSV injection** : protÃ©gÃ©e (`csvEscape`), OK.

---

## 5. ProblÃ¨mes SQLite

- `average_cost` stockÃ© obsolÃ¨te (voir P0 #1).
- Pas de `schema_migrations`.
- FK CASCADE dangereuses (voir P0 #7).
- `inventory_items.counted_qty` Ã©crasÃ© (voir P0 #4).
- `quantity`/`REAL` â€” prÃ©cision non contrÃ´lÃ©e (acceptÃ© actuellement, documentÃ©).
- Index manquants (voir P1 #12).

---

## 6. ProblÃ¨mes stock

- CMUP incorrect aprÃ¨s `recordMovement` (P0 #1).
- `getAverageCost()` calcule Ã  la volÃ©e `value/qty`, masquant la colonne obsolÃ¨te.
- Aucun test de cohÃ©rence `rebuildBalances` vs `recordMovement`.

---

## 7. ProblÃ¨mes inventaire

- Pas de versioning.
- Pas de restore.
- Pas de correction aprÃ¨s validation.
- Workflow DRAFT â†’ COMPTAGE â†’ CALCUL â†’ VALIDATION existant mais sans historique des modifications.

---

## 8. ProblÃ¨mes suppression

- `ProductService.deleteProduct` : rÃ©fÃ©rences incomplÃ¨tes.
- `ClientRepository.remove` : ne vÃ©rifie pas `client_credits`.
- `SupplierRepository.remove` : ne vÃ©rifie pas `purchase_orders`, `stock_movements`, `supplier_credits`.
- Pas de distinction claire "Archiver" vs "Supprimer dÃ©finitivement" dans l'UI pour clients/suppliers.

---

## 9. ProblÃ¨mes backup

- Auto-backup naÃ¯f (P1 #10).
- Restore OK (dÃ©pÃ´t marqueur `.restore_pending.db` sur Windows).
- Pas de checksum â€” valide via integrity_check uniquement (acceptable).

---

## 10. ProblÃ¨mes IPC

- `preload.ts` non typÃ©.
- Handlers inventaire sans Zod.
- RÃ©ponses hÃ©tÃ©rogÃ¨nes (`{success, data}`, `{success, error}`, raw) â€” normalisÃ© par `humanError` mais Ã  documenter.

---

## 11. ProblÃ¨mes Clean Architecture

- Services font office de faÃ§ades (acceptable provisoirement) mais Domain/Application non sÃ©parÃ©s.
- Repositories SQLite importent directement `db` (couplÃ© Ã  better-sqlite3).
- Use Cases non crÃ©Ã©s.

---

## 12. ProblÃ¨mes performance

- N+1 dans `getReceivings`, `getMonthlyRevenue`.
- Import CSV non batchÃ©.
- Index manquants.

---

## 13. Plan de correction

**P0 â€” Critique :**
1. Fix `recordMovement` â†’ calcul et persistance de `average_cost` cohÃ©rents.
2. CrÃ©er un vrai systÃ¨me de migrations versionnÃ©es (`schema_migrations`).
3. Renforcer `deleteProduct` (toutes rÃ©fÃ©rences + message dÃ©taillÃ© + erreur mÃ©tier `EntityCannotBeDeletedError`).
4. Ajouter le versioning inventaire (`inventory_versions`, `inventory_item_versions`) + restore + correction post-finalisation.
5. ProtÃ©ger delete clients/suppliers.
6. Typer `preload.ts` + `global.d.ts`.
7. Remplacer les FK CASCADE dangereuses par `ON DELETE RESTRICT` (migration sÃ»re).

**P1 â€” Important :**
8. Import CSV batchÃ© (`bulkCreateProducts` + streaming).
9. Supprimer les N+1 (`getReceivings`, `getMonthlyRevenue`).
10. AmÃ©liorer backup auto (check last successful backup).
11. Remplacer `as any` / `@ts-ignore` critiques.
12. Ajouter index nÃ©cessaires.
13. Pagination dashboard/listes.

**P2 â€” Optimisation :**
14. Keyset pagination (documentÃ©).
15. Passage money en INTEGER cents (non fait â€” migration trop risquÃ©e, documentÃ©).

---

## 14. PrioritÃ©s P0/P1/P2

| PrioritÃ© | Actions |
|----------|---------|
| **P0** | #1, #2, #3, #4, #5, #6, #7 |
| **P1** | #8, #9, #10, #11, #12, #13 |
| **P2** | #14, #15 |

---

## 15. DÃ©cisions architecturales ambiguÃ«s documentÃ©es

### 15.1 Money en REAL vs INTEGER cents

- **Problem** : les prix/quantitÃ©s sont en REAL ; les calculs financiers peuvent souffrir d'erreurs flottantes.
- **Options** :
  - A. Passer Ã  INTEGER cents (migration lourde de toutes les tables + conversion UI/DB).
  - B. Conserver REAL + arrondis explicites (`round2()`).
- **Recommendation** : **B** pour l'instant. La migration vers INTEGER cents est trop risquÃ©e pour les bases existantes et le gain est faible pour une app mono-utilisateur avec des montants modÃ©rÃ©s. Documenter pour une future version.
- **Risk** : erreurs d'arrondi possibles en extrÃªme bord. AttÃ©nuÃ© par `round2()` dans `DocumentRepository`.

### 15.2 `average_cost` colonne stockÃ©e ou calculÃ©e ?

- **Problem** : `average_cost` est une donnÃ©e dÃ©rivÃ©e (`total_in_value / total_in_qty`) mais stockÃ©e, et dÃ©synchronisÃ©e.
- **Options** :
  - A. La conserver et la mettre Ã  jour Ã  chaque mouvement (garantie transactionnelle).
  - B. La supprimer et la calculer Ã  la lecture.
- **Recommendation** : **A** â€” la conserver et la maintenir atomiquement dans `recordMovement` (le calcul `value/qty` est trivial, mais la colonne sert aux requÃªtes agrÃ©gÃ©es du dashboard `SUM(quantity * average_cost)` sans jointure dynamique).
- **Risk** : si un mouvement oublie la mise Ã  jour, incohÃ©rence. AttÃ©nuÃ© par le test de cohÃ©rence `rebuildBalances` vs `recordMovement`.

### 15.3 Remplacement des FK CASCADE

- **Problem** : `ON DELETE CASCADE` supprime l'historique.
- **Options** :
  - A. Passer tout en `ON DELETE RESTRICT`.
  - B. Remplacer uniquement les FK historiques critiques.
- **Recommendation** : **B** â€” remplacer les CASCADE sur `stock_movementsâ†’products`, `inventory_balancesâ†’products`, `client_creditsâ†’customers`, `paymentsâ†’documents`, `subcategoriesâ†’categories` par `ON DELETE RESTRICT`. Les CASCADE sur `document_itemsâ†’documents` et `purchase_order_itemsâ†’purchase_orders` restent (suppression d'un brouillon supprime ses lignes, logique).
- **Risk** : si un code tente de supprimer un produit avec mouvements, il recevra une FK error â†’ corrigÃ© par `deleteProduct` qui vÃ©rifie les rÃ©fÃ©rences en amont.

### 15.4 Versioning inventaire

- **Problem** : `counted_qty` Ã©crasÃ©.
- **Options** :
  - A. Tables `inventory_versions` + `inventory_item_versions` avec historique immuable.
  - B. Table unique `inventory_item_versions` suffisante.
- **Recommendation** : **A** â€” `inventory_versions` stocke les mÃ©tadonnÃ©es de version (session_id, version_number, created_at, note) et `inventory_item_versions` stocke les valeurs par ligne. `inventory_items.counted_qty` reste la valeur courante, l'historique est immuable.
- **Risk** : complexitÃ© accrue. AttÃ©nuÃ© par des tests obligatoires (V1=95, V2=97, V3=96, restore V2 â†’ V4=97, V1/V2/V3 conservÃ©s).

---

## 16. RÃ©capitulatif des fichiers Ã  crÃ©er / modifier

### Ã€ crÃ©er
- `migrations/` + runner
- `src/domain/` (erreurs mÃ©tier, entitÃ©s, interfaces repository)
- `src/application/` (use cases)
- `src/repositories/interfaces/` (contrats)
- `src/repositories/sqlite/` (implÃ©mentations)
- `src/types/` (types partagÃ©s IPC)
- Tests supplÃ©mentaires

### Ã€ modifier
- `StockLedgerService.ts` (average_cost)
- `connection.ts` (migrations versionnÃ©es)
- `database.sql` (FK RESTRICT, index)
- `ProductService.ts` (delete protection)
- `ClientRepository.ts` / `SupplierRepository.ts` (delete protection)
- `InventorySessionRepository.ts` (versioning)
- `ImportService.ts` (batch)
- `BackupService.ts` (auto-backup)
- `preload.ts` / `global.d.ts` (types)
- `schemas.ts` (schÃ©mas inventaire/backup)

---

*Ce document est un point de dÃ©part ; les corrections sont appliquÃ©es progressivement, chaque phase compilant et passant les tests.*
