# StockLocal - Gestion Commerciale

**StockLocal** est une application desktop de gestion commerciale 100% locale, conçue pour les grossistes et détaillants au Maroc. L'objectif est d'offrir une plateforme rapide, robuste et hors-ligne pour la gestion des stocks, la facturation, et le suivi du crédit client (نسيئة).

## 🚀 Fonctionnalités Principales

- **Gestion du Stock & Produits** : Historique des mouvements, alertes de rupture, unités multiples (Pièce, Kg, Carton), impression de codes-barres.
- **Clients & Fournisseurs** : Suivi des créances (Crédit/نسيئة), plafonds de crédit, historique détaillé des paiements et relevés de compte.
- **Tarification** : Multi-tarifs (Détail, Gros, VIP), gestion des marges, remises par volume.
- **Facturation** : Cycle complet de vente (Devis ➔ Bon de Livraison ➔ Facture), impression PDF très rapide avec mentions légales marocaines (ICE, RC, IF).
- **Tableau de Bord** : Vue d'ensemble du CA, marges, classements des ventes et suivi des échéances de paiement.
- **Sécurité** : Base de données locale (SQLite), sauvegardes automatiques quotidiennes, aucune perte de données.

## 🛠️ Stack Technique

- **Conteneur** : [Electron](https://www.electronjs.org/)
- **Frontend** : [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + Vite
- **Base de Données** : [SQLite](https://sqlite.org/) (via `better-sqlite3` pour des performances optimales synchrones)
- **State Management** : [Zustand](https://zustand-demo.pmnd.rs/)
- **Utilitaires** : `pdf-lib` (pour la génération des factures), `zod` (pour la validation)

## 📦 Installation et Lancement (Développement)

Pour contribuer au développement de StockLocal, assurez-vous d'avoir [Node.js](https://nodejs.org/) installé, puis suivez ces étapes :

```bash
# 1. Cloner le dépôt
git clone <url-du-depot>

# 2. Installer les dépendances
npm install

# 3. Lancer l'application en mode développement
npm run dev
```

## 🏗️ Architecture du Projet

- `src/` : Code Frontend React (UI, composants, stores Zustand).
- `src/database/` : Fichiers liés à la base de données SQLite (Schémas, requêtes).
- `src/services/` & `src/repositories/` : Logique métier partagée et requêtes base de données.
- `electron/` : Code Main Process Electron (Accès système, fichiers, IPC handlers SQLite).
- `dist-electron/` & `dist/` : Fichiers compilés (générés lors du build).

## 📜 Licence & Droits
Application propriétaire. Toute reproduction ou distribution non autorisée est interdite.
