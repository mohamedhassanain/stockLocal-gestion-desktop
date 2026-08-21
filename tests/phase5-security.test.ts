import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db } from '../src/database/config/connection';
import { DataStorageService } from '../src/services/DataStorageService';
import { nextSequence } from '../src/services/DocumentSequenceService';
import {
  validatePathWithinSubDir,
  assertFileSizeWithin,
  FILE_LIMITS,
  csvEscape,
} from '../electron/ipcValidation';

describe('Phase 5 — Confinement backup (validatePathWithinSubDir §10)', () => {
  const dataDir = DataStorageService.getConfig().dataPath;

  it('accepte un backup DANS <dataDir>/backups/', () => {
    const backup = path.join(dataDir, 'backups', 'stocklocal-backup-test.db');
    const resolved = validatePathWithinSubDir(backup, dataDir, 'backups', 'chemin backup');
    expect(resolved).toBe(path.resolve(backup));
  });

  it('rejette un fichier DANS <dataDir> mais HORS de backups/', () => {
    const outside = path.join(dataDir, 'stocklocal.db');
    expect(() => validatePathWithinSubDir(outside, dataDir, 'backups', 'chemin backup'))
      .toThrow(/en dehors du dossier de données autorisé/);
  });

  it('rejette un chemin absolu hors du dossier de données', () => {
    expect(() => validatePathWithinSubDir('C:\\Windows\\System32\\config\\SAM', dataDir, 'backups', 'chemin backup'))
      .toThrow(/en dehors du dossier de données autorisé/);
    expect(() => validatePathWithinSubDir('/etc/passwd', dataDir, 'backups', 'chemin backup'))
      .toThrow(/en dehors du dossier de données autorisé/);
  });

  it('rejette un traversal (../) même via backups/', () => {
    const evil = path.join(dataDir, 'backups', '..', '..', 'secret.db');
    expect(() => validatePathWithinSubDir(evil, dataDir, 'backups', 'chemin backup')).toThrow();
  });
});

describe('Phase 5 — Limites de taille de fichiers (§11)', () => {
  it('accepte un fichier sous la limite image (5 Mo)', () => {
    const tmp = path.join(os.tmpdir(), `sl-small-${Date.now()}.bin`);
    fs.writeFileSync(tmp, Buffer.alloc(1024));
    expect(() => assertFileSizeWithin(tmp, FILE_LIMITS.IMAGE_MAX_BYTES, 'fichier image')).not.toThrow();
    fs.unlinkSync(tmp);
  });

  it('rejette un fichier qui dépasse la limite image (5 Mo)', () => {
    const tmp = path.join(os.tmpdir(), `sl-big-${Date.now()}.bin`);
    fs.writeFileSync(tmp, Buffer.alloc(FILE_LIMITS.IMAGE_MAX_BYTES + 1));
    expect(() => assertFileSizeWithin(tmp, FILE_LIMITS.IMAGE_MAX_BYTES, 'fichier image'))
      .toThrow(/trop volumineux/);
    fs.unlinkSync(tmp);
  });

  it('rejette un fichier qui dépasse la limite CSV (50 Mo) sans le lire', () => {
    const tmp = path.join(os.tmpdir(), `sl-bigcsv-${Date.now()}.csv`);
    fs.writeFileSync(tmp, Buffer.alloc(FILE_LIMITS.CSV_MAX_BYTES + 1));
    expect(() => assertFileSizeWithin(tmp, FILE_LIMITS.CSV_MAX_BYTES, 'chemin CSV'))
      .toThrow(/trop volumineux/);
    fs.unlinkSync(tmp);
  });

  it('rejette un chemin inexistant proprement', () => {
    expect(() => assertFileSizeWithin(path.join(os.tmpdir(), 'sl-missing.db'), FILE_LIMITS.IMAGE_MAX_BYTES, 'fichier'))
      .toThrow(/Fichier introuvable|Impossible de lire/);
  });
});

describe('Phase 1.4 — Anti-injection de formule CSV (csvEscape)', () => {
  it('neutralise les préfixes = + - @', () => {
    // Contient des guillemets → cellule citée + apostrophe + doublage des ""
    expect(csvEscape('=HYPERLINK("http://evil")')).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvEscape('+SUM(A1:A2)')).toBe("'+SUM(A1:A2)");
    expect(csvEscape('-2+3')).toBe("'-2+3");
    expect(csvEscape('@cmd')).toBe("'@cmd");
  });

  it('conserve les valeurs normales', () => {
    expect(csvEscape('Produit A')).toBe('Produit A');
    expect(csvEscape(42)).toBe('42');
    expect(csvEscape('')).toBe('');
  });

  it('cite les cellules contenant séparateur, guillemets ou retour ligne', () => {
    expect(csvEscape('a;b')).toBe('"a;b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('ligne1\nligne2')).toBe('"ligne1\nligne2"');
  });
});

describe('Phase 4 — Numérotation transactionnelle des documents (§20)', () => {
  beforeEach(() => {
    db.exec('DELETE FROM document_sequences;');
  });

  it('alloue des numéros croissants sans chevauchement (plus de COUNT+1)', () => {
    expect(nextSequence('INVOICE', 2025)).toBe(1);
    expect(nextSequence('INVOICE', 2025)).toBe(2);
    expect(nextSequence('INVOICE', 2025)).toBe(3);
  });

  it('les numéros supprimés/annulés ne sont pas réutilisés (robuste après suppression)', () => {
    expect(nextSequence('INVOICE', 2025)).toBe(1);
    expect(nextSequence('INVOICE', 2025)).toBe(2);
    // Simule l’annulation/suppression d’un document : le compteur ne revient pas en arrière.
    expect(nextSequence('INVOICE', 2025)).toBe(3);
  });

  it('sépare les séquences par type et par année', () => {
    expect(nextSequence('INVOICE', 2025)).toBe(1);
    expect(nextSequence('CREDIT_NOTE', 2025)).toBe(1);
    expect(nextSequence('INVOICE', 2026)).toBe(1);
    expect(nextSequence('INVOICE', 2025)).toBe(2);
  });

  it('résiste aux imports massifs : jamais de numéro en double', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const n = nextSequence('PURCHASE', 2025);
      expect(seen.has(n)).toBe(false);
      seen.add(n);
    }
    expect(seen.size).toBe(500);
  });
});
