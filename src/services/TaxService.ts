import { TaxRepository, type FlowTotals, type VatRateBreakdown } from '../repositories/TaxRepository';
import { GlobalSettingsService } from './GlobalSettingsService';
import {
  DEFAULT_VAT_RATE,
  buildVatRateCatalog,
  isPresetVatRate,
  parseVatRate,
  parseVatRates,
  type VatRate,
} from '../domain/tax/vatRates';
import { roundMoney, subtractMoney } from '../utils/money';

/**
 * ─── §TVA — Service fiscal (source de vérité des règles) ───────────────────────
 *
 *   TaxRepository (SQL) ──► TaxService (règles) ──► IPC ──► UI
 *
 * RESPONSABILITÉS :
 *   1. Résolution du taux applicable : PRODUIT → CATÉGORIE → DÉFAUT.
 *   2. Catalogue des taux proposés (légaux + personnalisés).
 *   3. Rapport de TVA sur une période : collectée, déductible, nette, ventes et
 *      achats en HT / TTC, ventilation par taux.
 *
 * Ce service ne calcule JAMAIS la TVA d'une ligne : c'est `utils/money.ts`
 * (`calculateLineAmounts`) qui le fait, au moment de la facturation, et le
 * résultat est FIGÉ dans `document_items.vat_rate` / `documents.total_tax`.
 * Ici, on ne fait que RELIRE et AGRÉGER ces montants figés.
 */

/** Rapport de TVA sur une période (bornes incluses). */
export interface VatReport {
  /** Bornes de la période (AAAA-MM-JJ), telles que reçues. */
  from: string;
  to: string;
  /** Ventes : HT, TVA collectée, TTC (nets des avoirs). */
  sales: FlowTotals;
  /** Achats : HT, TVA déductible, TTC. */
  purchases: FlowTotals;
  /** TVA NETTE = collectée − déductible (négative = crédit de TVA reportable). */
  netVat: number;
  /** Détail des ventes par taux de TVA. */
  salesByRate: VatRateBreakdown[];
  /** Détail des achats par taux de TVA. */
  purchasesByRate: VatRateBreakdown[];
}

/** Catalogue des taux disponibles (taux légaux + personnalisés). */
function getCatalog(): VatRate[] {
  return buildVatRateCatalog(GlobalSettingsService.getAll().vat_rates);
}

/** Liste simple des taux (pour alimenter un menu déroulant). */
function getRates(): number[] {
  return parseVatRates(JSON.stringify(GlobalSettingsService.getAll().vat_rates));
}

/** Taux par défaut de l'entreprise (utilisé comme dernier repli). */
function getDefaultRate(): number {
  const rate = GlobalSettingsService.getAll().default_vat_rate;
  return Number.isFinite(rate) ? rate : DEFAULT_VAT_RATE;
}

/**
 * Résout le taux de TVA applicable à un produit :
 *   taux du PRODUIT → taux de sa CATÉGORIE → taux par DÉFAUT de l'entreprise.
 *
 * Deux cas, volontairement distincts :
 *   1. Le produit a demandé à HÉRITER de sa catégorie
 *      (`vat_inherit_from_category = 1`) → on ignore son propre taux et on
 *      remonte à la catégorie, puis au défaut société.
 *   2. Sinon, le taux du produit s'applique tel quel. Un taux à 0 (exonéré) est
 *      une VALEUR, pas une absence : il ne retombe JAMAIS sur le défaut.
 *
 * La catégorie est donc réellement atteignable (et non du code mort) ; c'est
 * la raison d'être de la colonne `vat_inherit_from_category`.
 */
function resolveRate(productId: string): number {
  const product = TaxRepository.getProductVat(productId);

  if (product && !product.inheritFromCategory) {
    if (product.vat_rate !== null && Number.isFinite(product.vat_rate)) {
      return product.vat_rate;
    }
  }

  const categoryRate = TaxRepository.getCategoryRateForProduct(productId);
  if (categoryRate !== null && Number.isFinite(categoryRate)) return categoryRate;

  return getDefaultRate();
}

/** Ajoute un taux personnalisé au catalogue (idempotent, bornes vérifiées). */
function addRate(value: unknown): number[] {
  const rate = parseVatRate(value);
  const current = getRates();
  if (!current.includes(rate)) {
    GlobalSettingsService.save({ vat_rates: [...current, rate] });
  }
  return getRates();
}

/**
 * Retire un taux PERSONNALISÉ du catalogue.
 * Un taux légal marocain (0/7/10/14/20) ne peut PAS être retiré : il doit
 * rester proposé, sinon une vente exonérée deviendrait impossible à saisir.
 */
function removeRate(value: unknown): number[] {
  const rate = parseVatRate(value);
  if (isPresetVatRate(rate)) {
    throw new Error(`Le taux légal ${rate} % ne peut pas être supprimé.`);
  }
  GlobalSettingsService.save({ vat_rates: getRates().filter(r => r !== rate) });
  return getRates();
}

/** Bornes « date seule » d'un mois `AAAA-MM` (du 1er au dernier jour). */
export function monthRange(month: string): { from: string; to: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error('Mois invalide (format attendu : AAAA-MM).');
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) throw new Error('Mois invalide (1 à 12).');
  // `new Date(year, monthNumber, 0)` = jour 0 du mois suivant, donc dernier jour
  // du mois demandé. On n'extrait QUE le numéro de jour : aucune conversion de
  // fuseau n'intervient sur une date métier.
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return {
    from: `${match[1]}-${match[2]}-01`,
    to: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** Bornes « date seule » d'une année civile. */
export function yearRange(year: number): { from: string; to: string } {
  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    throw new Error('Année invalide.');
  }
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** Construit le rapport de TVA pour une période bornée. */
function getReportForRange(from: string, to: string): VatReport {
  const sales = TaxRepository.getSalesTotals(from, to);
  const purchases = TaxRepository.getPurchaseTotals(from, to);

  return {
    from,
    to,
    sales,
    purchases,
    // TVA nette = collectée − déductible. Un solde négatif est un CRÉDIT de TVA
    // (reportable) : il est renvoyé tel quel, jamais ramené à 0 par un Math.max,
    // sinon un crédit disparaîtrait du rapport.
    netVat: roundMoney(subtractMoney(sales.tax, purchases.tax)),
    salesByRate: TaxRepository.getSalesByRate(from, to),
    purchasesByRate: TaxRepository.getPurchasesByRate(from, to),
  };
}

export const TaxService = {
  getCatalog,
  getRates,
  getDefaultRate,
  resolveRate,
  addRate,
  removeRate,
  monthRange,
  yearRange,
  getReportForRange,

  /** Rapport de TVA d'un mois `AAAA-MM`. */
  getReportForMonth(month: string): VatReport {
    const { from, to } = monthRange(month);
    return getReportForRange(from, to);
  },

  /** Rapport de TVA d'une année civile. */
  getReportForYear(year: number): VatReport {
    const { from, to } = yearRange(year);
    return getReportForRange(from, to);
  },
};
