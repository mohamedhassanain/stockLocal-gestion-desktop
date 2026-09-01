import { describe, it, expect, beforeEach, vi } from 'vitest';

// On capture les textes passés à `page.drawText` pour vérifier directement le
// mécanisme conditionnel implémenté dans PDFService. Extraire le texte d'un
// PDF réel est non trivial (FlateDecode + ObjStm), donc on vérifie la décision
// d'écriture du nom, pas le rendu binaire.
const capture = vi.hoisted(() => ({ drawn: [] as string[] }));

// Dossier réel où écrire le « faux » PDF : process.env.TEMP (Windows) sinon cwd.
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
        addPage: makePage,
        embedFont: vi.fn(async () => ({ widthOfTextAtSize: () => 100 })),
        embedPng: vi.fn(),
        embedJpg: vi.fn(),
        save: vi.fn(async () => Buffer.from('fake-pdf')),
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

const COMPANY_NAME = 'MonEntrepriseXYZTest12345';

describe('PDFService — show_company_name_on_documents', () => {
  beforeEach(() => { capture.drawn = []; });

  const client = {
    id: 'c1', name: 'Client Test', reference: 'CLI-1', phone: '0600000000',
    balance: 0, created_at: new Date().toISOString(), status: 'ACTIVE',
  } as never;

  it('affiche le nom de l\'entreprise par défaut (true)', async () => {
    CompanySettingsService.save({ name: COMPANY_NAME, show_company_name_on_documents: true });
    await PDFService.generateClientStatement(client, []);
    expect(capture.drawn).toContain(COMPANY_NAME);
  });

  it('cache le nom de l\'entreprise quand false', async () => {
    CompanySettingsService.save({ name: COMPANY_NAME, show_company_name_on_documents: false });
    await PDFService.generateClientStatement(client, []);
    expect(capture.drawn).not.toContain(COMPANY_NAME);
  });
});
