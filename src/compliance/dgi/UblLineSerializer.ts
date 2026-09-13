/**
 * ─── Sérialisation des lignes et de la TVA UBL ───────────────────────────────
 *
 * Convertit les lignes d'un document (document_items) en `cac:InvoiceLine` /
 * `cac:CreditNoteLine` UBL 2.1, et regroupe la TVA par taux pour produire les
 * `cac:TaxSubtotal`.
 *
 * Les montants sont calculés par le MOTEUR MONÉTAIRE CENTRAL de l'application
 * (src/utils/money) : les valeurs UBL sont donc identiques à celles imprimées
 * sur la facture (aucune divergence d'arrondi).
 *
 * ⚠️  Le mapping fin (code d'unité UN/ECE par unité produit, code de catégorie
 * de TVA marocain) devra être ajusté selon les spécifications DGI.
 *
 * Ce fichier est PUR (aucune dépendance `db`/`electron`).
 */

import { calculateLineAmounts, formatMoney, roundMoney, sumMoney } from '../../utils/money';
import { xmlContainer, xmlLeaf, xmlOptionalLeaf } from './UblXmlBuilder';
import {
  UBL_DEFAULT_UNIT_CODE,
  UBL_TAX_CATEGORY_STANDARD,
  UBL_TAX_SCHEME_ID_VAT,
  type UblSourceDocument,
  type UblSourceLine,
} from './ublTypes';

/** Ligne source enrichie de ses montants calculés. */
export interface ResolvedUblLine {
  index: number;
  productRef: string;
  designation: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  vatRate: number;
  exclTax: number;
  tax: number;
  inclTax: number;
}

/** Sous-total de TVA par taux. */
export interface UblTaxSubtotal {
  rate: number;
  taxableAmount: number;
  taxAmount: number;
}

/** Normalise une ligne source : valeurs numériques sûres + chaînes non nulles. */
function normalizeLine(line: UblSourceLine, index: number): ResolvedUblLine {
  const quantity = Number(line.quantity) || 0;
  const unitPrice = Number(line.unit_price) || 0;
  const discountPct = Number(line.discount) || 0;
  const vatRate = Number(line.vat_rate) || 0;
  const amounts = calculateLineAmounts({ quantity, unitPrice, discountPct, vatRate });

  return {
    index: index + 1,
    // `product_ref` / `product_name` : noms portés par `DocumentItem` en base.
    productRef: line.product_ref ?? '',
    designation: line.product_name ?? '',
    quantity,
    unitPrice,
    discountPct,
    vatRate,
    exclTax: amounts.exclTax,
    tax: amounts.tax,
    inclTax: amounts.inclTax,
  };
}

/** Résout toutes les lignes d'un document en lignes UBL calculées. */
export function resolveUblLines(document: UblSourceDocument): ResolvedUblLine[] {
  const items = document.items ?? [];
  return items.map((line, index) => normalizeLine(line, index));
}

/**
 * Regroupe les lignes par taux de TVA et produit les sous-totaux UBL.
 * Ordonné par taux croissant pour un XML stable et comparable.
 */
export function groupTaxByRate(lines: ResolvedUblLine[]): UblTaxSubtotal[] {
  const byRate = new Map<number, { taxable: number[]; tax: number[] }>();
  for (const line of lines) {
    const bucket = byRate.get(line.vatRate) ?? { taxable: [], tax: [] };
    bucket.taxable.push(line.exclTax);
    bucket.tax.push(line.tax);
    byRate.set(line.vatRate, bucket);
  }

  return [...byRate.entries()]
    .map(([rate, bucket]) => ({
      rate,
      taxableAmount: sumMoney(bucket.taxable),
      taxAmount: sumMoney(bucket.tax),
    }))
    .sort((a, b) => a.rate - b.rate);
}

/** Construit `cac:ClassifiedTaxCategory` (catégorie de TVA d'une ligne). */
function buildClassifiedTaxCategory(vatRate: number, level: number): string {
  return xmlContainer('cac:ClassifiedTaxCategory', level, [
    xmlLeaf('cbc:ID', vatRate > 0 ? UBL_TAX_CATEGORY_STANDARD : 'Z', level + 1),
    xmlLeaf('cbc:Percent', formatMoney(vatRate), level + 1),
    xmlContainer('cac:TaxScheme', level + 1, [
      xmlLeaf('cbc:ID', UBL_TAX_SCHEME_ID_VAT, level + 2),
    ]),
  ]);
}

/**
 * Construit une ligne de facture (`cac:InvoiceLine`) ou d'avoir
 * (`cac:CreditNoteLine`) selon `isCreditNote`.
 */
export function serializeUblLine(
  line: ResolvedUblLine,
  isCreditNote: boolean,
  currency: string,
  level: number,
): string {
  const lineTag = isCreditNote ? 'cac:CreditNoteLine' : 'cac:InvoiceLine';
  const quantityTag = isCreditNote ? 'cbc:CreditedQuantity' : 'cbc:InvoicedQuantity';
  // Un avoir porte des montants négatifs : on reflète le signe sur les montants.
  const sign = isCreditNote ? -1 : 1;

  const itemChildren = [
    xmlLeaf('cbc:Name', line.designation || line.productRef || 'Article', level + 4),
    xmlOptionalLeaf('cbc:Description', line.designation || null, level + 4),
    xmlContainer('cac:SellersItemIdentification', level + 4, [
      xmlOptionalLeaf('cbc:ID', line.productRef || null, level + 5),
    ]),
    buildClassifiedTaxCategory(line.vatRate, level + 4),
  ];

  return xmlContainer(lineTag, level, [
    xmlLeaf('cbc:ID', line.index, level + 1),
    xmlLeaf(quantityTag, line.quantity, level + 1, { unitCode: UBL_DEFAULT_UNIT_CODE }),
    xmlLeaf('cbc:LineExtensionAmount', formatMoney(sign * line.exclTax), level + 1, { currencyID: currency }),
    xmlContainer('cac:Item', level + 1, itemChildren),
    xmlContainer('cac:Price', level + 1, [
      xmlLeaf('cbc:PriceAmount', formatMoney(line.unitPrice), level + 2, { currencyID: currency }),
    ]),
  ]);
}

/** Construit `cac:TaxTotal` (montant total de TVA + sous-totaux par taux). */
export function serializeTaxTotal(
  totalTax: number,
  subtotals: UblTaxSubtotal[],
  currency: string,
  level: number,
): string {
  const subtotalNodes = subtotals.map((subtotal) =>
    xmlContainer('cac:TaxSubtotal', level + 1, [
      xmlLeaf('cbc:TaxableAmount', formatMoney(subtotal.taxableAmount), level + 2, { currencyID: currency }),
      xmlLeaf('cbc:TaxAmount', formatMoney(subtotal.taxAmount), level + 2, { currencyID: currency }),
      xmlContainer('cac:TaxCategory', level + 2, [
        xmlLeaf('cbc:ID', subtotal.rate > 0 ? UBL_TAX_CATEGORY_STANDARD : 'Z', level + 3),
        xmlLeaf('cbc:Percent', formatMoney(subtotal.rate), level + 3),
        xmlContainer('cac:TaxScheme', level + 3, [
          xmlLeaf('cbc:ID', UBL_TAX_SCHEME_ID_VAT, level + 4),
        ]),
      ]),
    ]),
  );

  return xmlContainer('cac:TaxTotal', level, [
    xmlLeaf('cbc:TaxAmount', formatMoney(roundMoney(totalTax)), level + 1, { currencyID: currency }),
    ...subtotalNodes,
  ]);
}
