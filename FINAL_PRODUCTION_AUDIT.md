# FINAL PRODUCTION AUDIT — StockLocal

> **DOCUMENT AUTORITATIF.** C'est le seul fichier dont le compteur de tests et le
> statut de production sont tenus à jour. Tous les autres rapports `*.md` du dépôt
> sont marqués **HISTORIQUE / PÉRIMÉ** en tête de fichier et leurs chiffres ne
> doivent plus être utilisés.

- **Date de cet audit :** 2026-09-14
- **Version applicative :** 1.0.0
- **Stack :** Electron 43.4.1 + React 18 + TypeScript 5.5 + better-sqlite3 13.0.3 (SQLite local, WAL)
- **Modèle :** application desktop **mono-utilisateur, 100 % locale, offline-first**.
  Aucun backend cloud, aucun PostgreSQL, aucun Docker, aucune authentification.
- **Environnement d'exécution de cet audit :** Windows 11, PowerShell, Node 22 (voir §7).

---

## 0. Résumé exécutif et décision

| Domaine | Résultat vérifié dans cette session |
|---|---|
| Suite de tests | **654 tests / 65 fichiers / 654 PASS / 0 FAIL** (`npm test`) |
| TypeScript | **0 erreur** sur `tsconfig.json` **et** `tsconfig.node.json` |
| Bundling (Vite) | **OK** (renderer + serveur MCP) |
| Recompilation native | **OK** (better-sqlite3 rebuild pour Electron 43.6.0 x64) |
| Packaging installeur Windows | **ÉCHEC — `EPERM`** (non vérifié, cf. §4.4) |
| E2E Electron réel | **PASS** — 17 assertions sur un scénario métier complet (2 démarrages réels) |
| TVA multi-taux (B1) | **Implémenté + testé** (40 tests) |
| Paiements multiples (B2) | **Implémenté + testé** (10 tests + E2E réel) |
| Prix par niveau client (B3) | **Implémenté + testé** (14 tests) |
| Vendeurs / commission (B4) | **Implémenté + testé** (13 tests) |
| Chiffrement SQLite au repos (C1) | **NON IMPLÉMENTÉ** — faisabilité prouvée, blocage de vérification documenté (cf. §4.1) |
| Sécurité (C5) | **Confirmé** (code inspecté, cf. §4.5) |

### Décision unique : 🟡 **RELEASE READY WITH LIMITATIONS**

**Ce qui est prêt :** le code métier, les tests, les deux type-checks, le bundling,
la compilation native et la chaîne complète `renderer → preload → IPC → service → SQLite`
(prouvée par l'E2E Electron réel) sont **vérifiés et passent**.

**Pourquoi pas 🟢 :** conformément à la règle « jamais 🟢 s'il reste un point
NON VÉRIFIÉ ou en échec », deux points empêchent le vert :
1. **la génération de l'installeur Windows n'a pas pu être vérifiée** dans cet
   environnement (échec `EPERM` reproductible, §4.4) — l'artefact livrable doit
   être produit et contrôlé sur une machine sans verrou antivirus/indexeur ;
2. **le chiffrement SQLite au repos (C1) n'est pas implémenté** (§4.1) — limitation
   assumée et documentée, avec preuve de faisabilité technique.

---

## 1. PARTIE A — Documentation périmée (traité)

Le décompte de tests précédemment publié (**538 tests / 57 fichiers**) était périmé.

- Le décompte **réel et actuel est de 654 tests dans 65 fichiers** (§2), obtenu en
  exécutant réellement `npm test` dans cette session.
- Les autres rapports ont été **vérifiés un par un** (recherche PowerShell sur
  l'ensemble des `.md` du dépôt) et portent en tête le bandeau
  `> [!WARNING] DOCUMENT HISTORIQUE - PERIME (Historical / superseded)` :
  `ARCHITECTURE_AUDIT.md`, `AUDIT_DB_RESULT.md`, `CAHIER_DES_CHARGES.md`,
  `COMPLIANCE_AUDIT.md`, `FINAL_AUDIT.md`, `FINAL_AUDIT_REPORT.md`,
  `FINAL_HARDENING_REPORT.md`, `FINAL_REFACTORING_REPORT.md`,
  `LIMITATIONS_FIXED.md`, `REFACTORING_REPORT.md`, `SUMMARY.md`, `README.md`,
  `docs/IMPLEMENTATION_PHASES_1_6.md`, `docs/PHASE5_MULTI_DEPOTS.md`
  (soit **14 fichiers** en plus du présent document).
- **`docs/DGI_COMPLIANCE_STATUS.md` est le seul `.md` du projet sans bandeau**, et
  c'est volontaire : il **n'affiche aucun décompte global de tests** (il ne cite que
  son propre test de module, `tests/dgi-ubl.test.ts`, dans une section « 5. Tests »).
  Aucun chiffre obsolète à corriger, donc pas de marquage « périmé » trompeur.
- Le bandeau de `ARCHITECTURE_AUDIT.md` a en outre été **rafraîchi** pour renvoyer
  explicitement au présent document pour l'état courant, sans y figer un décompte
  qui périmera à son tour.

*Aucun de ces fichiers historiques n'a été supprimé : ils restent consultables
comme trace, mais ne font plus autorité.*

---

## 2. Décompte réel des tests

**Commande exécutée :** `npm test` (→ `node scripts/run-tests-electron.cjs run`,
qui exécute Vitest).

**Résultat réel :**
```
 Test Files  65 passed (65)
      Tests  654 passed (654)
```

Répartition de l'évolution : **617 tests** (état antérieur) **+ 37 nouveaux tests**
(B2/B3/B4) **= 654**.

---

## 3. PARTIE B — Fonctionnalités commerciales

Toutes les fonctionnalités ci-dessous sont chaînées **de bout en bout**
`Database → Repository → Service → IPC → Preload → Zustand → React UI`, avec la
logique financière **côté main** (jamais uniquement dans le renderer).

### B1 — TVA multi-taux configurable ✅ Implémenté et testé

- **Catalogue de taux** : taux légaux marocains `0 / 7 / 10 / 14 / 20` **toujours
  proposés** + taux personnalisés persistés (`global_settings.vat_rates`).
  Un taux légal ne peut pas être supprimé (une vente exonérée doit rester possible).
- **Résolution du taux** : `produit → catégorie → défaut société`, avec la règle
  explicite qu'un taux **0 (exonéré) est une valeur, pas une absence**.
- **Moteur de calcul central** : `src/utils/money.ts` (`calculateLineAmounts`) —
  arrondi monétaire à 2 décimales, TVA calculée **après remise**. Aucune autre
  logique d'arrondi concurrente dans le code.
- **Rapport TVA** (`TaxService`) : TVA collectée (ventes), TVA déductible (achats),
  **TVA nette = collectée − déductible**, ventilation par taux ; un crédit de TVA
  négatif est **conservé** (jamais ramené à 0). Les avoirs viennent en déduction des
  ventes ; les documents ANNULÉS et les commandes en brouillon sont exclus.
- **UI** : rapport de TVA exposé via `tax:getReport` (page Rapports).
- **Tests : `tests/vat-rates.test.ts` → 40 tests, 40 PASS.**
  Couvre chaque taux, les arrondis (ex. 33,33 × 20 % = 6,67), la cohérence HT/TVA/TTC,
  la résolution produit→catégorie→défaut, la TVA sur achats et le rapport fiscal
  (y compris avoirs déduits, documents annulés exclus, crédit négatif conservé,
  bornes mois/année).

### B2 — Paiements multiples sur un même document ✅ Implémenté et testé

- **Service** : `DocumentService.addPayments(documentId, payments[])` — enregistre
  **plusieurs lignes de paiement en une seule transaction**. Règles appliquées au
  **TOTAL** : au moins une ligne, chaque montant > 0, **somme ≤ reste dû (+0,01)**.
  Atomicité : si une ligne est invalide, **rien** n'est enregistré.
- **Repository** : insertion des lignes + recalcul **unique** du statut en fin de
  transaction (`PAID` / `PARTIAL` / `UNPAID`).
- **IPC** : `documents:addPayments` validé par Zod (`PaymentsBatchSchema`).
- **UI caisse (`POSPage.tsx`)** : encaissement multi-lignes — chaque ligne a un mode
  (Espèces/Chèque/Virement), un montant et une référence ; boutons « Ajouter un mode »
  et « Compléter le reste » ; totaux « Encaissé / Reste » et **blocage de la validation**
  si le total dépasse le montant dû.
- **UI facture (`InvoicePage.tsx`)** : le panneau de détail d'un document permet
  également l'encaissement réparti sur plusieurs lignes.
- **Tests : `tests/multi-payments.test.ts` → 10 tests, 10 PASS.**
  Paiement complet en un mode, paiement **réparti en plusieurs modes**, paiement
  partiel, **refus (sans écriture) si le total dépasse le reste dû**, refus des
  montants nuls/négatifs, refus d'une liste vide, refus d'un document déjà payé /
  annulé / introuvable, tolérance d'un centime.
- **Preuve E2E réelle** (§4.3) : facture de 120 TTC encaissée en **50 espèces +
  40 chèque + 30 virement** → statut `PAID`, **3 lignes** de paiement, solde client
  ramené de 120 à 0.

### B3 — Niveaux de prix clients ✅ Implémenté et testé

- **Données** : `customers.price_level` (défaut `RETAIL`), `product_price_levels`
  (prix d'un produit par niveau), `customer_prices` (prix négocié client × produit).
- **Règle de priorité (source unique, module pur `domain/pricing/priceLevels.ts`)** :
  **prix spécifique client > prix du niveau > remise quantité (`volume_discounts`) >
  prix standard**. Une remise quantité **ne se cumule jamais** avec un prix négocié.
- **Preuve d'application** : `PricingService.resolveProductPrice()` renvoie toujours
  le **motif affichable** (« Prix spécifique client », « Prix niveau Grossiste »,
  « Remise quantité : -8 % », « Prix standard »), affiché sur la ligne de vente dans
  `POSPage.tsx`.
- **UI** : la sélection/le changement de client à la caisse **re-résout** le prix de
  toutes les lignes, via le backend. Le formulaire de facture (`NewDocumentModal`)
  résout également le prix selon le client sélectionné.
- **Tests : `tests/price-levels.test.ts` → 14 tests, 14 PASS.**
  Priorité testée pour **chaque combinaison**, bornage de la remise à [0,100], un prix
  absent n'est pas un prix à 0, normalisation des niveaux, application du prix de
  niveau, du prix client, refus d'un prix négatif, liste/suppression des prix par niveau.

### B4 — Fiches vendeurs / commerciaux ✅ Implémenté et testé

- **Nature** : de simples **FICHES** (`sellers` : nom, téléphone, taux de commission,
  actif/inactif) — **aucun compte utilisateur, aucune authentification**.
  Une vente référence un vendeur par `documents.seller_id` (colonne additive, nullable).
- **Commission** : règle pure `domain/sellers/commission.ts` —
  `commission = CA × taux / 100`, arrondie au centime ; taux borné à [0,100], jamais négatif.
- **Rapport** : CA par vendeur, nombre de ventes et commission calculée sur une période
  (factures + bons de livraison non annulés).
- **Garde-fou** : suppression **refusée** si le vendeur est référencé par un document
  (il faut le désactiver) — la trace commerciale est préservée.
- **UI** : page **Vendeurs** (CRUD + activation/désactivation + rapport de commission
  mensuel), accessible depuis la barre latérale (section Clients). Sélecteur de vendeur
  à la caisse et dans le formulaire de facture.
- **Tests : `tests/sellers-commission.test.ts` → 13 tests, 13 PASS.**
  Calcul et arrondi de commission, taux hors bornes, CRUD (nom obligatoire, mise à jour
  partielle sans perte de champ), activation/désactivation, rapport (CA, nombre de ventes,
  commission, vendeur sans vente, exclusion hors période), refus de suppression référencée.

### Hors périmètre (volontairement non traité)

Promotions engine, bundles/kits produits, forecasting, dashboard personnalisable,
filtres sauvegardés, dark mode, notes/pièces jointes, supplier scoring — **non
implémentés**, conformément à la consigne (feature creep évité).
---

## 4. PARTIE C — Audit de release

### 4.1 C1 — Chiffrement SQLite au repos (SQLCipher) — ⚠️ NON IMPLÉMENTÉ (tentative réelle, blocage documenté)

**Versions réellement présentes :** Electron `43.4.1`, `better-sqlite3` `13.0.3`,
Node (types) `22`. L'ABI native est reconstruite pour **Electron 43.6.0 x64**
(confirmé par la sortie d'`electron-builder` : `finished moduleName=better-sqlite3 arch=x64`).

**Recherche de binding (registre npm interrogé réellement) :**
```
npm view better-sqlite3-multiple-ciphers version   → 13.0.3
npm view @journeyapps/sqlcipher version            → 6.0.0
npm view better-sqlite3 version                    → 13.0.3
```
- `better-sqlite3-multiple-ciphers` **13.0.3** est un fork de `better-sqlite3` à la
  **même version** (API synchrone identique : `prepare/get/all/run/pragma`) — c'est
  l'option production-grade réaliste.
- `@journeyapps/sqlcipher` **6.0.0** est **écarté** : API asynchrone
  (style `node-sqlite3`), ce qui imposerait de réécrire toute la couche d'accès aux
  données (tous les repositories sont synchrones).

**Tentative réelle effectuée (hors projet, isolée, sans aucun impact sur le dépôt) :**
installation du fork dans un dossier temporaire, puis exécution d'une sonde
(création d'une base chiffrée, écriture, lecture, réouvertures). Résultats obtenus :
```
MODULE_OK
ENCRYPTED_WRITE_READ_OK {"v":"hello"}
CIPHER_VERSION undefined
NO_KEY_REJECTED_OK file is not a database
WRONG_KEY_REJECTED_OK file is not a database
REOPEN_OK {"v":"hello"}
PROBE_DONE
```
**Conclusion de la sonde :** le chiffrement **fonctionne réellement** sur cette
machine — base chiffrée écrite/relue, **réouverture sans clé refusée**, **réouverture
avec mauvaise clé refusée**, réouverture avec la bonne clé OK. (Le pragma
`cipher_version` lu avec `{simple:true}` n'a pas renvoyé de valeur ; cela n'affecte pas
la preuve de chiffrement.)

**Pourquoi ce n'est PAS implémenté malgré la faisabilité de la bibliothèque :**
1. **ABI Electron non vérifiable ici.** La sonde tourne sous **Node**, pas sous
   Electron. Le fork devrait être recompilé pour l'ABI d'Electron 43
   (`electron-builder install-app-deps`) **et** l'application relancée pour prouver que
   l'addon natif se charge dans le process principal. Le packaging échoue déjà en fin
   de chaîne (§4.4), donc cette preuve n'est pas obtenable dans cet environnement.
2. **Custody de clé via `safeStorage` exigée.** Le motif demandé
   (`electron.safeStorage`) n'existe que dans le **runtime Electron** — il n'est pas
   exerçable sous Vitest (Node). La chaîne de gestion de clé serait donc **non couverte
   par la suite de tests**, donc non vérifiable au niveau de preuve exigé par ce projet.
3. **Migration de la SEULE copie de données utilisateur.** Une migration
   sauvegarde → chiffrement → contrôle d'intégrité → remplacement atomique qui
   échouerait en cours de route détruirait la base — or elle **ne peut pas être
   validée de bout en bout ici**. Livrer une migration de données non vérifiée sur
   l'unique copie des données est un risque irréversible, explicitement à éviter.

**Ce qui est proprement utilisable aujourd'hui :** les clés d'API IA sont déjà
chiffrées via `electron.safeStorage` (`src/ai/secureStorage.ts`, préfixe `enc:v1:`,
repli documenté si `isEncryptionAvailable()` est faux) — mais **la base SQLite elle-même
n'est pas chiffrée au repos**. C'est une **limitation assumée** pour une application
mono-utilisateur strictement locale ; elle est désormais documentée avec sa preuve de
faisabilité et la liste précise de ce qui reste à faire.

### 4.2 C2 — Échéances (`due_date ≥ invoice_date`) — ✅ Vérifié

- La règle est appliquée **en couche service**, pas seulement suggérée dans l'UI :
  `DocumentService.createDocument()` **et** `DocumentService.updateDocument()`
  appellent `isValidDueDate(...)` et **lèvent** une erreur si l'échéance précède la
  date de facture.
- **Aucun décalage de fuseau possible** : la comparaison est faite **sur des chaînes
  `YYYY-MM-DD`**, jamais sur des objets `Date` :
  `isValidDueDate` → `compareDateOnly(dueDate, invoiceDate) >= 0`, et
  `compareDateOnly` normalise puis compare lexicographiquement (`na < nb`), sans
  passer par `toISOString()` / UTC.
- Couvert par `tests/credit-echeance.test.ts`, `tests/echeance-qa.test.ts` et
  `tests/date-only-safety.test.ts` — **tous PASS** dans la suite de 654 tests.

### 4.3 C3 — E2E Electron réel — ✅ PASS (17 assertions, 2 démarrages réels)

Le scénario `scripts/e2e-electron.cjs` a été **étendu** et exécuté réellement
(`npm run e2e`) : il lance l'**application Electron réelle** (renderer construit +
`dist-electron/main.js`) et pilote le renderer via CDP — donc la vraie chaîne
`renderer → preload → IPC → service → SQLite`. La restauration s'appliquant au
démarrage, le script **démarre l'application deux fois** sur le même dossier de données.

**Phase 1 — résultats obtenus (tous ✔) :**
```
✔ stock initial = 100
✔ achat reçu (20) → stock = 120
✔ vente (5) → stock = 115
✔ facture TTC = 120
✔ solde client après facture impayée = 120
✔ paiement MULTI-MODES → facture PAYÉE
✔ 3 lignes de paiement enregistrées
✔ solde client après paiement = 0
✔ avoir créé
✔ retour (2) → stock = 117
✔ solde client après avoir = -48
✔ 2 dépôts présents
✔ transfert → 10 unités dans le dépôt 2
✔ transfert → 107 unités dans le dépôt 1
✔ session de caisse fermée
```
**Phase 2 — après redémarrage réel :**
```
✔ le produit créé APRÈS la sauvegarde a disparu (restauration appliquée)
✔ des produits existent toujours après restauration
```
Résultat brut de la phase 1 (extrait) :
`{"stockAfterEntry":100,"stockAfterPurchase":120,"invoiceTotal":120,"stockAfterSale":115,`
`"balanceAfterInvoice":120,"invoiceStatusAfterPayment":"PAID","paymentsCount":3,`
`"balanceAfterPayment":0,"creditNoteOk":true,"stockAfterReturn":117,"balanceAfterReturn":-48,`
`"warehousesCount":2,"transferToW2":10,"transferFromW1":107,"sessionStatus":"CLOSED",`
`"restoreRequested":true,"ok":true}`

Cela couvre l'enchaînement demandé : **produit → client → achat → stock → vente avec
paiement multi-mode (B2) → stock et solde client → retour/avoir → stock/solde →
transfert entre dépôts → les deux dépôts → session de caisse (ouverture/vente/dépense/
fermeture) → sauvegarde → modification → restauration → vérification.**
Deux captures d'écran de l'UI réelle sont produites : `e2e-shot-1-phase1.png`,
`e2e-shot-2-phase2.png`.

### 4.4 C4 — Build Windows réel — ⚠️ Bundling OK, installeur NON VÉRIFIÉ (`EPERM`)

`npm run build` exécuté réellement. Étapes atteintes :
- `tsc` → **OK** ;
- `vite build` (renderer) → **OK** ;
- `vite build --config vite.config.mcp.ts` (serveur MCP) → **OK**
  (`dist-electron/mcp-server.js`, 443,71 kB) ;
- `electron-builder` → `@electron/rebuild` de `better-sqlite3` pour **Electron 43.6.0
  x64** → **OK** ; téléchargement d'Electron → **100 %**.

**Échec reproductible à l'étape de packaging :**
```
⨯ EPERM: operation not permitted, rename
  '…\release\win-unpacked.tmp' -> '…\release\win-unpacked'
    at extractArchive (app-builder-lib/src/util/electronGet.ts:249)
    at ElectronFramework.prepareApplicationStageDirectory (…/ElectronFramework.ts:254)
```
**Cause précise (non masquée) :** sur ce poste Windows, le **renommage** du dossier
fraîchement extrait est refusé par le système (`EPERM`) — typiquement un verrou
(antivirus / Defender en analyse temps réel, indexeur Windows Search, ou dossier
surveillé) sur `release/win-unpacked.tmp`. L'échec a été **reproduit deux fois**,
y compris après suppression du dossier temporaire résiduel
(`release\win-unpacked.tmp`) et des artefacts périmés.

**Conséquence honnête :** **aucun installeur n'a été produit par cette session.**
L'ancien `release/StockLocal-1.0.0-setup.exe` datait du **2026-09-13** (il a été
supprimé pour éviter toute confusion) : il ne prouvait rien sur l'état actuel du code.
Statut : **NON VÉRIFIÉ — environnement Windows (EPERM au packaging)**. Le build doit
être relancé sur une machine où le verrou (antivirus/indexeur) est neutralisé, ou avec
un dossier de sortie hors zone surveillée, avant toute distribution.

### 4.5 C5 — Sécurité finale — ✅ Confirmé (inspection de code)

Reconfirmé **sans modification** (déjà correct) :
- **`webPreferences`** (`electron/main.ts`) : `nodeIntegration: false`,
  `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, `preload` explicite.
- **Navigation** : `will-navigate` intercepté **et** `setWindowOpenHandler` défini.
- **Surface IPC = whitelist** : le renderer ne peut appeler que ce que `preload.ts`
  expose (`contextBridge`), et chaque handler est enregistré côté main.
- **Validation Zod systématique** : ~70 appels `safeParse(...)` répartis sur **tous**
  les modules IPC (`ai`, `businessData`, `operations`, `referenceData`, `system`) —
  y compris les nouveaux handlers B2/B3/B4 (`PaymentsBatchSchema`, `SellerCreateSchema`,
  `SellerUpdateSchema`, `SellerActiveSchema`, `SellerPeriodSchema`, `ResolvePriceSchema`,
  `ProductLevelPriceSchema`, `LevelKeySchema`, `CustomerPriceSchema`, `CustomerProductKeySchema`).
- **Aucun secret exposé au renderer** : les clés d'API IA sont chiffrées via
  `electron.safeStorage` ; le commentaire et le code de `src/ai/secureStorage.ts`
  confirment que **la clé n'est jamais renvoyée en clair au renderer** (seul un
  indicateur du type « clé définie »). Le renderer ne fait que **fournir** la clé.
- **Chemin d'accès fichier** : `validatePathWithinDataDir` / `validatePathWithinSubDir`
  confinent tout chemin fourni par le renderer au dossier de données (protection
  anti-traversal, anti-lecture/écriture arbitraire), en plus d'un rejet précoce `..`.
- **Requêtes SQL** : uniquement **paramétrées** (`db.prepare(...).run/get/all(?)`) dans
  les repositories, y compris les nouvelles requêtes B2/B3/B4 — aucune concaténation de
  valeur utilisateur dans une requête.
---

## 5. Tableau de décision final

| Zone | Statut | Preuve |
|---|---|---|
| **Tests** | ✅ PASS | `npm test` → **65 fichiers · 654 tests · 654 PASS · 0 FAIL** |
| **TypeScript (les deux configs)** | ✅ PASS | `npx tsc --noEmit -p tsconfig.json` → 0 erreur ; `npx tsc --noEmit -p tsconfig.node.json` → 0 erreur |
| **Build** | ⚠️ PARTIEL (bundling OK, installeur NON VÉRIFIÉ) | `tsc` OK · `vite build` OK · `vite build` (MCP) OK · rebuild `better-sqlite3` OK · **packaging NSIS : `EPERM`** (§4.4) — aucun installeur produit |
| **TVA** | ✅ Implémenté + testé | `src/domain/tax/vatRates.ts`, `src/services/TaxService.ts`, `src/utils/money.ts` · **`tests/vat-rates.test.ts` → 40 tests PASS** · catalogue, résolution produit→catégorie→défaut, rapport collectée/déductible/nette |
| **Paiements multiples** | ✅ Implémenté + testé | `DocumentService.addPayments` + `DocumentRepository.addPayments` (atomique, somme ≤ reste dû) · UI `POSPage.tsx` + `InvoicePage.tsx` · **`tests/multi-payments.test.ts` → 10 tests PASS** · **E2E réel : 50 + 40 + 30 → PAID, 3 lignes, solde 120→0** |
| **Prix par niveau** | ✅ Implémenté + testé | `domain/pricing/priceLevels.ts` (règle de priorité pure), `PricingService`, `customers.price_level` / `product_price_levels` / `customer_prices` · UI POS + facture · **`tests/price-levels.test.ts` → 14 tests PASS** |
| **Vendeurs** | ✅ Implémenté + testé | table `sellers` (fiches, sans authentification), `documents.seller_id`, `domain/sellers/commission.ts`, page **Vendeurs** + rapport · **`tests/sellers-commission.test.ts` → 13 tests PASS** |
| **Chiffrement SQLite** | ⚠️ NON IMPLÉMENTÉ (faisabilité prouvée, blocage documenté) | `npm view` : fork `better-sqlite3-multiple-ciphers@13.0.3` (même version que l'existant) ; sonde isolée : chiffrement OK, **sans clé = « file is not a database »**, mauvaise clé refusée, bonne clé OK · blocage : ABI Electron non vérifiable + clé `safeStorage` non testable sous Vitest + migration de l'unique copie non validable ici (§4.1) |
| **E2E** | ✅ PASS | `npm run e2e` — **application Electron réelle, 2 démarrages** · 15 assertions phase 1 + 2 assertions phase 2, **toutes ✔** (§4.3) · captures `e2e-shot-1-phase1.png`, `e2e-shot-2-phase2.png` |
| **Sécurité** | ✅ Confirmé | `electron/main.ts` : `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, `webSecurity:true`, `will-navigate` + `setWindowOpenHandler` · ~70 `safeParse` Zod (dont B2/B3/B4) · `validatePathWithinDataDir` · clé IA via `safeStorage`, jamais renvoyée au renderer · SQL paramétré (§4.5) |

---

## 6. Limitations et points non vérifiés (assumés, sans masquage)

1. **Installeur Windows non produit (NON VÉRIFIÉ — environnement).** L'échec `EPERM`
   au renommage `win-unpacked.tmp → win-unpacked` est **reproductible** sur ce poste.
   Ce n'est pas un défaut de code : `tsc`, les deux builds Vite et la recompilation
   native passent. À rejouer sur une machine sans verrou antivirus/indexeur (ou avec un
   dossier de sortie hors zone surveillée) **avant distribution**.
2. **Chiffrement SQLite au repos non implémenté (C1).** Limitation assumée pour une
   application mono-utilisateur strictement locale, avec la preuve de faisabilité et
   la marche à suivre précise (§4.1). À reprendre quand la vérification Electron
   (ABI + `safeStorage`) et la validation de la migration sont possibles.
3. **Restauration vérifiée au redémarrage de l'application** (E2E), ce qui couvre le
   chemin réel du produit. Le contrôle « base restaurée puis rouverte à la main, poste
   éteint puis rallumé » n'a pas été rejoué physiquement.

---

## 7. Reproductibilité (commandes réellement exécutées)

```bash
npm test                                        # 65 fichiers · 654 tests · 654 PASS
npx tsc --noEmit -p tsconfig.json               # 0 erreur (renderer + src/)
npx tsc --noEmit -p tsconfig.node.json          # 0 erreur (electron/ + services + repositories + database)
npm run build                                   # tsc OK · vite OK · vite(mcp) OK · electron-rebuild OK · packaging EPERM
npm run e2e                                     # E2E Electron réel — 17 assertions ✔ (2 démarrages)
```

Sondes ponctuelles (C1) : `npm view better-sqlite3-multiple-ciphers version` (→ 13.0.3),
`npm view @journeyapps/sqlcipher version` (→ 6.0.0), puis installation et exécution
d'une sonde de chiffrement **dans un dossier temporaire isolé** (supprimé après).

---

## 8. Fichiers ajoutés / modifiés dans cette session

**Fonctionnalités B2/B3/B4 (code)**
- `src/domain/pricing/priceLevels.ts`, `src/repositories/PricingRepository.ts`, `src/services/PricingService.ts` (B3)
- `src/domain/sellers/commission.ts`, `src/repositories/SellerRepository.ts`, `src/services/SellerService.ts` (B4)
- `src/services/DocumentService.ts`, `src/repositories/DocumentRepository.ts` (B2 — `addPayments`)
- `src/database/schema/database.sql` (tables/colonnes `sellers`, `price_level`, `product_price_levels`, `customer_prices`, `documents.seller_id`) + correctif : l'index `idx_documents_seller` est créé par le **chemin d'upgrade** (jamais dans le script principal, pour ne pas casser les bases anciennes)
- `src/database/config/connection.ts` (upgrade : colonne + index `seller_id`, `price_level`)
- `src/validation/schemas.ts`, `electron/ipc/businessData.ipc.ts`, `electron/preload.ts` (IPC + Zod pour B2/B3/B4)
- `src/stores/useSellerStore.ts`, `src/stores/useDocumentStore.ts`, `src/pages/SellersPage.tsx`, `src/pages/POSPage.tsx`, `src/pages/InvoicePage.tsx`, `src/App.tsx`, `src/components/layout/Sidebar.tsx` (UI + routage)

**Tests**
- `tests/multi-payments.test.ts` (10), `tests/price-levels.test.ts` (14), `tests/sellers-commission.test.ts` (13)

**Audit / outillage**
- `scripts/e2e-electron.cjs` (scénario E2E étendu, 2 démarrages)
- `FINAL_PRODUCTION_AUDIT.md` (ce document, autorité) · bandeau `ARCHITECTURE_AUDIT.md` rafraîchi

---

*Ce document est le point d'autorité sur l'état réel de StockLocal au 2026-09-14.
Tout chiffre qui le contredit dans un autre fichier est périmé.*
