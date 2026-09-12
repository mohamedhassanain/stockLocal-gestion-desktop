import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card } from '../ui';
import { toast } from '../../stores/useToastStore';
import { toLocalDateString } from '../../utils/date';
import type { ProfitSummary } from '../../services/ProfitService';

/**
 * §Phase 12 / §Phase 18 — Marge brute et résultat estimé, par période.
 *
 * Aucun calcul financier ici : tout vient de `ProfitService` via IPC
 * (source de vérité unique). Ce composant ne fait que présenter.
 *
 * Vocabulaire strict : on parle de « Marge brute » et de « Résultat estimé »,
 * JAMAIS de « bénéfice net » (l'application ne tient pas de comptabilité
 * complète : amortissements et charges non saisies ne sont pas couverts).
 */

type Period = 'today' | 'week' | 'month' | 'year';

const PERIOD_LABELS: Record<Period, string> = {
  today: "Aujourd'hui",
  week: 'Cette semaine',
  month: 'Ce mois',
  year: 'Cette année',
};

/** Bornes [from, to] en dates LOCALES (aucun décalage de fuseau). */
function periodBounds(period: Period): { from: string; to: string } {
  const now = new Date();
  const to = toLocalDateString(now);
  let start: Date;

  if (period === 'today') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (period === 'week') {
    // Semaine ISO : lundi → aujourd'hui.
    const dayIndex = (now.getDay() + 6) % 7; // 0 = lundi
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayIndex);
  } else if (period === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    start = new Date(now.getFullYear(), 0, 1);
  }

  return { from: toLocalDateString(start), to };
}

function money(value: number): string {
  return `${Number(value ?? 0).toFixed(2)} MAD`;
}

export const ProfitSummaryPanel: React.FC = () => {
  const [period, setPeriod] = useState<Period>('month');
  const [summary, setSummary] = useState<ProfitSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const bounds = useMemo(() => periodBounds(period), [period]);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await window.api.profit.getSummary(bounds.from, bounds.to) as
        { success?: boolean; data?: ProfitSummary; error?: string } | ProfitSummary;
      const payload = result as { success?: boolean; data?: ProfitSummary; error?: string };
      if (payload && payload.success === false) {
        toast.error(payload.error ?? 'Synthèse financière indisponible.');
        setSummary(null);
      } else {
        setSummary((payload.data ?? (result as ProfitSummary)) ?? null);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Synthèse financière indisponible.');
      setSummary(null);
    } finally {
      setIsLoading(false);
    }
  }, [bounds.from, bounds.to]);

  useEffect(() => { void load(); }, [load]);

  const marginTone = (value: number): string => (value < 0 ? 'var(--danger)' : 'var(--success)');

  return (
    <Card padding className="mb-4">
      <div className="flex items-center justify-between" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 className="section-title" style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>
          Marge brute & résultat estimé
        </h2>
        <div className="flex gap-2">
          {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
            <Button
              key={p}
              size="sm"
              variant={period === p ? 'primary' : 'secondary'}
              onClick={() => setPeriod(p)}
            >
              {PERIOD_LABELS[p]}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="state-text" style={{ padding: 16 }}>Calcul en cours…</div>
      ) : !summary ? (
        <div className="text-muted text-center" style={{ padding: 16 }}>Aucune donnée sur la période.</div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="card card-body-compact">
              <div className="text-xs text-muted">CA TTC</div>
              <div className="money font-semibold">{money(summary.revenueInclTax)}</div>
              <div className="text-xs text-muted">{summary.salesCount} vente(s)</div>
            </div>
            <div className="card card-body-compact">
              <div className="text-xs text-muted">CA hors taxes</div>
              <div className="money font-semibold">{money(summary.revenueExclTax)}</div>
            </div>
            <div className="card card-body-compact">
              <div className="text-xs text-muted">Coût des marchandises</div>
              <div className="money font-semibold">{money(summary.costOfGoods)}</div>
            </div>
            <div className="card card-body-compact">
              <div className="text-xs text-muted">Marge brute</div>
              <div className="money font-semibold" style={{ color: marginTone(summary.grossMargin) }}>
                {money(summary.grossMargin)}
              </div>
              <div className="text-xs text-muted">Taux : {summary.marginRate.toFixed(1)} %</div>
            </div>
            <div className="card card-body-compact">
              <div className="text-xs text-muted">Dépenses</div>
              <div className="money font-semibold">−{money(summary.expenses)}</div>
            </div>
            <div className="card card-body-compact">
              <div className="text-xs text-muted">Résultat estimé</div>
              <div className="money font-semibold" style={{ color: marginTone(summary.estimatedResult) }}>
                {money(summary.estimatedResult)}
              </div>
            </div>
          </div>
          <p className="text-xs text-muted" style={{ marginTop: 10, marginBottom: 0 }}>
            Résultat <strong>estimé</strong> = marge brute − dépenses enregistrées. Ce n'est pas un
            bénéfice net : amortissements et charges non saisies ne sont pas pris en compte.
          </p>
        </>
      )}
    </Card>
  );
};
