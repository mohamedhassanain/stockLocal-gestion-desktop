import { Notification, BrowserWindow } from 'electron';
import { GlobalSettingsService } from '../src/services/GlobalSettingsService';
import { DashboardRepository } from '../src/repositories/DashboardRepository';
import { ProductBatchRepository } from '../src/repositories/ProductBatchRepository';

/**
 * §Notifications système desktop.
 *
 * Informe l'utilisateur HORS de l'application (notification native Windows /
 * macOS / Linux) de ce qui demande une action : échéances clients proches,
 * lots bientôt périmés, factures en retard, produits sous le seuil de stock.
 *
 * RÈGLES :
 *  - Entièrement piloté par les paramètres (`desktop_notifications_enabled`,
 *    `desktop_notification_due_days`, `desktop_notification_expiry_days`) :
 *    désactivé, le module ne fait STRICTEMENT rien.
 *  - Une SEULE notification agrégée par passage (jamais une par alerte) :
 *    l'utilisateur n'est pas noyé sous les bulles au démarrage.
 *  - Les données proviennent des méthodes de repository DÉJÀ utilisées par les
 *    écrans (aucun calcul parallèle, aucun risque de divergence).
 *  - Un échec (notification non supportée, base fermée…) est journalisé et
 *    n'interrompt JAMAIS le fonctionnement de l'application.
 */

/** Intervalle entre deux vérifications (6 heures). */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Délai après le démarrage : laisse le temps au seed et à l'UI de s'initialiser. */
const STARTUP_DELAY_MS = 12_000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;

function notificationsSupported(): boolean {
  try {
    return Notification.isSupported();
  } catch {
    return false;
  }
}

/** Ramène la fenêtre principale au premier plan (clic sur la notification). */
function focusMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Affiche une notification native agrégée. */
function showNotification(body: string): void {
  const notification = new Notification({
    title: 'StockLocal — points à vérifier',
    body,
  });
  notification.on('click', focusMainWindow);
  notification.show();
}

/**
 * Construit et affiche (si nécessaire) la notification agrégée.
 * LECTURE SEULE : aucune écriture en base.
 */
export function runDesktopNotificationCheck(): void {
  try {
    const settings = GlobalSettingsService.getAll();
    if (!settings.desktop_notifications_enabled) return;
    if (!notificationsSupported()) return;

    const lines: string[] = [];

    const dueDays = settings.desktop_notification_due_days;
    const dueCount = DashboardRepository.getUpcomingDues(dueDays).length;
    if (dueCount > 0) {
      lines.push(`• ${dueCount} échéance(s) client dans ${dueDays} jour(s)`);
    }

    const expiryDays = settings.desktop_notification_expiry_days;
    const expiringCount = ProductBatchRepository.getExpiringBatches(expiryDays).length;
    if (expiringCount > 0) {
      lines.push(`• ${expiringCount} lot(s) dont la péremption approche (${expiryDays} jour(s))`);
    }

    const alerts = DashboardRepository.getAlertSummary();
    if (alerts.overdue_count > 0) {
      lines.push(`• ${alerts.overdue_count} facture(s) en retard de paiement`);
    }
    if (alerts.low_stock_count > 0) {
      lines.push(`• ${alerts.low_stock_count} produit(s) sous le seuil de stock`);
    }

    if (lines.length === 0) return;
    showNotification(lines.join('\n'));
  } catch (error) {
    // Une notification ne doit jamais empêcher l'application de fonctionner.
    console.warn('[Notifications] Vérification ignorée :', error);
  }
}

/**
 * Démarre la vérification périodique (idempotent : un seul planificateur).
 * À appeler dans `app.whenReady()`, après la création de la fenêtre.
 */
export function scheduleDesktopNotifications(): void {
  if (intervalHandle) return;
  const startupTimer = setTimeout(runDesktopNotificationCheck, STARTUP_DELAY_MS);
  // `unref` : ces minuteurs ne maintiennent pas le processus en vie.
  startupTimer.unref?.();
  intervalHandle = setInterval(runDesktopNotificationCheck, CHECK_INTERVAL_MS);
  intervalHandle.unref?.();
}
