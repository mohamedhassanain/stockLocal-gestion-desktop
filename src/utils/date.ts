/**
 * Retourne la date LOCALE au format YYYY-MM-DD (sans décalage timezone).
 *
 * Pourquoi : `new Date().toISOString().split('T')[0]` renvoie la date en **UTC**.
 * Dans un fuseau à offset positif (ex. Maroc UTC+1), entre minuit et 01h00
 * locales, cela produit la **veille** → une facture créée à 00h30 locale
 * serait datée du jour précédent (off-by-one).
 *
 * Cette fonction utilise les composantes LOCALES de la date, donc la valeur
 * correspond toujours à la date affichée par l'horloge de l'utilisateur.
 */
export function toLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
