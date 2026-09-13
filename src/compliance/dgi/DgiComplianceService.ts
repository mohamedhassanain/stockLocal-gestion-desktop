/**
 * ─── DgiComplianceService — orchestration ISOLÉE (process principal) ─────────
 *
 * ⚠️  À BRANCHER QUAND LES SPÉCIFICATIONS OFFICIELLES SERONT PUBLIÉES.
 *
 * Ce service est le SEUL point où le reste de l'application pourrait un jour
 * confier une facture au module DGI. Tant que le module est désactivé
 * (`dgi_compliance_enabled = false`, valeur par défaut), il ne fait RIEN et
 * n'affecte AUCUNE fonctionnalité existante (facturation, stock, PDF…).
 *
 * Il n'est JAMAIS appelé par DocumentService / PDFService : l'inversion de
 * dépendance est totale (le métier ignore le module DGI). C'est ce service qui
 * dépend du métier, jamais l'inverse.
 *
 * Ce fichier utilise `db` (better-sqlite3) : il ne doit donc JAMAIS être importé
 * par le renderer. Les éléments PURS exposés à l'UI vivent dans dgiStatus.ts.
 */

import { db } from '../../database/config/connection';
import { CompanySettingsService } from '../../services/CompanySettingsService';
import { GlobalSettingsService } from '../../services/GlobalSettingsService';
import { DocumentRepository } from '../../repositories/DocumentRepository';
import {
  DGI_INTEGRATION_AVAILABLE,
  DGI_STATUS_LABEL,
  type DgiStatus,
} from './dgiStatus';
import {
  createDgiConnector,
  DgiComplianceError,
  DgiNotConfiguredError,
  type DgiInvoicePayload,
  type DgiSubmissionResult,
} from './DgiConnector';
import { documentToUbl } from './UblInvoiceGenerator';
import type { UblGenerationContext, UblParty } from './ublTypes';

/** État du module de conformité (pour l'affichage et le diagnostic). */
export interface DgiModuleState {
  /** Réglage `dgi_compliance_enabled` (défaut : false). */
  enabled: boolean;
  /** Un connecteur réel est-il branché ? (aujourd'hui : false). */
  configured: boolean;
  /** L'intégration réelle est-elle disponible ? (aujourd'hui : false). */
  integrationAvailable: boolean;
  /** Statut effectif attendu pour un document (PENDING si activé, sinon NOT_APPLICABLE). */
  effectiveStatus: DgiStatus;
  /** Connecteur technique actuellement utilisé (ex. « dgi-stub »). */
  connectorId: string;
}

/** Construit la partie « fournisseur » depuis les paramètres de l'entreprise. */
function buildSupplierParty(): UblParty {
  const company = CompanySettingsService.getAll();
  return {
    name: company.name || 'Entreprise',
    ice: company.ice || null,
    taxId: company.if_ || null,
    rc: company.rc || null,
    address: company.address || null,
    phone: company.phone || null,
    email: company.email || null,
  };
}

/** Construit la partie « acheteur » depuis le client du document (lecture seule). */
function buildCustomerParty(customerId: string, fallbackName?: string | null): UblParty {
  if (customerId) {
    const row = db
      .prepare('SELECT name, ice, address, phone FROM customers WHERE id = ?')
      .get(customerId) as { name?: string; ice?: string | null; address?: string | null; phone?: string | null } | undefined;
    if (row) {
      return {
        name: row.name ?? (fallbackName || 'Client comptoir'),
        ice: row.ice ?? null,
        address: row.address ?? null,
        phone: row.phone ?? null,
      };
    }
  }
  return { name: fallbackName || 'Client comptoir' };
}

export const DgiComplianceService = {
  /** Le module de conformité DGI est-il activé ? (défaut : non). */
  isEnabled(): boolean {
    return GlobalSettingsService.getAll().dgi_compliance_enabled === true;
  },

  /** État complet du module (utilisé par l'UI et la journalisation). */
  getModuleState(): DgiModuleState {
    const enabled = this.isEnabled();
    const connector = createDgiConnector();
    const configured = connector.isConfigured();
    return {
      enabled,
      configured,
      integrationAvailable: DGI_INTEGRATION_AVAILABLE,
      // Honnête : jamais de faux succès. Activé sans intégration → PENDING.
      effectiveStatus: !enabled ? 'NOT_APPLICABLE' : 'PENDING',
      connectorId: connector.id,
    };
  },

  /** Libellé lisible d'un statut (réexport pratique pour le main process). */
  describeStatus(status: DgiStatus): string {
    return DGI_STATUS_LABEL[status];
  },

  /**
   * Construit le contexte UBL (parties + devise) pour un document donné.
   * Lecture seule : n'écrit jamais en base.
   */
  buildUblContext(documentId: string): UblGenerationContext {
    const document = DocumentRepository.getById(documentId);
    return {
      supplier: buildSupplierParty(),
      customer: buildCustomerParty(document?.entity_id ?? '', document?.customer_name ?? null),
    };
  },

  /**
   * Génère la représentation UBL 2.1 d'un document existant (lecture seule).
   * Ne contacte AUCUN serveur. Utile pour préparer/contrôler la donnée.
   */
  buildUblForDocument(documentId: string): string {
    const document = DocumentRepository.getById(documentId);
    if (!document) throw new DgiComplianceError('Document introuvable.', 'DGI_DOCUMENT_NOT_FOUND');
    return documentToUbl(document, this.buildUblContext(documentId));
  },

  /**
   * Soumet une facture à la DGI.
   *
   * ⚠️  Tant que le module est désactivé OU l'intégration non branchée, cette
   * méthode ÉCHOUE explicitement — elle ne simule JAMAIS un succès.
   */
  async submitDocument(documentId: string): Promise<DgiSubmissionResult> {
    if (!this.isEnabled()) {
      throw new DgiComplianceError(
        'Module de conformité DGI désactivé : aucune soumission effectuée.',
        'DGI_DISABLED',
      );
    }

    const document = DocumentRepository.getById(documentId);
    if (!document) throw new DgiComplianceError('Document introuvable.', 'DGI_DOCUMENT_NOT_FOUND');

    const connector = createDgiConnector();
    if (!connector.isConfigured()) {
      throw new DgiNotConfiguredError();
    }

    const payload: DgiInvoicePayload = {
      documentId: document.id,
      documentNumber: document.document_number,
      documentDate: document.date,
      ublXml: this.buildUblForDocument(documentId),
      idempotencyKey: document.id,
    };

    return connector.submitInvoice(payload);
  },
};
