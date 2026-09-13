/**
 * ─── Générateur UBL 2.1 — document → XML ─────────────────────────────────────
 *
 * Convertit un document existant (facture / avoir + ses lignes déjà en base) en
 * une structure XML UBL 2.1 « basique » : en-tête, parties, lignes, montants,
 * TVA. La donnée est ainsi prête à transmettre le jour où l'API réelle sera
 * branchée.
 *
 * ⚠️  À BRANCHER QUAND LES SPÉCIFICATIONS OFFICIELLES SERONT PUBLIÉES.
 * Le mapping EXACT des champs MAROCAINS spécifiques (ICE, identifiant fiscal,
 * codes DGI de type de document et de TVA, codes d'unité, CustomizationID /
 * ProfileID) DEVRA être ajusté selon la documentation officielle. Les valeurs
 * ci-dessous suivent la structure UBL 2.1 PUBLIQUE (standard OASIS), pas une
 * invention, mais elles ne constituent PAS une déclaration de conformité DGI.
 *
 * Ce fichier est PUR (aucune dépendance `db`/`electron`) : la conversion reçoit
 * un document déjà chargé et ne fait aucune requête.
 */

import { formatMoney } from '../../utils/money';
import { XML_DECLARATION, xmlContainer, xmlLeaf, xmlOptionalLeaf } from './UblXmlBuilder';
import { serializeUblParty } from './UblPartySerializer';
import {
  groupTaxByRate,
  resolveUblLines,
  serializeTaxTotal,
  serializeUblLine,
} from './UblLineSerializer';
import {
  DEFAULT_CURRENCY,
  UBL_CREDIT_NOTE_TYPE_CODE,
  UBL_INVOICE_TYPE_CODE,
  UBL_NAMESPACE_CAC,
  UBL_NAMESPACE_CBC,
  UBL_NAMESPACE_CREDIT_NOTE,
  UBL_NAMESPACE_INVOICE,
  UBL_VERSION_ID,
  type UblConversionResult,
  type UblGenerationContext,
  type UblParty,
  type UblSourceDocument,
} from './ublTypes';

/**
 * Valeurs d'enveloppe à définir avec la DGI (profil de conformité / de
 * processus). Volontairement explicites : elles rappellent qu'elles ne sont
 * PAS encore connues, plutôt que d'inventer un identifiant.
 */
export const UBL_CUSTOMIZATION_ID_PLACEHOLDER = 'A_DEFINIR_SELON_SPECIFICATIONS_DGI';
export const UBL_PROFILE_ID_PLACEHOLDER = 'A_DEFINIR_SELON_SPECIFICATIONS_DGI';

const DEFAULT_SUPPLIER_NAME = 'Fournisseur (nom non renseigné)';
const DEFAULT_CUSTOMER_NAME = 'Client comptoir';

interface UblRoot {
  isCreditNote: boolean;
  rootName: 'Invoice' | 'CreditNote';
  namespace: string;
  defaultTypeCode: string;
  typeCodeTag: 'cbc:InvoiceTypeCode' | 'cbc:CreditNoteTypeCode';
}

/** Détermine l'élément racine UBL et le code de type selon le document. */
function resolveUblRoot(document: UblSourceDocument): UblRoot {
  const isCreditNote = document.type === 'CREDIT_NOTE';
  return {
    isCreditNote,
    rootName: isCreditNote ? 'CreditNote' : 'Invoice',
    namespace: isCreditNote ? UBL_NAMESPACE_CREDIT_NOTE : UBL_NAMESPACE_INVOICE,
    defaultTypeCode: isCreditNote ? UBL_CREDIT_NOTE_TYPE_CODE : UBL_INVOICE_TYPE_CODE,
    typeCodeTag: isCreditNote ? 'cbc:CreditNoteTypeCode' : 'cbc:InvoiceTypeCode',
  };
}

/** Résout le fournisseur (données entreprise) depuis le contexte. */
function resolveSupplier(context?: UblGenerationContext): UblParty {
  return context?.supplier ?? { name: DEFAULT_SUPPLIER_NAME };
}

/** Résout l'acheteur : contexte prioritaire, sinon nom client du document. */
function resolveCustomer(document: UblSourceDocument, context?: UblGenerationContext): UblParty {
  return context?.customer ?? { name: document.customer_name ?? DEFAULT_CUSTOMER_NAME };
}

/** En-tête UBL (identifiants, dates, devise, notes). */
function buildUblHeader(
  document: UblSourceDocument,
  root: UblRoot,
  currency: string,
  typeCode: string,
  customizationId: string,
  profileId: string,
): string[] {
  return [
    xmlLeaf('cbc:UBLVersionID', UBL_VERSION_ID, 1),
    xmlLeaf('cbc:CustomizationID', customizationId, 1),
    xmlLeaf('cbc:ProfileID', profileId, 1),
    xmlLeaf('cbc:ID', document.document_number, 1),
    xmlLeaf('cbc:IssueDate', document.date, 1),
    xmlOptionalLeaf('cbc:DueDate', document.due_date ?? null, 1),
    xmlLeaf(root.typeCodeTag, typeCode, 1),
    xmlLeaf('cbc:DocumentCurrencyCode', currency, 1),
    xmlOptionalLeaf('cbc:Note', document.notes ?? null, 1),
  ];
}

/** Totaux monétaires UBL (`cac:LegalMonetaryTotal`). */
function buildLegalMonetaryTotal(
  document: UblSourceDocument,
  currency: string,
  level: number,
): string {
  const exclTax = formatMoney(document.total_excl_tax);
  const inclTax = formatMoney(document.total_incl_tax);
  const allowance = Number(document.discount_amount ?? 0);

  return xmlContainer('cac:LegalMonetaryTotal', level, [
    xmlLeaf('cbc:LineExtensionAmount', exclTax, level + 1, { currencyID: currency }),
    xmlLeaf('cbc:TaxExclusiveAmount', exclTax, level + 1, { currencyID: currency }),
    xmlLeaf('cbc:TaxInclusiveAmount', inclTax, level + 1, { currencyID: currency }),
    allowance > 0 ? xmlLeaf('cbc:AllowanceTotalAmount', formatMoney(allowance), level + 1, { currencyID: currency }) : '',
    xmlLeaf('cbc:PayableAmount', inclTax, level + 1, { currencyID: currency }),
  ]);
}

/**
 * Convertit un document en chaîne XML UBL 2.1.
 *
 * @param document Facture / avoir chargé (avec ses lignes `items`).
 * @param context  Parties (fournisseur/client) et enveloppe UBL optionnelles.
 */
export function documentToUbl(document: UblSourceDocument, context?: UblGenerationContext): string {
  const root = resolveUblRoot(document);
  const currency = context?.currency ?? DEFAULT_CURRENCY;
  const typeCode = context?.invoiceTypeCode ?? root.defaultTypeCode;
  const customizationId = context?.customizationId ?? UBL_CUSTOMIZATION_ID_PLACEHOLDER;
  const profileId = context?.profileId ?? UBL_PROFILE_ID_PLACEHOLDER;

  const lines = resolveUblLines(document);
  const subtotals = groupTaxByRate(lines);

  const rootAttributes = {
    xmlns: root.namespace,
    'xmlns:cac': UBL_NAMESPACE_CAC,
    'xmlns:cbc': UBL_NAMESPACE_CBC,
  };

  const body = xmlContainer(root.rootName, 0, [
    ...buildUblHeader(document, root, currency, typeCode, customizationId, profileId),
    serializeUblParty('cac:AccountingSupplierParty', resolveSupplier(context), 1),
    serializeUblParty('cac:AccountingCustomerParty', resolveCustomer(document, context), 1),
    serializeTaxTotal(document.total_tax, subtotals, currency, 1),
    buildLegalMonetaryTotal(document, currency, 1),
    ...lines.map((line) => serializeUblLine(line, root.isCreditNote, currency, 1)),
  ], rootAttributes);

  return `${XML_DECLARATION}\n${body}\n`;
}

/** Variante renvoyant le XML et des métadonnées utiles (tests, journalisation). */
export function documentToUblResult(
  document: UblSourceDocument,
  context?: UblGenerationContext,
): UblConversionResult {
  const xml = documentToUbl(document, context);
  return {
    xml,
    documentNumber: document.document_number,
    documentType: document.type,
    lineCount: (document.items ?? []).length,
    currency: context?.currency ?? DEFAULT_CURRENCY,
  };
}
