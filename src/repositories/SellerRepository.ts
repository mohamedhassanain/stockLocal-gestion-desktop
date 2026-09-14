import { db } from '../database/config/connection';
import { randomUUID } from 'crypto';

/**
 * ─── §B4 — Repository vendeurs / commerciaux ────────────────────────────────
 *
 * SEUL endroit qui interroge la table `sellers` (et agrège les ventes par
 * vendeur). Le service porte les règles ; la commission est calculée par le
 * module pur `domain/sellers/commission.ts`.
 *
 * Rappel : `sellers` sont des FICHES, pas des comptes utilisateurs.
 */

export interface Seller {
  id: string;
  name: string;
  phone?: string | null;
  commission_rate: number;
  /** 1 = actif, 0 = inactif (stocké en INTEGER en base). */
  active: number;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SellerInput {
  name: string;
  phone?: string | null;
  commission_rate?: number;
  active?: number;
  notes?: string | null;
}

/** Ligne brute du rapport (avant calcul de commission). */
export interface SellerSalesRow {
  id: string;
  name: string;
  commission_rate: number;
  active: number;
  sales_count: number;
  revenue: number;
}

const stmtGetAll = db.prepare(`
  SELECT * FROM sellers ORDER BY active DESC, name ASC
`);

const stmtGetActive = db.prepare(`
  SELECT * FROM sellers WHERE active = 1 ORDER BY name ASC
`);

const stmtGetById = db.prepare('SELECT * FROM sellers WHERE id = ?');

const stmtInsert = db.prepare(`
  INSERT INTO sellers (id, name, phone, commission_rate, active, notes)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const stmtUpdate = db.prepare(`
  UPDATE sellers SET name = ?, phone = ?, commission_rate = ?, active = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const stmtSetActive = db.prepare(`
  UPDATE sellers SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
`);

const stmtDelete = db.prepare('DELETE FROM sellers WHERE id = ?');

const stmtCountDocuments = db.prepare('SELECT COUNT(*) AS cnt FROM documents WHERE seller_id = ?');

/**
 * Rapport ventes par vendeur sur une période (bornes « date seule » incluses).
 * Ventes = factures + bons de livraison NON annulés (mêmes règles que la TVA).
 */
const stmtSalesReport = db.prepare(`
  SELECT
    s.id AS id,
    s.name AS name,
    s.commission_rate AS commission_rate,
    s.active AS active,
    COUNT(d.id) AS sales_count,
    COALESCE(SUM(d.total_incl_tax), 0) AS revenue
  FROM sellers s
  LEFT JOIN documents d ON d.seller_id = s.id
    AND d.type IN ('INVOICE', 'DELIVERY_NOTE')
    AND d.status <> 'CANCELLED'
    AND date(d.date) BETWEEN date(?) AND date(?)
  GROUP BY s.id
  ORDER BY revenue DESC, s.name ASC
`);

export const SellerRepository = {
  getAll(): Seller[] {
    return stmtGetAll.all() as Seller[];
  },

  getActive(): Seller[] {
    return stmtGetActive.all() as Seller[];
  },

  getById(id: string): Seller | undefined {
    return stmtGetById.get(id) as Seller | undefined;
  },

  create(data: SellerInput): Seller {
    const id = randomUUID();
    stmtInsert.run(
      id,
      data.name,
      data.phone ?? null,
      data.commission_rate ?? 0,
      data.active ?? 1,
      data.notes ?? null,
    );
    return this.getById(id)!;
  },

  update(id: string, data: SellerInput): Seller {
    const existing = this.getById(id);
    if (!existing) throw new Error('Vendeur introuvable.');
    stmtUpdate.run(
      data.name,
      data.phone ?? null,
      data.commission_rate ?? 0,
      data.active ?? existing.active,
      data.notes ?? null,
      id,
    );
    return this.getById(id)!;
  },

  setActive(id: string, active: boolean): void {
    const existing = this.getById(id);
    if (!existing) throw new Error('Vendeur introuvable.');
    stmtSetActive.run(active ? 1 : 0, id);
  },

  /**
   * Supprime un vendeur. REFUSÉ dès qu'il est référencé par un document (une
   * vente conserve la trace du vendeur) : l'utilisateur doit alors le désactiver.
   */
  remove(id: string): void {
    const existing = this.getById(id);
    if (!existing) throw new Error('Vendeur introuvable.');
    const count = (stmtCountDocuments.get(id) as { cnt: number }).cnt;
    if (count > 0) {
      throw new Error(
        `Ce vendeur est référencé par ${count} document(s) : désactivez-le au lieu de le supprimer.`
      );
    }
    stmtDelete.run(id);
  },

  /** Rapport ventes par vendeur (CA, nombre de ventes) sur une période. */
  getSalesReport(from: string, to: string): SellerSalesRow[] {
    return stmtSalesReport.all(from, to) as SellerSalesRow[];
  },
};
