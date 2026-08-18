<div align="center">

# 📦 StockLocal

### Application Desktop de Gestion Commerciale

**100% locale · Ultra-rapide · Sans internet**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://reactjs.org/)
[![Electron](https://img.shields.io/badge/Electron-31-47848f?logo=electron)](https://www.electronjs.org/)
[![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite)](https://www.sqlite.org/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

</div>

---

## 📋 Table des matières

- [À propos](#-à-propos)
- [Fonctionnalités](#-fonctionnalités)
- [Technologies](#-technologies)
- [Installation](#-installation)
- [Utilisation](#-utilisation)
- [Structure du projet](#-structure-du-projet)
- [Raccourcis clavier](#-raccourcis-clavier)
- [Contribuer](#-contribuer)

---

## 🎯 À propos

**StockLocal** est une application de gestion de stock et de facturation conçue pour les grossistes et détaillants au Maroc. Fonctionnant entièrement hors ligne, elle offre des performances ultra-rapides tout en garantissant la sécurité des données.

### Pourquoi StockLocal ?

- 🚫 **100% hors ligne** — Aucune connexion internet requise
- ⚡ **Ultra-rapide** — Recherche de produits en < 100ms
- 🔒 **Sécurisé** — Base de données chiffrée avec SQLCipher
- 💰 **Adapté au Maroc** — MAD, ICE, RC, IF, تجديد
- 📊 **Tableau de bord** — Statistiques en temps réel
- 🧾 **Facturation** — Devis, BL, Factures, Avoirs, PDF

---

## ✨ Fonctionnalités

### 📦 Gestion des Produits
- Création, modification, archivage, suppression
- Images produit avec aperçu
- Codes-barres et étiquettes imprimables
- Import CSV/Excel
- Catégories et sous-catégories
- Recherche ultra-rapide

### 📊 Gestion du Stock
- Entrées / Sorties / Inventaire
- Historique complet des mouvements
- Alertes stock minimum
- Valorisation du stock

### 👥 Clients & Fournisseurs
- Fiches clients avec crédits (نسيئة)
- Plafonds de crédit et soldes en temps réel
- Historique des transactions
- Relevés de compte exportables en PDF

### 🧾 Facturation
- Devis → Bon de Livraison → Facture
- Avoirs (crédit notes)
- Paiements (Espèces, Chèque, Virement)
- Export PDF professionnel

### 📊 Tableau de Bord
- CA jour / semaine / mois
- Marges et top produits
- Alertes stock et échéances
- Rapports Excel / PDF

---

## 🛠️ Technologies

| Composant | Technologie | Version |
|-----------|-------------|---------|
| Frontend | React + TypeScript | 18.3 |
| Desktop | Electron | 31.x |
| Base de données | SQLite + better-sqlite3 | 3.x |
| Chiffrement | SQLCipher | - |
| Validation | Zod | 3.x |
| État global | Zustand | 4.x |
| PDF | pdf-lib | 1.x |
| Build | Vite | 5.x |
| Packaging | electron-builder | 24.x |

---

## 🚀 Installation

### Prérequis
- [Node.js](https://nodejs.org/) >= 18
- npm ou yarn

### Étapes

```bash
# 1. Cloner le dépôt
git clone https://github.com/mohamedhassanain/stockLocal-gestion-desktop.git
cd stockLocal-gestion-desktop

# 2. Installer les dépendances
npm install

# 3. Lancer en mode développement
npm run dev

# 4. Build pour production
npm run build
```

---

## 📖 Utilisation

### Premier lancement
1. L'assistant de configuration vous demandera les informations de votre entreprise
2. Un jeu de données de démonstration sera automatiquement chargé
3. Connectez-vous avec les identifiants par défaut

### Navigation
Utilisez le **menu latéral** ou les **raccourcis clavier** pour naviguer entre les modules.

---

## 📁 Structure du projet

```
stockLocal-gestion-desktop/
├── electron/                 # Processus principal Electron
│   ├── main.ts              # Point d'entrée principal
│   └── preload.ts           # API sécurisée IPC
├── src/
│   ├── components/          # Composants React
│   │   ├── layout/          # Sidebar, Header
│   │   └── products/        # Formulaire produits
│   ├── database/            # Configuration SQLite
│   ├── pages/               # Pages principales
│   │   ├── DashboardPage.tsx
│   │   ├── ProductsPage.tsx
│   │   ├── StockPage.tsx
│   │   ├── ClientsPage.tsx
│   │   ├── SuppliersPage.tsx
│   │   ├── InvoicePage.tsx
│   │   └── SettingsPage.tsx
│   ├── repositories/        # Accès aux données (DAO)
│   ├── services/            # Logique métier
│   ├── stores/              # État global (Zustand)
│   └── App.tsx
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## ⌨️ Raccourcis clavier

| Raccourci | Action |
|-----------|--------|
| `F1` | Tableau de bord |
| `F2` | Produits |
| `F3` | Stock |
| `F4` | Clients |
| `F5` | Fournisseurs |
| `F6` | Facturation |
| `F7` | Paramètres |
| `F8` | Nouveau produit |
| `Ctrl+F` | Rechercher |

---

## 🤝 Contribuer

Les contributions sont les bienvenues !

1. Forkez le dépôt
2. Créez une branche (`git checkout -b feature/nouvelle-fonctionnalite`)
3. Commitez vos changements (`git commit -m 'Ajout: nouvelle fonctionnalité'`)
4. Pushnez sur la branche (`git push origin feature/nouvelle-fonctionnalite`)
5. Ouvrez une Pull Request

---

## 📄 Licence

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

---
