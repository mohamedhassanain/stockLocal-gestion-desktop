<div align="center">

# 📦 StockLocal

### Application Desktop de Gestion Commerciale pour Grossistes & Détaillants

**100% locale · Ultra-rapide · Sans connexion internet requise**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://reactjs.org/)
[![Electron](https://img.shields.io/badge/Electron-31-47848f?logo=electron)](https://www.electronjs.org/)
[![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite)](https://www.sqlite.org/)

</div>

---

## Table des matières

- [À propos](#à-propos)
- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture)
- [Sécurité](#sécurité)
- [Base de données](#base-de-données)
- [Installation](#installation)
- [Développement](#développement)
- [Tests](#tests)
- [Build & packaging](#build--packaging)
- [Sauvegarde & restauration](#sauvegarde--restauration)
- [Raccourcis clavier](#raccourcis-clavier)
- [Known limitations](#known-limitations)

---

## À propos

**StockLocal** est une application de gestion de stock et de facturation destinée aux grossistes et détaillants. Elle fonctionne entièrement en local, sans internet, avec une base SQLite embarquée (better-sqlite3) pour des performances optimales.

### Points clés

- 🚫 **100% hors ligne** — aucune connexion internet requise
- ⚡ **Rapide** — requêtes SQL préparées, virtualisation des listes
- 💰 **Adapté au Maroc** — MAD, ICE, TVA, échéances, crédit client (نسيئة)
- 🧾 **Documents** — Devis, Bon de Livraison, Facture, Avoir, PDF
- 🔒 **Sécurisé** — renderer sandboxé, IPC validés, CSP en production

---

## Fonctionnalités

### 📦 Gestion des produits et du stock
- Produits : création, modification, archivage, réactivation, désactivation
- Import CSV avec aperçu, étiquettes code-barres, images
- Moteur de stock centralisé (`StockLedgerService`) avec mouvements explicites :
  `PURCHASE_IN`, `SALE_OUT`, `RETURN_IN`, `RETURN_OUT`, `ADJUSTMENT_IN`,
  `ADJUSTMENT_OUT`, `TRANSFER_IN`, `TRANSFER_OUT`, `DAMAGE_OUT`, `LOSS_OUT`,
  `OPENING_BALANCE`
- Inventaire physique : écart négatif → `ADJUSTMENT_OUT`, positif → `ADJUSTMENT_IN`
- Quantités décimales (0.5, 1.25, 2.5…)
- Valorisation du stock au **coût moyen pondéré (CMUP)**

### 👥 Clients, fournisseurs & crédit
- Fiches clients/fournisseurs avec historique
- Crédit client (نسيئة) avec **contrôle du plafond** côté service
  (`CREDIT_LIMIT_EXCEEDED`)
- Paiements et dettes, relevés de compte PDF

### 🧾 Facturation & paiements
- Devis → Bon de Livraison → Facture
- Avoirs avec **anti sur-retour** (quantité retournée ≤ quantité vendue)
- Paiements (Espèces, Chèque, Virement) avec calcul automatique du statut :
  `UNPAID` → `PARTIAL` → `PAID`
- TVA ligne par ligne, remises, totaux HT/TVA/TTC cohérents
- Export PDF professionnel

### 📊 Tableau de bord & rapports
- CA aujourd'hui / mois, marge, valeur du stock, impayés
- Graphique d'évolution (6 mois), top produits, top clients
- Alertes stock, échéances, sauvegarde, exports Excel (CSV UTF-8 BOM) et PDF

---

## Architecture

```
electron/
├── main.ts                 # Processus principal : fenêtre, IPC, sécurité
├── preload.ts              # API exposée au renderer (contextBridge)
└── ipcValidation.ts        # Validation IPC + messages d'erreur humains
src/
├── components/             # Sidebar, formulaires, onglets, assistants
├── database/
│   ├── config/connection.ts# Connexion SQLite, migrations, transactions
│   └── schema/database.sql # Schéma complet (idempotent)
├── pages/                  # Dashboard, Produits, Stock, Inventaire, Ventes…
├── repositories/           # Accès aux données (DAO)
├── services/               # Logique métier (Stock, Documents, Backup…)
├── stores/                 # État global Zustand
├── validation/schemas.ts   # Schémas Zod des entrées IPC
└── styles.css              # Design system (variables CSS)
```

**Chaîne de confiance** : Renderer (sandboxé) → `window.api` (preload) → IPC → validation (Zod + `ipcValidation.ts`) → Service métier → Repository → SQLite.

---

## Sécurité

- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`
- API renderer limitée au `preload.ts` (aucun accès direct à Node)
- Navigation verrouillée (`will-navigate`, `setWindowOpenHandler`) : les liens
  externes s'ouvrent dans le navigateur système
- **CSP stricte en production** injectée au build (`vite.config.ts` → `<meta>`),
  désactivée en dev pour le préambule React
- Validation Zod sur les payloads IPC critiques ; validation systématique des
  chemins fichiers (anti traversal `..`, `~`)
- Erreurs SQLite traduites en messages humains (`toHumanError`)
- Audit log : actions critiques tracées (`audit_logs`), avec `old_value` /
  `new_value` pour les modifications de prix

> NB : l'application est **single-user** (pas d'authentification ni de rôles).
> Le schéma d'audit est préparé pour l'ajout d'un `user_id` ultérieur.

---

## Base de données

- Moteur : **SQLite** via `better-sqlite3` (module natif)
- Emplacement des données : choisi au premier lancement (par défaut dans le
  dossier de l'utilisateur)
- PRAGMAs : `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`
- Migrations automatiques au démarrage (`connection.ts`) :
  - ajout de colonnes manquantes (`addColumnIfMissing`)
  - reconstruction des tables dont les quantités doivent passer en `REAL`
  - reclassement des anciens mouvements vers `movement_type` explicites
  - recréation `audit_logs` sans FK `users` si une ancienne base la contient
- Index créés sur les colonnes réellement utilisées en filtre/join
- Intégrité vérifiable via `PRAGMA integrity_check` (IPC `db:integrityCheck`)

---

## Installation

Prérequis : Node.js >= 18 et npm.

```bash
# 1. Cloner
git clone https://github.com/mohamedhassanain/stockLocal-gestion-desktop.git
cd stockLocal-gestion-desktop

# 2. Installer (le postinstall recompile better-sqlite3 pour l'ABI Electron)
npm install

# 3. Lancer en développement
npm run dev

# 4. Build de production (typecheck + bundle + installeur)
npm run build
```

> Le `postinstall` exécute `electron-builder install-app-deps` : indispensable
> pour que `better-sqlite3` soit compatible avec le Node embarqué d'Electron
> (évite l'erreur `NODE_MODULE_VERSION mismatch`).

---

## Développement

| Script | Rôle |
|--------|------|
| `npm run dev` | Vite + Electron en mode développement (HMR) |
| `npm run build` | `tsc && vite build && electron-builder` |
| `npm test` | Tests Vitest lancés sous le Node d'Electron |
| `npm run test:watch` | Même chose en mode watch |

### Tests

Les tests s'exécutent avec le **Node d'Electron** (`ELECTRON_RUN_AS_NODE=1`) via
`scripts/run-tests-electron.cjs`, afin de valider exactement le binaire natif de
l'application.

```
npm test
```

Couverture actuelle : validation des schémas (20), moteur de stock / inventaire /
transferts / produits (25), backup / restore (4).

---

## Build & packaging

`npm run build` produit :

1. Vérification TypeScript (`tsc`)
2. Bundle renderer (Vite) + main/preload (`dist/`, `dist-electron/`)
3. Installeur via `electron-builder` (dossier `release/`)

La CSP de production est injectée dans `dist/index.html` au moment du build.

---

## Sauvegarde & restauration

- **Backup manuel** : bouton « Sauvegarder » (dashboard) ou IPC `backup:now`
- **Backup automatique** : planifié au démarrage (`BackupService.scheduleAutoBackup`)
- **Restauration** :
  1. backup de sécurité de l'état courant
  2. copie du backup → marqueur `.restore_pending.db`
  3. au prochain démarrage : `integrity_check`, sinon **rollback automatique**
- Les backups sont conservés dans le dossier `backups/` des données

---

## Raccourcis clavier

| Raccourci | Page |
|-----------|------|
| `F1` | Tableau de bord |
| `F2` | Produits |
| `F3` | Mouvements de stock |
| `F4` | Clients |
| `F5` | Fournisseurs |
| `F6` | Factures & Devis |
| `F7` | Paramètres |
| `F8` | Point de vente |
| `F9` | Commandes fournisseurs |
| `F10` | Inventaire |

Sur la page Produits : `Ctrl+F` focus recherche, `F8` nouveau produit.

---

## Known limitations

- **Single-user** : pas d'authentification, de rôles ni de permissions (prévu)
- **Rapports** : valuation et marge du dashboard utilisent encore le coût
  moyen pondéré calculé par le service ; les exports PDF/CSV reposent sur les
  données agrégées existantes
- **Multi-dépôts / lots** : les tables `warehouses` et `product_batches` sont
  préparées dans le schéma, sans UI ni service actif pour l'instant
- Pas de script `lint` à ce stade

---

## Licence

Projet sous licence MIT.
