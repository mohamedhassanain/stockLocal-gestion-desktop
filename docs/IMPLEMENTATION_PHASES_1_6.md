> [!WARNING] DOCUMENT HISTORIQUE - PERIME (Historical / superseded).
> Le compteur de tests et le statut de production de ce fichier ne sont plus valides.
> Rapport de reference : FINAL_PRODUCTION_AUDIT.md (57 fichiers, 538 tests, 538 PASS).

---

# ImplÃ©mentation des fonctionnalitÃ©s manquantes â€” Rapport final (Phases 1 â†’ 6)

Application : StockLocal (mono-utilisateur, 100 % locale).
SchÃ©ma SQL **dÃ©jÃ  existant** rÃ©utilisÃ© â€” aucune table nouvelle crÃ©Ã©e.

## Ã‰tat global

| VÃ©rification | RÃ©sultat |
|---|---|
| `npx tsc --noEmit` | **PASS** (0 erreur) |
| `npm test` (suite complÃ¨te) | **PASS** â€” 24 fichiers, **227 tests** |
| `npx vite build` | **PASS** (client + `dist-electron/main.js` + `preload.js`) |

Toutes les phases (1 â†’ 6) sont **terminÃ©es** et leurs tests passent rÃ©ellement.

---

## Phase 1 â€” Conversion Devis â†’ BL / Facture â€” âœ… TERMINÃ‰E

- `DocumentRepository.convertQuoteToDeliveryNote(quoteId)` et
  `convertQuoteToInvoice(quoteId)` : transaction atomique, copie des lignes,
  numÃ©rotation via `document_sequences`, liaison au document d'origine.
- Statut du devis d'origine aprÃ¨s conversion : **`CONVERTED`** (statut dÃ©jÃ 
  prÃ©sent dans le modÃ¨le de statuts ; aucune invention de statut).
- `InvoicePage.tsx` : boutons Â« Convertir en BL Â» / Â« Convertir en facture Â»
  sur les devis, avec confirmation.
- Refus de conversion d'un devis dÃ©jÃ  converti/annulÃ© (message clair).
- Fichiers : `src/repositories/DocumentRepository.ts`, `src/services/DocumentService.ts`,
  `src/stores/useDocumentStore.ts`, `electron/ipc/businessData.ipc.ts`, `electron/preload.ts`,
  `src/pages/InvoicePage.tsx`, `src/components/ui/statusMaps.ts`.
- Tests : `tests/quote-conversion.test.ts` â€” **5/5 âœ…** (conversion rÃ©ussie,
  refus si dÃ©jÃ  converti, atomicitÃ©/rollback).

## Phase 2 â€” Ticket de caisse 80 mm â€” âœ… TERMINÃ‰E

- `PDFService` : gÃ©nÃ©ration d'un reÃ§u court 80 mm (en-tÃªte entreprise si
  `show_company_name_on_documents` actif, articles, total, mode de paiement,
  date/heure) â€” sans les mentions lÃ©gales de la facture A4.
- `POSPage.tsx` : choix Â« Ticket de caisse Â» (dÃ©faut) / Â« Facture complÃ¨te Â» Ã 
  l'encaissement ; rÃ©utilise le mÃ©canisme d'impression existant
  (`documents:printReceipt` â†’ IPC main â†’ `shell.openPath`).
- Fichiers : `src/services/PDFService.ts`, `electron/ipc/businessData.ipc.ts`,
  `electron/preload.ts`, `src/pages/POSPage.tsx`.
- Tests : `tests/pdf-receipt.test.ts` â€” **4/4 âœ…**.

## Phase 3 â€” Lots / dates d'expiration + alertes â€” âœ… TERMINÃ‰E

- Case Â« Ce produit est gÃ©rÃ© par lots avec date d'expiration Â» (`batch_managed`,
  0 par dÃ©faut â€” comportement inchangÃ© pour l'existant) dans `ProductForm.tsx`.
- Saisie de lot (nÂ° + date d'expiration) Ã  la rÃ©ception/ajustement dans `StockPage.tsx`,
  crÃ©ant une ligne `product_batches`. **Le moteur de stock global
  (`StockLedgerService`, `inventory_balances`) n'est pas modifiÃ©.**
- `StockAlertsPage.tsx` : section Â« Produits proches de l'expiration Â» avec
  seuils configurables (7 / 30 / 90 jours ; lots dÃ©jÃ  expirÃ©s signalÃ©s).
- Fichiers : `src/repositories/ProductBatchRepository.ts` (nouveau),
  `src/repositories/ProductRepository.ts`, `src/validation/schemas.ts`,
  `electron/ipc/referenceData.ipc.ts`, `electron/preload.ts`,
  `src/components/products/ProductForm.tsx`, `src/pages/StockPage.tsx`,
  `src/pages/StockAlertsPage.tsx`.
- Tests : `tests/product-batches.test.ts` â€” **4/4 âœ…** (crÃ©ation de lot, seuils
  7 j / 30 j / expirÃ©, produit non gÃ©rÃ© jamais alertÃ©).

## Phase 4 â€” Remises par quantitÃ© â€” âœ… TERMINÃ‰E

- Interface de crÃ©ation/liste des paliers : **dÃ©jÃ  prÃ©sente** dans `SettingsPage.tsx`
  (onglet Remises), rÃ©utilisant `volume_discounts` â€” complÃ©tÃ©e par l'application effective.
- RÃ¨gle mÃ©tier **non-cumul** (documentÃ©e dans `src/utils/volumeDiscount.ts`) :
  une remise **manuelle** saisie sur la ligne est prioritaire ; sinon la meilleure
  rÃ¨gle de palier est appliquÃ©e. Jamais appliquÃ©e silencieusement â€” le motif
  Â« Remise quantitÃ© : -X% dÃ¨s N unitÃ©s Â» est affichÃ©.
  âš ï¸ Le schÃ©ma `volume_discounts` n'a **pas** de `product_id` : les rÃ¨gles sont
  donc globales par tranche de quantitÃ© (documentÃ©).
- `POSPage.tsx` et `InvoicePage.tsx` : application automatique + affichage du motif.
- Fichiers : `src/utils/volumeDiscount.ts` (nouveau), `src/pages/POSPage.tsx`,
  `src/pages/InvoicePage.tsx`.
- Tests : `tests/volume-discount.test.ts` â€” **5/5 âœ…** (paliers, hors palier, non-cumul).

## Phase 5 â€” Multi-dÃ©pÃ´ts â€” âš ï¸ TERMINÃ‰E EN PORTÃ‰E RÃ‰DUITE (autorisÃ©)

DÃ©tail complet dans **`docs/PHASE5_MULTI_DEPOTS.md`**.

- **Fait** : rÃ©fÃ©rentiel des dÃ©pÃ´ts (`WarehouseRepository`), IPC `warehouses:*`,
  `preload`, page `WarehousesPage.tsx` (CRUD + dÃ©pÃ´t par dÃ©faut + suppression avec
  confirmation), entrÃ©e de navigation. Un seul dÃ©pÃ´t par dÃ©faut garanti.
- **Non fait (hors pÃ©rimÃ¨tre assumÃ©)** : ventilation de `inventory_balances` par
  dÃ©pÃ´t et transferts inter-dÃ©pÃ´ts â€” la table `stock_transfers` **n'existe pas**
  dans le schÃ©ma ; une refonte structurelle du moteur de stock a Ã©tÃ© Ã©vitÃ©e.
- Fichiers : `src/repositories/WarehouseRepository.ts` (nouveau),
  `src/validation/schemas.ts`, `electron/ipc/referenceData.ipc.ts`,
  `electron/preload.ts`, `src/pages/WarehousesPage.tsx` (nouveau),
  `src/App.tsx`, `src/components/layout/Sidebar.tsx`,
  `docs/PHASE5_MULTI_DEPOTS.md` (nouveau).
- Tests : `tests/warehouses.test.ts` â€” **4/4 âœ…**.

## Phase 6 â€” Conversions d'unitÃ©s â€” âœ… TERMINÃ‰E

- `ProductUnitConversionsModal.tsx` : dÃ©finition par produit des conversions
  (ex. 1 CARTON = 12 PIÃˆCES), rÃ©utilisant `unit_conversions`. Bouton dÃ©diÃ© dans
  `ProductsPage.tsx`.
- `POSPage.tsx` : sÃ©lecteur d'unitÃ© alternative par ligne. Vendre 1 CARTON
  dÃ©crÃ©mente 12 PIÃˆCES : la quantitÃ© est convertie en unitÃ© de base et le prix
  unitaire est ramenÃ© Ã  l'unitÃ© de base **en prÃ©servant exactement le total**.
- Aucune conversion dÃ©finie â†’ facteur 1 â†’ **comportement inchangÃ©**.
- Fichiers : `src/utils/unitSale.ts` (nouveau),
  `src/components/products/ProductUnitConversionsModal.tsx` (nouveau),
  `src/pages/ProductsPage.tsx`, `src/pages/POSPage.tsx`.
- Tests : `tests/unit-conversion-sale.test.ts` â€” **6/6 âœ…** (deux sens, total
  prÃ©servÃ©, absence de conversion).

---

## Limitations / simplifications assumÃ©es

1. **Phase 5** : stock toujours global (pas de ventilation par dÃ©pÃ´t), pas de
   transferts inter-dÃ©pÃ´ts (table inexistante). Voir doc dÃ©diÃ©e.
2. **Phase 4** : rÃ¨gles de remise globales par quantitÃ© (le schÃ©ma ne porte pas
   de `product_id`) ; remise manuelle prioritaire (non-cumul).
3. **Phase 3** : les lots sont informatifs (pas d'affectation FIFO au stock).
---

## Suivi â€” finalisation UI des Phases 4 & 6 (itÃ©ration 2)

Constats d'audit vÃ©rifiÃ©s dans le code :
- Les **Ã©crans de gestion existaient dÃ©jÃ ** : ParamÃ¨tres â†’ onglet Â« Remises volume Â»
  (Phase 4) et ParamÃ¨tres â†’ Â« Conversions d'unitÃ©s Â» + modale par produit dans
  `ProductsPage.tsx` (Phase 6). L'application automatique Ã©tait Ã©galement cÃ¢blÃ©e
  dans `POSPage.tsx` / `InvoicePage.tsx`.
- Deux manques rÃ©els ont Ã©tÃ© comblÃ©s :

### Phase 4 â€” ajouts
1. **Modification** d'une rÃ¨gle de remise : l'Ã©cran ParamÃ¨tres â†’ Â« Remises volume Â»
   permet dÃ©sormais crÃ©er / **modifier** / supprimer (bouton âœï¸ par ligne â†’
   `window.api.discounts.update`), avec confirmation avant suppression.
2. Comportement **non-cumul** confirmÃ© et documentÃ© : une remise **manuelle**
   saisie sur une ligne de vente est prioritaire ; sinon la meilleure rÃ¨gle de
   palier s'applique. Le motif (Â« Remise quantitÃ© : -X% dÃ¨s N unitÃ©s Â») est
   affichÃ© â€” jamais appliquÃ© silencieusement.
3. Tests ajoutÃ©s (`tests/volume-discount.test.ts`) : CRUD backend
   (create/update/delete) et `getDiscountForQuantity` (bon palier, rien hors palier).

### Phase 6 â€” ajouts
1. POS **rÃ©utilise le backend** pour le facteur de conversion :
   `window.api.conversions.convert(1, unitÃ©Vente, unitÃ©Base, productId)` â€”
   **aucune rÃ¨gle de conversion n'est dupliquÃ©e cÃ´tÃ© front**. `src/utils/unitSale.ts`
   ne contient plus que l'arithmÃ©tique pure (`toBaseQuantity`, `toBaseUnitPrice`).
2. Test **bout-en-bout** (`tests/unit-conversion-sale.test.ts`) : vendre 2 CARTONS
   (Ã—12) dÃ©crÃ©mente le stock de **24 PIÃˆCES** (100 â†’ 76) et prÃ©serve le total de
   ligne (2 Ã— 300 MAD = 600 MAD HT) ; produit **sans** conversion â†’ facteur 1,
   stock dÃ©crÃ©mentÃ© de la quantitÃ© exacte (comportement inchangÃ©).

### RÃ©sultats (itÃ©ration 2)
- `npx tsc --noEmit` : **PASS**
- `npm test` : **PASS â€” 24 fichiers, 229 tests** (base 227 â†’ +2)
- `npx vite build` : **PASS** (client + main + preload)

### ChaÃ®ne fonctionnelle vÃ©rifiÃ©e de bout en bout
- **Phase 4** : ParamÃ¨tres (crÃ©er/modifier/supprimer rÃ¨gles) â†’ POS/Invoice
  (application automatique visible + remise manuelle prioritaire).
- **Phase 6** : ParamÃ¨tres & fiche produit (dÃ©finir 1 CARTON = 12 PIÃˆCES) â†’ POS
  (sÃ©lection d'unitÃ© Ã  la vente) â†’ facteur via backend `convert` â†’ stock dÃ©crÃ©mentÃ©
  en unitÃ© de base du montant exact.
