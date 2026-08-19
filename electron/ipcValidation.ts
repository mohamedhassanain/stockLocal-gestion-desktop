/**
 * Validation utilities for IPC handlers (§32, §33 - Sécurité)
 * All string/number params must be validated before use.
 * Path traversal protection: no ../ in paths, restrict to data folder.
 */

import path from 'node:path';
import fs from 'node:fs';

// ─── String Validation ────────────────────────────────────────────────────────

export function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Paramètre invalide : "${fieldName}" est requis et doit être une chaîne non vide.`);
  }
  return value.trim();
}

export function requireId(value: unknown, fieldName: string): string {
  const str = requireString(value, fieldName);
  if (!/^[a-zA-Z0-9\-]{1,64}$/.test(str)) {
    throw new Error(`Paramètre invalide : "${fieldName}" contient des caractères non autorisés.`);
  }
  return str;
}

export function requirePositiveNumber(value: unknown, fieldName: string): number {
  const num = Number(value);
  if (isNaN(num) || num < 0) {
    throw new Error(`Paramètre invalide : "${fieldName}" doit être un nombre positif.`);
  }
  return num;
}

export function requireStrictPositiveNumber(value: unknown, fieldName: string): number {
  const num = Number(value);
  if (isNaN(num) || num <= 0) {
    throw new Error(`Paramètre invalide : "${fieldName}" doit être un nombre supérieur à 0.`);
  }
  return num;
}

export function optionalString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`Paramètre invalide : "${fieldName}" doit être une chaîne.`);
  }
  return value.trim();
}

// ─── Path Validation (§33) ───────────────────────────────────────────────────

const DANGEROUS_PATH_CHARS = /[<>"|?*\x00-\x1f]/;

export function hasPathTraversal(filePath: string): boolean {
  return filePath.includes('..') || filePath.includes('~');
}

export function validateFilePath(filePath: string, fieldName: string): string {
  requireString(filePath, fieldName);
  if (hasPathTraversal(filePath)) {
    throw new Error(`Chemin invalide : "${fieldName}" contient une séquence de traversal (..).`);
  }
  if (DANGEROUS_PATH_CHARS.test(filePath)) {
    throw new Error(`Chemin invalide : "${fieldName}" contient des caractères non autorisés.`);
  }
  try {
    return path.resolve(filePath);
  } catch {
    throw new Error(`Chemin invalide : "${fieldName}" ne peut pas être résolu.`);
  }
}

export function validatePathWithinDataDir(filePath: string, dataDir: string, fieldName: string): string {
  const resolved = validateFilePath(filePath, fieldName);
  const resolvedDataDir = path.resolve(dataDir);
  if (!resolved.startsWith(resolvedDataDir + path.sep) && resolved !== resolvedDataDir) {
    throw new Error(`Accès refusé : "${fieldName}" est en dehors du dossier de données autorisé.`);
  }
  return resolved;
}

export function validateFileExists(filePath: string, fieldName: string): void {
  const resolved = validateFilePath(filePath, fieldName);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Fichier introuvable : "${fieldName}" (${resolved}).`);
  }
  try {
    fs.accessSync(resolved, fs.constants.R_OK);
  } catch {
    throw new Error(`Accès refusé : "${fieldName}" n'est pas lisible.`);
  }
}

// ─── Object Validation ────────────────────────────────────────────────────────

export function requireObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Paramètre invalide : "${fieldName}" doit être un objet.`);
  }
  return value as Record<string, unknown>;
}

export function requireArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Paramètre invalide : "${fieldName}" doit être un tableau.`);
  }
  return value;
}

// ─── Sanitization ─────────────────────────────────────────────────────────────

export function sanitizeString(value: string): string {
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
}

export function sanitizeNote(value: unknown): string | null {
  if (!value || typeof value !== 'string') return null;
  return sanitizeString(value).substring(0, 500) || null;
}

// ─── Human Error Messages (§31) ──────────────────────────────────────────────

const HUMAN_ERROR_MAP: Record<string, string> = {
  'UNIQUE constraint failed': 'Un élément avec ce nom/référence existe déjà.',
  'FOREIGN KEY constraint failed': 'Impossible : cet élément est utilisé par un autre enregistrement.',
  'NOT NULL constraint failed': 'Un champ obligatoire est manquant.',
  'CHECK constraint failed': 'La valeur saisie ne respecte pas les règles de validation.',
  'database disk image is malformed': 'La base de données est corrompue. Essayez de restaurer une sauvegarde.',
  'attempt to write a readonly database': 'La base de données est en lecture seule. Vérifiez les permissions.',
  'no such table': 'Erreur interne : une table est manquante dans la base de données.',
  'no such column': 'Erreur interne : une colonne est manquante dans la base de données.',
  ' SQLITE_CONSTRAINT': 'Une contrainte de la base de données a été violée.',
};

/**
 * Converts SQLite/technical errors to human-friendly French messages (§31).
 */
export function toHumanError(error: unknown): string {
  if (!error) return 'Une erreur inconnue est survenue.';
  const msg = String((error as any)?.message ?? error);
  
  for (const [pattern, human] of Object.entries(HUMAN_ERROR_MAP)) {
    if (msg.includes(pattern)) return human;
  }
  
  // If it's already a French error from our services, return as-is
  if (msg.includes('invalide') || msg.includes('introuvable') || msg.includes('impossible') ||
      msg.includes('manquant') || msg.includes('obligatoire') || msg.includes('supérieur')) {
    return msg;
  }
  
  // Generic fallback
  return `Erreur : ${msg.substring(0, 200)}`;
}
