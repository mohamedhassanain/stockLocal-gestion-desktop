# Conformité fiscale DGI (Maroc) — Statut d'avancement

> **Rappel essentiel** : ce module **prépare l'architecture**. Il **ne rend PAS
> l'application conforme DGI**. La conformité réelle nécessitera l'intégration
> finale (API, authentification, accusés de réception, mapping des champs
> marocains), **une fois les spécifications officielles publiées**.
>
> Date de ce travail : **13 septembre 2026** — le décret d'application de la
> facturation électronique marocaine n'était pas encore publié à cette date.

---

## 1. Ce qui est prêt

| Élément | Emplacement | Statut |
| --- | --- | --- |
| Module isolé (statuts, erreurs, connecteur) | `src/compliance/dgi/` | Prêt |
| Connecteur DGI (contrat) + stub honnête | `src/compliance/dgi/DgiConnector.ts` | Prêt (stub) |
| Réglage d'activation, désactivé par défaut | `global_settings.dgi_compliance_enabled` | Prêt |
| Écran Paramètres « Conformité DGI » | `src/pages/SettingsPage.tsx` (onglet « Conformité DGI ») | Prêt |
| Colonnes de statut sur les documents | `documents.dgi_status`, `documents.dgi_reference`, `documents.dgi_submitted_at` | Prêt (migration additive) |
| Générateur UBL 2.1 de base | `src/compliance/dgi/UblInvoiceGenerator.ts` | Prêt (structure) |
| Badge discret dans l'interface de facturation | `src/pages/InvoicePage.tsx` | Prêt (visible si activé) |
| Aperçu UBL en lecture seule (IPC) | `electron/ipc/dgi.ipc.ts` (`dgi:previewUbl`) | Prêt |
| Tests de non-régression du module | `tests/dgi-ubl.test.ts` | Prêt |

### 1.1 Isolation

Toute la logique DGI vit dans `src/compliance/dgi/`. **Aucun autre module**
(`DocumentService`, `PDFService`, `DocumentRepository`…) n'appelle une logique
DGI : l'inversion de dépendance est totale (c'est le module de conformité qui
dépend du métier, jamais l'inverse).

- Le module est **désactivé par défaut** (`dgi_compliance_enabled = false`).
- Tant qu'il est désactivé, **aucune fonctionnalité existante n'est affectée** :
  facturation, stock, PDF, caisse, rapports fonctionnent exactement comme avant.
- `documents.dgi_status` reste `NOT_APPLICABLE` (valeur normalisée au démarrage
  lorsque le module est désactivé).

### 1.2 Comportement des statuts

| Situation | `dgi_status` affiché |
| --- | --- |
| Module **désactivé** (défaut) | `NOT_APPLICABLE` |
| Module **activé**, intégration **non branchée** | `PENDING` (jamais de faux succès) |
| Module activé, intégration branchée (à venir) | valeur réellement retournée par la DGI |

Valeurs prévues : `PENDING`, `SUBMITTED`, `CLEARED`, `REJECTED`,
`NOT_APPLICABLE`.

### 1.3 Générateur UBL 2.1

`documentToUbl(document, contexte?)` convertit une facture (ou un avoir) en XML
UBL 2.1 « basique » : en-tête, parties (fournisseur/acheteur), lignes, montants,
TVA. UBL 2.1 est un standard international public (OASIS) ; les montants sont
calculés par le moteur monétaire central de l'application, donc identiques à la
facture imprimée. Un test valide la **bonne formation** du XML avec un vrai
parseur SAX.

---

## 2. Ce qui manque explicitement (et pourquoi)

Ces éléments **ne peuvent pas** être écrits sans invention tant que les
spécifications officielles ne sont pas publiées. Ils ne sont donc **pas**
implémentés, et les points de branchement sont marqués dans le code par
`⚠️ À BRANCHER QUAND LES SPÉCIFICATIONS OFFICIELLES SERONT PUBLIÉES`.

1. **Vrai endpoint API DGI** — l'URL, le protocole et le format de transport
   exacts ne sont pas connus. Aucune URL n'est inventée : `createDgiConnector()`
   renvoie le stub (`DgiConnector.ts`).
2. **Authentification** — mécanisme d'authentification (jeton, certificat,
   signature électronique) non spécifié.
3. **Gestion des accusés de réception** — async/sync, format des réponses,
   références retournées (`dgi_reference`), réessais, idempotence.
4. **Mapping des champs marocains spécifiques** — emplacement définitif de
   l'ICE, de l'Identifiant Fiscal, des codes DGI de type de document et de TVA,
   des codes d'unité UN/ECE, ainsi que `CustomizationID` / `ProfileID`
   (aujourd'hui des valeurs d'attente explicites : `A_DEFINIR_SELON_SPECIFICATIONS_DGI`).
5. **Transmission effective depuis l'interface** — volontairement absente : une
   soumission ne doit jamais être simulée. `DgiComplianceService.submitDocument`
   échoue honnêtement (`DgiNotConfiguredError`) tant que l'intégration n'existe pas.
6. **Calendrier / obligations légales** — dépend de la publication du décret
   (calendrier PME encore incertain selon les sources).

**Pourquoi** : inventer un endpoint, un payload ou un identifiant d'API
produirait du code faussement « conforme », impossible à valider et dangereux
(fausse impression de conformité). On préfère un contrat clair, testé, et un
point de branchement unique.

---

## 3. Où brancher l'intégration réelle (plus tard)

Tout le branchement tient dans **un seul endroit** :

1. Créer une classe implémentant l'interface `DgiConnector`
   (`submitInvoice`, `isConfigured`) dans `src/compliance/dgi/` — ex.
   `HttpDgiConnector` construite à partir de `DgiConnectorConfig`.
2. La renvoyer depuis `createDgiConnector()` lorsque `config.endpointUrl` est
   renseigné (`DgiConnector.ts`).
3. Passer `DGI_INTEGRATION_AVAILABLE` à `true` (`dgiStatus.ts`) **en même temps**
   que le branchement, jamais avant.
4. Ajuster `UblInvoiceGenerator.ts` / `UblPartySerializer.ts` selon le mapping
   officiel des champs marocains.
5. Câbler la soumission réelle (bouton / automatisation) via
   `DgiComplianceService.submitDocument`, en écrivant `dgi_status`,
   `dgi_reference`, `dgi_submitted_at` d'après la réponse DGI.

Aucune autre partie de l'application ne devrait avoir à changer.

---

## 4. Vérifications à faire régulièrement (avant d'aller plus loin)

- **Bulletin officiel** : publication du **décret d'application** de la
  facturation électronique.
- **fatourati.gov.ma** : disponibilité du portail officiel et de la
  documentation destinée aux entreprises.
- **Documentation API DGI** : spécifications techniques officielles (endpoints,
  authentification, format de facture — UBL 2.1 ou CII —, mapping des champs,
  gestion des accusés de réception).
- **Calendrier** : dates d'entrée en vigueur par catégorie d'entreprise (PME,
  grandes entreprises), encore incertaines.

**Tant que ces éléments ne sont pas confirmés officiellement, ne pas activer le
module en production et ne pas considérer l'application comme conforme DGI.**

---

## 5. Tests

`tests/dgi-ubl.test.ts` vérifie, sur une facture réelle créée en base :

- le XML UBL 2.1 est **bien formé** (validé par un parseur SAX `saxes`) ;
- les champs essentiels sont présents (UBLVersionID, ID, parties, lignes,
  `TaxTotal`, `LegalMonetaryTotal`, `PayableAmount`) ;
- les caractères spéciaux sont **échappés** (XML 1.0) ;
- le connecteur **échoue explicitement** (aucun faux succès) ;
- le statut par défaut est `NOT_APPLICABLE` (désactivé) ou `PENDING` (activé).
