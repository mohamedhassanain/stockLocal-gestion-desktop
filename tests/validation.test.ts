import { describe, it, expect } from 'vitest';
import {
  requireString,
  requireId,
  requirePositiveNumber,
  requireStrictPositiveNumber,
  optionalString,
  hasPathTraversal,
  validateFilePath,
  toHumanError,
  sanitizeNote,
} from '../electron/ipcValidation';

describe('IPC Validation (§32, §33)', () => {
  describe('requireString', () => {
    it('returns trimmed string for valid input', () => {
      expect(requireString('hello', 'test')).toBe('hello');
      expect(requireString('  spaces  ', 'test')).toBe('spaces');
    });

    it('throws for empty string', () => {
      expect(() => requireString('', 'test')).toThrow('test');
    });

    it('throws for non-string', () => {
      expect(() => requireString(123, 'test')).toThrow('test');
      expect(() => requireString(null, 'test')).toThrow('test');
      expect(() => requireString(undefined, 'test')).toThrow('test');
    });
  });

  describe('requireId', () => {
    it('returns valid UUID-like strings', () => {
      expect(requireId('abc-123', 'id')).toBe('abc-123');
      expect(requireId('550e8400-e29b-41d4-a716-446655440000', 'id')).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('throws for dangerous characters', () => {
      expect(() => requireId('../etc/passwd', 'id')).toThrow();
      expect(() => requireId('id; DROP TABLE', 'id')).toThrow();
      expect(() => requireId('', 'id')).toThrow();
    });
  });

  describe('requirePositiveNumber', () => {
    it('accepts 0 and positive numbers', () => {
      expect(requirePositiveNumber(0, 'qty')).toBe(0);
      expect(requirePositiveNumber(10, 'qty')).toBe(10);
      expect(requirePositiveNumber('5.5', 'qty')).toBe(5.5);
    });

    it('throws for negative numbers', () => {
      expect(() => requirePositiveNumber(-1, 'qty')).toThrow();
      expect(() => requirePositiveNumber(NaN, 'qty')).toThrow();
    });
  });

  describe('requireStrictPositiveNumber', () => {
    it('accepts positive numbers', () => {
      expect(requireStrictPositiveNumber(1, 'qty')).toBe(1);
      expect(requireStrictPositiveNumber(100, 'qty')).toBe(100);
    });

    it('throws for 0 and negative', () => {
      expect(() => requireStrictPositiveNumber(0, 'qty')).toThrow();
      expect(() => requireStrictPositiveNumber(-5, 'qty')).toThrow();
    });
  });

  describe('optionalString', () => {
    it('returns null for empty/null/undefined', () => {
      expect(optionalString('', 'test')).toBeNull();
      expect(optionalString(null, 'test')).toBeNull();
      expect(optionalString(undefined, 'test')).toBeNull();
    });

    it('returns trimmed string for valid input', () => {
      expect(optionalString('hello', 'test')).toBe('hello');
    });
  });

  describe('hasPathTraversal', () => {
    it('detects path traversal', () => {
      expect(hasPathTraversal('../etc/passwd')).toBe(true);
      expect(hasPathTraversal('~/file')).toBe(true);
      expect(hasPathTraversal('normal/file.txt')).toBe(false);
    });
  });

  describe('validateFilePath', () => {
    it('returns resolved path for valid input', () => {
      const result = validateFilePath('test/file.txt', 'test');
      expect(result).toContain('test');
    });

    it('throws for traversal sequences', () => {
      expect(() => validateFilePath('../secret', 'test')).toThrow();
    });
  });

  describe('toHumanError', () => {
    it('converts UNIQUE constraint errors', () => {
      const msg = toHumanError(new Error('UNIQUE constraint failed: products.reference'));
      expect(msg).toContain('existe déjà');
    });

    it('converts FOREIGN KEY errors', () => {
      const msg = toHumanError(new Error('FOREIGN KEY constraint failed'));
      expect(msg).toContain('utilisé par un autre');
    });

    it('passes through French errors', () => {
      const msg = toHumanError(new Error('Le nom est obligatoire.'));
      expect(msg).toBe('Le nom est obligatoire.');
    });

    it('handles unknown errors', () => {
      const msg = toHumanError(new Error('some random error'));
      expect(msg).toContain('Erreur');
    });
  });

  describe('sanitizeNote', () => {
    it('returns null for falsy values', () => {
      expect(sanitizeNote(null)).toBeNull();
      expect(sanitizeNote('')).toBeNull();
    });

    it('truncates long notes', () => {
      const longNote = 'a'.repeat(1000);
      const result = sanitizeNote(longNote);
      expect(result?.length).toBeLessThanOrEqual(500);
    });
  });
});
