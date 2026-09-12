import { describe, it, expect } from 'vitest';
import {
  toLocalDateString,
  toDateOnly,
  parseDateOnly,
  todayDateOnly,
  formatDateOnly,
  compareDateOnly,
} from '../src/utils/date';
import { isValidDueDate, DUE_DATE_BEFORE_INVOICE_MESSAGE } from '../src/domain/credit/CreditStatus';

/**
 * §Phase 2.1 & 2.2 — Sécurité des dates « date seule ».
 *
 * Une date métier (date de facture, échéance, date d'inventaire, mois du
 * rapport…) est un CALENDRIER, pas un instant. Elle ne doit JAMAIS être
 * reconvertie via UTC, sinon :
 *   - à UTC+1, une facture créée à 00h30 locale est datée de la VEILLE ;
 *   - le 1er du mois à 00h30, le rapport porte sur le MOIS PRÉCÉDENT.
 * En plus : `due_date >= invoice_date` (Phase 2.1).
 */

describe('§Phase 2.2 — Aucun décalage d’un jour sur une date métier', () => {
  it('toLocalDateString utilise les composantes LOCALES (jamais UTC)', () => {
    const d = new Date(2026, 8, 12, 0, 30); // 12 sept. 2026, 00h30 LOCAL
    expect(toLocalDateString(d)).toBe('2026-09-12');
    expect(d.getDate()).toBe(12);

    // Le piège exact que la fonction évite : toISOString() est en UTC.
    const naive = d.toISOString().split('T')[0];
    if (d.getTimezoneOffset() < 0) {
      // Machine à l'est de Greenwich (ex. Maroc UTC+1) : la version naïve
      // renverrait la VEILLE. C'est la régression que ce test verrouille.
      expect(naive).not.toBe('2026-09-12');
      expect(naive).toBe('2026-09-11');
    }
    // Dans TOUS les fuseaux, la version locale donne bien le 12 septembre.
    expect(toLocalDateString(d)).toBe('2026-09-12');
  });

  it('todayDateOnly() correspond au jour LOCAL du calendrier', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(todayDateOnly()).toBe(expected);
    expect(todayDateOnly()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('le MOIS du rapport suit le calendrier local, pas UTC', () => {
    // 1er du mois à 00h30 local : la version naïve donnerait le mois précédent.
    const d = new Date(2026, 8, 1, 0, 30); // 1er sept. 2026, 00h30
    const localMonth = toLocalDateString(d).slice(0, 7);
    expect(localMonth).toBe('2026-09');

    const naiveMonth = d.toISOString().slice(0, 7);
    if (d.getTimezoneOffset() < 0) {
      expect(naiveMonth).toBe('2026-08'); // le bug évité
      expect(localMonth).not.toBe(naiveMonth);
    }
  });

  it('toDateOnly ne reconvertit jamais une chaîne calendaire via UTC', () => {
    // Une chaîne de date seule reste elle-même, même avec une heure/minuit UTC.
    expect(toDateOnly('2026-09-12')).toBe('2026-09-12');
    expect(toDateOnly('2026-09-12T00:30:00Z')).toBe('2026-09-12');
    expect(toDateOnly('2026-09-12T23:59:59+01:00')).toBe('2026-09-12');
    // Objet Date → composantes locales.
    expect(toDateOnly(new Date(2026, 8, 12, 23, 59))).toBe('2026-09-12');
    // Entrées invalides → null.
    expect(toDateOnly(null)).toBeNull();
    expect(toDateOnly('')).toBeNull();
  });

  it('parseDateOnly rend MINUIT LOCAL (jamais un instant UTC)', () => {
    const d = parseDateOnly('2026-09-12');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(8);
    expect(d!.getDate()).toBe(12);
    expect(d!.getHours()).toBe(0);
    expect(parseDateOnly('pas-une-date')).toBeNull();
  });

  it('formatDateOnly affiche le calendrier sans décalage (jj/mm/aaaa)', () => {
    expect(formatDateOnly('2026-09-12')).toBe('12/09/2026');
    expect(formatDateOnly('2026-01-05')).toBe('05/01/2026');
    expect(formatDateOnly(null)).toBe('—');
  });

  it('compareDateOnly compare des calendriers (ordre lexicographique)', () => {
    expect(compareDateOnly('2026-09-12', '2026-09-12')).toBe(0);
    expect(compareDateOnly('2026-09-05', '2026-09-12')).toBeLessThan(0);
    expect(compareDateOnly('2026-10-01', '2026-09-30')).toBeGreaterThan(0);
  });
});

describe('§Phase 2.1 — L’échéance ne peut pas précéder la facture', () => {
  it('due_date >= invoice_date est accepté', () => {
    expect(isValidDueDate('2026-09-12', '2026-09-12')).toBe(true);
    expect(isValidDueDate('2026-09-12', '2026-09-15')).toBe(true);
    expect(isValidDueDate('2026-09-12', '2027-01-01')).toBe(true);
  });

  it('due_date < invoice_date est REJETÉ (exemple du cahier des charges)', () => {
    // facture 12/09/2026, échéance 05/09/2026 → refusé
    expect(isValidDueDate('2026-09-12', '2026-09-05')).toBe(false);
    expect(DUE_DATE_BEFORE_INVOICE_MESSAGE).toBe(
      "La date d'échéance ne peut pas être antérieure à la date de facture.",
    );
  });

  it('l’absence d’échéance ou de date de facture ne bloque rien', () => {
    expect(isValidDueDate('2026-09-12', null)).toBe(true);
    expect(isValidDueDate(null, '2026-09-15')).toBe(true);
    expect(isValidDueDate(null, null)).toBe(true);
  });
});
