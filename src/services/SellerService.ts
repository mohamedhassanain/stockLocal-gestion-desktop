import { SellerRepository, type Seller, type SellerInput, type SellerSalesRow } from '../repositories/SellerRepository';
import { calculateCommission, normalizeCommissionRate, SELLER_NAME_MAX_LENGTH } from '../domain/sellers/commission';
import { monthRange, yearRange } from './TaxService';

/**
 * ─── §B4 — Service vendeurs / commerciaux ───────────────────────────────────
 *
 *   SellerRepository (SQL) ──► SellerService (règles) ──► IPC ──► UI
 *
 * Les vendeurs sont des FICHES (aucun compte utilisateur). Le service valide
 * les entrées, gère l'activation, et calcule le rapport de commission via le
 * module pur `domain/sellers/commission.ts`.
 */

/** Ligne du rapport de commission (CA + commission déjà calculés). */
export interface SellerCommissionRow extends SellerSalesRow {
  commission: number;
}

/** Rapport complet sur une période. */
export interface SellerReport {
  from: string;
  to: string;
  rows: SellerCommissionRow[];
  totalRevenue: number;
  totalCommission: number;
}

function validateInput(data: SellerInput): SellerInput {
  const name = typeof data.name === 'string' ? data.name.trim().slice(0, SELLER_NAME_MAX_LENGTH) : '';
  if (!name) throw new Error('Le nom du vendeur est obligatoire.');
  const phone = typeof data.phone === 'string' && data.phone.trim() ? data.phone.trim().slice(0, 30) : null;
  const notes = typeof data.notes === 'string' && data.notes.trim() ? data.notes.trim().slice(0, 500) : null;
  return {
    name,
    phone,
    notes,
    commission_rate: normalizeCommissionRate(data.commission_rate),
    active: data.active === 0 ? 0 : 1,
  };
}

export const SellerService = {
  getAllSellers(): Seller[] {
    return SellerRepository.getAll();
  },

  getActiveSellers(): Seller[] {
    return SellerRepository.getActive();
  },

  getSeller(id: string): Seller | undefined {
    return SellerRepository.getById(id);
  },

  createSeller(data: SellerInput): Seller {
    return SellerRepository.create(validateInput(data));
  },

  /**
   * Met à jour un vendeur. Le payload peut être PARTIEL (modification d'un
   * seul champ) : il est fusionné avec l'existant AVANT validation, pour ne
   * jamais perdre un champ non fourni.
   */
  updateSeller(id: string, data: Partial<SellerInput>): Seller {
    const existing = SellerRepository.getById(id);
    if (!existing) throw new Error('Vendeur introuvable.');
    const merged: SellerInput = {
      name: data.name ?? existing.name,
      phone: data.phone !== undefined ? data.phone : existing.phone,
      commission_rate: data.commission_rate ?? existing.commission_rate,
      active: data.active ?? existing.active,
      notes: data.notes !== undefined ? data.notes : existing.notes,
    };
    return SellerRepository.update(id, validateInput(merged));
  },

  setSellerActive(id: string, active: boolean): void {
    SellerRepository.setActive(id, active);
  },

  deleteSeller(id: string): void {
    SellerRepository.remove(id);
  },

  /** Rapport de commission sur une période bornée (AAAA-MM-JJ). */
  getReportForRange(from: string, to: string): SellerReport {
    const rows = SellerRepository.getSalesReport(from, to).map(row => {
      const revenue = Number(row.revenue ?? 0);
      return {
        ...row,
        revenue,
        commission: calculateCommission(revenue, row.commission_rate),
      };
    });
    const totalRevenue = rows.reduce((sum, r) => sum + r.revenue, 0);
    const totalCommission = rows.reduce((sum, r) => sum + r.commission, 0);
    return { from, to, rows, totalRevenue, totalCommission };
  },

  /** Rapport d'un mois `AAAA-MM`. */
  getReportForMonth(month: string): SellerReport {
    const { from, to } = monthRange(month);
    return this.getReportForRange(from, to);
  },

  /** Rapport d'une année civile. */
  getReportForYear(year: number): SellerReport {
    const { from, to } = yearRange(year);
    return this.getReportForRange(from, to);
  },
};
