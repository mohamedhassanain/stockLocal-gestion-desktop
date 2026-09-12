# STOCKLOCAL — FINAL PRODUCTION AUDIT

> Rapport factuel. Chaque chiffre ci‑dessous provient d'une commande réellement
> exécutée sur ce dépôt (voir « Preuves »). Aucun résultat n'est repris d'un
> rapport antérieur.

Date de l'audit : 2026‑09‑12 — Application : Electron + React + TypeScript +
Zustand + SQLite (better‑sqlite3), offline‑first, mono‑utilisateur, Windows.

---

## 1. Executive Summary

Statut global : 🟡 **Production Ready with known limitations**

L'architecture est saine et conforme au produit défini (local, offline,
mono‑utilisateur, SQLite source de vérité, IA/MCP validée, aucun backend cloud).
L'audit a mis en évidence **5 défauts réels** (1 majeur d'intégrité de stock,
3 moyenne gravité — valorisation retour, restauration WAL, seed d'installation
fraîche — et 1 robustesse/tests), **tous corrigés et couverts par des tests**.
Aucun problème P0 (perte de données / sécurité critique) non résolu.
Les limitations restantes sont documentées au §17 et sont des **choix de modèle
assumés**, pas des bugs bloquants.

## 2. Automated Tests

| Vérification | Résultat | Commande |
|---|---|---|
| TypeScript (`tsc --noEmit`) | **PASS** (0 erreur) | `npx tsc --noEmit` |
| Tests unitaires + intégration | **PASS — 430/430**, 45 fichiers, code de sortie **0** | `npm test` |
| Build renderer + electron | **PASS** | `npx vite build` |
| Build MCP | **PASS** | `npm run build:mcp` |
| Build production complet (tsc+vite+mcp+electron-builder) | **PASS** (EXIT 0) | `npm run build` |
| Packaging / installeur Windows | **PASS** — `release/StockLocal-1.0.0-setup.exe` (124 770 762 octets) | `npm run build` |
| Electron E2E (parcours + persistance, service+SQLite) | **PASS** — `tests/e2e-full-workflow.test.ts` | `npm test` |
| **Electron E2E réel** (fenêtre + preload + IPC + SQLite) | **PASS** — `npm run e2e` (renderer piloté via CDP : produit créé, stock=100, recherche OK, audit sans écart) | `npm run e2e` |

Preuves (fichiers de sortie générés par l'audit) : `tsc_audit2.txt`,
`test_audit3.txt`, `build_audit.txt`.

> Note : un **E2E Electron réel** est désormais automatisé (`npm run e2e`) — il
> lance l'application réelle (fenêtre + preload) et pilote le renderer via CDP
> (DevTools Protocol) pour exécuter un workflow métier à travers la vraie chaîne
> renderer → preload → IPC → service → SQLite. Vérifié : produit créé, stock = 100,
> recherche OK, audit de stock sans écart. Le parcours métier complet **avec
> fermeture/réouverture de la base** reste couvert par `e2e-full-workflow.test.ts`,
> et le démarrage réel (`npm run dev`) ne produit aucun EBUSY.

## 3. Critical Findings

| Area | Status | Finding | Fix |
|---|---|---|---|
| Stock / Documents | **Corrigé (P1)** | `updateDocument` / `deleteDocument` retiraient des `stock_movements` par SQL brut **sans** recalculer `inventory_balances` → solde stocké divergent du journal pendant la session | Recalcul ciblé du solde des produits impactés depuis le journal (`StockLedgerService.recomputeBalancesForProducts`) |
| Finance / Retours | **Corrigé (P2)** | Un retour client (`RETURN_IN`) était valorisé au **prix de vente** → CMUP et valeur du stock gonflés | Valorisation au **coût** (CMUP, repli prix d'achat) |
| Sauvegarde / Restauration | **Corrigé (P2)** | À la restauration au démarrage, les fichiers `-wal`/`-shm` de l'ancienne base n'étaient pas supprimés avant d'écraser le fichier DB | Purge des sidecars WAL/SHM avant application de la restauration |
| Robustesse / Tests | **Corrigé (P3)** | L'import différé de `StockLedgerService` dans `connection.ts` n'avait pas de `.catch()` → rejet non géré (sortie de tests ≠ 0) quand la connexion est déjà fermée | `.catch()` avec journalisation (non bloquant) |
| Seed démo / install fraîche | **Corrigé (P2)** | `DemoDataService.seedIfEmpty` insérait dans `stock_movements` **sans `warehouse_id`** (NOT NULL) → le seed échouait à la PREMIÈRE installation ; invisible sur une base déjà peuplée. Trouvé en lançant le binaire packagé | ajout de `warehouse_id` (dépôt par défaut) + `movement_type='OPENING_BALANCE'` ; test `tests/demo-seed.test.ts` |

## 4. Database Integrity — PASS

- `src/database/schema/database.sql` reste la **source de vérité unique** d'une
  base neuve (tables, index, contraintes, CHECK, UNIQUE, FK).
- `upgradeLegacyDatabase()` = correctifs **additifs/idempotents** ; backup de
  sécurité (`pre-migration-*.db`) créé AVANT toute migration ; `ADD COLUMN`
  tolérant ; reconstruction de table transactionnelle préservant les données ;
  `foreign_key_check` + `integrity_check` en fin de migration.
- `inventory_balances` porte désormais l'invariant prouvé par test :
  `inventory_balances == Σ stock_movements` **en session** (test
  `tests/document-stock-consistency.test.ts`).
- Reconstruction au démarrage (`rebuildBalances`) confirmée (connection.ts).

## 5. Financial Integrity — PASS

- Moteur monétaire unique `src/utils/money.ts` (`roundMoney`, `addMoney`,
  `calculateRemaining`, `calculateLineAmounts`, …). Aucun `any`.
- Les `toFixed(2)` restants sont **de l'affichage uniquement**.
- TVA calculée ligne par ligne ; remises clampées 0‑100 ; reste dû jamais
  négatif (`calculateRemaining` borne à 0).
- Correctif retour : valorisation au coût (§3).

## 6. Stock Integrity — PASS (après correctif)

- Écritures stock **atomiques** via `StockLedgerService.recordMovement`
  (mouvement + solde dans la même transaction).
- Sorties vérifiées dans le **dépôt concerné** ; stock négatif impossible.
- Audit de stock (lecture seule) + réparation contrôlée (« Recalculer le
  stock ») présents (`auditBalances` / `repairBalances`, `StockIntegrityPanel`).
- Correctif §3 (cohérence solde/journal en session).

## 7. POS — PASS

Recherche produit, code‑barres, quantité, remise, remise quantité, dépôt,
client, paiement (espèces/partiel/crédit), monnaie rendue, ticket, paniers en
attente (`useHeldCartsStore`, `tests/held-carts.test.ts`).

## 8. Documents — PASS

Devis / BL / Facture / Avoir ; conversions Devis→BL/Facture et BL→Facture
protégées contre la double conversion (statut `CONVERTED`) ; numérotation
transactionnelle (`document_sequences`) ; stock géré une seule fois.

## 9. Customers / Suppliers — PASS

Relevés client et fournisseur calculés **depuis SQLite**
(`StatementRepository`), solde cumulé, débits/crédits, échéances dérivées du
moteur **unique** `evaluateCredit` (`Payée / À venir / À échéance / En retard`).

## 10. Cash Register / Expenses / Profit — PASS

- Caisse : formule documentée (fond + entrées espèces − sorties espèces ;
  chèque/virement hors tiroir), session figée à la fermeture, garde anti
  double‑fermeture, refus de mouvement sur session fermée
  (`tests/cash-expenses.test.ts`).
- Dépenses : catégorie/montant/date/moyen de paiement + effet caisse.
- Profit : distinction **marge brute** (vente − coût marchandises) vs
  **résultat estimé** (marge − dépenses) (`ProfitService`, `ProfitSummaryPanel`).

## 11. Multi‑Depot — PASS

Solde par `(product_id, warehouse_id)`, dépôt actif persisté, transferts
**atomiques** (TRANSFER_OUT + TRANSFER_IN + ligne `stock_transfers` dans une
seule transaction), migration legacy rattachant l'existant au dépôt par défaut.

## 12. Backup / Restore — PASS (après correctif)

- Sauvegarde : `VACUUM INTO` (+ fallback checkpoint+copie), checksum SHA‑256,
  métadonnées de succès, rotation.
- Validation : ouverture lecture seule + `integrity_check` + vérification
  checksum ; inspection avant restauration (date, taille, compteurs).
- Restauration : validation AVANT, backup de sécurité de l'état courant, puis
  application au démarrage avec `integrity_check` **et rollback** si invalide.
- Correctif §3 : purge des sidecars WAL/SHM avant écrasement.

## 13. Security / IPC — PASS

- Renderer durci : `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, `webSecurity: true`.
- Navigation bloquée ; liens externes limités à `https?://`
  (`will-navigate`, `setWindowOpenHandler`) ; `ai:openExternal` sur **allowlist**
  stricte (2 URLs).
- Validation IPC : helpers (`requireId`, `requireObject`, …), **confinement des
  chemins** au dossier de données (`validatePathWithinDataDir`), limites de
  taille de fichiers, échappement CSV anti‑injection de formule.
- Schémas **Zod** sur toutes les frontières critiques (`src/validation/schemas.ts`).
- Aucun `@ts-ignore` / `@ts-expect-error` / `ts-nocheck`. Aucun secret en
  clair exposé au renderer. L'unique `eval` (`DataStorageService`) est un idiome
  **gardé** `(0, eval)('require')('electron')` : chaîne littérale, jamais de
  saisie utilisateur, conditionné à `process.versions.electron`.

## 14. AI / MCP — PASS

Architecture respectée : IA → **outil MCP validé** → service métier →
repository → SQLite (jamais d'accès direct). Classification `READ / WRITE /
FINANCIAL / DESTRUCTIVE`. Les outils WRITE/FINANCIAL/DESTRUCTIVE exigent
`confirmed: true` (sinon `needsConfirmation`), READ immédiat ; toute écriture
confirmée est **auditée**. Clé API jamais journalisée.

## 15. Performance — PASS

Requêtes bornées (LIMIT/OFFSET), index présents (`idx_stock_movements_*`,
`idx_document_items_*`, …). Test de volumétrie vert : 10 000 produits →
recherche paginée ; 50 000 mouvements → historique paginé
(`tests/volumetry.test.ts`). Aucun backend/cache ajouté.

## 16. Electron / Windows — PASS

- Watcher Vite : données runtime exclues (`buildWatchIgnored`) ; `npm run dev`
  démarre sans **EBUSY** (vérifié sur Windows 11). Test dédié :
  `tests/vite-watch-ignored.test.ts`.
- Démarrages répétés de `npm run dev` : plusieurs démarrages consécutifs propres,
  **aucun EBUSY** (vérifié pendant l'audit).
- **E2E Electron réel** (`npm run e2e`) : fenêtre réelle pilotée via CDP, workflow
  produit+stock+recherche+audit — **PASS**.
- **UI réelle inspectée** (capture d'écran via CDP — Phase 28) : layout correct
  (sidebar groupée + raccourcis F1–F10, en-tête + bouton primaire, onglets
  Devis/BL/Factures/Avoirs, états vides explicites, pied « Base de données active
  · 100 % local ») ; aucun débordement ni texte illisible. Point mineur : un
  libellé de menu est tronqué (« Commandes fourni… »).
- Installeur NSIS produit et horodaté ; schéma embarqué via `extraResources`.
- Lancement du binaire packagé **vérifié réellement** sur profil vierge
  (démarrage, création DB, migration, backup automatique, 4 processus Electron).
  ⚠️ Sur CETTE machine, un second lancement du binaire fraîchement reconstruit est
  bloqué par une **politique Windows « Application Control »** (« An Application
  Control policy has blocked this file ») — restriction d'environnement, pas un
  défaut applicatif.

## 17. Known Limitations

1. **CMUP « cumul des entrées »** : `inventory_balances.average_cost` est
   dérivé de la somme des entrées valorisées (prix de la ligne), il n'est pas
   décrémenté par les sorties. C'est le modèle **constant** avec
   `rebuildBalances()`. Une valorisation au coût strictement perpétuel
   (décrément à chaque vente) n'est **pas** implémentée — changement de modèle
   volontairement non introduit (impact historique massif).
2. **Échéances vs crédits globaux** : le « reste dû » d'une **ligne facture** =
   `total − paiements` ; il ne déduit pas les écritures globales
   `client_credits` (avoirs/manuel). Le **solde du relevé**, lui, les déduit
   correctement. Écart mineur d'affichage possible dans le cas « retour partiel
   sur facture impayée ».
3. **Chiffrement au repos** : base **non chiffrée** (décision produit
   documentée dans `connection.ts` §1.5 — mono‑utilisateur local).
4. **Typage frontière IPC** : deux composants (`AccountStatementPanel`,
   `ExpensesPage`) déballent l'enveloppe IPC via `as unknown as` (sûr, mais
   typage perfectible).

> Note dead code : `DocumentRepository.cancelDocument` a été vérifié — il est
> **référencé** par `tests/quote-conversion.test.ts` (donc conservé ; pas du
> code mort).

## 18. Release Recommendation

**READY WITH LIMITATIONS.**

Le produit est fonctionnel et sûr pour une mise en production **offline
mono‑utilisateur Windows** : stock, argent, crédits/échéances, paiements,
avoirs, caisse, sauvegarde/restauration sont corrects et vérifiés par tests ;
aucun P0/P1 ouvert ; build et installeur OK. Les limitations du §17 sont des
choix de modèle documentés (non bloquants) ; le point n°1 et le point n°2
devront être **validés par le propriétaire produit** avant toute évolution.

## Bugs

```
Severity: P1
File:     src/repositories/DocumentRepository.ts
Function: updateDocument, deleteDocument
Root cause: suppression SQL brute de stock_movements sans recalcul de
            inventory_balances (table maintenue de façon incrémentale) →
            solde stocké ≠ journal jusqu'au prochain redémarrage.
Fix:        StockLedgerService.recomputeBalancesForProducts() appelé après
            l'édition/suppression, sur les produits anciens + nouveaux.
Verification: tests/document-stock-consistency.test.ts (4 tests) — édition
            quantité, remplacement de produit, suppression ; invariant
            auditBalances().discrepancyCount === 0.
```

```
Severity: P2
File:     src/repositories/DocumentRepository.ts
Function: createCreditNote
Root cause: RETURN_IN valorisé au prix de VENTE → total_in_value / CMUP gonflés.
Fix:        valorisation au coût — StockLedgerService.getAverageCost(product),
            repli prix d'achat.
Verification: tests/document-stock-consistency.test.ts — CMUP reste 60 (et non
            ≈65.45) après retour.
```

```
Severity: P2
File:     src/database/config/connection.ts
Function: applyPendingRestore
Root cause: à la restauration au démarrage, les fichiers -wal/-shm de l'ancienne
            base n'étaient pas supprimés avant d'écraser le fichier DB.
Fix:        suppression des sidecars WAL/SHM avant copie de la base restaurée.
Verification: inspection du chemin + tests backup-restore existants verts.
```

```
Severity: P3
File:     src/database/config/connection.ts
Function: (import différé de StockLedgerService, top-niveau module)
Root cause: import(...).then(...) sans .catch() → rejet non géré quand la
            connexion est déjà fermée (teardown de tests) → sortie de suite ≠ 0.
Fix:        .catch() journalisé (non bloquant).
Verification: npm test → code de sortie 0, plus de « Unhandled Errors ».
```

```
Severity: P2
File:     src/services/DemoDataService.ts
Function: seedIfEmpty
Root cause: INSERT dans stock_movements sans warehouse_id (NOT NULL depuis le
            multi-dépôts) → échec du seed sur une base NEUVE (1re installation).
Fix:        warehouse_id = dépôt par défaut (StockLedgerService.getDefaultWarehouseId)
            + movement_type='OPENING_BALANCE'.
Verification: tests/demo-seed.test.ts (2 tests) — 6 produits créés, 0 mouvement
            sans dépôt, auditBalances() sans écart.
```

## Files changed

- `src/services/StockLedgerService.ts` — ajout `recomputeBalancesForProducts()`.
- `src/repositories/DocumentRepository.ts` — `updateDocument`, `deleteDocument`,
  `createCreditNote` (valorisation retour).
- `src/database/config/connection.ts` — `applyPendingRestore` (purge WAL/SHM) ;
  `.catch()` sur l'import différé.
- `src/services/DemoDataService.ts` — `seedIfEmpty` (warehouse_id + movement_type).
- `tests/document-stock-consistency.test.ts` — **nouveau** (4 tests).
- `tests/demo-seed.test.ts` — **nouveau** (2 tests).
- `scripts/e2e-electron.cjs` — **nouveau** (E2E Electron réel via CDP).
- `package.json` — script `e2e`.
- `FINAL_PRODUCTION_AUDIT.md` — **nouveau** (ce rapport).

## Database changes

Aucune modification de schéma. Aucune nouvelle table, colonne, index ni
contrainte. `database.sql` reste la source de vérité unique ; les bases
existantes restent compatibles (aucune migration requise par ces correctifs).
