/**
 * Formate une valeur d'axe Y d'un graphique en adaptant le nombre de décimales
 * à l'échelle réelle (scaleMax), afin que les paliers (0, 0.25, 0.5, 0.75, 1
 * × scaleMax) restent visuellement DISTINCTS.
 *
 * Sans cet ajustement, `.toFixed(0)` produisait des libellés dupliqués (« 1 »,
 * « 1 », « 1 ») dès que scaleMax est petit (ex. quelques MAD) — bug confirmé
 * quand toutes les valeurs de la période sont à 0 (scaleMax forcé à 1).
 */
export function formatAxisValue(value: number, scaleMax: number): string {
  if (scaleMax >= 1000) {
    return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : value.toFixed(0);
  }
  const step = scaleMax * 0.25;
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return value.toFixed(decimals);
}
