# StockLocal — AUDIT DE PRODUCTION FINAL

**Statut : RAPPORT AUTORITATIF — état courant uniquement.**
**Date : 2026-09-13** · **Version : 1.0.0** · **Plateforme : Windows x64**

> ⚠️ **Ce document REMPLACE tous les rapports précédents.** Tous les autres
> fichiers d'audit du dépôt sont **HISTORIQUES et périmés** (`Historical /
> superseded`) : leurs compteurs de tests et leurs statuts ne sont plus valides.
> Voir la section « Rapports historiques » en fin de document.

Toutes les valeurs de ce rapport proviennent de **commandes réellement exécutées**
sur l'arbre de travail le 2026-09-13. Aucune valeur n'est reprise d'un ancien
rapport. Là où une vérification n'a pas pu être faite, c'est écrit
`NON VÉRIFIÉ` — jamais `PASS`.

---

## 1. Comment reproduire ce rapport

```bat
npm test                                    :: Vitest via Electron
npx tsc --noEmit                            :: renderer / src (tsconfig.json)
npx tsc -p tsconfig.node.json --noEmit      :: main + electron (tsconfig.node.json)
npm run build                               :: tsc + vite build + MCP build + electron-builder
npm run e2e                                 :: Electron réel : renderer → preload → IPC → SQLite
```

---

## 2. Vérifications automatisées — RÉSULTATS RÉELS

| Contrôle | Commande | Résultat mesuré | Statut |
|---|---|---|---|
| Tests | `npm test` | **57 fichiers · 538 tests · 538 PASS · 0 FAIL** · `EXIT=0` | ✅ PASS |
| TypeScript (renderer) | `npx tsc --noEmit` | 0 erreur · `EXIT=0` | ✅ PASS |
| TypeScript (main/electron) | `npx tsc -p tsconfig.node.json --noEmit` | 0 erreur · `EXIT=0` | ✅ PASS |
| Build Vite (renderer) | `npm run build` | `built in 2.72s` | ✅ PASS |
| Build Vite (main + preload) | `npm run build` | `built in 9.91s` / `1.47s` | ✅ PASS |
| Build MCP standalone | `vite build --config vite.config.mcp.ts` | `dist-electron/mcp-server.js` · `built in 19ms` | ✅ PASS |
| Packaging Windows | `electron-builder` | `release\StockLocal-1.0.0-setup.exe` produit · `EXIT=0` | ✅ PASS |
| E2E Electron réel | `npm run e2e` | workflow IPC/SQLite validé · `EXIT=0` | ✅ PASS |

**Compteur de tests : 538 tests dans 57 fichiers, 538 passent, 0 échoue.**
C'est le seul compteur valide du dépôt. Tout autre chiffre (430/430, 165/165,
155/155, 149, 147, 139, 93/94, 88/88, 85/85, 504…) est **obsolète**.

---

## 3. Vérification métier (business engine)

Source de vérité : les fichiers de tests ci-dessous, exécutés dans la suite
`npm test`.

| Domaine | Statut | Preuve (test exécuté) |
|---|---|---|
| **CMUP** (coût moyen pondéré mobile) | ✅ PASS | `tests/cmup-weighted-average.test.ts` (9), `tests/stock-engine.test.ts` |
| **COGS / valorisation du stock** | ✅ PASS | `tests/cmup-weighted-average.test.ts`, `tests/profit.test.ts` |
| **Solde client** (factures incluses) | ✅ PASS | `tests/client-balance.test.ts` (8), `tests/statement.test.ts` |
| **Solde fournisseur** (commandes incluses) | ✅ PASS | `tests/client-balance.test.ts`, `tests/statement.test.ts` |
| **Échéances** (due_date ≥ invoice_date) | ✅ PASS | `tests/credit-echeance.test.ts`, `tests/echeance-qa.test.ts`, `tests/date-only-safety.test.ts` |
| **Retours / avoirs** | ✅ PASS | `tests/returns-credit-note.test.ts`, `tests/document-stock-consistency.test.ts` |
| **Multi-dépôts** | ✅ PASS | `tests/multi-warehouse.test.ts`, `tests/warehouses.test.ts`, `tests/migration-legacy-warehouses.test.ts` |
| **Caisse** (sessions, mouvements) | ✅ PASS | `tests/cash-expenses.test.ts`, `tests/cash-movement-types.test.ts`, `tests/held-carts.test.ts` |
| **Dépenses** | ✅ PASS | `tests/expense-categories.test.ts`, `tests/cash-expenses.test.ts` |
| **Marge / résultat** | ✅ PASS | `tests/profit.test.ts` |
| **Inventaire** (versioning, corrections) | ✅ PASS | `tests/inventory-versioning.test.ts` |
| **Lots / FEFO / péremption** | ✅ PASS | `tests/fefo-batches.test.ts`, `tests/product-batches.test.ts` |
| **Achats / réceptions** | ✅ PASS | `tests/purchase-receiving.test.ts` |
| **Devis → BL → facture** | ✅ PASS | `tests/quote-conversion.test.ts` |
| **Recherche globale** | ✅ PASS | `tests/global-search.test.ts` |
| **Conformité DGI** (UBL, lecture seule) | ✅ PASS | `tests/dgi-ubl.test.ts` |
| **Assistant IA / MCP** | ✅ PASS | `tests/ai-assistant.test.ts`, `tests/ai-chat-e2e.test.ts` |

### 3.1 CMUP — formule implémentée

```text
Entrée :  Nouveau CMUP = ((Qté_avant × CMUP_avant) + (Qté_entrée × Coût_entrée))
                         / (Qté_avant + Qté_entrée)

Sortie :  Le CMUP NE CHANGE PAS. Une sortie valorise au CMUP courant
          (colonne additive `stock_movements.unit_cost` = base du COGS).

Entrée sans coût : valorisée au CMUP courant (jamais 0).
Rejeu du journal : ordre d'écriture (created_at, rowid) — la colonne `date`
          mélange des formats et faussait l'ordre achat/vente du même jour.
Transfert de dépôt : neutre en valeur (même CMUP des deux côtés).
```

**Le prix de vente n'est jamais utilisé comme coût de stock.** Vérifié par
`tests/cmup-weighted-average.test.ts` (achats multiples, vente, épuisement
total, réachat, retour, transfert, rebuild).

### 3.2 Solde client / fournisseur

Le solde est défini par **une expression SQL unique** partagée
(`clientBalanceSql` / `supplierBalanceSql`) incluant :

```text
+ factures / bons de livraison non soldés (documents)
+ dettes manuelles (client_credits / supplier_credits)
+ achats (purchase_orders) côté fournisseur
− paiements encaissés / règlements
− avoirs (credit notes)
```

La même expression sert au repository **et** à l'export et au relevé de compte,
donc les trois valeurs coïncident toujours (vérifié par l'invariant de
`tests/client-balance.test.ts` : « le solde du repository ÉGALE toujours le
solde du relevé de compte »).

### 3.3 Échéances — validation en couche métier

`src/domain/credit/CreditStatus.ts` est la **source de vérité unique** :

- `isValidDueDate(invoiceDate, dueDate)` → impose `due_date >= invoice_date`.
  **Appelée dans `src/services/DocumentService.ts`** à la création (ligne 33)
  et à la modification (ligne 63) — donc dans la couche service, pas seulement
  dans l'UI.
- `evaluateCredit(...)` → `PAYE` / `A_VENIR` / `A_ECHEANCE` / `EN_RETARD`, avec
  comparaison **date-seule** (`compareDateOnly` / `daysBetweenDateOnly`) : aucune
  bascule de fuseau horaire (`2026-09-13` ne devient jamais `2026-09-12`).

---

## 4. Données : base neuve, migration, sauvegarde, restauration

| Contrôle | Statut | Preuve |
|---|---|---|
| Base **neuve** (schéma, index, contraintes) | ✅ PASS | `tests/database-schema.test.ts`, `tests/db-audit-schema.test.ts`, `tests/db-audit-indexes.test.ts` |
| Dépôt par défaut auto-créé | ✅ PASS | E2E réel : `[DB] Dépôt par défaut créé : « Dépôt principal »` |
| **Migration d'une base ancienne** | ✅ PASS | `tests/db-audit-migration.test.ts`, `tests/migration-legacy-warehouses.test.ts`, `tests/db-audit-integrity.test.ts` |
| Pas de perte / doublon après migration | ✅ PASS | `tests/db-audit-integrity.test.ts`, `tests/stock-integrity.test.ts` |
| Backup pré-migration automatique | ✅ PASS | E2E réel : `[DB] Backup de sécurité avant migration : …pre-migration-…db` |
| **Sauvegarde** (VACUUM INTO + intégrité + checksum) | ✅ PASS | `tests/backup-restore.test.ts` · E2E réel : `[Backup] Sauvegarde marquée comme réussie (intégrité + checksum OK)` |
| **Restauration** d'une sauvegarde valide | ✅ PASS | `tests/backup-restore.test.ts` (restauration appliquée au démarrage) |
| **Sauvegarde invalide / corrompue** → base courante intacte | ✅ PASS | `tests/backup-restore.test.ts` + `applyPendingRestore()` : copie de sécurité → `integrity_check` → rollback automatique si invalide |
| WAL / SHM gérés à la restauration | ✅ PASS | `applyPendingRestore()` supprime les sidecars `-wal`/`-shm` de l'ancienne base avant remplacement |
| Persistance après **redémarrage manuel** | ⚠️ PARTIELLEMENT VÉRIFIÉ | La restauration différée et la migration s'exécutent au démarrage et sont couvertes par `tests/backup-restore.test.ts`. Le cycle manuel complet n'a pas été rejoué à la main. |

---

## 5. Exécution réelle (runtime Electron)

`npm run e2e` (`scripts/e2e-electron.cjs`) — **exécution réelle, pas un test unitaire** :

```text
[E2E] dossier données : …\Temp\stocklocal-e2e-1789310682301
[app] [DB] Schéma appliqué (database.sql).
[app] [DB] Dépôt par défaut créé : « Dépôt principal ».
[app] [DB] Balances de stock recalculées.
[app] [Backup] Backup VACUUM INTO créé : …stocklocal-backup-….db
[app] [Backup] Sauvegarde marquée comme réussie (intégrité + checksum OK).
[E2E] renderer ciblé : file:///…/dist/index.html
[E2E] workflow = {"createdId":"…","level":100,"foundCount":1,"discrepancy":0,"ok":true}
[E2E]   ✔ produit créé
[E2E]   ✔ stock = 100
[E2E]   ✔ produit trouvé par recherche
[E2E]   ✔ audit stock sans écart
[E2E] SUCCÈS — workflow réel renderer→preload→IPC→SQLite validé.
EXIT=0
```

**Chaîne réellement traversée** : fenêtre Electron → renderer (`dist/index.html`)
→ `preload` (`contextBridge`) → IPC → SQLite (better-sqlite3), sur une base
créée de zéro dans un dossier temporaire. Statut : ✅ **PASS**.

> Les étapes métier du workflow complet (achat → vente → paiement → retour →
> transfert → caisse → clôture) sont couvertes au niveau moteur par la suite de
> tests (538 tests), et le canal renderer→IPC→SQLite est prouvé par cet E2E.
> Le parcours **entièrement cliqué dans l'interface** au-delà de ce workflow :
> `NON VÉRIFIÉ` en tant que scénario UI exhaustif.

---

## 6. Packaging Windows

`npm run build` → `electron-builder` · `EXIT=0`.

| Élément | Vérifié |
|---|---|
| Installateur NSIS | `release\StockLocal-1.0.0-setup.exe` (+ `.blockmap`, `latest.yml`) |
| Cible | `nsis`, `arch=x64`, `oneClick=false`, `perMachine=false` |
| Exécutable décompressé | `release\win-unpacked\StockLocal.exe` |
| Schéma embarqué | `release\win-unpacked\resources\schema\database.sql` (`extraResources`) |
| Application packagée | `resources\app.asar` + `resources\app.asar.unpacked` |
| **Module natif déballé** | `app.asar.unpacked\node_modules\better-sqlite3` ✅ |
| Assistant d'élévation | `resources\elevate.exe` |

**Installation sur machine vierge : `NON VÉRIFIÉ`.** L'installateur est
**produit et son contenu inspecté**, mais il n'a pas été installé sur une machine
Windows « propre » dans cet environnement.

---

## 7. Sécurité

| Contrôle | Valeur constatée | Statut |
|---|---|---|
| `contextIsolation` | `true` | ✅ |
| `nodeIntegration` | `false` | ✅ |
| `sandbox` | `true` | ✅ |
| `webSecurity` | `true` (défaut) | ✅ |
| CSP stricte (build prod) | `default-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'` | ✅ |
| Navigation hors app | `will-navigate` bloqué ; liens http(s) → navigateur système | ✅ |
| Fenêtres/popups | `setWindowOpenHandler` → `deny` | ✅ |
| Preload | **allowlist** explicite (`contextBridge`), pas de `ipcRenderer` brut exposé | ✅ |
| Confinement des chemins | `validatePathWithinDataDir` / `validatePathWithinSubDir` | ✅ |
| Limites de taille de fichier | `FILE_LIMITS` (image 5 Mo, CSV 50 Mo) | ✅ |
| Anti-injection CSV (formules) | `csvEscape()` préfixe `= + - @` | ✅ |
| Erreurs SQLite → français | `toHumanError()` | ✅ |
| `@ts-ignore` / `@ts-expect-error` | **0** | ✅ |
| `as any` | **0** | ✅ |
| `eval` | 1 occurrence (`DataStorageService`), gardée par `process.versions.electron` + `try/catch`, commentée | ⚠️ Accepté (documenté) |

Aucun accès SQL arbitraire, shell arbitraire ou écriture filesystem arbitraire
exposé au renderer.

---

## 8. Sécurité de typage

Traitement de l'enveloppe IPC centralisé : **`src/utils/ipcResult.ts`**.

Avant cette passe, 4 emplacements de code de production convertissaient une
réponse IPC avec `as unknown as` (aucune vérification) :

- `src/components/AccountStatementPanel.tsx` (×2)
- `src/pages/ExpensesPage.tsx` (×2)
- `src/usecases/stock/StockUseCases.ts` (×2 — cast inutile : `StockMovement`
  **est** un alias de `StockMovementRow`)
- `src/components/ui/Toaster.tsx` — `React.ComponentType<any>` → `LucideIcon`

Après correction : un seul normalisateur typé, `toIpcResult<T>()`, couvert par
**10 tests** (`tests/ipc-result.test.ts`) ; les composants n'effectuent plus
aucune assertion non vérifiée.

`npx tsc --noEmit` et `npx tsc -p tsconfig.node.json --noEmit` : **0 erreur**.

---

## 9. Chiffrement de la base au repos — LIMITATION DE RELEASE

**Statut : NON IMPLÉMENTÉ.** `stocklocal.db` est **en clair** sur le disque.
Aucune revendication de sécurité au repos ne doit être faite.

### 9.1 Faisabilité — MESURÉE (pas supposée)

La justification de refus qui figurait dans `src/database/config/connection.ts`
était **factuellement fausse** (elle affirmait une incompatibilité d'ABI Electron
et la nécessité de recompiler avec VS Build Tools). Vérifications réelles :

| Point | Constat mesuré |
|---|---|
| Version du fork | `better-sqlite3-multiple-ciphers@13.0.3` = **même ligne de version** que `better-sqlite3@13.0.3` (drop-in) |
| Binaires | prebuilds **N-API** fournis, dont `prebuilds\win32-x64.node` → **aucune compilation nécessaire** |
| Création base chiffrée | `CREATE_OK` |
| Réouverture avec `cipher` + `key` | `REOPEN_OK {"a":7}` |
| Lecture **sans** clé | `NOKEY_REJECTED_OK: file is not a database` |
| Lecture avec **mauvaise** clé | `BADKEY_REJECTED_OK: file is not a database` |
| En-tête `SQLite format 3` dans le fichier | **absent** |
| Chaîne en clair présente dans le fichier | **aucune** |

**Conclusion : SQLCipher est réellement disponible et fonctionnel, sans
compilation, sur cette pile (Electron 43.4.1 / better-sqlite3 13.0.3). Ce n'est
pas un blocage technique.**

### 9.2 Pourquoi ce n'est pas activé dans cette release

C'est un **choix de périmètre de release**, pas un refus de principe. Son
activation est un changement **de niveau architecture** (interdit dans une passe
de stabilisation) et touche :

1. **Pilote natif** : `better-sqlite3` → fork, sur le main process, le serveur MCP
   autonome (`vite.config.mcp.ts`) et le `postinstall`
   (`electron-builder install-app-deps`), plus `asarUnpack` du `.node`.
2. **Gestion de clé — non écrite**. La clé doit être protégée par le coffre OS
   (Electron `safeStorage` = DPAPI sur Windows). Jamais dans le code, le dépôt,
   la base ou un fichier de configuration en clair.
3. **Migration des bases existantes — non écrite** :
   `vérif → sauvegarde → sqlcipher_export() → integrity_check → remplacement
   atomique`, en conservant la base d'origine en cas d'échec.
4. **Sauvegardes** : aujourd'hui des `VACUUM INTO` en clair ; elles devraient
   hériter du même modèle de clé.

**Livrer une implémentation partielle serait pire que l'absence de chiffrement** :
fausse garantie de sécurité et risque de base client irrécupérable. La décision
retenue est donc : non chiffré aujourd'hui, limitation **publiée**, chemin de
migration documenté.

### 9.3 Protections réellement en place (sans chiffrement au repos)

Dossier de données utilisateur hors `Program Files` (permissions OS), renderer
en sandbox, confinement des chemins IPC, allowlist IPC, validations Zod côté
main, sauvegardes locales. **Cela ne remplace pas le chiffrement au repos.**

---

## 10. Rapports historiques (ne plus s'y fier)

Ces fichiers décrivent des états **antérieurs**. Leurs compteurs de tests sont
**périmés**. Ils sont conservés pour traçabilité uniquement.

| Fichier | Statut | Compteur périmé qu'il contient |
|---|---|---|
| `FINAL_HARDENING_REPORT.md` | Historical / superseded | 139 → 155 tests |
| `FINAL_AUDIT_REPORT.md` | Historical / superseded | 165/165 |
| `AUDIT_DB_RESULT.md` | Historical / superseded | 504 tests |
| `COMPLIANCE_AUDIT.md` | Historical / superseded | 88/88 |
| `FINAL_AUDIT.md` | Historical / superseded | 88/88 |
| `REFACTORING_REPORT.md` | Historical / superseded | 85/85 |
| `SUMMARY.md` | Historical / superseded | 93/94 |
| `docs/IMPLEMENTATION_PHASES_1_6.md` | Historical / superseded | 227/229 tests |
| `ARCHITECTURE_AUDIT.md` | Historical / superseded | — |
| `CAHIER_DES_CHARGES.md` | Référence fonctionnelle (hors audit) | — |
| `LIMITATIONS_FIXED.md` | **SUPERSEDED par ce document** | 528/528 (déjà dépassé) |
| `FINAL_REFACTORING_REPORT.md` | Historical / superseded | — |
| `FINAL_PRODUCTION_AUDIT.md` | **AUTORITATIF — ce document** | **538/538** |

**Là où ces fichiers sont en contradiction avec le présent document, ce dernier
fait foi.**

---

## 11. Checklist de release

### Automatisé
- [x] `npm test` → 57 fichiers · 538 tests · 538 PASS · `EXIT=0`
- [x] `npx tsc --noEmit` → 0 erreur
- [x] `npx tsc -p tsconfig.node.json --noEmit` → 0 erreur
- [x] `npm run build` (tsc + vite + MCP) → `EXIT=0`
- [x] `vite build --config vite.config.mcp.ts` → `dist-electron/mcp-server.js`

### Métier
- [x] CMUP (moyenne pondérée mobile) — `cmup-weighted-average.test.ts`
- [x] COGS / valorisation — `cmup-weighted-average.test.ts`, `profit.test.ts`
- [x] Solde client — `client-balance.test.ts`, `statement.test.ts`
- [x] Solde fournisseur — `client-balance.test.ts`, `statement.test.ts`
- [x] Échéance (`due_date >= invoice_date`, en couche service) — `credit-echeance.test.ts`
- [x] Retours / avoirs — `returns-credit-note.test.ts`
- [x] Multi-dépôts — `multi-warehouse.test.ts`, `warehouses.test.ts`
- [x] Caisse — `cash-expenses.test.ts`, `held-carts.test.ts`
- [x] Dépenses — `expense-categories.test.ts`
- [x] Marge / résultat — `profit.test.ts`

### Données
- [x] Base neuve — `database-schema.test.ts`
- [x] Migration legacy — `db-audit-migration.test.ts`, `migration-legacy-warehouses.test.ts`
- [x] Backup (VACUUM INTO + intégrité + checksum) — `backup-restore.test.ts` + E2E réel
- [x] Restore (rollback si sauvegarde invalide) — `backup-restore.test.ts`
- [ ] Persistance après redémarrage manuel — **PARTIELLEMENT VÉRIFIÉ**

### Runtime
- [x] E2E Electron réel (`npm run e2e`) → `EXIT=0`
- [x] Packaging Windows (installateur NSIS produit)
- [x] Contenu packagé inspecté (schéma + `.node` natif déballé)
- [ ] Installation machine vierge — **NON VÉRIFIÉ**
- [ ] Redémarrage après installation — **NON VÉRIFIÉ**

### Sécurité
- [x] IPC (allowlist + validation)
- [x] preload (`contextBridge`, pas d'IPC brut)
- [x] Filesystem (confinement des chemins)
- [x] MCP (serveur autonome, outils restreints)
- [x] Secrets (aucune clé en dur)
- [x] Type safety (`as any`: 0, `@ts-ignore`: 0)
- [x] **Chiffrement base** → ❌ **NON IMPLÉMENTÉ** (limitation publiée, §9)

---

## 12. Performance

| Contrôle | Statut |
|---|---|
| Pagination SQL (`LIMIT/OFFSET`) sur historiques & exports | ✅ Requêtes bornées (`getAllHistory`, `documents:getAll`, exports par lots) |
| Index sur les colonnes de jointure/filtre | ✅ `tests/db-audit-indexes.test.ts` |
| Test de volumétrie | ✅ `tests/volumetry.test.ts` |
| Jeu de données « réaliste » (500+ produits, 1000+ mouvements, centaines de clients/documents) chargé et chronométré de bout en bout | **NON VÉRIFIÉ** dans cet environnement |
---

## 13. DÉCISION FINALE

### 🟡 RELEASE READY WITH LIMITATIONS

Le moteur métier est vérifié de bout en bout par une suite réelle et par une
exécution Electron réelle. Deux limitations sont **publiées** plutôt que
dissimulées : le chiffrement au repos (non implémenté) et l'installation sur
machine vierge (non testée ici).

| Zone | Statut | Preuve |
|---|---|---|
| Tests | ✅ PASS | `npm test` → 57 fichiers · **538/538** · `EXIT=0` |
| TypeScript | ✅ PASS | `tsc` (renderer) + `tsc -p tsconfig.node.json` → 0 erreur · `EXIT=0` |
| Build | ✅ PASS | `npm run build` → `EXIT=0` (vite ×3 + MCP + electron-builder) |
| CMUP | ✅ PASS | `tests/cmup-weighted-average.test.ts` (9) + `stock-engine` |
| Customer Balance | ✅ PASS | `tests/client-balance.test.ts` (8) + `statement` |
| Supplier Balance | ✅ PASS | `tests/client-balance.test.ts` + `statement` |
| Échéance | ✅ PASS | `isValidDueDate` dans `DocumentService` + `credit-echeance.test.ts` |
| Backup | ✅ PASS | `tests/backup-restore.test.ts` + E2E réel (VACUUM INTO + checksum OK) |
| Restore | ✅ PASS | `tests/backup-restore.test.ts` + rollback auto sur sauvegarde invalide |
| Encryption | ❌ **NON IMPLÉMENTÉ** | Faisabilité prouvée (§9.1) ; hors périmètre de cette release |
| E2E | ✅ PASS | `npm run e2e` → `EXIT=0` (renderer→preload→IPC→SQLite) |
| Installer | ⚠️ PRODUIT / NON INSTALLÉ | `release\StockLocal-1.0.0-setup.exe` généré ; installation machine vierge non testée |
| Security | ✅ PASS (hors chiffrement) | sandbox + `contextIsolation` + allowlist IPC + confinement chemins |

### Ce qui rend cette release « avec limitations » et non « prête »

1. **Chiffrement au repos absent** — limitation produit documentée, avec
   faisabilité technique démontrée et chemin de migration écrit.
2. **Installation machine vierge non vérifiée** — l'installateur est produit et
   inspecté, mais pas déployé sur un Windows propre dans cet environnement.

### Ce qui n'est **pas** une limitation

- Le moteur métier (CMUP, COGS, soldes, échéances, retours, multi-dépôts,
  caisse, dépenses, marge) est couvert par des tests réels et **passe**.
- Le canal renderer → preload → IPC → SQLite est **prouvé en Electron réel**.
- Le typage est propre sur les deux configurations, sans aucune échappatoire
  (`as any` : 0, `@ts-ignore` : 0).
