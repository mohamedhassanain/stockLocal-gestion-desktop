# Limitations identifiées dans l'audit — traitées et vérifiées

Ce document récapitule les **4 limitations** relevées lors de l'audit du moteur
de stock / du modèle financier, l'analyse de leur cause racine, le correctif
appliqué et la **preuve de vérification** (tests + build).

État global : **528/528 tests verts (56 fichiers)**, **0 erreur TypeScript** sur
les deux configurations, **build de production OK** (`EXIT=0`).

---

## Limitation 1 — CMUP : le coût moyen n'était pas une moyenne mobile

### Cause racine
`inventory_balances.average_cost` était calculé comme un **cumul d'achats**
(`total_in_value / total_in_qty`). Deux conséquences fausses :

1. Les **sorties ne « sortaient » pas de valeur** : après une vente, le coût
   affiché restait la moyenne de TOUS les achats historiques, y compris ceux
   déjà vendus. Le stock restant était sur-évalué et le COGS sous-évalué.
2. Après **épuisement du stock puis ré-achat** à un prix différent, l'ancienne
   moyenne continuait de « polluer » le nouveau coût
   (ex. 100×10 puis épuisement puis 100×20 → 15 au lieu de 20).

### Correctif
- `StockLedgerService.recordMovement` applique désormais la **moyenne pondérée
  mobile perpétuelle** :
  `CMUP = (qty_en_main × CMUP + qty_entrée × coût) / (qty_en_main + qty_entrée)`.
- Une **sortie ne modifie jamais le CMUP** (les unités sortent au coût moyen) ;
  une **entrée sans coût explicite est valorisée au CMUP courant** (jamais 0).
- Nouvelle colonne additive `stock_movements.unit_cost` = coût de valorisation
  de CHAQUE mouvement (entrées : coût d'acquisition ; sorties : CMUP au moment
  de la sortie) → base exacte du COGS et de la valorisation.
- `rebuildFromLedger` **rejoue le journal dans l'ordre d'écriture**
  (`created_at`, `rowid`). Motif : la colonne `date` mélange des formats
  (`YYYY-MM-DD` d'un document et horodatage complet d'un mouvement direct) ;
  trier par `date` faisait passer une vente du jour AVANT l'achat du jour.
  La **période comptable** reste portée par `documents.date`.
- Le COGS (`DashboardRepository.getRevenueAndCost`) valorise chaque ligne à
  `quantité × unit_cost` du mouvement, sur la période du **document**.
- Un transfert entre dépôts reporte le coût moyen de la source (la valeur
  totale du stock reste inchangée).

### Preuve
- `tests/cmup-weighted-average.test.ts` — **9 tests** : A (100×10 + 100×20 =
  15), B (13,33), C (sortie ≠ impact CMUP), C-2 (ré-achat = nouveau coût),
  D (retour au coût), E (transfert neutre), F (séquence complète + idempotence
  du rebuild), + 2 tests de cohérence **COGS ↔ valorisation**.
- `tests/stock-engine.test.ts` : invariant de test corrigé (l'ancien invariant
  `average_cost = total_in_value/total_in_qty` n'est plus valide par conception).
- `tests/profit.test.ts`, `tests/stock-integrity.test.ts`,
  `tests/multi-warehouse.test.ts`, `tests/document-stock-consistency.test.ts` :
  tous verts.

---

## Limitation 2 — Compte client / factures impayées : solde toujours à 0

### Cause racine
`ClientRepository.getBalance()` (et le champ `balance` de la liste des clients,
de la fiche client, de l'assistant IA et de l'export CSV) ne lisait QUE la table
`client_credits`. Or **les factures ne sont jamais écrites dans cette table**
(elles vivent dans `documents`) : un client endetté de 1 000 MAD par une vente à
crédit affichait **0 MAD**. Conséquences réelles :

- le **plafond de crédit n'était jamais appliqué** aux ventes (seules les
  dettes saisies manuellement le déclenchaient) ;
- l'**encaissement manuel** d'une facture était refusé à tort
  (« le paiement dépasse la dette actuelle ») ;
- le solde affiché **contredisait le relevé de compte** (qui, lui, incluait
  les factures).

Le même défaut existait côté fournisseur (dette = `supplier_credits` seulement,
commandes d'achat ignorées).

### Correctif
- Définition **unique** du solde, réutilisée partout via `clientBalanceSql()` :
  `solde = factures & BL non annulés + crédits manuels − paiements − règlements`.
- `supplierBalanceSql()` : `dette = commandes d'achat non annulées + crédits manuels − règlements`.
- `ExportService.exportClients` / `exportSuppliers` réutilisent ces **mêmes
  expressions** : un export ne peut plus diverger de l'écran.
- Le message d'erreur de migration de la base inclut désormais **toujours la
  cause réelle** (elle était masquée dès qu'un backup pré-migration existait),
  ce qui a permis de diagnostiquer `incomplete input` (un `;` dans un commentaire
  du schéma tronquait une instruction).

### Preuve
- `tests/client-balance.test.ts` — **8 tests** : facture impayée = TTC, paiement
  partiel, facture soldée = 0, dette + encaissement manuels, retour total d'une
  facture impayée (avoir non crédité, facture annulée), **invariant solde
  repository == solde du relevé**, plafond de crédit appliqué aux ventes, dette
  fournisseur sur commande d'achat (+ commande annulée ignorée).

---

## Limitation 3 — Chiffrement de la base de données

### Décision (documentée, volontairement NON appliquée)
Le chiffrement au repos via **SQLCipher** (`better-sqlite3-multiple-ciphers`) a
été évalué et **écarté**, pour trois raisons documentées :
1. Il remplace le module natif compilé pour l'ABI Electron 31 → recompilation
   locale (VS Build Tools) exigée sur les machines non-dev ;
2. La clé resterait stockée sur la même machine que la base : gain de sécurité
   faible dans un modèle **mono-utilisateur 100 % local** assumé ;
3. Chaque correctif ABI du fork devient un risque de build cassé pour toutes les
   installations distribuées.

La protection retenue repose sur le dossier de données utilisateur, la sandbox du
renderer, le confinement des chemins IPC et les **backups** (`VACUUM INTO`).

### Emplacement
- `src/database/config/connection.ts` — bloc de décision détaillé.
- `README.md` — lignes 40 et 443 (section Sécurité).

---

## Limitation 4 — Sécurité de typage

### Cause racine
`tsconfig.node.json` (qui couvre `electron/`, `vite.config.ts`,
`src/services`, `src/repositories`, `src/database`) **n'avait pas de `target`** :
TypeScript retombait sous ES2015 et rejetait toute itération de `Map`/`Set`
(TS2802) sur du code pourtant écrit pour ES2020. La vérification de ces dossiers
était donc inexploitable.

### Correctif
- `target: "ES2020"` + `lib: ["ES2020"]` ajoutés à `tsconfig.node.json`,
  alignant les deux configurations.

### Preuve
- `npx tsc --noEmit -p tsconfig.json` → **0 erreur**
- `npx tsc --noEmit -p tsconfig.node.json` → **0 erreur**

---

## Vérifications finales

| Vérification | Résultat |
| --- | --- |
| Suite de tests complète | **528 / 528** (56 fichiers) |
| TypeScript (`tsconfig.json`) | 0 erreur |
| TypeScript (`tsconfig.node.json`) | 0 erreur |
| Build de production (`tsc && vite build && vite build --config vite.config.mcp.ts`) | **EXIT=0** |

### Nouveaux fichiers de tests
- `tests/cmup-weighted-average.test.ts` (9 tests)
- `tests/client-balance.test.ts` (8 tests)
