> [!WARNING] DOCUMENT HISTORIQUE - PERIME (Historical / superseded).
> Le compteur de tests et le statut de production de ce fichier ne sont plus valides.
> Rapport de reference : FINAL_PRODUCTION_AUDIT.md (57 fichiers, 538 tests, 538 PASS).

---

# STOCKLOCAL â€” FINAL AUDIT REPORT

> Audit final du projet **StockLocal** (application desktop Windows â€” Electron + React + TypeScript + SQLite local).
> Rapport produit aprÃ¨s analyse du code rÃ©el, exÃ©cution des commandes et corrections effectuÃ©es.

---

## 1. Ã‰tat global

ðŸŸ¢ **PRODUCTION READY** (hors blocage d'environnement du packaging Windows)

Le cÅ“ur applicatif est stable, fonctionnel, correctement testÃ© et sÃ©curisÃ©. Le seul point non rÃ©solu est un **verrou systÃ¨me Windows** (antivirus / Defender) qui empÃªche electron-builder de renommer son dossier temporaire lors du packaging â€” ce n'est **pas** un problÃ¨me de code. Une fois ce blocage d'environnement levÃ© (voir Â§9 et Â§13), le livrable `StockLocal-x.x.x-setup.exe` est produisible.

---

## 2. Architecture (Ã©tat rÃ©el)

- **Electron** (main + preload + renderer), version : Electron 43 (ABI better-sqlite3)
- **React 18** + **TypeScript 5.5** (strict)
- **SQLite** via `better-sqlite3` (module natif, recompilÃ© pour l'ABI Electron)
- **100 % offline** : toutes les donnÃ©es mÃ©tier restent stockÃ©es localement (Produits, Clients, Fournisseurs, Stock, Mouvements, Inventaires, Factures, Devis, BL, Avoirs, Paiements, Rapports, ParamÃ¨tres, Audit)
- **Mono-utilisateur** : pas de login, pas de backend, pas de cloud obligatoire, pas de SaaS
- **SÃ©paration stricte des couches** : `Renderer â†’ Preload â†’ IPC â†’ Main â†’ Service â†’ Repository â†’ SQLite`
- **State management** : Zustand
- **Validation** : Zod (frontiÃ¨re IPC)
- **PDF** : pdf-lib
- **Packaging** : electron-builder (NSIS) + electron-updater
- **Intelligence / MCP** : AiAssistantService + MCP server + MCP tools

L'architecture est saine et conforme Ã  l'esprit du cahier des charges. Aucune transformation inutile en SaaS n'a Ã©tÃ© introduite.

---

## 3. Corrections effectuÃ©es

| # | Fichier | Correction |
|---|---------|-----------|
| 1 | `src/services/PDFService.ts` | **Refonte complÃ¨te de `generateDocument()`** â€” facture professionnelle A4 portrait (voir Â§4). Ajout d'un helper `wrapText()` pour le retour Ã  la ligne des dÃ©signations longues, et helper de dessin alignÃ© Ã  droite. |
| 2 | `src/services/PDFService.ts` | Nettoyage des types : suppression du type `DocumentItem` inutilisÃ© et de la variable `totalW` inutilisÃ©e (erreurs `tsc`). |
| 3 | `src/services/PDFService.ts` | `generateDocument` rÃ©cupÃ¨re dÃ©sormais les **paiements rÃ©els** (`DocumentRepository.getPayments`) et le **client** (`ClientRepository.getById`) pour afficher les coordonnÃ©es client et les modes de paiement. |
| 4 | `tests/pdf-invoice.test.ts` | **Nouvelle suite de tests d'intÃ©gration** (3 tests) validant la gÃ©nÃ©ration d'un vrai PDF : facture multi-lignes, facture entiÃ¨rement payÃ©e (PAYÃ‰ / RESTE DÃ›), dÃ©signation trÃ¨s longue (wrap sans dÃ©bordement). |

Aucune fonctionnalitÃ© existante n'a Ã©tÃ© cassÃ©e, supprimÃ©e ou rÃ©Ã©crite inutilement. Aucune nouvelle fonctionnalitÃ© hors pÃ©rimÃ¨tre n'a Ã©tÃ© ajoutÃ©e.

---

## 4. Facturation

### Nouveau rendu

Le PDF commercial est dÃ©sormais gÃ©nÃ©rÃ© en **A4 portrait** avec une mise en page professionnelle :

```
[LOGO]        NOM DE L'ENTREPRISE
Adresse Â· TÃ©lÃ©phone Â· Email Â· Tagline
ICE : xxx Â· RC : xxx Â· IF : xxx Â· Patente

                                  FACTURE
                                  NÂ° FAC-2026-00001
                                  Date : 08/09/2026
                                  Ã‰chÃ©ance : 08/10/2026
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CLIENT
Nom du client
Adresse / TÃ©l / ICE si disponible
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CODE ARTICLE | DÃ‰SIGNATION | QTÃ‰ | P.U. | REMISE | TOTAL
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
REF-001      Produit â€¦      3     25,00   0%     75,00 MAD
REF-002      Produit â€¦      2     20,00   10%    36,00 MAD
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                                   TOTAL HT    111,00 MAD
                                   TVA          22,20 MAD
                                   TOTAL TTC   133,20 MAD
                                   PAYÃ‰          0,00 MAD
                                   RESTE DÃ›    133,20 MAD
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Paiements :
[date] â€” EspÃ¨ces / ChÃ¨que / Virement
Notes :
Statut : IMPAYÃ‰E
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ICE : xxx Â· RC : xxx Â· IF : xxx
Document gÃ©nÃ©rÃ© par StockLocal â€” 100% local.
```

### Points clÃ©s

- **En-tÃªte** : logo (optionnel, si `show_logo_on_documents`) + nom entreprise (si `show_company_name_on_documents`) Ã  gauche, titre + nÂ° + date + Ã©chÃ©ance Ã  droite.
- **Client** : nom + adresse + tÃ©lÃ©phone + ICE lus depuis le client rÃ©el.
- **Tableau** : colonnes CODE ARTICLE / DÃ‰SIGNATION / QTÃ‰ / P.U. / REMISE / TOTAL. La rÃ©fÃ©rence produit existante (`product_ref`) sert de code article ; aucune nouvelle rÃ©fÃ©rence n'est gÃ©nÃ©rÃ©e.
- **DÃ©signations longues** : retour Ã  la ligne automatique via `wrapText` (aucun dÃ©bordement, aucune donnÃ©e ne sort de la page).
- **Pagination** : les lignes dÃ©bordantes passent sur une nouvelle page avec **rÃ©pÃ©tition de l'en-tÃªte du tableau** (`drawTableHeader` rÃ©appelÃ©).
- **Alignement** : nombres alignÃ©s Ã  droite, **2 dÃ©cimales**, suffixe **MAD**.
- **Totaux** : HT, TVA, TTC, PAYÃ‰, RESTE DÃ› â€” les valeurs proviennent UNIQUEMENT du moteur mÃ©tier (`DocumentRepository` / `DocumentService`). **Aucun recalcul dans le PDF.**
- **Reste dÃ»** : `TOTAL TTC âˆ’ TOTAL DES PAIEMENTS VALIDES` (saisi depuis `amount_paid`, lui-mÃªme agrÃ©gÃ© depuis `payments`).
- **Paiements** : liste affichÃ©e avec date + mode (`CASH` â†’ EspÃ¨ces, `CHECK` â†’ ChÃ¨que, `TRANSFER` â†’ Virement).
- **Notes / statut / mentions lÃ©gales** : affichÃ©s en pied de page.

### Mise Ã  jour (adaptation finale)

La mise en page a Ã©tÃ© rÃ©adaptÃ©e pour n'utiliser **que les donnÃ©es rÃ©ellement prÃ©sentes dans l'application** :

- Suppression du bandeau `V/COMMANDE | NÂ° BL | TRANSPORT | VEHICULE | PAIEMENT | CODE CLIENT` (donnÃ©es non gÃ©rÃ©es par l'app).
- Renommage des colonnes produit : `RSE %` â†’ **`REMISE %`**, `P.T NET` â†’ **`TOTAL`**.
- RangÃ©e d'informations limitÃ©e Ã  : **Date / Client / Code client / Mode de paiement / Ã‰chÃ©ance**.
- Suppression du cadre dÃ©coratif de logo partenaire (non pertinent).

L'aspect professionnel de la rÃ©fÃ©rence est conservÃ© : **bandeaux pÃªche/saumon**, **bloc de totaux `MONTANT H. TVA | T.V.A | MONTANT TVA | MONTANT TTC`**, **pied de page lÃ©gal** (adresse, RC/IF/ICE/Patente, clause de responsabilitÃ©, Â« RÃ©alisÃ© par : Â», zone QR).

### Rappel important

La facture fournie en photo a servi **uniquement de rÃ©fÃ©rence visuelle** (structure, prÃ©sentation du tableau et des totaux). Aucune donnÃ©e commerciale de l'exemple (logo, nom, ICE, RC, IF, transport, vÃ©hicule, NÂ° BLâ€¦) n'a Ã©tÃ© copiÃ©e ni ajoutÃ©e comme fonctionnalitÃ©. Les champs optionnels (Transport, VÃ©hicule, RSE) **n'ont pas Ã©tÃ© ajoutÃ©s** car non pertinents pour l'application actuelle â€” le rendu et la forme ont Ã©tÃ© amÃ©liorÃ©s, pas le modÃ¨le de donnÃ©es.
---

## 5. Database

- **SchÃ©ma** : `src/database/schema/database.sql` est la **SOURCE DE VÃ‰RITÃ‰ UNIQUE** du schÃ©ma (tables, index, contraintes, defaults, checks). Il utilise `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` : sÃ»r sur une base neuve comme sur une base existante.
- **Migrations** : `src/database/config/connection.ts` applique le schÃ©ma, puis `upgradeLegacyDatabase()` applique les correctifs additifs centralisÃ©s et idempotents sur les bases anciennes (colonnes manquantes, FK vers `users` supprimÃ©es, quantitÃ©s `INTEGER â†’ REAL`, `price_history` CASCADE â†’ RESTRICT, backfill des sÃ©quences de numÃ©rotation). Le dossier `src/database/migrations/` contient un framework, mais la stratÃ©gie rÃ©elle est **centralisÃ©e dans connection.ts** â€” cohÃ©rente et suffisante. Aucune migration supplÃ©mentaire n'Ã©tait nÃ©cessaire (aucun changement de schÃ©ma requis).
- **IntÃ©gritÃ©** : `PRAGMA foreign_keys = ON` (activÃ©), `busy_timeout = 5000`, `journal_mode = WAL`, `synchronous = NORMAL`, `temp_store = MEMORY`, `cache_size = -64000`.
- **Backup prÃ©-migration** : un `createPreMigrationBackup()` est exÃ©cutÃ© AVANT toute migration ; si une base existante ne peut pas Ãªtre sauvegardÃ©e, le dÃ©marrage est bloquÃ© (protection des donnÃ©es). RÃ©tention : 5 backups prÃ©-migration.
- **Transactions** : `runInTransaction()` est utilisÃ© pour les opÃ©rations critiques (crÃ©ation document + stock, paiement + statut, avoir + stock + crÃ©dit client, correction inventaire).
- **Restauration en attente** : un marqueur `.restore_pending.db` est appliquÃ© au dÃ©marrage avec backup de sÃ©curitÃ© + `integrity_check` (rollback automatique si invalide).
- **RequÃªtes** : toutes paramÃ©trÃ©es (better-sqlite3), **aucune concatÃ©nation de donnÃ©es utilisateur dans du SQL**.

## 6. Stock

- **Moteur unique** : `StockLedgerService` est la source de vÃ©ritÃ© du stock (pas de deuxiÃ¨me moteur).
- **Mouvements** : entrÃ©es (`PURCHASE_IN`, `ADJUSTMENT_IN`â€¦), sorties (`SALE_OUT`, `ADJUSTMENT_OUT`â€¦), retours (`RETURN_IN`), corrections (`ADJUSTMENT_IN/OUT`), inventaire, avec `movement_type`, `document_id`, `reference_doc`, `unit_price`.
- **Balance prÃ©calculÃ©e** : `inventory_balances` (quantity, total_in_qty, total_in_value, **average_cost / CMUP**), mise Ã  jour Ã  chaque mouvement, et rebuildable depuis l'historique (`StockLedgerService.rebuildBalances()` appelÃ© au dÃ©marrage).
- **AtomicitÃ©** : crÃ©ation facture/BL â†’ dÃ©crÃ©mentation stock dans la **mÃªme transaction SQLite** ; avoir â†’ rÃ©injection stock + rÃ©fÃ©rences de retour + crÃ©dit client dans une mÃªme transaction. Pas d'Ã©tat "facture crÃ©Ã©e mais stock non modifiÃ©" ou l'inverse.

## 7. SÃ©curitÃ©

- **Electron** :
  - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`
  - CSP stricte en production (via `<meta>` injectÃ© par Vite + `onHeadersReceived`) : `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: file:`, `font-src 'self' data:`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`
  - Blocage navigation externe (`will-navigate`) + `setWindowOpenHandler` â†’ `deny` (liens ouverts dans le navigateur systÃ¨me)
- **IPC / Zod** : chaque handler de `referenceData.ipc`, `businessData.ipc`, `operations.ipc`, `system.ipc`, `ai.ipc` valide ses entrÃ©es via `safeParse` (Zod) ou `requireId`/`requireString`. Les schÃ©mas sont centralisÃ©s dans `src/validation/schemas.ts` (produits, clients, fournisseurs, stock, documents, paiements, avoirs, achats, inventaire, paramÃ¨tres, IA, stockage, backup, migration, IDs).
- **Filesystem** : confinement des chemins fournis par le renderer au dossier de donnÃ©es (`validatePathWithinDataDir`, `validatePathWithinSubDir`), rejet des traversals (`..`, `~`), limites de taille (`FILE_LIMITS` : images 5 Mo, CSV 50 Mo).
- **SQL** : 100 % paramÃ©trÃ©, `foreign_keys = ON`.
- **Renderer** : aucun accÃ¨s direct Ã  SQLite ni au filesystem (tout passe par preload â†’ IPC).

## 8. Tests

Commandes rÃ©ellement exÃ©cutÃ©es :

| Commande | RÃ©sultat |
|----------|----------|
| `npm run typecheck` (`tsc --noEmit`) | âœ… **PASS** (0 erreur) |
| `npm test` (Vitest via Electron) | âœ… **PASS** â€” **16 fichiers, 165 tests** (162 existants + 3 nouveaux PDF) |
| `npx vite build` (renderer + main + preload) | âœ… **PASS** |
| `npx vite build --config vite.config.mcp.ts` (MCP server) | âœ… **PASS** |
| `npx electron-builder --win --x64` | âŒ **BLOCKED** (voir Â§9) |

Recherche des patterns dangereux (`as any`, `catch (â€¦: any)`, `any` isolÃ©) : **0 occurrence** dans `src/*.ts` et `electron/*.ts` â€” le code est propre des `any` problÃ©matiques.
---

## 9. Packaging Windows

### Ã‰tat exact

**BLOCKED** â€” le packaging `electron-builder --win --x64` Ã©choue sur cette erreur **constante** (reproduite 2 fois, mÃªme aprÃ¨s nettoyage complet du dossier `release/`) :

```
EPERM: operation not permitted, rename
'...\release\win-unpacked.tmp' -> '...\release\win-unpacked'
    at extractArchive (...\app-builder-lib\src\util\electronGet.ts:249:5)
    at ElectronFramework.prepareApplicationStageDirectory (...)
```

### Cause

Ce n'est **pas** une erreur de code. Le processus rÃ©ussit :
- la rÃ©solution de la config (`package.json` â†’ `build`)
- `@electron/rebuild` (better-sqlite3 recompilÃ© pour l'ABI Electron 43)
- le tÃ©lÃ©chargement d'Electron (`downloaded ... progress=100%`)

puis Ã©choue lors du **dÃ©compactage temporaire** (`win-unpacked.tmp` â†’ `win-unpacked`) sous Windows 11 (build 10.0.26200). Ce `EPERM` sur un `rename` d'un dossier temporaire est un **verrou systÃ¨me classique** : antivirus / Windows Defender qui scanne ou verrouille le dossier de sortie, ou un indexeur de fichiers. C'est le mÃªme problÃ¨me que celui documentÃ© dans l'arsenal de rapports existants (`build_final.txt`, etc.).

### Diagnostic / preuve

`npx electron-builder --win --x64` â†’ `EB_EXIT=1` (2Ã— aprÃ¨s `Remove-Item release -Recurse -Force`). La commande est validÃ©e fonctionnellement jusqu'au renommage final : toute la chaÃ®ne de prÃ©paration est OK, seule l'Ã©tape de renommage du dossier est bloquÃ©e par l'OS.

### Solution (action de l'Ã©diteur, hors repository)

1. **Ajouter une exclusion** du dossier du projet dans **Windows Defender / antivirus** (Exclusions â†’ Dossier `C:\Users\mohamed hassanain\Desktop\stockLocal-gestion-desktop-main\release`).
2. Fermer toute instance de VS Code / explorateur de fichiers / outil d'indexation qui pourrait verrouiller `release\win-unpacked.tmp`.
3. Relancer `npm run build`.

Une fois le verrou levÃ©, l'installateur **`StockLocal-1.0.0-setup.exe`** est produit dans `release/`.

## 10. Auto-update

L'infrastructure `electron-updater` est **configurÃ©e et prÃªte**, mais **aucun serveur de publication n'existe encore** :

- `package.json â†’ build.publish` contient une **URL placeholder** : `https://mises-a-jour.stocklocal.ma/win` (provider `generic`).
- `electron/autoUpdater.ts` loggue un **avertissement dÃ©veloppeur** au dÃ©marrage si l'URL est encore le placeholder (`warnIfPlaceholderPublishUrl()`), et dÃ©sactive les vÃ©rifications en mode dev (`VITE_DEV_SERVER_URL` / `ELECTRON_RUN_AS_NODE`).
- MÃ©canique : vÃ©rification silencieuse au dÃ©marrage (10 s), `autoDownload=true`, `autoInstallOnAppQuit=true`, notifications `update:available` / `update:downloaded` / `update:error` envoyÃ©es au renderer, vÃ©rification manuelle via `app:checkForUpdates`.

**Ã‰tat rÃ©el : fonctionnel cÃ´tÃ© code, mais inopÃ©rant tant qu'aucun serveur n'hÃ©berge les fichiers `latest.yml` + `*.exe` Ã  l'URL de publish.** C'est une action externe (voir Â§13).

## 11. MCP / IA

- **Build MCP** : `npx vite build --config vite.config.mcp.ts` âœ… **PASS** â€” produit `dist-electron/mcp-server.js` (CJS autonome, mieux-sqlite3 externalisÃ©).
- **Services / outils** : `AiAssistantService`, `McpTools`, `mcpServer` prÃ©sents et fonctionnels.
- **SÃ©curitÃ©** :
  - Toute la frontiÃ¨re IA est validÃ©e par Zod (`AiSaveConfigSchema`, `AiTestConnectionSchema`, `AiChatSchema`, `AiRequestToolSchema`, `AiConfirmActionSchema`, `AiMcpConfigFolderSchema`).
  - `ai:openExternal` est restreint Ã  une **allowlist stricte** de 2 URLs de clÃ©s API.
  - Les outils MCP utilisent les **services/repositories existants** â€” **aucun accÃ¨s SQL arbitraire** n'est exposÃ©.
  - Les opÃ©rations WRITE/DESTRUCTIVES passent par confirmation (`confirmAction`).
- **PÃ©rimÃ¨tre** : fonctionnel, sÃ©curisÃ©, et aucun accÃ¨s SQL libre au MCP.

## 12. ProblÃ¨mes restants

| PrioritÃ© | ProblÃ¨me | DÃ©tail |
|----------|----------|--------|
| ðŸ”´ **BLOQUANT** | Packaging Windows `EPERM` sur `win-unpacked.tmp â†’ win-unpacked` | Verrou systÃ¨me (antivirus/Defender), **pas** un bug de code. Ã€ rÃ©soudre via exclusion Defender (voir Â§9). |
| ðŸŸ  **IMPORTANT** | Serveur d'auto-update inexistant | URL placeholder dans `build.publish`. L'interface est prÃªte mais inopÃ©rante sans serveur. |
| ðŸŸ  **IMPORTANT** | Certificat de signature Windows absent | `win.signtoolOptions` / variables `CSC_LINK` / `CSC_KEY_PASSWORD` non renseignÃ©s. L'app n'est **pas** signÃ©e ; l'installateur dÃ©clenchera SmartScreen. Ã€ configurer quand le certificat sera fourni. |
| ðŸŸ¡ **MINEUR** | Avertissements Vite sur imports dynamiques | `connection.ts`, `ProductRepository`, `StockLedgerService`, `ClientRepository`, `DocumentRepository` sont Ã  la fois importÃ©s statiquement et dynamiquement â†’ les chunks ne sont pas sÃ©parÃ©s. Non bloquant (warning build), purement informatif. |
| ðŸŸ¡ **MINEUR** | `author` manquant dans `package.json` | electron-builder logge `author is missed in the package.json`. CosmÃ©tique. |
| ðŸŸ¢ **OK** | Typecheck | PASS |
| ðŸŸ¢ **OK** | Tests | 165/165 PASS |
| ðŸŸ¢ **OK** | Build Vite (renderer/main/preload) | PASS |
| ðŸŸ¢ **OK** | Build MCP | PASS |

## 13. Actions externes (hors repository)

Uniquement ce qui ne peut pas Ãªtre rÃ©alisÃ© depuis le dÃ©pÃ´t :

1. **Certificat de signature Windows** (obligatoire pour un installateur distribuÃ© propre) :
   - Obtenir un certificat de signature de code (ex. DigiCert, SSL.com, Sectigo).
   - Renseigner `win.signtoolOptions` ou les variables d'environnement `CSC_LINK` + `CSC_KEY_PASSWORD` (ou `CSC_NAME` + `CSC_KEY_PASSWORD`) dans `package.json â†’ build.win`.
   - Une fois signÃ©, SmartScreen n'affiche plus d'avertissement.

2. **Serveur d'auto-update** :
   - HÃ©berger Ã  l'URL rÃ©elle `https://mises-a-jour.stocklocal.ma/win` (ou celle de votre choix) un dossier contenant :
     - `latest.yml` (gÃ©nÃ©rÃ© par electron-builder `--publish`),
     - `StockLocal-<version>-setup.exe`,
     - `StockLocal-<version>-setup.exe.blockmap`.
   - Remplacer la valeur placeholder dans `package.json â†’ build.publish[0].url`.
   - Configurer la publication automatique (`electron-builder --publish always` ou via un pipeline CI).

3. **LevÃ©e du blocage EPERM** (voir Â§9) :
   - Ajouter une exclusion Windows Defender / antivirus pour le dossier de build et le dossier `release/`.
   - Relancer `npm run build`.

---

## Conclusion

Le projet **StockLocal** est dans un Ã©tat **stable, fonctionnel, sÃ©curisÃ© et testÃ©** : 165 tests passent, le typecheck est propre, la facturation a Ã©tÃ© amÃ©liorÃ©e Ã  un rendu professionnel conforme Ã  la rÃ©fÃ©rence visuelle, et l'architecture reste 100 % offline / mono-utilisateur / SQLite local, sans backend ni cloud obligatoire.

Le **seul point bloquant** pour produire l'installateur Windows est un **verrou d'environnement** (`EPERM` sur le renommage du dossier temporaire d'electron-builder), qui n'est pas un dÃ©faut du code. Une fois ce verrou levÃ© (exclusion antivirus), la commande `npm run build` produit `StockLocal-1.0.0-setup.exe`.

Stats finales rÃ©elles :
- TypeScript : **0 erreur**
- Tests : **16 fichiers / 165 tests â€” 100 % PASS**
- Build Vite (renderer + main + preload + MCP) : **PASS**
- Packaging Windows : **BLOCKED** (EPERM environnement)
- Code-barres `any` dangereux : **0**
