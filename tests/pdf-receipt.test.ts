import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Phase 2 — Ticket de caisse 80 mm.
 *
 * On capture les textes passés à `page.drawText` et la taille de page demandée
 * à `addPage` (extraire le texte d'un vrai PDF est non trivial : FlateDecode).
 * On vérifie donc : largeur = 80 mm, contenu essentiel présent (articles, total,
 * mode de paiement) et format compact (pas de mentions légales).
 */
const capture = vi.hoisted(() => ({ drawn: [] as string[], pageSizes: [] as number[][] }));

const docsDir = vi.hoisted(() => process.env.TEMP || process.cwd());
vi.mock('electron', () => ({ app: { getPath: () => docsDir } }));

vi.mock('pdf-lib', () => {
  const makePage = () => ({
    getSize: () => ({ width: 595, height: 842 }),
    drawText: (t: string) => { capture.drawn.push(t); },
    drawImage: () => {},
    drawLine: () => {},
    drawRectangle: () => {},
  });
  return {
    PDFDocument: {
      create: vi.fn(async () => ({
        addPage: (size?: number[]) => {
          capture.pageSizes.push(size ?? [595, 842]);
          return makePage();
        },
        embedFont: vi.fn(async () => ({ widthOfTextAtSize: (t: string) => t.length * 4 })),
        embedPng: vi.fn(),
        embedJpg: vi.fn(),
        save: vi.fn(async () => Buffer.from('%PDF fake')),
        getPageCount: vi.fn(() => 1),
        getPage: vi.fn(() => makePage()),
      })),
    },
    rgb: () => ({}),
    StandardFonts: { Helvetica: 'Helvetica', HelveticaBold: 'HelveticaBold' },
  };
});

import { PDFService } from '../src/services/PDFService';
import { CompanySettingsService } from '../src/services/CompanySettingsService';
import type { Document } from '../src/repositories/DocumentRepository';

const MM = 2.8346;
const EXPECTED_WIDTH = Math.round(80 * MM * 100) / 100;

function makeDoc(): Document {
  return {
    id: 'RECEIPT-1',
    type: 'INVOICE',
    document_number: 'FAC-2026-00042',
    entity_id: '',
    customer_name: 'Client Comptoir',
    date: '2026-01-15T10:30:00.000Z',
    total_excl_tax: 100,
    total_tax: 20,
    total_incl_tax: 120,
    discount_amount: 0,
    status: 'PAID',
    items: [
      { id: 'i1', document_id: 'RECEIPT-1', product_id: 'p1', product_ref: 'REF1', product_name: 'Café', quantity: 2, unit_price: 30, discount: 0, total: 60, vat_rate: 20 },
      { id: 'i2', document_id: 'RECEIPT-1', product_id: 'p2', product_ref: 'REF2', product_name: 'Sucre', quantity: 1, unit_price: 40, discount: 0, total: 40, vat_rate: 20 },
    ],
  } as Document;
}

describe('Phase 2 — PDFService.generateReceipt (ticket 80 mm)', () => {
  beforeEach(() => {
    capture.drawn = [];
    capture.pageSizes = [];
    CompanySettingsService.save({ name: 'MonCommerce', show_company_name_on_documents: true });
  });

  it('produit une page de 80 mm de large et reste compact', async () => {
    await PDFService.generateReceipt(makeDoc());
    expect(capture.pageSizes.length).toBe(1);
    expect(capture.pageSizes[0][0]).toBeCloseTo(EXPECTED_WIDTH, 1);
    // Format compact : la hauteur (calculée selon le contenu) reste petite.
    expect(capture.pageSizes[0][1]).toBeLessThan(400);
  });

  it('contient les articles, le total et le mode de paiement', async () => {
    await PDFService.generateReceipt(makeDoc());
    const all = capture.drawn.join('\n');
    expect(all).toContain('Café');
    expect(all).toContain('Sucre');
    expect(all).toMatch(/2 × 30\.00/);
    expect(all).toMatch(/TOTAL TTC : 120\.00 MAD/);
    expect(all).toContain('Paiement :');
    expect(all).toContain('FAC-2026-00042');
  });

  it('n\'affiche PAS les mentions légales de la facture A4', async () => {
    await PDFService.generateReceipt(makeDoc());
    const all = capture.drawn.join('\n');
    expect(all).not.toContain('tribunaux du siège');
    expect(all).not.toMatch(/RC :/);
  });

  it('affiche le nom de l\'entreprise uniquement si l\'option est active', async () => {
    CompanySettingsService.save({ name: 'MonCommerce', show_company_name_on_documents: false });
    await PDFService.generateReceipt(makeDoc());
    expect(capture.drawn).not.toContain('MonCommerce');

    capture.drawn = [];
    capture.pageSizes = [];
    CompanySettingsService.save({ name: 'MonCommerce', show_company_name_on_documents: true });
    await PDFService.generateReceipt(makeDoc());
    expect(capture.drawn).toContain('MonCommerce');
  });
});
