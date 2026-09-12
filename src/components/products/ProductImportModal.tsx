import React, { useState } from 'react';
import { Button, Modal, ModalHeader, ModalBody, ModalFooter, Input } from '../ui';
import { toast } from '../../stores/useToastStore';
import type { ImportDuplicateStrategy } from '../../../electron/preload';

/**
 * §Phase 17 — Import CSV produits avec APERÇU OBLIGATOIRE.
 *
 * Aucune écriture n'a lieu avant que l'utilisateur ait :
 *   1. vu le décompte (lignes valides / doublons / invalides) ;
 *   2. choisi explicitement la stratégie de doublons
 *      (Créer / Mettre à jour / Ignorer).
 *
 * L'aperçu est calculé côté MAIN (lecture seule). Le statut « doublon » est
 * recalculé côté main au moment de la confirmation : la base reste la seule
 * source de vérité, le renderer ne peut pas le forcer.
 */

/** Une ligne valide de l'aperçu tel que renvoyé par le main. */
interface PreviewRow {
  product: { reference: string; designation: string };
  isDuplicate: boolean;
}

interface PreviewData {
  rows: PreviewRow[];
  errors: { row: number; message: string }[];
  headers: string[];
  summary: { total: number; valid: number; duplicates: number; invalid: number };
}

interface ImportOutcomeData {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  messages: string[];
}

interface ProductImportModalProps {
  onClose: () => void;
  /** Appelé après un import réussi (pour rafraîchir la liste des produits). */
  onImported?: () => void;
}

const STRATEGIES: Array<{ id: ImportDuplicateStrategy; label: string; hint: string }> = [
  { id: 'CREATE', label: 'Créer', hint: 'Les références existantes sont signalées en erreur.' },
  { id: 'UPDATE', label: 'Mettre à jour', hint: 'Le produit existant (même référence) est modifié.' },
  { id: 'SKIP', label: 'Ignorer', hint: 'Les références existantes sont laissées intactes.' },
];

export const ProductImportModal: React.FC<ProductImportModalProps> = ({ onClose, onImported }) => {
  const [filePath, setFilePath] = useState('');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [strategy, setStrategy] = useState<ImportDuplicateStrategy>('CREATE');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcomeData | null>(null);

  const pickFile = async () => {
    const result = await window.api.products.pickCsv();
    if (result?.canceled || !result?.path) return;
    setFilePath(result.path);
    setPreview(null);
    setOutcome(null);
  };

  /** Analyse le fichier SANS rien écrire. */
  const analyse = async () => {
    const path = filePath.trim();
    if (!path) { toast.warning('Sélectionnez un fichier CSV.'); return; }
    setBusy(true);
    try {
      const result = await window.api.products.previewImportCsv(path);
      if (!result.success) { toast.error(result.error ?? 'Analyse impossible.'); return; }
      setPreview(result.data as PreviewData);
      setOutcome(null);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Analyse impossible.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await window.api.products.confirmImport(
        preview.rows.map(r => r.product as never),
        strategy,
      );
      if (!result.success) { toast.error(result.error ?? 'Import impossible.'); return; }
      const data = result.data as ImportOutcomeData;
      setOutcome(data);
      toast.success(
        `Import terminé : ${data.created} créés, ${data.updated} mis à jour, ${data.skipped} ignorés, ${data.errors} erreurs.`,
      );
      onImported?.();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Import impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} width={720}>
      <ModalHeader
        icon="📥"
        title="Importer des produits (CSV)"
        subtitle="Colonnes : reference;designation;purchase_price;selling_price;wholesale_price;min_stock;barcode;unit"
      />
      <ModalBody>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Input
              label="Fichier CSV"
              value={filePath}
              onChange={e => { setFilePath(e.target.value); setPreview(null); setOutcome(null); }}
              placeholder="Sélectionnez un fichier CSV…"
            />
          </div>
          <Button variant="secondary" onClick={pickFile} disabled={busy}>📂 Parcourir</Button>
          <Button onClick={analyse} disabled={busy || !filePath.trim()}>
            {busy ? 'Analyse…' : '🔍 Analyser'}
          </Button>
        </div>

        {preview && (
          <>
            <div className="grid-4" style={{ marginTop: 'var(--space-4)', gap: 'var(--space-3)', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <div className="surface-muted text-center" style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}>
                <div className="text-xs text-muted">Lignes</div>
                <div className="font-semibold" style={{ fontSize: 20 }}>{preview.summary.total}</div>
              </div>
              <div className="surface-success text-center" style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}>
                <div className="text-xs text-muted">Valides</div>
                <div className="text-success font-semibold" style={{ fontSize: 20 }}>{preview.summary.valid}</div>
              </div>
              <div className="surface-muted text-center" style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}>
                <div className="text-xs text-muted">Doublons</div>
                <div className="font-semibold" style={{ fontSize: 20, color: 'var(--warning)' }}>{preview.summary.duplicates}</div>
              </div>
              <div className="surface-muted text-center" style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}>
                <div className="text-xs text-muted">Invalides</div>
                <div className="font-semibold text-danger" style={{ fontSize: 20 }}>{preview.summary.invalid}</div>
              </div>
            </div>

            {preview.errors.length > 0 && (
              <div className="surface-danger" style={{ maxHeight: 130, overflowY: 'auto', marginTop: 'var(--space-4)', padding: 10, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                {preview.errors.slice(0, 100).map((e, i) => (
                  <div key={i}>Ligne {e.row} : {e.message}</div>
                ))}
                {preview.errors.length > 100 && <div>… et {preview.errors.length - 100} autre(s).</div>}
              </div>
            )}

            <div style={{ marginTop: 'var(--space-5)' }}>
              <div className="form-label">En cas de référence déjà existante</div>
              <div className="grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}>
                {STRATEGIES.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    className={`btn ${strategy === s.id ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setStrategy(s.id)}
                    title={s.hint}
                    style={{ flexDirection: 'column', gap: 2, height: 'auto', padding: '10px 8px' }}
                  >
                    <span className="font-semibold">{s.label}</span>
                    <span className="text-xs" style={{ opacity: 0.8, whiteSpace: 'normal', lineHeight: 1.25 }}>{s.hint}</span>
                  </button>
                ))}
              </div>
              {preview.summary.duplicates === 0 && (
                <p className="text-xs text-muted" style={{ marginTop: 6 }}>
                  Aucun doublon détecté : la stratégie n’a pas d’effet sur ce fichier.
                </p>
              )}
            </div>

            {outcome && (
              <div className="surface-success" style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}>
                <div className="font-semibold text-success">Import terminé</div>
                <div className="text-sm">
                  {outcome.created} créé(s) · {outcome.updated} mis à jour · {outcome.skipped} ignoré(s) · {outcome.errors} erreur(s)
                </div>
                {outcome.messages.length > 0 && (
                  <div style={{ maxHeight: 120, overflowY: 'auto', marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {outcome.messages.map((m, i) => <div key={i}>{m}</div>)}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </ModalBody>
      <ModalFooter between>
        <Button variant="secondary" onClick={onClose}>Fermer</Button>
        <Button
          variant="success"
          size="lg"
          onClick={confirm}
          disabled={busy || !preview || preview.rows.length === 0}
        >
          {busy ? 'Import…' : `Confirmer l’import (${preview?.rows.length ?? 0})`}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
