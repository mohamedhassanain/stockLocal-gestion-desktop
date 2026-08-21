# REFACTORING_REPORT — StockLocal Desktop

**Date** : 21/08/2026
**Périmètre** : refactoring architectural, durcissement sécurité, optimisation SQLite/stock, tests.
**Contrainte absolue respectée** : application **desktop, offline, single-user, SQLite local** — aucune dépendance cloud/distribuée introduite.

---

## 1. Architecture avant

```
electron/main.ts   → toute la logique : window + IPC inline + backup + updater + log
electron/preload.ts → bridge non typé (paramètres `any`)
src/
├── repositories/   → faits métier mélangés au SQL, N+1 dans le dashboard
├── services/       → validation dispersée, pas de moteur de stock transactionnel unique
└── database/schema/database.sql → schéma historique sans balances, numérotation COUNT+1
```

Problèmes majeurs identifiés (détail dans `ARCHITECTURE_AUDIT.md`) :

| Domaine | Problème |
|---|---|
| IPC | Logique métier inline, paramètres non validés (`any`), chemins renderer arbitraires |
| Filesystem | Lecture de chemins renderer sans confinement ni limite de taille |
| Stock | Recalcul de tout l'historique à chaque lecture ; pas de transaction unique mouvement + solde |
| Performance | N+1 (requête par produit) sur listes produits, dashboard, exports |
| Numérotation | `COUNT(*)+1` fragile (rollback, suppression, import → collisions) |
| Export CSV | Aucune protection contre l'injection de formule (=, +, -, @) |
| Electron | Pas de blocage navigation/popups, pas de confinement des chemins backup |

---

## 2. Architecture après

```
React UI (Zustand, stores par domaine)
   ↓ window.api (preload, contexte isolé)
Electron IPC — 4 modules typés + validation système
   ↓
Application Layer (services) — règles métier (stock, facturation, séquences)
   ↓
Domain/Repositories        (repositories persistants)
   ↓
SQLite Infrastructure      (schéma versionné + balances + séquences)
```

```
electron/
├── main.ts                 → composition root (fenêtre, CSP, IPC, updater, seed)
├── preload.ts              → bridge (inchangé contractuellement)
├── ipcValidation.ts        → requireId / confinement chemins / FILE_LIMITS / csvEscape / erreurs
└── ipc/
    ├── ipcContext.ts       → getter paresseux de la fenêtre
    ├── referenceData.ipc.ts  → produits, catégories, remises, conversions, prix, paramètres, imports, exports
    ├── businessData.ipc.ts   → stock, clients, fournisseurs, documents/facturation
    ├── operations.ipc.ts     → dashboard, commandes fournisseur, inventaire, audit, rapports
    └── system.ipc.ts         → storage, onboarding, backups, migration, logs, updates
```

`main.ts` ne fait plus que : `installContentSecurityPolicy()` → `setIpcContext()` → `registerXxxHandlers()` → `initAutoUpdater()` → `DemoDataService.seedIfEmpty()` → `AuditService.log('APP_START')` → `BackupService.scheduleAutoBackup()` → `createWindow()`.

---

## 3. Vulnérabilités corrigées

| # | Vulnérabilité | Correction |
|---|---|---|
| 1 | Écriture/suppression arbitraire via `backup:delete/restore/now` | Tous les chemins backup confinés à `dataDir/backups/` via `validatePathWithinSubDir` (§10) |
| 2 | Lecture arbitraire via `products:getImageBase64` et logo | `validatePathWithinDataDir` + limite 5 Mo (§2.2/§11) |
| 3 | Path traversal (`..`, `~`, absolus Windows/POSIX) | Détection précoce `hasPathTraversal` + barrière réelle `validatePathWithinDataDir` (comparaison insensible à la casse Windows, séparateurs normalisés) |
| 4 | DoS mémoire (fichiers énormes lus en entier) | `assertFileSizeWithin` : images **5 Mo**, CSV **50 Mo** (§11) |
| 5 | Injection de formule CSV (`=`, `+`, `-`, `@`) | `csvEscape()` centralisé appliqué à tous les exports de valeurs utilisateur (§1.4) |
| 6 | Navigation/popups non bloqués | `will-navigate` (seule origine app) + `setWindowOpenHandler` (`deny`, externe → `shell.openExternal`) |
| 7 | Electron relâché | `nodeIntegration:false`, `contextIsolation:true`, **`sandbox:true`**, `webSecurity:true` conservés (§9) |
| 8 | CSP absente en prod | `<meta>` CSP injecté au build (vite.config.ts) + en-tête `Content-Security-Policy` via `onHeadersReceived` (main.ts) |
| 9 | Erreurs brutes exposées au renderer | Hiérarchie d'erreurs (`AppError`, `ValidationError`, `PermissionError`, `BackupError`…) + `toHumanError()` mapper central (§21/§31) |
| 10 | Choix de fichiers par le renderer | Sélection **exclusive** via boîtes de dialogue natives (`pickCsv`, `pickImage`) — le renderer ne fournit plus de chemin pour ces flux |
| 11 | `as any` aux frontières IPC | Requêtes structurées + whitelists Zod (`buildProductInput`, `safeDocumentType`, payload rapport typé) |

---

## 4. Optimisations SQLite

- **`inventory_balances`** (table ajoutée, `UNIQUE(product_id)` via PK) : stock physique + cumuls CMUP précalculés, maintenus **dans la même transaction** que chaque mouvement (aucun désyncro possible).
- **Lectures chaudes sans scan d'historique** :
  - `getStockLevel()` → 1 SELECT sur balance ;
  - `getAverageCost()` → `total_in_value / total_in_qty` (logique comptable CMUP strictement identique) ;
  - `getStockValue()` → **1 requête agrégée** (au lieu de N+1).
- **Backfill idempotent** `rebuildBalances()` au démarrage (rejoué via SQL agrégé, compatible données existantes).
- **N+1 éliminés** :
  - listes produits → `LEFT JOIN inventory_balances` ;
  - dashboard → agrégations SQL par groupe (top produits, top clients, alertes stock, échéances, CA mensuel) ;
  - dettes fournisseurs → somme agrégée (`supplier_debt_total`).
- **Index ajoutés** (uniquement utiles) : produits (reference, barcode, designation, category, subcategory), stock_movements (product_id, date, movement_type), documents (type, date), credit_note_refs (original/credit).
- **Exports CSV par batch** : plus de plafond silencieux (tous les enregistrements écrits).

## 5. Optimisations stock

- **Moteur unique transactionnel** : `StockLedgerService.recordMovement()` → mouvement + upsert balance dans la même transaction (jamais de mouvement sans solde, ni l'inverse) ;
- Mouvements typés auditaables : `PURCHASE_IN`, `SALE_OUT`, `RETURN_IN/OUT`, `ADJUSTMENT_IN/OUT`, `TRANSFER_IN/OUT`, `DAMAGE_OUT`, `LOSS_OUT`, `OPENING_BALANCE` ;
- Inventaire directionnel : écart → `ADJUSTMENT_IN/OUT` automatique (stock insuffisant impossible) ;
- Transferts et ajustements atomiques ; rejet stock négatif ; quantités décimales ;
- `StockMovementRepository.create/getAllHistory` réachemine vers le moteur central (suppression du double chemin d'écriture).

## 6. IPC sécurisés

- Chaque handler accepte `unknown` et valide : `requireId` (format strict), `Number()` borné, `trim().slice()` sur les chaînes, **schémas Zod** pour les payloads structurés (`ProductCreate/Update`, `StockEntry/Exit`, `Inventory`, `Sale`, `Payment`, `CreditNoteCreate`, `Client/Supplier`, `ClientDebt`, `SupplierDebt`, `Purchase`, `PurchaseReceive`, `Category`, `Subcategory`, `VolumeDiscount`, `UnitConversion`, `CompanySettings`, `GlobalSettings`) ;
- Aucun retour d'erreur brut : wrapper `humanError()/run()` → `{ success:false, error: toHumanError() }` ;
- Modules organisés par domaine, branchés par `main.ts` (composition root).

## 7. Migrations ajoutées

- Exécutées au démarrage par `connection.ts` (idempotentes, transactionnelles) :
  1. création `inventory_balances` ;
  2. backfill balances via `rebuildBalances()` ;
  3. création `document_sequences` ;
  4. **seed des séquences** depuis les documents existants (max par type/année) → zéro collision avec l'existant ;
- Format des numéros **conservé** : `FAC-AAAA-#####`, `BL-…`, `DEV-…`, `AV-…` ;
- Aucune table existante supprimée/reconstruite — données préservées.

## 8. Tests ajoutés

`tests/phase5-security.test.ts` (15 tests) :

- Confinement backup (`validatePathWithinSubDir`) : chemin valide / hors backups / absolus Windows-POSIX / `../` ;
- Limites de taille : image ≤ 5 Mo, CSV ≤ 50 Mo, fichier manquant ;
- Anti-injection CSV : préfixes `= + - @`, citation des cellules contenant `; "` ou saut de ligne ;
- Numérotation transactionnelle : croissance sans chevauchement, non-réutilisation après suppression, séparation type/année, robustesse import massif (500 numéros sans doublon).

**Suite complète** : 85 tests — 20 validation, 25 stock-engine, 16 hardening, 15 phase5-security, 4 backup-restore, 5 volumetry.

## 9. Performance avant / après

| Opération | Avant | Après |
|---|---|---|
| `current_stock` d'une liste de N produits | N+1 (agrégation par produit) | 1 requête `LEFT JOIN` |
| `getStockValue()` | scan total historique | 1 agrégation sur balances |
| `getAverageCost()` | scan historique du produit | 1 SELECT balance |
| Recherche barcode / référence | scan liste renderer | requêtes SQL indexées exactes |
| Historique global stock | chargement complet | `LIMIT/OFFSET` bornés (≤1000) |
| Export produits / mouvements | plafond silencieux tronquant | batch complet |
| Dashboard | dizaines de requêtes | agrégations SQL groupées |

*Benchmark 1M+ mouvements : non exécuté dans cette passe (voir §13 Risques).*

## 10. Fichiers créés

| Fichier | Rôle |
|---|---|
| `ARCHITECTURE_AUDIT.md` | Audit complet Phase 1 |
| `electron/ipc/ipcContext.ts` | Getter paresseux fenêtre |
| `electron/ipc/referenceData.ipc.ts` | Produits/catalogue/paramètres/import/export |
| `electron/ipc/businessData.ipc.ts` | Stock/clients/fournisseurs/documents |
| `electron/ipc/operations.ipc.ts` | Dashboard/achats/inventaire/rapports |
| `electron/ipc/system.ipc.ts` | Storage/backups/migration/logs/updates |
| `src/services/DocumentSequenceService.ts` | Numérotation transactionnelle (§20) |
| `tests/phase5-security.test.ts` | Tests sécurité/robustesse |

## 11. Fichiers modifiés

- `electron/main.ts` — composition root + durcissement sécurité
- `electron/ipcValidation.ts` — confinement chemins, limites, csvEscape, erreurs, IDs
- `src/database/schema/database.sql` — tables `inventory_balances`, `document_sequences`, index
- `src/database/config/connection.ts` — migrations versionnées, backfill, seed séquences
- `src/services/StockLedgerService.ts` — balances transactionnelles, CMUP sur balance, valorisation 1 requête
- `src/services/StockMovementRepository.ts` — réachemine vers le moteur central, pagination
- `src/repositories/ProductRepository.ts` — `LEFT JOIN inventory_balances` (fin du N+1)
- `src/repositories/DashboardRepository.ts` — agrégations SQL groupées
- `src/services/ExportService.ts` — export par batch + protection CSV
- `src/services/ImportService.ts` — validation taille en entrée IPC
- `src/validation/schemas.ts` — ~18 nouveaux schémas Zod
- Tests existants : `stock-engine.test.ts`, `hardening.test.ts`, `backup-restore.test.ts`, `volumetry.test.ts`, `validation.test.ts`

## 12. Breaking changes éventuels

- Aucun changement dans l'API `window.api` (preload conservé) → aucun composant React modifié ;
- Aucune suppression de table/colonne ; la migration ajoute seulement ;
- Comportement `products:getAll` : renvoie les 50 premiers résultats paginés (déjà le cas avant).

## 13. Risques restants

- **Benchmark volumétrique** (500k/1M mouvements) non mesuré dans cette passe — recommandé avant mise en production longue durée (voir §15) ;
- `preload.ts` expose encore des paramètres `any` côté renderer (typage de façade) — la validation réelle est dans le main, mais un typage plus strict du preload renforcerait l'éditeur ;
- Quelques `as any` subsistent dans du code **préexistant** non touché cette passe (`ipcValidation` introspection d'erreur, `StockMovementRepository.getAllHistory` cast du retour SQL) — à auditer plus tard ;
- `importCsv` passe par un chemin choisi en boîte de dialogue native : le fichier vient de l'utilisateur lui-même (limites : 50 Mo + validation ligne à ligne) ;
- Synchronisation dossier (OneDrive/Dropbox) : messages `SQLITE_BUSY` gérés côté `toHumanError` mais le WAL sur dossier synchronisé reste fragile (déjà documenté dans `ARCHITECTURE_AUDIT.md`).

## 14. Recommandations futures

1. **Cursor/keyset pagination** sur `stock_movements`, `audit_logs`, `payments` quand le volume le justifiera réellement (les `LIMIT/OFFSET` actuels sont bornés et suffisent pour la single-user) ;
2. **Typage complet du preload** (suppression des `any` renderer) ;
3. **Benchmark automatisé** (socle `tests/volumetry.test.ts` existant) : étendre à 1M mouvements et instrumenter `product search`, `stock lookup`, `dashboard`, `document list`, `CSV import/export`, `backup`, démarrage ;
4. **Import CSV streaming** pour dépasser 50 Mo sans charge mémoire → remplacer `readFileSync` si l'usage réel le demande ;
5. **Chiffrement optionnel** de la base (SQLCipher) si l'utilisateur final l'exige — hors périmètre actuel ;
6. **Code signing / notarisation** Windows pour l'auto-updater en production.

## 15. Vérifications finales (toutes passes)

- `tsc -p tsconfig.node.json --noEmit` → OK
- `npm run typecheck` (renderer) → OK
- `npm test` → **85/85 tests OK** (6 fichiers)
- `npx vite build` → OK (renderer 437 kB / gzip 115 kB ; main Electron 877 kB ; preload 8,9 kB)
- Aucun `TODO`/`FIXME`/`@ts-ignore`/`@ts-nocheck`/`eslint-disable` introduit ; aucun `as any` restant dans les fichiers IPC créés/refactorés
- Schéma préservé : produits, clients, fournisseurs, documents, paiements, mouvements, achats, inventaire, paramètres, audit — aucune donnée détruite
