import { db } from '../database/config/connection';
import { roundMoney } from '../utils/money';

/**
 * ─── §TVA — Repository fiscal ──────────────────────────────────────────────────
 *
 * SEUL endroit qui interroge la base pour la TVA. Le `TaxService` porte les
 * règles ; ce repository ne fait que du SQL, paramétré, en LECTURE SEULE.
 *
 * Conventions de période : bornes « date seule » (AAAA-MM-JJ) incluses, via
 * `date(?)` — donc calendrier LOCAL, jamais UTC (même règle que le reste de
 * l'application : une date métier n'est pas un instant).
 *
 * Les montants proviennent des colonnes FIGÉES au moment du document
 * (`documents.total_tax`, `document_items.vat_rate`) : un changement de TVA
 * d'un produit aujourd'hui ne réécrit pas l'historique.
 */

/** Totaux d'un flux (ventes ou achats) sur une période. */
export interface FlowTotals {
  /** Base hors taxe. */
  exclTax: number;
  /** Montant de TVA. */
  tax: number;
  /** Total toutes taxes comprises. */
  inclTax: number;
  /** Nombre de documents pris en compte. */
  count: number;
}

/** Détail d'un taux : base hors taxe et TVA correspondante. */
export interface VatRateBreakdown {
  /** Taux appliqué (pourcentage). */
  rate: number;
  /** Base hors taxe cumulée à ce taux. */
  exclTax: number;
  /** TVA cumulée à ce taux (peut être négative : avoirs). */
  tax: number;
}

const EMPTY_FLOW: FlowTotals = { exclTax: 0, tax: 0, inclTax: 0, count: 0 };

// §Ventes — factures + bons de livraison, NETS DES AVOIRS (dont les lignes sont
// stockées en négatif, cf. DocumentRepository.createCreditNote). Les documents
// annulés sont exclus : un avoir total annule déjà la facture d'origine.
const stmtSalesTotals = db.prepare(`
  SELECT
    COALESCE(SUM(d.total_excl_tax), 0) AS excl_tax,
    COALESCE(SUM(d.total_tax), 0)      AS tax,
    COALESCE(SUM(d.total_incl_tax), 0) AS incl_tax,
    COUNT(*)                           AS cnt
  FROM documents d
  WHERE d.type IN ('INVOICE', 'DELIVERY_NOTE', 'CREDIT_NOTE')
    AND d.status <> 'CANCELLED'
    AND date(d.date) BETWEEN date(?) AND date(?)
`);

// §Achats — SEULES les commandes effectivement RÉCEPTIONNÉES comptent.
//
// Une TVA n'est déductible que sur une marchandise réellement entrée (et la
// facture fournisseur correspondante). Une commande au statut DRAFT n'est qu'une
// intention d'achat : la compter ferait apparaître une TVA déductible FICTIVE,
// donc un crédit de TVA qui n'existe pas. Les totaux d'une commande
// CONFIRMED/RECEIVED sont, eux, calculés par `receive()` sur les quantités
// réellement reçues (une réception partielle ne déduit que sa part).
const stmtPurchaseTotals = db.prepare(`
  SELECT
    COALESCE(SUM(po.total_excl_tax), 0) AS excl_tax,
    COALESCE(SUM(po.total_tax), 0)      AS tax,
    COALESCE(SUM(po.total_incl_tax), 0) AS incl_tax,
    COUNT(*)                            AS cnt
  FROM purchase_orders po
  WHERE po.status IN ('CONFIRMED', 'RECEIVED')
    AND date(po.date) BETWEEN date(?) AND date(?)
`);

const stmtSalesByRate = db.prepare(`
  SELECT di.vat_rate AS rate,
         COALESCE(SUM(di.total), 0) AS excl_tax
  FROM document_items di
  JOIN documents d ON d.id = di.document_id
  WHERE d.type IN ('INVOICE', 'DELIVERY_NOTE', 'CREDIT_NOTE')
    AND d.status <> 'CANCELLED'
    AND date(d.date) BETWEEN date(?) AND date(?)
  GROUP BY di.vat_rate
  ORDER BY di.vat_rate ASC
`);

// La base HT par taux est calculée sur les quantités RÉELLEMENT REÇUES
// (`received_qty × unit_price`), exactement comme l'entête de commande
// (`purchase_orders.total_excl_tax`, recalculé par `receive()`). Utiliser
// `poi.total` — le total COMMANDÉ — ferait diverger la ventilation de l'entête
// dès qu'une réception est partielle.
const stmtPurchasesByRate = db.prepare(`
  SELECT poi.vat_rate AS rate,
         COALESCE(SUM(poi.received_qty * poi.unit_price), 0) AS excl_tax
  FROM purchase_order_items poi
  JOIN purchase_orders po ON po.id = poi.purchase_order_id
  WHERE po.status IN ('CONFIRMED', 'RECEIVED')
    AND date(po.date) BETWEEN date(?) AND date(?)
  GROUP BY poi.vat_rate
  ORDER BY poi.vat_rate ASC
`);

interface FlowRow {
  excl_tax: number;
  tax: number;
  incl_tax: number;
  cnt: number;
}

interface RateRow {
  rate: number;
  excl_tax: number;
}

function toFlowTotals(row: FlowRow | undefined): FlowTotals {
  if (!row) return { ...EMPTY_FLOW };
  return {
    exclTax: roundMoney(row.excl_tax),
    tax: roundMoney(row.tax),
    inclTax: roundMoney(row.incl_tax),
    count: Number(row.cnt ?? 0),
  };
}

/** Convertit une ligne (taux, base HT) en ventilation complète, TVA recalculée. */
function toBreakdown(rows: RateRow[]): VatRateBreakdown[] {
  return rows.map(row => {
    const rate = Number(row.rate ?? 0);
    const exclTax = roundMoney(row.excl_tax);
    // La TVA d'un taux = base × taux. Le calcul est fait ICI (et non stocké
    // ligne par ligne) car `document_items` ne conserve que le HT ; c'est la
    // même formule que la facturation (`money.calculateLineAmounts`).
    const tax = roundMoney(exclTax * (rate / 100));
    return { rate, exclTax, tax };
  });
}

export const TaxRepository = {
  /** Totaux de VENTE (HT / TVA collectée / TTC) sur une période. */
  getSalesTotals(from: string, to: string): FlowTotals {
    return toFlowTotals(stmtSalesTotals.get(from, to) as FlowRow | undefined);
  },

  /** Totaux d'ACHAT (HT / TVA déductible / TTC) sur une période. */
  getPurchaseTotals(from: string, to: string): FlowTotals {
    return toFlowTotals(stmtPurchaseTotals.get(from, to) as FlowRow | undefined);
  },

  /** Ventilation des ventes par taux de TVA (base HT et TVA par taux). */
  getSalesByRate(from: string, to: string): VatRateBreakdown[] {
    return toBreakdown(stmtSalesByRate.all(from, to) as RateRow[]);
  },

  /** Ventilation des achats par taux de TVA. */
  getPurchasesByRate(from: string, to: string): VatRateBreakdown[] {
    return toBreakdown(stmtPurchasesByRate.all(from, to) as RateRow[]);
  },

  /**
   * Taux PROPRE du produit + indicateur d'héritage.
   *
   * `inherit_from_category = 1` signifie que le produit ignore son propre
   * `vat_rate` et doit hériter du taux de sa catégorie (puis du défaut
   * société). Sans cet indicateur, l'héritage serait inatteignable : la colonne
   * `products.vat_rate` est `NOT NULL DEFAULT 20`, elle n'est donc jamais nulle.
   *
   * @returns `null` si le produit n'existe pas.
   */
  getProductVat(productId: string): { vat_rate: number | null; inheritFromCategory: boolean } | null {
    const row = db.prepare(
      'SELECT vat_rate, vat_inherit_from_category FROM products WHERE id = ?'
    ).get(productId) as { vat_rate: number | null; vat_inherit_from_category: number | null } | undefined;
    if (!row) return null;
    return {
      vat_rate: typeof row.vat_rate === 'number' ? row.vat_rate : null,
      inheritFromCategory: Number(row.vat_inherit_from_category ?? 0) === 1,
    };
  },

  /**
   * Taux de TVA hérité de la CATÉGORIE du produit (`null` si le produit n'a pas
   * de catégorie ou si celle-ci ne définit pas de taux).
   */
  getCategoryRateForProduct(productId: string): number | null {
    const row = db.prepare(`
      SELECT c.vat_rate AS vat_rate
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.id = ?
    `).get(productId) as { vat_rate: number | null } | undefined;
    if (!row) return null;
    return typeof row.vat_rate === 'number' ? row.vat_rate : null;
  }
};
