<div align="center">

# 📦 StockLocal

### Application Desktop de Gestion Commerciale pour Grossistes & Détaillants

**100% locale · Ultra-rapide · Sans connexion internet requise**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://reactjs.org/)
[![Electron](https://img.shields.io/badge/Electron-43-47848f?logo=electron)](https://www.electronjs.org/)
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
- [Dépannage — `npm run dev` plante avec `spawn UNKNOWN`](#dépannage--npm-run-dev-plante-avec-spawn-unknown)
- [Tests](#tests)
- [Build & packaging](#build--packaging)
- [Sauvegarde & restauration](#sauvegarde--restauration)
- [Assistant IA](#assistant-ia)
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
- **CSP stricte en production** : en-tête HTTP (`electron/main.ts` →
  `onHeadersReceived`) + `<meta>` injecté au build (`vite.config.ts`), désactivée
  en dev pour le préambule React
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

Prérequis : Node.js >= 18 et npm >= 11 (npm 11+ résout correctement l'arbre de
peer dependencies de vitest — un simple `npm install` suffit, sans
`--legacy-peer-deps`).

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

Couverture actuelle : validation des schémas, moteur de stock / inventaire /
transferts / produits, backup / restore, hardening (barcode et référence SQL,
exports batch, confinement des chemins) et volumétrie (10 000 produits,
50 000 mouvements).

```
Test Files  8 passed (8)
     Tests  110 passed (110)
```

---

## Dépannage — `npm run dev` plante avec `spawn UNKNOWN`

**Symptôme.** Après un build réussi de `main.js` / `preload.js`, `npm run dev`
s'interrompt sur :

```text
Error: spawn UNKNOWN
    errno: -4094, code: 'UNKNOWN', syscall: 'spawn'
    at .../vite-plugin-electron/dist/index.js
```

Le **build** est correct : c'est le **lancement du binaire Electron** qui échoue.
Ce n'est **pas un bug de l'application** ni de sa logique métier — c'est un
problème d'**environnement de développement Windows**.

### Cause la plus fréquente : Windows 11 « Smart App Control »

Windows 11 active par défaut **Smart App Control**, qui refuse d'exécuter un
`.exe` **non signé numériquement**. L'`electron.exe` fourni par npm pour le
développement **n'est pas signé** (c'est normal en dev) → Windows bloque la
création du processus (d'où `spawn UNKNOWN`, `errno -4094`).

**Vérifier la cause** (PowerShell, à la racine du projet) :

```powershell
Get-AuthenticodeSignature ".\node_modules\electron\dist\electron.exe" | Format-List Status,StatusMessage
```

Un `Status : NotSigned` **confirme** la cause. Test complémentaire : exécuter
directement `.\node_modules\electron\dist\electron.exe` → le message
« An Application Control policy has blocked this file » apparaît.

**Solutions (environnement de développement uniquement) :**

1. **Désactiver Smart App Control** : *Sécurité Windows* → *Contrôle des
   applications et du navigateur* → *Paramètres Smart App Control* →
   **Désactivé**. (Attention : une fois désactivé, Smart App Control ne peut
   être réactivé que par une réinstallation/réinitialisation de Windows.)
2. **Ajouter une exclusion** pour le dossier du projet (ou `node_modules`) dans
   les paramètres de sécurité Windows / l'antivirus.

> ⚠️ Ces réglages ne concernent **que la machine de développement**. Ils ne
> doivent **jamais** être appliqués à l'application **packagée** livrée aux
> clients : pour l'installateur final, la bonne approche reste la **signature de
> code** avec un vrai certificat (voir « Code signing Windows (SmartScreen) »).

### Cause secondaire possible : chemin du projet contenant un espace

Un chemin contenant un **espace** (ex. `C:\Users\mohamed hassanain\Desktop\...`)
a déjà été associé à des échecs de `spawn` sous Windows selon la version de
Node.js. Si le problème **persiste après** la vérification de Smart App Control,
**déplacer le projet** vers un chemin sans espace ni caractère spécial, par
exemple `C:\Dev\stockLocal`.

### Faut-il mettre à jour `vite-plugin-electron` ?

Vérifié à ce jour : **non**. Version installée : `vite-plugin-electron`
**0.28.8** (dernière publiée : **1.1.2**). Le changelog officiel (v0.29 → v1.1)
apporte des correctifs sur la **résolution du chemin Electron** et le
**hot-reload Windows**, mais **aucun** ne traite un refus d'exécution au niveau
**système d'exploitation**. Le plugin se contente d'appeler
`child_process.spawn(electronPath, …)` : **aucun paramètre du plugin ne peut
contourner un blocage système** de l'exécutable. Une montée 0.28 → 1.x serait
**majeure** (changements d'API) **sans bénéfice** pour ce point précis → **non
effectuée volontairement**. Aucun paramètre de configuration du plugin n'a été
ajouté (aucune option officielle ne réduit ce type d'échec).

### `npm test` est aussi touché (même binaire Electron)

`npm test` lance Vitest **avec le Node embarqué d'Electron**
(`scripts/run-tests-electron.cjs` → `spawnSync(electronPath, …)`), donc le même
blocage s'applique : `npm test` se termine **sans exécuter les tests** (exit 1).
Contournement de développement : lancer Vitest avec le **Node système** —
`npx vitest run` — qui exécute exactement les mêmes tests. `npm test` reste la
référence « ABI Electron » **une fois Smart App Control neutralisé**.

### Le build de production n'est pas affecté

Le blocage ne concerne **que** les commandes qui **lancent le binaire Electron**
(`npm run dev`, `npm test`). `npx vite build` et `npm run build`
(typecheck + bundle + `electron-builder`) fonctionnent normalement.

---

## Build & packaging

`npm run build` produit :

1. Vérification TypeScript (`tsc`)
2. Bundle renderer (Vite) + main/preload (`dist/`, `dist-electron/`)
3. Installeur via `electron-builder` (dossier `release/`)

La CSP de production est appliquée via `session.defaultSession.webRequest.onHeadersReceived`
dans `electron/main.ts` et injectée en `<meta>` dans `dist/index.html` au build
(protocole `file://` des builds packagés).

**Stack runtime cible** : Electron **43.4.1**, electron-updater **6.8.9**,
better-sqlite3 **13.0.3** (recompilé via `electron-builder install-app-deps`).

---

## Mises à jour automatiques (infrastructure à configurer)

La **mécanique** d'auto-update est en place (`electron-updater`) :

- Vérification automatique **silencieuse** au démarrage (10 s après lancement,
  aucune interruption).
- Si une mise à jour est disponible : téléchargement en arrière-plan,
  **notification discrète** (toast) et installation à la fermeture.
- Bouton **« Vérifier les mises à jour »** dans `Paramètres → Mises à jour`
  (vérification manuelle).
- Provider de publication : `generic` → `https://mises-a-jour.stocklocal.ma/win`
  (configurable dans `package.json` → `build.publish`).

### Ce que vous devez faire (une seule fois)

1. **Héberger les fichiers de release** sur un serveur HTTPS statique (ou un
   bucket S3, ou GitHub Releases via provider `github`). Pour le provider
   `generic`, déposez simplement les fichiers générés dans `release/` :
   - l'installeur `StockLocal-<version>-setup.exe`
   - `latest.yml` (meta généré automatiquement par electron-builder)
2. **Bump de version** : chaque nouvelle release doit avoir un `version` plus
   élevé dans `package.json` AVANT `npm run build`.
3. Vérifier le canal : `autoUpdater.checkForUpdates()` ne propose que les
   versions strictement supérieures à la version installée.

### Code signing Windows (SmartScreen) — important

Sans signature, Windows affiche **« Windows a protégé votre ordinateur »** lors
de l'installation (SmartScreen / Mark-of-the-Web), ce qui fait fuir une grande
partie des utilisateurs non techniques.

La structure est prête dans `electron-builder` : les variables d'environnement
standard `CSC_LINK` (chemin ou URL du certificat `.pfx`) et `CSC_KEY_PASSWORD`
(mot de passe) sont automatiquement détectées au build. Aucune config
supplémentaire n'est nécessaire — il suffit de les fournir lors du build :

```bash
CSC_LINK=/chemin/vers/certificat.pfx CSC_KEY_PASSWORD=**** npm run build
```

À prévoir : un certificat de signature de code (par ex. un certificat OV/EV
auprès d'un émetteur reconnu, valable pour Windows).

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

## Assistant IA

StockLocal intègre désormais un assistant conversationnel **provider-agnostique**
(Anthropic/Claude, OpenAI/Codex, ou tout endpoint compatible) accessible depuis la
sidebar → **Assistant IA**. Deux modes coexistent :

### Mode A — Chat intégré (dans l'app StockLocal)

Depuis l'écran **Assistant IA → Chat**, vous configurez le fournisseur, l'URL de
base de l'API, la clé API (masquée, jamais journalisée), le modèle, l'**expiration
de session** (date précise ou sans expiration) et la **limite d'appels/minute**.
L'app appelle directement l'API du LLM choisi et peut lire/créer/modifier/supprimer
des données via les outils `McpTools`. Toute action d'écriture/destruction demande
une **confirmation explicite** dans l'UI avant exécution.

### Mode B — Serveur MCP externe (Claude Desktop, Cursor, etc.)

StockLocal expose ses données/actions comme un **serveur MCP** (`src/ai/mcpServer.ts`,
transport stdio) utilisable depuis Claude Desktop, Cursor ou tout autre client MCP
externe, **sans passer par l'écran de chat de l'app**. La page **Assistant IA →
Configuration** propose un bouton **« Copier la configuration MCP »** qui génère le
bloc `claude_desktop_config.json` (ou `mcp.json` pour Cursor) avec le chemin absolu
vers `dist-electron/mcp-server.js`, ainsi que les instructions par OS/client.

```json
{
  "mcpServers": {
    "stocklocal": {
      "command": "node",
      "args": ["C:/chemin/vers/dist-electron/mcp-server.js"],
      "env": { "STOCKLOCAL_USER_DATA_DIR": "C:/Users/.../AppData/Roaming/StockLocal" }
    }
  }
}
```

### Garde-fous communs aux deux modes

Les garde-fous sont appliqués **dans `executeMcpTool`** (`src/ai/McpTools.ts`),
quel que soit l'appelant (chat intégré ou serveur MCP externe) :

- **Confirmation explicite** : tout outil `WRITE`/`DESTRUCTIVE` exige `confirmed: true`.
  Sans quoi il renvoie `needsConfirmation: true` (le client externe ré-invoque avec
  `confirmed: true` ; dans l'app, l'utilisateur confirme dans l'UI).
- **Audit** : toute exécution confirmée est journalisée dans `AuditService` avec la
  mention « assistant IA » et la provenance (`connexion externe (client MCP)` pour le
  mode B).
- **Rate-limit** : chaque appel d'outil est compté (limite lue depuis
  `global_settings.ai_rate_limit_per_min`), partagé entre les deux modes.

---

## Known limitations

- **Single-user** : pas d'authentification, de rôles ni de permissions (prévu)
- **Rapports** : valuation et marge du dashboard utilisent encore le coût
  moyen pondéré calculé par le service ; les exports PDF/CSV reposent sur les
  données agrégées existantes
- **Multi-dépôts / lots** : les tables `warehouses` et `product_batches` sont
  préparées dans le schéma, sans UI ni service actif pour l'instant
- **Chiffrement de la base — NON IMPLÉMENTÉ** : SQLCipher a été évalué puis
  écarté pour ne pas casser la compatibilité ABI du module natif
  `better-sqlite3` avec Electron et le pipeline `install-app-deps`. La base
  `.db` est donc en clair sur le disque. Protection recommandée : chiffrement
  au niveau du système d'exploitation (BitLocker / FileVault) sur la machine
  du commerçant. À traiter dans une phase dédiée (validation ABI + build NSIS
  complet) avant de prétendre au « production ready » complet.
- Pas de script `lint` à ce stade

---

## Licence

Projet sous licence MIT.
