/**
 * ─── Types UBL 2.1 (préparation) ─────────────────────────────────────────────
 *
 * UBL (Universal Business Language) 2.1 est un STANDARD INTERNATIONAL PUBLIC
 * (OASIS). Les sources indiquent que le format attendu par la DGI marocaine
 * sera UBL 2.1 ou CII : on prépare donc la conversion vers UBL 2.1 pour que la
 * donnée soit déjà structurée le jour où l'API réelle sera branchée.
 *
 * ⚠️  Les codes et champs SPÉCIFIQUES au Maroc (ICE, identifiant fiscal, codes
 * DGI de type de document/TVA) devront être ajustés selon les spécifications
 * officielles une fois publiées. Voir docs/DGI_COMPLIANCE_STATUS.md.
 *
 * Ce fichier est PUR (aucune dépendance `db`/`electron`) : il peut être importé
 * côté renderer comme côté main sans embarquer better-sqlite3.
 */

// ─── Espaces de noms et constantes UBL 2.1 ──────────────────────────────────
export const UBL_NAMESPACE_INVOICE = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
export const UBL_NAMESPACE_CREDIT_NOTE = 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2';
export const UBL_NAMESPACE_CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
export const UBL_NAMESPACE_CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';

/** Version du schéma UBL. */
export const UBL_VERSION_ID = '2.1';

/** Devise par défaut (dirham marocain, code ISO 4217). */
export const DEFAULT_CURRENCY = 'MAD';

/**
 * Code d'unité de mesure UN/ECE Recommendation 20 : « one / unit » (C62).
 * Un mapping fin unité-produit → code UN/ECE devra être affiné selon les
 * spécifications DGI (à brancher plus tard).
 */
export const UBL_DEFAULT_UNIT_CODE = 'C62';

/** Code de type de document UBL (UN/CEFACT 1001) : 380 = facture commerciale. */
export const UBL_INVOICE_TYPE_CODE = '380';
/** Code de type de document UBL : 381 = note de crédit (avoir). */
export const UBL_CREDIT_NOTE_TYPE_CODE = '381';

/** Catégorie de TVA UBL (S = standard, Z = taux zéro). */
export const UBL_TAX_CATEGORY_STANDARD = 'S';
export const UBL_TAX_SCHEME_ID_VAT = 'VAT';

// ─── Structures source (ce que fournit l'application) ───────────────────────

/** Partie (fournisseur ou acheteur) dans le vocabulaire UBL. */
export interface UblParty {
  name: string;
  /** ICE — Identifiant Commun de l'Entreprise (Maroc). */
  ice?: string | null;
  /** Identifiant Fiscal (IF, Maroc). */
  taxId?: string | null;
  /** Registre de Commerce (RC, Maroc). */
  rc?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

/**
 * Ligne de facture source (document_items + infos produit jointes).
 * Les noms de champs correspondent EXACTEMENT à `DocumentItem` du repository
 * (`product_ref` = référence produit, `product_name` = désignation), afin
 * qu'un document issu de la base soit directement convertible.
 */
export interface UblSourceLine {
  product_id?: string;
  product_ref?: string | null;
  product_name?: string | null;
  quantity: number;
  unit_price: number;
  discount: number;
  vat_rate: number;
}

/**
 * Document source minimal attendu par le générateur.
 * Structurellement, un `Document` de DocumentRepository satisfait ce type.
 */
export interface UblSourceDocument {
  id: string;
  /** INVOICE | CREDIT_NOTE | DELIVERY_NOTE | QUOTE */
  type: string;
  document_number: string;
  date: string;
  due_date?: string | null;
  notes?: string | null;
  customer_name?: string | null;
  total_excl_tax: number;
  total_tax: number;
  total_incl_tax: number;
  discount_amount?: number | null;
  items?: UblSourceLine[] | null;
}

/** Contexte optionnel : parties et paramètres d'enveloppe UBL. */
export interface UblGenerationContext {
  supplier?: UblParty | null;
  customer?: UblParty | null;
  currency?: string;
  /** CustomizationID : profil de conformité (à définir avec la DGI). */
  customizationId?: string;
  /** ProfileID : profil de processus (à définir avec la DGI). */
  profileId?: string;
  /** Force le code de type de document (sinon déduit du document). */
  invoiceTypeCode?: string;
}

/** Résultat d'une conversion document → UBL. */
export interface UblConversionResult {
  xml: string;
  documentNumber: string;
  documentType: string;
  lineCount: number;
  currency: string;
}
