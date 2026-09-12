# Implémentation des fonctionnalités manquantes — Rapport final (Phases 1 → 6)

Application : StockLocal (mono-utilisateur, 100 % locale).
Schéma SQL **déjà existant** réutilisé — aucune table nouvelle créée.

## État global

| Vérification | Résultat |
|---|---|
| `npx tsc --noEmit` | **PASS** (0 erreur) |
| `npm test` (suite complète) | **PASS** — 24 fichiers, **227 tests** |
| `npx vite build` | **PASS** (client + `dist-electron/main.js` + `preload.js`) |

Toutes les phases (1 → 6) sont **terminées** et leurs tests passent réellement.

---

## Phase 1 — Conversion Devis → BL / Facture — ✅ TERMINÉE

- `DocumentRepository.convertQuoteToDeliveryNote(quoteId)` et
  `convertQuoteToInvoice(quoteId)` : transaction atomique, copie des lignes,
  numérotation via `document_sequences`, liaison au document d'origine.
- Statut du devis d'origine après conversion : **`CONVERTED`** (statut déjà
  présent dans le modèle de statuts ; aucune invention de statut).
- `InvoicePage.tsx` : boutons « Convertir en BL » / « Convertir en facture »
  sur les devis, avec confirmation.
- Refus de conversion d'un devis déjà converti/annulé (message clair).
- Fichiers : `src/repositories/DocumentRepository.ts`, `src/services/DocumentService.ts`,
  `src/stores/useDocumentStore.ts`, `electron/ipc/businessData.ipc.ts`, `electron/preload.ts`,
  `src/pages/InvoicePage.tsx`, `src/components/ui/statusMaps.ts`.
- Tests : `tests/quote-conversion.test.ts` — **5/5 ✅** (conversion réussie,
  refus si déjà converti, atomicité/rollback).

## Phase 2 — Ticket de caisse 80 mm — ✅ TERMINÉE

- `PDFService` : génération d'un reçu court 80 mm (en-tête entreprise si
  `show_company_name_on_documents` actif, articles, total, mode de paiement,
  date/heure) — sans les mentions légales de la facture A4.
- `POSPage.tsx` : choix « Ticket de caisse » (défaut) / « Facture complète » à
  l'encaissement ; réutilise le mécanisme d'impression existant
  (`documents:printReceipt` → IPC main → `shell.openPath`).
- Fichiers : `src/services/PDFService.ts`, `electron/ipc/businessData.ipc.ts`,
  `electron/preload.ts`, `src/pages/POSPage.tsx`.
- Tests : `tests/pdf-receipt.test.ts` — **4/4 ✅**.

## Phase 3 — Lots / dates d'expiration + alertes — ✅ TERMINÉE

- Case « Ce produit est géré par lots avec date d'expiration » (`batch_managed`,
  0 par défaut — comportement inchangé pour l'existant) dans `ProductForm.tsx`.
- Saisie de lot (n° + date d'expiration) à la réception/ajustement dans `StockPage.tsx`,
  créant une ligne `product_batches`. **Le moteur de stock global
  (`StockLedgerService`, `inventory_balances`) n'est pas modifié.**
- `StockAlertsPage.tsx` : section « Produits proches de l'expiration » avec
  seuils configurables (7 / 30 / 90 jours ; lots déjà expirés signalés).
- Fichiers : `src/repositories/ProductBatchRepository.ts` (nouveau),
  `src/repositories/ProductRepository.ts`, `src/validation/schemas.ts`,
  `electron/ipc/referenceData.ipc.ts`, `electron/preload.ts`,
  `src/components/products/ProductForm.tsx`, `src/pages/StockPage.tsx`,
  `src/pages/StockAlertsPage.tsx`.
- Tests : `tests/product-batches.test.ts` — **4/4 ✅** (création de lot, seuils
  7 j / 30 j / expiré, produit non géré jamais alerté).

## Phase 4 — Remises par quantité — ✅ TERMINÉE

- Interface de création/liste des paliers : **déjà présente** dans `SettingsPage.tsx`
  (onglet Remises), réutilisant `volume_discounts` — complétée par l'application effective.
- Règle métier **non-cumul** (documentée dans `src/utils/volumeDiscount.ts`) :
  une remise **manuelle** saisie sur la ligne est prioritaire ; sinon la meilleure
  règle de palier est appliquée. Jamais appliquée silencieusement — le motif
  « Remise quantité : -X% dès N unités » est affiché.
  ⚠️ Le schéma `volume_discounts` n'a **pas** de `product_id` : les règles sont
  donc globales par tranche de quantité (documenté).
- `POSPage.tsx` et `InvoicePage.tsx` : application automatique + affichage du motif.
- Fichiers : `src/utils/volumeDiscount.ts` (nouveau), `src/pages/POSPage.tsx`,
  `src/pages/InvoicePage.tsx`.
- Tests : `tests/volume-discount.test.ts` — **5/5 ✅** (paliers, hors palier, non-cumul).

## Phase 5 — Multi-dépôts — ⚠️ TERMINÉE EN PORTÉE RÉDUITE (autorisé)

Détail complet dans **`docs/PHASE5_MULTI_DEPOTS.md`**.

- **Fait** : référentiel des dépôts (`WarehouseRepository`), IPC `warehouses:*`,
  `preload`, page `WarehousesPage.tsx` (CRUD + dépôt par défaut + suppression avec
  confirmation), entrée de navigation. Un seul dépôt par défaut garanti.
- **Non fait (hors périmètre assumé)** : ventilation de `inventory_balances` par
  dépôt et transferts inter-dépôts — la table `stock_transfers` **n'existe pas**
  dans le schéma ; une refonte structurelle du moteur de stock a été évitée.
- Fichiers : `src/repositories/WarehouseRepository.ts` (nouveau),
  `src/validation/schemas.ts`, `electron/ipc/referenceData.ipc.ts`,
  `electron/preload.ts`, `src/pages/WarehousesPage.tsx` (nouveau),
  `src/App.tsx`, `src/components/layout/Sidebar.tsx`,
  `docs/PHASE5_MULTI_DEPOTS.md` (nouveau).
- Tests : `tests/warehouses.test.ts` — **4/4 ✅**.

## Phase 6 — Conversions d'unités — ✅ TERMINÉE

- `ProductUnitConversionsModal.tsx` : définition par produit des conversions
  (ex. 1 CARTON = 12 PIÈCES), réutilisant `unit_conversions`. Bouton dédié dans
  `ProductsPage.tsx`.
- `POSPage.tsx` : sélecteur d'unité alternative par ligne. Vendre 1 CARTON
  décrémente 12 PIÈCES : la quantité est convertie en unité de base et le prix
  unitaire est ramené à l'unité de base **en préservant exactement le total**.
- Aucune conversion définie → facteur 1 → **comportement inchangé**.
- Fichiers : `src/utils/unitSale.ts` (nouveau),
  `src/components/products/ProductUnitConversionsModal.tsx` (nouveau),
  `src/pages/ProductsPage.tsx`, `src/pages/POSPage.tsx`.
- Tests : `tests/unit-conversion-sale.test.ts` — **6/6 ✅** (deux sens, total
  préservé, absence de conversion).

---

## Limitations / simplifications assumées

1. **Phase 5** : stock toujours global (pas de ventilation par dépôt), pas de
   transferts inter-dépôts (table inexistante). Voir doc dédiée.
2. **Phase 4** : règles de remise globales par quantité (le schéma ne porte pas
   de `product_id`) ; remise manuelle prioritaire (non-cumul).
3. **Phase 3** : les lots sont informatifs (pas d'affectation FIFO au stock).
