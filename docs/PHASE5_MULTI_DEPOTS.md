# Phase 5 — Multi-dépôts (`warehouses`) : portée réalisée vs restante

Ce document précise **exactement** ce qui a été implémenté pour les dépôts et ce
qui reste à faire pour un support multi-dépôts complet — conformément à
l'autorisation explicite d'un **scope réduit** lorsque la refonte complète est
trop risquée.

## ✅ Réalisé

1. **Référentiel des dépôts** — table `warehouses` déjà présente dans `database.sql`
   (`id`, `name`, `address`, `is_default`).
   - `src/repositories/WarehouseRepository.ts` : CRUD (`getAll`, `getById`,
     `getDefault`, `create`, `update`, `remove`, `setDefault`).
   - **Unicité du dépôt par défaut** garantie : marquer un dépôt par défaut
     désélectionne tous les autres (transaction), et supprimer le dépôt par
     défaut promeut automatiquement le premier dépôt restant.
   - IPC (`warehouses:*`) + `preload` (`window.api.warehouses.*`).
   - Page `src/pages/WarehousesPage.tsx` : création, édition, suppression
     (avec confirmation), définition du dépôt par défaut. Entrée de navigation
     ajoutée dans la barre latérale (section « Stock » → « Dépôts »).
   - Tests : `tests/warehouses.test.ts` (4 tests, ✅).

## ⚠️ NON réalisé (volontairement hors périmètre)

2. **Ventilation du stock par dépôt** — NON faite.
   Le stock reste un **solde global par produit** dans `inventory_balances`
   (`product_id` → `quantity`), sans colonne `warehouse_id`. Aucune modification
   du moteur de stock (`StockLedgerService`, `StockMovementRepository`,
   `inventory_balances`) n'a été effectuée.

3. **Transferts inter-dépôts** — NON faits.
   La table `stock_transfers` **n'existe pas** dans `database.sql` (vérifié).
   Aucune table n'a été créée et aucun écran de transfert n'a été ajouté.

## 🔧 Reste à faire pour un vrai support multi-dépôts complet

Pour ventiler le stock par dépôt sans risque, il faudrait :

1. **Schéma** : ajouter `warehouse_id` (FK → `warehouses`) à `inventory_balances`,
   `stock_movements`, et aux documents (`sales_documents` / lignes).
   Ajouter la table `stock_transfers` (dépôt source, dépôt destination, produit,
   quantité, date, statut).
2. **Migration** : affecter tous les mouvements/balances existants au dépôt par
   défaut (`is_default = 1`), puis recalculer `inventory_balances` par
   `(product_id, warehouse_id)`.
3. **Moteur de stock** : faire transiter `warehouse_id` dans toute la chaîne
   (`StockLedgerService`, `ProductRepository`/`inventory_balances`, POS, achats,
   inventaires) — c'est un changement transversal à fort risque de régression.
4. **UI** : sélecteur de dépôt (POS, achats, mouvements), écran de transferts.
5. **Tests** : isolation par dépôt, transfert (sortie source / entrée destination
   atomiques), alertes de stock par dépôt.

Ces étapes constituent une **refonte structurelle du moteur de stock** qui n'a
pas été engagée ici, comme explicitement autorisé par le prompt.
