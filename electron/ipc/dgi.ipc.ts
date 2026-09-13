import { ipcMain } from 'electron';
import { requireId, toHumanError } from '../ipcValidation';
import { DgiComplianceService } from '../../src/compliance/dgi/DgiComplianceService';

/**
 * ─── Handlers IPC — Conformité fiscale DGI (Maroc) ────────────────────────────
 *
 * ⚠️  À BRANCHER QUAND LES SPÉCIFICATIONS OFFICIELLES SERONT PUBLIÉES.
 *
 * Ces handlers sont en LECTURE SEULE : ils exposent l'état du module (activé ou
 * non, intégration branchée ou non) et un APERÇU de la représentation UBL 2.1
 * d'un document existant. Ils ne soumettent JAMAIS rien à une quelconque API —
 * la soumission réelle passera par `DgiComplianceService.submitDocument`, qui
 * échoue honnêtement tant que l'intégration n'est pas branchée.
 */
export function registerDgiHandlers(): void {
  ipcMain.handle('dgi:getModuleState', async () => {
    try {
      return { success: true, state: DgiComplianceService.getModuleState() };
    } catch (error: unknown) {
      return { success: false, error: toHumanError(error) };
    }
  });

  ipcMain.handle('dgi:previewUbl', async (_, documentId: unknown) => {
    try {
      const safeId = requireId(documentId, 'id document');
      const xml = DgiComplianceService.buildUblForDocument(safeId);
      return { success: true, xml };
    } catch (error: unknown) {
      return { success: false, error: toHumanError(error) };
    }
  });
}
