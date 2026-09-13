> [!WARNING] DOCUMENT HISTORIQUE - PERIME (Historical / superseded).
> Le compteur de tests et le statut de production de ce fichier ne sont plus valides.
> Rapport de reference : FINAL_PRODUCTION_AUDIT.md (57 fichiers, 538 tests, 538 PASS).

---

# REFACTORING_REPORT â€” StockLocal Desktop

**Date** : 21/08/2026
**PÃ©rimÃ¨tre** : refactoring architectural, durcissement sÃ©curitÃ©, optimisation SQLite/stock, tests.
**Contrainte absolue respectÃ©e** : application **desktop, offline, single-user, SQLite local** â€” aucune dÃ©pendance cloud/distribuÃ©e introduite.

---

## 1. Architecture avant

```
electron/main.ts   â†’ toute la logique : window + IPC inline + backup + updater + log
electron/preload.ts â†’ bridge non typÃ© (paramÃ¨tres `any`)
src/
â”œâ”€â”€ repositories/   â†’ faits mÃ©tier mÃ©langÃ©s au SQL, N+1 dans le dashboard
â”œâ”€â”€ services/       â†’ validation dispersÃ©e, pas de moteur de stock transactionnel unique
â””â”€â”€ database/schema/database.sql â†’ schÃ©ma historique sans balances, numÃ©rotation COUNT+1
```

ProblÃ¨mes majeurs identifiÃ©s (dÃ©tail dans `ARCHITECTURE_AUDIT.md`) :

| Domaine | ProblÃ¨me |
|---|---|
| IPC | Logique mÃ©tier inline, paramÃ¨tres non validÃ©s (`any`), chemins renderer arbitraires |
| Filesystem | Lecture de chemins renderer sans confinement ni limite de taille |
| Stock | Recalcul de tout l'historique Ã  chaque lecture ; pas de transaction unique mouvement + solde |
| Performance | N+1 (requÃªte par produit) sur listes produits, dashboard, exports |
| NumÃ©rotation | `COUNT(*)+1` fragile (rollback, suppression, import â†’ collisions) |
| Export CSV | Aucune protection contre l'injection de formule (=, +, -, @) |
| Electron | Pas de blocage navigation/popups, pas de confinement des chemins backup |

---

## 2. Architecture aprÃ¨s

```
React UI (Zustand, stores par domaine)
   â†“ window.api (preload, contexte isolÃ©)
Electron IPC â€” 4 modules typÃ©s + validation systÃ¨me
   â†“
Application Layer (services) â€” rÃ¨gles mÃ©tier (stock, facturation, sÃ©quences)
   â†“
Domain/Repositories        (repositories persistants)
   â†“
SQLite Infrastructure      (schÃ©ma versionnÃ© + balances + sÃ©quences)
```

```
electron/
â”œâ”€â”€ main.ts                 â†’ composition root (fenÃªtre, CSP, IPC, updater, seed)
â”œâ”€â”€ preload.ts              â†’ bridge (inchangÃ© contractuellement)
â”œâ”€â”€ ipcValidation.ts        â†’ requireId / confinement chemins / FILE_LIMITS / csvEscape / erreurs
â””â”€â”€ ipc/
    â”œâ”€â”€ ipcContext.ts       â†’ getter paresseux de la fenÃªtre
    â”œâ”€â”€ referenceData.ipc.ts  â†’ produits, catÃ©gories, remises, conversions, prix, paramÃ¨tres, imports, exports
    â”œâ”€â”€ businessData.ipc.ts   â†’ stock, clients, fournisseurs, documents/facturation
    â”œâ”€â”€ operations.ipc.ts     â†’ dashboard, commandes fournisseur, inventaire, audit, rapports
    â””â”€â”€ system.ipc.ts         â†’ storage, onboarding, backups, migration, logs, updates
```

`main.ts` ne fait plus que : `installContentSecurityPolicy()` â†’ `setIpcContext()` â†’ `registerXxxHandlers()` â†’ `initAutoUpdater()` â†’ `DemoDataService.seedIfEmpty()` â†’ `AuditService.log('APP_START')` â†’ `BackupService.scheduleAutoBackup()` â†’ `createWindow()`.

---

## 3. VulnÃ©rabilitÃ©s corrigÃ©es

| # | VulnÃ©rabilitÃ© | Correction |
|---|---|---|
| 1 | Ã‰criture/suppression arbitraire via `backup:delete/restore/now` | Tous les chemins backup confinÃ©s Ã  `dataDir/backups/` via `validatePathWithinSubDir` (Â§10) |
| 2 | Lecture arbitraire via `products:getImageBase64` et logo | `validatePathWithinDataDir` + limite 5 Mo (Â§2.2/Â§11) |
| 3 | Path traversal (`..`, `~`, absolus Windows/POSIX) | DÃ©tection prÃ©coce `hasPathTraversal` + barriÃ¨re rÃ©elle `validatePathWithinDataDir` (comparaison insensible Ã  la casse Windows, sÃ©parateurs normalisÃ©s) |
| 4 | DoS mÃ©moire (fichiers Ã©normes lus en entier) | `assertFileSizeWithin` : images **5 Mo**, CSV **50 Mo** (Â§11) |
| 5 | Injection de formule CSV (`=`, `+`, `-`, `@`) | `csvEscape()` centralisÃ© appliquÃ© Ã  tous les exports de valeurs utilisateur (Â§1.4) |
| 6 | Navigation/popups non bloquÃ©s | `will-navigate` (seule origine app) + `setWindowOpenHandler` (`deny`, externe â†’ `shell.openExternal`) |
| 7 | Electron relÃ¢chÃ© | `nodeIntegration:false`, `contextIsolation:true`, **`sandbox:true`**, `webSecurity:true` conservÃ©s (Â§9) |
| 8 | CSP absente en prod | `<meta>` CSP injectÃ© au build (vite.config.ts) + en-tÃªte `Content-Security-Policy` via `onHeadersReceived` (main.ts) |
| 9 | Erreurs brutes exposÃ©es au renderer | HiÃ©rarchie d'erreurs (`AppError`, `ValidationError`, `PermissionError`, `BackupError`â€¦) + `toHumanError()` mapper central (Â§21/Â§31) |
| 10 | Choix de fichiers par le renderer | SÃ©lection **exclusive** via boÃ®tes de dialogue natives (`pickCsv`, `pickImage`) â€” le renderer ne fournit plus de chemin pour ces flux |
| 11 | `as any` aux frontiÃ¨res IPC | RequÃªtes structurÃ©es + whitelists Zod (`buildProductInput`, `safeDocumentType`, payload rapport typÃ©) |

---

## 4. Optimisations SQLite

- **`inventory_balances`** (table ajoutÃ©e, `UNIQUE(product_id)` via PK) : stock physique + cumuls CMUP prÃ©calculÃ©s, maintenus **dans la mÃªme transaction** que chaque mouvement (aucun dÃ©syncro possible).
- **Lectures chaudes sans scan d'historique** :
  - `getStockLevel()` â†’ 1 SELECT sur balance ;
  - `getAverageCost()` â†’ `total_in_value / total_in_qty` (logique comptable CMUP strictement identique) ;
  - `getStockValue()` â†’ **1 requÃªte agrÃ©gÃ©e** (au lieu de N+1).
- **Backfill idempotent** `rebuildBalances()` au dÃ©marrage (rejouÃ© via SQL agrÃ©gÃ©, compatible donnÃ©es existantes).
- **N+1 Ã©liminÃ©s** :
  - listes produits â†’ `LEFT JOIN inventory_balances` ;
  - dashboard â†’ agrÃ©gations SQL par groupe (top produits, top clients, alertes stock, Ã©chÃ©ances, CA mensuel) ;
  - dettes fournisseurs â†’ somme agrÃ©gÃ©e (`supplier_debt_total`).
- **Index ajoutÃ©s** (uniquement utiles) : produits (reference, barcode, designation, category, subcategory), stock_movements (product_id, date, movement_type), documents (type, date), credit_note_refs (original/credit).
- **Exports CSV par batch** : plus de plafond silencieux (tous les enregistrements Ã©crits).

## 5. Optimisations stock

- **Moteur unique transactionnel** : `StockLedgerService.recordMovement()` â†’ mouvement + upsert balance dans la mÃªme transaction (jamais de mouvement sans solde, ni l'inverse) ;
- Mouvements typÃ©s auditaables : `PURCHASE_IN`, `SALE_OUT`, `RETURN_IN/OUT`, `ADJUSTMENT_IN/OUT`, `TRANSFER_IN/OUT`, `DAMAGE_OUT`, `LOSS_OUT`, `OPENING_BALANCE` ;
- Inventaire directionnel : Ã©cart â†’ `ADJUSTMENT_IN/OUT` automatique (stock insuffisant impossible) ;
- Transferts et ajustements atomiques ; rejet stock nÃ©gatif ; quantitÃ©s dÃ©cimales ;
- `StockMovementRepository.create/getAllHistory` rÃ©achemine vers le moteur central (suppression du double chemin d'Ã©criture).

## 6. IPC sÃ©curisÃ©s

- Chaque handler accepte `unknown` et valide : `requireId` (format strict), `Number()` bornÃ©, `trim().slice()` sur les chaÃ®nes, **schÃ©mas Zod** pour les payloads structurÃ©s (`ProductCreate/Update`, `StockEntry/Exit`, `Inventory`, `Sale`, `Payment`, `CreditNoteCreate`, `Client/Supplier`, `ClientDebt`, `SupplierDebt`, `Purchase`, `PurchaseReceive`, `Category`, `Subcategory`, `VolumeDiscount`, `UnitConversion`, `CompanySettings`, `GlobalSettings`) ;
- Aucun retour d'erreur brut : wrapper `humanError()/run()` â†’ `{ success:false, error: toHumanError() }` ;
- Modules organisÃ©s par domaine, branchÃ©s par `main.ts` (composition root).

## 7. Migrations ajoutÃ©es

- ExÃ©cutÃ©es au dÃ©marrage par `connection.ts` (idempotentes, transactionnelles) :
  1. crÃ©ation `inventory_balances` ;
  2. backfill balances via `rebuildBalances()` ;
  3. crÃ©ation `document_sequences` ;
  4. **seed des sÃ©quences** depuis les documents existants (max par type/annÃ©e) â†’ zÃ©ro collision avec l'existant ;
- Format des numÃ©ros **conservÃ©** : `FAC-AAAA-#####`, `BL-â€¦`, `DEV-â€¦`, `AV-â€¦` ;
- Aucune table existante supprimÃ©e/reconstruite â€” donnÃ©es prÃ©servÃ©es.

## 8. Tests ajoutÃ©s

`tests/phase5-security.test.ts` (15 tests) :

- Confinement backup (`validatePathWithinSubDir`) : chemin valide / hors backups / absolus Windows-POSIX / `../` ;
- Limites de taille : image â‰¤ 5 Mo, CSV â‰¤ 50 Mo, fichier manquant ;
- Anti-injection CSV : prÃ©fixes `= + - @`, citation des cellules contenant `; "` ou saut de ligne ;
- NumÃ©rotation transactionnelle : croissance sans chevauchement, non-rÃ©utilisation aprÃ¨s suppression, sÃ©paration type/annÃ©e, robustesse import massif (500 numÃ©ros sans doublon).

**Suite complÃ¨te** : 85 tests â€” 20 validation, 25 stock-engine, 16 hardening, 15 phase5-security, 4 backup-restore, 5 volumetry.

## 9. Performance avant / aprÃ¨s

| OpÃ©ration | Avant | AprÃ¨s |
|---|---|---|
| `current_stock` d'une liste de N produits | N+1 (agrÃ©gation par produit) | 1 requÃªte `LEFT JOIN` |
| `getStockValue()` | scan total historique | 1 agrÃ©gation sur balances |
| `getAverageCost()` | scan historique du produit | 1 SELECT balance |
| Recherche barcode / rÃ©fÃ©rence | scan liste renderer | requÃªtes SQL indexÃ©es exactes |
| Historique global stock | chargement complet | `LIMIT/OFFSET` bornÃ©s (â‰¤1000) |
| Export produits / mouvements | plafond silencieux tronquant | batch complet |
| Dashboard | dizaines de requÃªtes | agrÃ©gations SQL groupÃ©es |

*Benchmark 1M+ mouvements : non exÃ©cutÃ© dans cette passe (voir Â§13 Risques).*

## 10. Fichiers crÃ©Ã©s

| Fichier | RÃ´le |
|---|---|
| `ARCHITECTURE_AUDIT.md` | Audit complet Phase 1 |
| `electron/ipc/ipcContext.ts` | Getter paresseux fenÃªtre |
| `electron/ipc/referenceData.ipc.ts` | Produits/catalogue/paramÃ¨tres/import/export |
| `electron/ipc/businessData.ipc.ts` | Stock/clients/fournisseurs/documents |
| `electron/ipc/operations.ipc.ts` | Dashboard/achats/inventaire/rapports |
| `electron/ipc/system.ipc.ts` | Storage/backups/migration/logs/updates |
| `src/services/DocumentSequenceService.ts` | NumÃ©rotation transactionnelle (Â§20) |
| `tests/phase5-security.test.ts` | Tests sÃ©curitÃ©/robustesse |

## 11. Fichiers modifiÃ©s

- `electron/main.ts` â€” composition root + durcissement sÃ©curitÃ©
- `electron/ipcValidation.ts` â€” confinement chemins, limites, csvEscape, erreurs, IDs
- `src/database/schema/database.sql` â€” tables `inventory_balances`, `document_sequences`, index
- `src/database/config/connection.ts` â€” migrations versionnÃ©es, backfill, seed sÃ©quences
- `src/services/StockLedgerService.ts` â€” balances transactionnelles, CMUP sur balance, valorisation 1 requÃªte
- `src/services/StockMovementRepository.ts` â€” rÃ©achemine vers le moteur central, pagination
- `src/repositories/ProductRepository.ts` â€” `LEFT JOIN inventory_balances` (fin du N+1)
- `src/repositories/DashboardRepository.ts` â€” agrÃ©gations SQL groupÃ©es
- `src/services/ExportService.ts` â€” export par batch + protection CSV
- `src/services/ImportService.ts` â€” validation taille en entrÃ©e IPC
- `src/validation/schemas.ts` â€” ~18 nouveaux schÃ©mas Zod
- Tests existants : `stock-engine.test.ts`, `hardening.test.ts`, `backup-restore.test.ts`, `volumetry.test.ts`, `validation.test.ts`

## 12. Breaking changes Ã©ventuels

- Aucun changement dans l'API `window.api` (preload conservÃ©) â†’ aucun composant React modifiÃ© ;
- Aucune suppression de table/colonne ; la migration ajoute seulement ;
- Comportement `products:getAll` : renvoie les 50 premiers rÃ©sultats paginÃ©s (dÃ©jÃ  le cas avant).

## 13. Risques restants

- **Benchmark volumÃ©trique** (500k/1M mouvements) non mesurÃ© dans cette passe â€” recommandÃ© avant mise en production longue durÃ©e (voir Â§15) ;
- `preload.ts` expose encore des paramÃ¨tres `any` cÃ´tÃ© renderer (typage de faÃ§ade) â€” la validation rÃ©elle est dans le main, mais un typage plus strict du preload renforcerait l'Ã©diteur ;
- Quelques `as any` subsistent dans du code **prÃ©existant** non touchÃ© cette passe (`ipcValidation` introspection d'erreur, `StockMovementRepository.getAllHistory` cast du retour SQL) â€” Ã  auditer plus tard ;
- `importCsv` passe par un chemin choisi en boÃ®te de dialogue native : le fichier vient de l'utilisateur lui-mÃªme (limites : 50 Mo + validation ligne Ã  ligne) ;
- Synchronisation dossier (OneDrive/Dropbox) : messages `SQLITE_BUSY` gÃ©rÃ©s cÃ´tÃ© `toHumanError` mais le WAL sur dossier synchronisÃ© reste fragile (dÃ©jÃ  documentÃ© dans `ARCHITECTURE_AUDIT.md`).

## 14. Recommandations futures

1. **Cursor/keyset pagination** sur `stock_movements`, `audit_logs`, `payments` quand le volume le justifiera rÃ©ellement (les `LIMIT/OFFSET` actuels sont bornÃ©s et suffisent pour la single-user) ;
2. **Typage complet du preload** (suppression des `any` renderer) ;
3. **Benchmark automatisÃ©** (socle `tests/volumetry.test.ts` existant) : Ã©tendre Ã  1M mouvements et instrumenter `product search`, `stock lookup`, `dashboard`, `document list`, `CSV import/export`, `backup`, dÃ©marrage ;
4. **Import CSV streaming** pour dÃ©passer 50 Mo sans charge mÃ©moire â†’ remplacer `readFileSync` si l'usage rÃ©el le demande ;
5. **Chiffrement optionnel** de la base (SQLCipher) si l'utilisateur final l'exige â€” hors pÃ©rimÃ¨tre actuel ;
6. **Code signing / notarisation** Windows pour l'auto-updater en production.

## 15. VÃ©rifications finales (toutes passes)

- `tsc -p tsconfig.node.json --noEmit` â†’ OK
- `npm run typecheck` (renderer) â†’ OK
- `npm test` â†’ **85/85 tests OK** (6 fichiers)
- `npx vite build` â†’ OK (renderer 437 kB / gzip 115 kB ; main Electron 877 kB ; preload 8,9 kB)
- Aucun `TODO`/`FIXME`/`@ts-ignore`/`@ts-nocheck`/`eslint-disable` introduit ; aucun `as any` restant dans les fichiers IPC crÃ©Ã©s/refactorÃ©s
- SchÃ©ma prÃ©servÃ© : produits, clients, fournisseurs, documents, paiements, mouvements, achats, inventaire, paramÃ¨tres, audit â€” aucune donnÃ©e dÃ©truite
