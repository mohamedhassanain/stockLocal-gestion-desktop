> [!WARNING] DOCUMENT HISTORIQUE - PERIME (Historical / superseded).
> Le compteur de tests et le statut de production de ce fichier ne sont plus valides.
> Rapport de reference : FINAL_PRODUCTION_AUDIT.md (57 fichiers, 538 tests, 538 PASS).

---

# Limitations identifiÃ©es dans l'audit â€” traitÃ©es et vÃ©rifiÃ©es

Ce document rÃ©capitule les **4 limitations** relevÃ©es lors de l'audit du moteur
de stock / du modÃ¨le financier, l'analyse de leur cause racine, le correctif
appliquÃ© et la **preuve de vÃ©rification** (tests + build).

Ã‰tat global : **528/528 tests verts (56 fichiers)**, **0 erreur TypeScript** sur
les deux configurations, **build de production OK** (`EXIT=0`).

---

## Limitation 1 â€” CMUP : le coÃ»t moyen n'Ã©tait pas une moyenne mobile

### Cause racine
`inventory_balances.average_cost` Ã©tait calculÃ© comme un **cumul d'achats**
(`total_in_value / total_in_qty`). Deux consÃ©quences fausses :

1. Les **sorties ne Â« sortaient Â» pas de valeur** : aprÃ¨s une vente, le coÃ»t
   affichÃ© restait la moyenne de TOUS les achats historiques, y compris ceux
   dÃ©jÃ  vendus. Le stock restant Ã©tait sur-Ã©valuÃ© et le COGS sous-Ã©valuÃ©.
2. AprÃ¨s **Ã©puisement du stock puis rÃ©-achat** Ã  un prix diffÃ©rent, l'ancienne
   moyenne continuait de Â« polluer Â» le nouveau coÃ»t
   (ex. 100Ã—10 puis Ã©puisement puis 100Ã—20 â†’ 15 au lieu de 20).

### Correctif
- `StockLedgerService.recordMovement` applique dÃ©sormais la **moyenne pondÃ©rÃ©e
  mobile perpÃ©tuelle** :
  `CMUP = (qty_en_main Ã— CMUP + qty_entrÃ©e Ã— coÃ»t) / (qty_en_main + qty_entrÃ©e)`.
- Une **sortie ne modifie jamais le CMUP** (les unitÃ©s sortent au coÃ»t moyen) ;
  une **entrÃ©e sans coÃ»t explicite est valorisÃ©e au CMUP courant** (jamais 0).
- Nouvelle colonne additive `stock_movements.unit_cost` = coÃ»t de valorisation
  de CHAQUE mouvement (entrÃ©es : coÃ»t d'acquisition ; sorties : CMUP au moment
  de la sortie) â†’ base exacte du COGS et de la valorisation.
- `rebuildFromLedger` **rejoue le journal dans l'ordre d'Ã©criture**
  (`created_at`, `rowid`). Motif : la colonne `date` mÃ©lange des formats
  (`YYYY-MM-DD` d'un document et horodatage complet d'un mouvement direct) ;
  trier par `date` faisait passer une vente du jour AVANT l'achat du jour.
  La **pÃ©riode comptable** reste portÃ©e par `documents.date`.
- Le COGS (`DashboardRepository.getRevenueAndCost`) valorise chaque ligne Ã 
  `quantitÃ© Ã— unit_cost` du mouvement, sur la pÃ©riode du **document**.
- Un transfert entre dÃ©pÃ´ts reporte le coÃ»t moyen de la source (la valeur
  totale du stock reste inchangÃ©e).

### Preuve
- `tests/cmup-weighted-average.test.ts` â€” **9 tests** : A (100Ã—10 + 100Ã—20 =
  15), B (13,33), C (sortie â‰  impact CMUP), C-2 (rÃ©-achat = nouveau coÃ»t),
  D (retour au coÃ»t), E (transfert neutre), F (sÃ©quence complÃ¨te + idempotence
  du rebuild), + 2 tests de cohÃ©rence **COGS â†” valorisation**.
- `tests/stock-engine.test.ts` : invariant de test corrigÃ© (l'ancien invariant
  `average_cost = total_in_value/total_in_qty` n'est plus valide par conception).
- `tests/profit.test.ts`, `tests/stock-integrity.test.ts`,
  `tests/multi-warehouse.test.ts`, `tests/document-stock-consistency.test.ts` :
  tous verts.

---

## Limitation 2 â€” Compte client / factures impayÃ©es : solde toujours Ã  0

### Cause racine
`ClientRepository.getBalance()` (et le champ `balance` de la liste des clients,
de la fiche client, de l'assistant IA et de l'export CSV) ne lisait QUE la table
`client_credits`. Or **les factures ne sont jamais Ã©crites dans cette table**
(elles vivent dans `documents`) : un client endettÃ© de 1 000 MAD par une vente Ã 
crÃ©dit affichait **0 MAD**. ConsÃ©quences rÃ©elles :

- le **plafond de crÃ©dit n'Ã©tait jamais appliquÃ©** aux ventes (seules les
  dettes saisies manuellement le dÃ©clenchaient) ;
- l'**encaissement manuel** d'une facture Ã©tait refusÃ© Ã  tort
  (Â« le paiement dÃ©passe la dette actuelle Â») ;
- le solde affichÃ© **contredisait le relevÃ© de compte** (qui, lui, incluait
  les factures).

Le mÃªme dÃ©faut existait cÃ´tÃ© fournisseur (dette = `supplier_credits` seulement,
commandes d'achat ignorÃ©es).

### Correctif
- DÃ©finition **unique** du solde, rÃ©utilisÃ©e partout via `clientBalanceSql()` :
  `solde = factures & BL non annulÃ©s + crÃ©dits manuels âˆ’ paiements âˆ’ rÃ¨glements`.
- `supplierBalanceSql()` : `dette = commandes d'achat non annulÃ©es + crÃ©dits manuels âˆ’ rÃ¨glements`.
- `ExportService.exportClients` / `exportSuppliers` rÃ©utilisent ces **mÃªmes
  expressions** : un export ne peut plus diverger de l'Ã©cran.
- Le message d'erreur de migration de la base inclut dÃ©sormais **toujours la
  cause rÃ©elle** (elle Ã©tait masquÃ©e dÃ¨s qu'un backup prÃ©-migration existait),
  ce qui a permis de diagnostiquer `incomplete input` (un `;` dans un commentaire
  du schÃ©ma tronquait une instruction).

### Preuve
- `tests/client-balance.test.ts` â€” **8 tests** : facture impayÃ©e = TTC, paiement
  partiel, facture soldÃ©e = 0, dette + encaissement manuels, retour total d'une
  facture impayÃ©e (avoir non crÃ©ditÃ©, facture annulÃ©e), **invariant solde
  repository == solde du relevÃ©**, plafond de crÃ©dit appliquÃ© aux ventes, dette
  fournisseur sur commande d'achat (+ commande annulÃ©e ignorÃ©e).

---

## Limitation 3 â€” Chiffrement de la base de donnÃ©es

### DÃ©cision (documentÃ©e, volontairement NON appliquÃ©e)
Le chiffrement au repos via **SQLCipher** (`better-sqlite3-multiple-ciphers`) a
Ã©tÃ© Ã©valuÃ© et **Ã©cartÃ©**, pour trois raisons documentÃ©es :
1. Il remplace le module natif compilÃ© pour l'ABI Electron 31 â†’ recompilation
   locale (VS Build Tools) exigÃ©e sur les machines non-dev ;
2. La clÃ© resterait stockÃ©e sur la mÃªme machine que la base : gain de sÃ©curitÃ©
   faible dans un modÃ¨le **mono-utilisateur 100 % local** assumÃ© ;
3. Chaque correctif ABI du fork devient un risque de build cassÃ© pour toutes les
   installations distribuÃ©es.

La protection retenue repose sur le dossier de donnÃ©es utilisateur, la sandbox du
renderer, le confinement des chemins IPC et les **backups** (`VACUUM INTO`).

### Emplacement
- `src/database/config/connection.ts` â€” bloc de dÃ©cision dÃ©taillÃ©.
- `README.md` â€” lignes 40 et 443 (section SÃ©curitÃ©).

---

## Limitation 4 â€” SÃ©curitÃ© de typage

### Cause racine
`tsconfig.node.json` (qui couvre `electron/`, `vite.config.ts`,
`src/services`, `src/repositories`, `src/database`) **n'avait pas de `target`** :
TypeScript retombait sous ES2015 et rejetait toute itÃ©ration de `Map`/`Set`
(TS2802) sur du code pourtant Ã©crit pour ES2020. La vÃ©rification de ces dossiers
Ã©tait donc inexploitable.

### Correctif
- `target: "ES2020"` + `lib: ["ES2020"]` ajoutÃ©s Ã  `tsconfig.node.json`,
  alignant les deux configurations.

### Preuve
- `npx tsc --noEmit -p tsconfig.json` â†’ **0 erreur**
- `npx tsc --noEmit -p tsconfig.node.json` â†’ **0 erreur**

---

## VÃ©rifications finales

| VÃ©rification | RÃ©sultat |
| --- | --- |
| Suite de tests complÃ¨te | **528 / 528** (56 fichiers) |
| TypeScript (`tsconfig.json`) | 0 erreur |
| TypeScript (`tsconfig.node.json`) | 0 erreur |
| Build de production (`tsc && vite build && vite build --config vite.config.mcp.ts`) | **EXIT=0** |

### Nouveaux fichiers de tests
- `tests/cmup-weighted-average.test.ts` (9 tests)
- `tests/client-balance.test.ts` (8 tests)
