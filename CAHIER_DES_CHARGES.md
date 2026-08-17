# CAHIER DES CHARGES FINAL — StockLocal

## Vision du produit

Créer une application de gestion de stock 100 % locale, rapide, simple et stable, destinée principalement aux grossistes marocains.

**Objectifs principaux :**
- Fonctionner sans Internet
- Gérer un volume important de produits
- Simplifier la gestion quotidienne
- Réduire les erreurs humaines
- Offrir une interface rapide et facile à utiliser
- Générer un produit commercialisable au Maroc

## 1. Informations générales
| Élément | Détail |
|---------|--------|
| Nom du projet | StockLocal |
| Type | Application desktop |
| Cible principale | Grossistes |
| Cible secondaire | Détaillants |
| Plateforme | Windows 10 et Windows 11 |
| Langue (V1) | Français |
| Langue (V2) | Arabe et Darija |
| Mode | 100 % hors ligne |
| Internet | Activation initiale de la licence uniquement |

## 2. Architecture technique
- **Interface** : React
- **Application desktop** : Electron
- **Langage** : TypeScript
- **Base de données** : SQLite
- **Accès aux données** : better-sqlite3
- **Chiffrement** : SQLCipher
- **État global** : Zustand
- **Validation** : Zod
- **Génération PDF** : pdf-lib
- **Codes-barres** : ZXing
- **Sauvegarde** : Automatique locale

## 3. Module Produits
- **Gestion** : Création, Modification, Archivage, Activation/Désactivation.
- **Informations** : Réf, Désignation, Description, Catégorie, Sous-catégorie, Code-barres, Image.
- **Unités** : Pièce, Kg, Litre, Carton, Palette.
- **Recherche** : Nom, Réf, Catégorie, Code-barres.
- **Importation** : Excel/CSV, Détection automatique, Rapport d'erreurs.
- **Impression** : Étiquettes, Codes-barres.

## 4. Module Stock
- **Entrées** : Réception fournisseur, Qté, Prix, Date, Réf BL.
- **Sorties** : Vente, Casse, Perte, Retour.
- **Inventaire** : Comptage, Écarts, Ajustement.
- **Historique** : Liste détaillée (Date, Utilisateur, Qté, Type).
- **Alertes** : Stock minimum, Rupture.
- **Valorisation** : Calcul de la valeur du stock.

## 5. Module Clients et Fournisseurs
- **Fiche client** : Nom, Tél, Adresse, ICE, Conditions de paiement.
- **Crédit client (نسيئة)** : Vente à crédit, Plafond, Solde en temps réel.
- **Échéances** : Paiements à venir / en retard.
- **Historique** : Factures, Paiements, Avoirs, Relevé de compte (Export PDF).
- **Catégories** : Détail, Grossiste, VIP.

## 6. Module Tarification
- **Prix** : Achat, Vente, Grossiste.
- **Remises** : Par quantité (1-9, 10-49, 50+), sur facture, globale, par ligne.
- **Marges** : Unitaire, globale.

## 7. Module Facturation
- **Devis & BL** : Création, Impression, Export PDF, Conversion (BL -> Facture).
- **Facture** : Numérotation automatique, ICE, RC, IF, Export PDF.
- **Avoir** : Retour, Annulation partielle.
- **Paiements** : Espèces, Chèque, Virement.
- **Statuts** : Payée, Impayée, Partiellement payée.

## 8. Tableau de bord
- **Statistiques** : CA (Jour, Semaine, Mois), Ventes, Marge.
- **Alertes** : Ruptures, Seuils.
- **Classements** : Top Produits, Top Clients.
- **Échéances** : 7 jours / 30 jours.
- **Rapports** : Excel / PDF.

## 9. Sécurité & 10. Sauvegarde
- **Authentification** : Utilisateur/Mot de passe.
- **Chiffrement** : Base chiffrée.
- **Journalisation** : Prix, suppressions, annulations, inventaires.
- **Sauvegarde** : Quotidienne automatique, manuelle USB.

## 11. Assistant de configuration
- **Entreprise** : Nom, Logo, ICE, RC, IF.
- **Licence** : Essai 30 jours, clé liée à la machine.
- **Démo** : Jeu de données injecté.

## 12. Exigences non fonctionnelles
- **Performances** : 50k+ produits, 1M+ mouvements, Recherche < 100ms.
- **Temps de page** : < 500ms.
- **Facture PDF** : < 2 secondes.
- **Fiabilité** : 0% perte de données.
