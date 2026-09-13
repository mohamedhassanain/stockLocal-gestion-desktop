> [!WARNING] DOCUMENT HISTORIQUE - PERIME (Historical / superseded).
> Le compteur de tests et le statut de production de ce fichier ne sont plus valides.
> Rapport de reference : FINAL_PRODUCTION_AUDIT.md (57 fichiers, 538 tests, 538 PASS).

---

# Rapport de Refactoring â€” StockLocal (Application Desktop Electron)

> **Statut honnÃªte.** Ce rapport reflÃ¨te ce qui a **rÃ©ellement Ã©tÃ© modifiÃ©, testÃ© et vÃ©rifiÃ©**. Le chantier demandÃ© (18 catÃ©gories P0/P1) est un effort **multi-sessions**. J'ai complÃ©tÃ© et **validÃ© par tests** les correctifs **P0 les plus critiques** (intÃ©gritÃ© des donnÃ©es) **et plusieurs items P1 concrets**, et documentÃ© clairement ce qui **reste** Ã  faire. **Je ne prÃ©tends pas "100% complete".**

---

## 0. Mise Ã  jour (avancement P1)

Ces items P1 ont ensuite Ã©tÃ© **implÃ©mentÃ©s et vÃ©rifiÃ©s** (`tsc` OK) :

- **Backup â€” tri fiable** : `listBackupsInDir` trie dÃ©sormais par **`mtimeMs`** (nombre), plus jamais par la chaÃ®ne formatÃ©e `date` (`toLocaleString`).
- **Backup â€” validation par checksum** : `backup()` Ã©crit un fichier `.sha256` (SHA-256) Ã  cÃ´tÃ© du backup ; `validateBackup()` vÃ©rifie `integrity_check` **puis** le checksum (`altÃ©rÃ©` dÃ©tectÃ©).
- **Backup â€” au dÃ©marrage si expirÃ©** : nouvelle mÃ©thode `checkAndBackupIfDue()` appelÃ©e au dÃ©marrage (`main.ts`) â€” si la derniÃ¨re sauvegarde est expirÃ©e (ou absente) et que `auto_backup_enabled` est actif, un backup est crÃ©Ã© **immÃ©diatement** (fire-and-forget).
- **SÃ©curitÃ© Electron â€” CSP durcie** : ajout de `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'` Ã  la CSP de production (ne casse ni React ni Electron). `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, `webSecurity:true` dÃ©jÃ  prÃ©sents.
- **IPC Security â€” Zod pour inventaire versioning** : nouveaux schÃ©mas `InventoryCreateVersionSchema`, `InventoryGetVersionsSchema`, `InventoryRestoreVersionSchema`, `InventoryCorrectionSchema` utilisÃ©s dans les handlers IPC (`safeParse`). Le preload envoie `{ sessionId }` pour `getVersions` (cohÃ©rent avec le schÃ©ma).
- **CSV â€” anti-injection de formule** : dÃ©jÃ  centralisÃ© dans `ExportService.csvEscape` (`=`, `+`, `-`, `@` â†’ apostrophe) â€” **aucune modification nÃ©cessaire**.

---

## 1. ProblÃ¨mes identifiÃ©s & corrigÃ©s

### P0-1 â€” Suppression de produit : l'historique n'Ã©tait pas protÃ©gÃ©
- **Fichier** : `src/services/ProductService.ts` (`deleteProduct`)
- **ProblÃ¨me** : `moveCount` (mouvements de stock) Ã©tait calculÃ© mais **non ajoutÃ©** aux rÃ©fÃ©rences bloquantes. Pire, le code **supprimait les mouvements de stock** (`DELETE FROM stock_movements`) lors de la suppression â€” destruction d'historique. `price_history` n'Ã©tait pas non plus bloquant.
- **Correction** :
  - `stock_movements` et `price_history` sont dÃ©sormais des rÃ©fÃ©rences **bloquantes** â†’ `EntityCannotBeDeletedError` si le produit a un historique.
  - La suppression transactionnelle ne touche **plus** `stock_movements` ; elle ne nettoie que la balance prÃ©calculÃ©e `inventory_balances` (donnÃ©e dÃ©rivÃ©e) puis supprime le produit.
- **Tests** : `tests/stock-engine.test.ts` couvre dÃ©jÃ  Â« produit avec mouvement â†’ refusÃ© Â» et Â« produit propre â†’ suppression OK Â».

### P0-3 â€” State machine d'inventaire
- **Fichier** : `src/repositories/InventorySessionRepository.ts`
- **ProblÃ¨me** : `update()` permettait de modifier `status` librement â†’ `VALIDATION â†’ DRAFT/COMPTAGE/CALCUL` possibles.
- **Correction** :
  - `update()` **refuse dÃ©sormais tout changement de `status`** (uniquement nom/notes). Les transitions passent par `startCounting()` (DRAFTâ†’COMPTAGE), `calculateGaps()` (COMPTAGEâ†’CALCUL), `validate()` (CALCULâ†’VALIDATION).
  - `remove()` **refuse la suppression d'une session `VALIDATION`** (l'historique de stock est protÃ©gÃ© ; on passe par une correction).

### P0-4 â€” EmpÃªcher la double validation
- **VÃ©rifiÃ©** : `validate()` possÃ©dait dÃ©jÃ  le garde `session.status === 'VALIDATION' â†’ throw` et utilise `runInTransaction` (atomique).
- **Test ajoutÃ©** : `tests/inventory-versioning.test.ts` â€” `validate()` â†’ stock 95 ; `validate()` Ã  nouveau â†’ **refusÃ©**, un seul mouvement (-5), pas de -10.

### P0-5 / P0-6 / P0-7 â€” Versioning d'inventaire de bout en bout + restauration + correction
- **Backend dÃ©jÃ  prÃ©sent** : `InventorySessionRepository.createVersion/getVersions/restoreVersion/correctValidatedInventory` (restauration crÃ©e **une nouvelle version**, jamais d'Ã©crasement).
- **Manquant cÃ¢blÃ©** :
  - `electron/ipc/operations.ipc.ts` : handlers `inventory:createVersion`, `inventory:getVersions`, `inventory:restoreVersion`, `inventory:correctValidatedInventory` (validation des inputs, `requireId`, `toHumanError`).
  - `electron/preload.ts` : `inventory.createVersion/getVersions/restoreVersion/correctValidatedInventory`.
  - `src/stores/useInventoryStore.ts` : Ã©tat `versions` + actions `createVersion/getVersions/restoreVersion/correctValidatedInventory`.
  - `src/pages/InventoryPage.tsx` : bouton Â« ðŸ’¾ Enregistrer une version Â», panneau Â« ðŸ•˜ Historique des versions Â» (numÃ©ro, date, note) avec bouton Â« Restaurer Â», et bouton Â« Corriger Â» pour les sessions `VALIDATION` (correction post-validation).
- **Test ajoutÃ©** : `V1=95, V2=97, V3=96 â†’ restore V2 â†’ V4=97`, V1/V2/V3 intactes ; correction post-validation `95 â†’ 97 â†’ +2 (stock 97)`.

---

## 2. Fichiers modifiÃ©s

- `src/services/ProductService.ts` â€” suppression protÃ©gÃ©e (moveCount + price_history).
- `src/repositories/InventorySessionRepository.ts` â€” state machine + protection session validÃ©e.
- `electron/ipc/operations.ipc.ts` â€” handlers versioning inventaire.
- `electron/preload.ts` â€” API versioning.
- `src/stores/useInventoryStore.ts` â€” actions + Ã©tat `versions`.
- `src/pages/InventoryPage.tsx` â€” UI historique des versions + restauration + correction.

## 3. Fichiers crÃ©Ã©s

- `tests/inventory-versioning.test.ts` â€” tests P0-3/P0-4/P0-6/P0-7.

## 4. Bases de donnÃ©es / migrations

- **Aucune migration nÃ©cessaire** pour les correctifs rÃ©alisÃ©s : `inventory_versions`, `inventory_item_versions`, les FK `ON DELETE RESTRICT` sur `stock_movements â†’ products`, etc. Ã©taient dÃ©jÃ  prÃ©sentes dans `database.sql`.
  - Les FK historiques critiques sont dÃ©jÃ  `ON DELETE RESTRICT` : `document_items`, `inventory_items`, `purchase_order_items`, `credit_note_refs`, `stock_movements` (product).
  - `product_batches.product_id` et `unit_conversions.product_id` sont `ON DELETE CASCADE` (donnÃ©es de configuration / lots, pas de l'historique comptable) â€” Ã  confirmer selon la rÃ¨gle mÃ©tier si vous considÃ©rez les lots comme historiques.

## 5. Comportement Delete / Archive

- Un produit **avec historique** (facture, inventaire, achat, avoir, **mouvement de stock**, **historique de prix**) â†’ **suppression refusÃ©e** (`EntityCannotBeDeletedError`), l'utilisateur doit **Archiver**.
- Un produit **sans aucune rÃ©fÃ©rence** â†’ suppression directe (balance dÃ©rivÃ©e nettoyÃ©e, produit supprimÃ©).

## 6. Machine Ã  Ã©tats d'inventaire

```
DRAFT â†’ COMPTAGE â†’ CALCUL â†’ VALIDATION
```
- `update()` ne peut plus changer le statut.
- Session `VALIDATION` indÃ©lÃ©bile par `update`/`remove` ; toute modification passe par **correction**.
- Restauration d'une version â†’ **nouvelle version** (V4), jamais d'Ã©crasement.

## 7. IntÃ©gritÃ© du stock

- **Non modifiÃ©** : `StockLedgerService` + `inventory_balances` (CMUP) restent atomiques via `runInTransaction`/`SAVEPOINT`. Le test `stock-engine.test.ts` (cohÃ©rence `recordMovement` vs `rebuildBalances`, CMUP 100Ã—10 + 100Ã—20 = 15) passe toujours.

## 8. Sauvegarde

- **Non modifiÃ©** dans cette session. Le prompt demande : backup **au dÃ©marrage** si expirÃ© (pas seulement `setInterval`), validation par `integrity_check` + checksum, tri par `mtimeMs` (pas `toLocaleString`). **Ã€ faire.**

## 9. SÃ©curitÃ© Electron / IPC

- **Non modifiÃ©** : `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true` doivent Ãªtre vÃ©rifiÃ©s dans `electron/main.ts`. Les nouveaux handlers versioning utilisent `requireId` + validation explicite. **Audit CSP (`object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`) Ã  faire.**

## 10. CSV / Performance

- **Non modifiÃ©** : import CSV charge tout en mÃ©moire ; streaming/batch + `bulkCreateProducts()` **Ã  faire** pour 100k lignes. Export CSV anti-injection de formule existant (Ã  vÃ©rifier centralisÃ©).

## 11. Tests exÃ©cutÃ©s

- **Nouveau test** : `npx vitest run tests/inventory-versioning.test.ts` â†’ **5/5 âœ“** (double validation, state machine, versioning V4, correction).
- **Suite complÃ¨te** (`npm test`) : **92 passÃ©s / 93**.
  - **1 Ã©chec prÃ©existant et sans lien avec ces modifications** : `tests/hardening.test.ts > Phase 4 â€” Exports > exportDashboard` â€” `expect(fs.existsSync(filePath)).toBe(true)` reÃ§oit `false`. Ce test concerne `ExportService.exportDashboard()` (fichier non crÃ©Ã© dans l'environnement de test). **Je n'ai touchÃ© aucun code d'export.**

## 12. Build / Typecheck

- `npx tsc --noEmit` â†’ **aucune erreur**.
- **Build non exÃ©cutÃ©** (non requis par les correctifs ; s'assurer que `npm run build` passe avant livraison).

## 13. ProblÃ¨mes restants (Ã  traiter en sessions suivantes)

1. **SÃ©curitÃ© Electron** : auditer `main.ts` (nodeIntegration/contextIsolation/sandbox), renforcer CSP.
2. **Migrations versionnÃ©es** : unifier `migrationRunner` + fonctions ad-hoc ; faire migrer anciennes FK `CASCADE` â†’ `RESTRICT` si nÃ©cessaire (via migration, pas DROP).
3. **Backup** : scheduling au dÃ©marrage si expirÃ©, validation `integrity_check` + checksum, tri par `mtimeMs`.
4. **CSV import** : streaming/batch/transaction pour gros fichiers.
5. **SÃ©curitÃ© filesystem** : confiner `path`/`fs` au dataDir (partiellement dÃ©jÃ  via `validatePathWithinDataDir`).
6. **Test exportDashboard** (prÃ©existant) : diagnostiquer pourquoi le fichier n'est pas crÃ©Ã©.
7. **Pagination** / index supplÃ©mentaires si les volumÃ©tries (100kâ€“1M mouvements) le nÃ©cessitent.

---

## RÃ©sumÃ© final (honnÃªte)

âœ” **P0-1, P0-3, P0-4, P0-5, P0-6, P0-7** : **implÃ©mentÃ©s et validÃ©s par tests** (5/5 verts, `tsc` OK).
âš  **P0-2 (audit FK), P1 (migrations, backup, security, CSV, performance)** : **restent Ã  faire** â€” effort multi-sessions.
âœ˜ **1 test Ã©choue** : `exportDashboard` (prÃ©existant, hors pÃ©rimÃ¨tre de mes changements).

**Je ne peux pas honnÃªtement affirmer que les 18 catÃ©gories sont complÃ¨tes.** Ce qui a Ã©tÃ© livrÃ© est **rÃ©el, testÃ© et sÃ»r pour les donnÃ©es** ; le reste nÃ©cessite des sessions supplÃ©mentaires ciblÃ©es.
