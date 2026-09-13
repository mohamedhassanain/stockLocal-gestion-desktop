/**
 * ─── DgiConnector — unique point d'entrée vers l'API DGI (Maroc) ─────────────
 *
 * ⚠️  À BRANCHER QUAND LES SPÉCIFICATIONS OFFICIELLES SERONT PUBLIÉES.
 *
 * AUCUNE URL, AUCUN FORMAT DE PAYLOAD RÉEL, AUCUN IDENTIFIANT D'API N'EST
 * INVENTÉ ICI. Le connecteur n'est qu'un CONTRAT : le jour où la DGI publiera
 * la documentation officielle, on écrira une nouvelle implémentation de
 * l'interface `DgiConnector` (endpoint, authentification, accusés de réception)
 * et on la renverra depuis `createDgiConnector()`. Le reste de l'application
 * n'aura pas à changer : il ne connaît que cette interface.
 *
 * Toute la logique DGI est ISOLÉE dans `src/compliance/dgi/`. Aucun autre
 * module (DocumentService, PDFService…) n'appelle directement une logique DGI.
 *
 * Ce fichier est PUR (aucune dépendance `db`/`electron`).
 */

import { DGI_INTEGRATION_AVAILABLE } from './dgiStatus';
import type { UblParty } from './ublTypes';

// ─── Contrat de données échangées ───────────────────────────────────────────

/**
 * Charge utile de soumission d'une facture. La structure interne est prête ;
 * SEUL le moyen de transport (endpoint / protocole) reste à définir avec la DGI.
 */
export interface DgiInvoicePayload {
  /** Identifiant interne du document (traçabilité locale). */
  documentId: string;
  /** Numéro de facture affiché (ex. FAC-2026-00001). */
  documentNumber: string;
  /** Date du document (YYYY-MM-DD). */
  documentDate: string;
  /** Représentation UBL 2.1 du document (générée par documentToUbl). */
  ublXml: string;
  /**
   * Clé d'idempotence (à confirmer avec la DGI) : évite une double soumission
   * si la réponse réseau est perdue. Valeur proposée = identifiant du document.
   */
  idempotencyKey?: string;
  /** Parties concernées (utiles si l'API attend des métadonnées séparées). */
  supplier?: UblParty | null;
  customer?: UblParty | null;
}

/** Statut renvoyé par la plateforme DGI après soumission. */
export interface DgiSubmissionResult {
  status: 'SUBMITTED' | 'CLEARED' | 'REJECTED' | 'PENDING';
  /** Référence retournée par la plateforme (à stocker dans dgi_reference). */
  reference?: string;
  message?: string;
  /** Horodatage de réception (ISO 8601). */
  receivedAt?: string;
}

/** Configuration du connecteur (renseignée UNIQUEMENT à l'intégration réelle). */
export interface DgiConnectorConfig {
  /** URL de base de l'API DGI — VIDE tant que non publiée. */
  endpointUrl: string;
  /** Jetons / identifiants éventuels. */
  credentials?: Record<string, string>;
  /** Délai d'attente réseau en millisecondes. */
  timeoutMs?: number;
}

/**
 * Interface que TOUTE implémentation réelle devra respecter.
 * L'application ne dépend que de cette interface (inversion de dépendance).
 */
export interface DgiConnector {
  /** Identifiant technique du connecteur (ex. « dgi-stub »). */
  readonly id: string;
  /** `true` si un endpoint réel est configuré et utilisable. */
  isConfigured(): boolean;
  /** Soumet une facture à la plateforme DGI. */
  submitInvoice(payload: DgiInvoicePayload): Promise<DgiSubmissionResult>;
}

// ─── Erreurs explicites (jamais de faux succès) ─────────────────────────────

/** Erreur de base du module de conformité DGI. */
export class DgiComplianceError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'DgiComplianceError';
    this.code = code;
  }
}

/** Message honnête affiché lorsque l'intégration n'est pas encore branchée. */
export const DGI_NOT_CONFIGURED_MESSAGE =
  'Intégration DGI non encore disponible — en attente des spécifications officielles';

/**
 * Levée lorsqu'on tente de soumettre une facture alors que le module est activé
 * mais qu'aucun endpoint réel n'est configuré. Aucune donnée n'est inventée.
 */
export class DgiNotConfiguredError extends DgiComplianceError {
  constructor(message: string = DGI_NOT_CONFIGURED_MESSAGE) {
    super(message, 'DGI_NOT_CONFIGURED');
    this.name = 'DgiNotConfiguredError';
  }
}

/** Levée si l'intégration est explicitement marquée comme indisponible. */
export class DgiIntegrationUnavailableError extends DgiComplianceError {
  constructor(message: string = DGI_NOT_CONFIGURED_MESSAGE) {
    super(message, 'DGI_INTEGRATION_UNAVAILABLE');
    this.name = 'DgiIntegrationUnavailableError';
  }
}

// ─── Implémentation STUB (par défaut) ───────────────────────────────────────

/**
 * ⚠️  À BRANCHER QUAND LES SPÉCIFICATIONS OFFICIELLES SERONT PUBLIÉES.
 *
 * Le stub ne contacte AUCUN serveur : il ne fait qu'échouer explicitement.
 * Ne JAMAIS remplacer ce comportement par un succès simulé (CLEARED) : le
 * module doit rester honnête tant que l'API réelle n'existe pas.
 */
export class StubDgiConnector implements DgiConnector {
  readonly id = 'dgi-stub';

  /** Aucun endpoint réel n'existe : toujours `false` pour le stub. */
  isConfigured(): boolean {
    return false;
  }

  submitInvoice(_payload: DgiInvoicePayload): Promise<DgiSubmissionResult> {
    // Rien n'est envoyé : on échoue avec un message clair, jamais un faux succès.
    return Promise.reject(new DgiNotConfiguredError());
  }
}

/**
 * ⚠️  POINT DE BRANCHEMENT UNIQUE.
 *
 * Pour l'intégration réelle : créer une classe implémentant `DgiConnector`
 * (ex. `HttpDgiConnector`) construite à partir de `DgiConnectorConfig`, puis la
 * renvoyer ici lorsque `config.endpointUrl` est renseigné. Aucun autre fichier
 * de l'application ne doit être modifié pour brancher l'API.
 */
export function createDgiConnector(_config?: DgiConnectorConfig): DgiConnector {
  return new StubDgiConnector();
}

/**
 * Indique si une intégration réelle est disponible (aujourd'hui : jamais).
 * Sert à afficher un statut honnête côté interface.
 */
export function isDgiIntegrationAvailable(): boolean {
  return DGI_INTEGRATION_AVAILABLE;
}
