import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

/**
 * Isolate les tests : chaque suite de tests utilise un dossier de données
 * temporaire distinct, évitant toute collision avec les données réelles
 * ou entre fichiers de test.
 */
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stocklocal-tests-'));

// Doit être défini AVANT l'import des modules du projet (ESM = imports évalués
// avant les hooks) pour que DataStorageService/connection.ts pointent vers le
// dossier temporaire dès leur chargement.
process.env.STOCKLOCAL_TEST_DATA_PATH = testRoot;
fs.mkdirSync(path.join(testRoot, 'data'), { recursive: true });

afterAll(() => {
  try {
    fs.rmSync(testRoot, { recursive: true, force: true });
  } catch {
    // Windows peut verrouiller le fichier DB encore ouvert
  }
});
