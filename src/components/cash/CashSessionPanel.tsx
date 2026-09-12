import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, Select, Modal, ModalBody, ModalFooter, ModalHeader } from '../ui';
import { toast } from '../../stores/useToastStore';
import type { CashSession, CashSessionDetail, CashMethod } from '../../repositories/CashSessionRepository';
import {
  DEFAULT_CASH_MOVEMENT_TYPES,
  normalizeCashMovementTypes,
  cashMovementTypeLabel,
  cashMovementDirection,
  type CashMovementTypeDef,
} from '../../domain/cash/cashMovementTypes';

/**
 * §Phase 10 — Caisse : ouverture (fond initial), mouvements, fermeture
 * (solde théorique / solde compté / écart).
 *
 * Tous les montants et l'écart sont calculés par `CashSessionRepository` via
 * IPC : ce composant n'effectue aucun calcul de solde lui-même.
 */

const METHOD_LABELS: Record<CashMethod, string> = {
  CASH: 'Espèces',
  CHECK: 'Chèque',
  TRANSFER: 'Virement',
};

function money(value: number): string {
  return `${Number(value ?? 0).toFixed(2)} MAD`;
}

export const CashSessionPanel: React.FC = () => {
  const [openSession, setOpenSession] = useState<CashSession | null>(null);
  const [detail, setDetail] = useState<CashSessionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Formulaire d'ouverture
  const [openingFloat, setOpeningFloat] = useState(0);
  const [openNotes, setOpenNotes] = useState('');

  // Formulaire de mouvement — les types proviennent des Paramètres (définis par l'utilisateur).
  const [movementTypes, setMovementTypes] = useState<CashMovementTypeDef[]>(() => [...DEFAULT_CASH_MOVEMENT_TYPES]);
  const [movementType, setMovementType] = useState<string>('Entrée manuelle');
  const [movementAmount, setMovementAmount] = useState(0);
  const [movementMethod, setMovementMethod] = useState<CashMethod>('CASH');
  const [movementDesc, setMovementDesc] = useState('');

  // Fermeture
  const [closeOpen, setCloseOpen] = useState(false);
  const [countedAmount, setCountedAmount] = useState(0);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const session = (await window.api.cash.getOpenSession()) as CashSession | null;
      setOpenSession(session ?? null);
      if (session) {
        const d = (await window.api.cash.getSessionDetail(session.id)) as
          | { success: boolean; data?: CashSessionDetail; error?: string }
          | CashSessionDetail;
        const payload = d as { success?: boolean; data?: CashSessionDetail; error?: string };
        if (payload.success === false) {
          toast.error(payload.error ?? 'Impossible de charger la session de caisse.');
          setDetail(null);
        } else {
          setDetail((payload.data ?? (d as CashSessionDetail)) ?? null);
        }
      } else {
        setDetail(null);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erreur de chargement de la caisse.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Types de mouvement définis par l'utilisateur dans Paramètres → menu « Type ».
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await window.api.globalSettings.get() as { cash_movement_types?: unknown } | null;
        const loaded = normalizeCashMovementTypes(settings?.cash_movement_types);
        const list = loaded.length > 0 ? loaded : [...DEFAULT_CASH_MOVEMENT_TYPES];
        if (cancelled) return;
        setMovementTypes(list);
        setMovementType(prev => (list.some(t => t.label === prev) ? prev : list[0].label));
      } catch {
        // Réglages indisponibles : on conserve les types par défaut.
        if (!cancelled) setMovementTypes([...DEFAULT_CASH_MOVEMENT_TYPES]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleOpen = async () => {
    try {
      const result = await window.api.cash.open(openingFloat, openNotes) as { success: boolean; error?: string };
      if (!result.success) { toast.error(result.error ?? 'Ouverture impossible.'); return; }
      toast.success('Caisse ouverte.');
      setOpenNotes('');
      setOpeningFloat(0);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Ouverture impossible.');
    }
  };

  const handleAddMovement = async () => {
    try {
      const direction = cashMovementDirection(movementTypes, movementType);
      const result = await window.api.cash.addMovement({
        movementType,
        direction,
        amount: movementAmount,
        paymentMethod: movementMethod,
        description: movementDesc || undefined,
      }) as { success: boolean; error?: string };
      if (!result.success) { toast.error(result.error ?? 'Mouvement refusé.'); return; }
      toast.success('Mouvement enregistré.');
      setMovementAmount(0);
      setMovementDesc('');
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Mouvement refusé.');
    }
  };

  const handleClose = async () => {
    if (!openSession) return;
    try {
      const result = await window.api.cash.close(openSession.id, countedAmount) as
        { success: boolean; data?: CashSession; error?: string };
      if (!result.success) { toast.error(result.error ?? 'Fermeture impossible.'); return; }
      const closed = result.data;
      toast.success(closed
        ? `Caisse fermée — écart ${money(closed.difference ?? 0)}`
        : 'Caisse fermée.');
      setCloseOpen(false);
      setCountedAmount(0);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Fermeture impossible.');
    }
  };

  if (isLoading) {
    return <div className="state-text" style={{ padding: 16 }}>Chargement de la caisse…</div>;
  }

  // ─── Caisse fermée : formulaire d'ouverture ────────────────────────────────
  if (!openSession) {
    return (
      <Card padding style={{ maxWidth: 560 }}>
        <h2 className="section-title" style={{ margin: '0 0 12px', fontSize: 'var(--font-size-lg)' }}>
          Ouverture de caisse
        </h2>
        <p className="text-sm text-secondary" style={{ marginTop: 0 }}>
          Aucune caisse n'est ouverte. Saisissez le fond de caisse initial (espèces présentes
          dans le tiroir) pour démarrer la journée.
        </p>
        <Input
          label="Fond de caisse initial (MAD)"
          type="number"
          min={0}
          step={0.01}
          value={openingFloat || ''}
          onChange={e => setOpeningFloat(Number(e.target.value))}
          className="money"
        />
        <Input
          label="Note (optionnel)"
          value={openNotes}
          onChange={e => setOpenNotes(e.target.value)}
          placeholder="Ex : ouverture du matin"
        />
        <Button variant="success" onClick={handleOpen} className="mt-3">
          Ouvrir la caisse
        </Button>
      </Card>
    );
  }

  const theoretical = detail?.theoreticalAmount ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── État de la caisse ── */}
      <div className="grid-3" style={{ gap: 10 }}>
        <div className="card card-body-compact">
          <div className="text-xs text-muted">Fond initial</div>
          <div className="money font-semibold">{money(openSession.opening_float)}</div>
        </div>
        <div className="card card-body-compact">
          <div className="text-xs text-muted">Solde théorique</div>
          <div className="money font-semibold" style={{ color: 'var(--success)' }}>{money(theoretical)}</div>
        </div>
        <div className="card card-body-compact">
          <div className="text-xs text-muted">Entrées / Sorties espèces</div>
          <div className="money font-semibold">
            +{money(detail?.totalCashIn ?? 0)} / −{money(detail?.totalCashOut ?? 0)}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="badge badge-success">Caisse ouverte depuis {String(openSession.opened_at).replace('T', ' ').slice(0, 16)}</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={load}>Actualiser</Button>
          <Button variant="danger" size="sm" onClick={() => { setCountedAmount(theoretical); setCloseOpen(true); }}>
            Fermer la caisse
          </Button>
        </div>
      </div>

      {/* ── Nouveau mouvement ── */}
      <Card padding>
        <h3 className="section-title" style={{ margin: '0 0 12px', fontSize: 'var(--font-size-md)' }}>
          Nouveau mouvement
        </h3>
        <div className="grid-4" style={{ gap: 8, alignItems: 'end' }}>
          <Select
            label="Type"
            value={movementType}
            onChange={e => setMovementType(e.target.value)}
          >
            {movementTypes.map(t => (
              <option key={t.label} value={t.label}>{t.label}</option>
            ))}
          </Select>
          <Input
            label="Montant (MAD)"
            type="number"
            min={0}
            step={0.01}
            value={movementAmount || ''}
            onChange={e => setMovementAmount(Number(e.target.value))}
            className="money"
          />
          <Select
            label="Mode"
            value={movementMethod}
            onChange={e => setMovementMethod(e.target.value as CashMethod)}
          >
            {(Object.keys(METHOD_LABELS) as CashMethod[]).map(m => (
              <option key={m} value={m}>{METHOD_LABELS[m]}</option>
            ))}
          </Select>
          <Input
            label="Description"
            value={movementDesc}
            onChange={e => setMovementDesc(e.target.value)}
            placeholder="Optionnel"
          />
        </div>
        <div className="text-xs text-muted" style={{ marginTop: 6 }}>
          Sens : <strong>{cashMovementDirection(movementTypes, movementType) === 'IN' ? 'Entrée' : 'Sortie'}</strong>
          {movementMethod !== 'CASH' && ' · les mouvements chèque/virement n\'affectent pas le tiroir'}
        </div>
        <Button variant="primary" onClick={handleAddMovement} className="mt-3" disabled={!(movementAmount > 0)}>
          Enregistrer le mouvement
        </Button>
      </Card>

      {/* ── Historique des mouvements ── */}
      <Card padding>
        <h3 className="section-title" style={{ margin: '0 0 12px', fontSize: 'var(--font-size-md)' }}>
          Mouvements de la session
        </h3>
        {(detail?.movements.length ?? 0) === 0 ? (
          <div className="text-muted text-center" style={{ padding: 16 }}>Aucun mouvement pour l'instant.</div>
        ) : (
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Heure</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Mode</th>
                  <th style={{ textAlign: 'right' }}>Montant</th>
                </tr>
              </thead>
              <tbody>
                {detail?.movements.map(m => (
                  <tr key={m.id}>
                    <td className="text-sm">{String(m.date).replace('T', ' ').slice(0, 16)}</td>
                    <td className="text-sm font-semibold">{cashMovementTypeLabel(m.movement_type)}</td>
                    <td className="text-sm text-muted">{m.description ?? '—'}</td>
                    <td className="text-sm">{METHOD_LABELS[m.payment_method] ?? m.payment_method}</td>
                    <td className="money text-right" style={{ color: m.direction === 'IN' ? 'var(--success)' : 'var(--danger)' }}>
                      {m.direction === 'IN' ? '+' : '−'}{Number(m.amount).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Fermeture de caisse ── */}
      <Modal open={closeOpen} onClose={() => setCloseOpen(false)} width={480}>
        <ModalHeader title="Fermeture de caisse" />
        <ModalBody>
          <div className="flex justify-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <span className="text-sm text-secondary">Solde théorique</span>
            <span className="money font-semibold">{money(theoretical)}</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <Input
              label="Solde compté (MAD)"
              type="number"
              min={0}
              step={0.01}
              value={countedAmount === 0 ? '' : countedAmount}
              onChange={e => setCountedAmount(Number(e.target.value))}
              className="money"
              autoFocus
            />
          </div>
          <div
            className="flex justify-between font-semibold"
            style={{
              marginTop: 10, padding: '10px 0', borderTop: '2px solid var(--text)',
              color: Math.abs(countedAmount - theoretical) > 0.001 ? 'var(--danger)' : 'var(--success)',
            }}
          >
            <span>Écart</span>
            <span className="money">{money(countedAmount - theoretical)}</span>
          </div>
          <p className="text-xs text-muted" style={{ marginTop: 8 }}>
            La confirmation enregistre définitivement le solde théorique et l'écart :
            ces valeurs ne seront plus recalculées.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setCloseOpen(false)}>Annuler</Button>
          <Button variant="danger" onClick={handleClose}>Confirmer la fermeture</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
};
