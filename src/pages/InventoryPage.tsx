import React, { useEffect, useState } from 'react';
import { useInventoryStore, type InventorySession, type InventorySessionStatus } from '../stores/useInventoryStore';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import {
  Button,
  Card,
  Badge,
  Input,
  Textarea,
  PageHeader,
  INVENTORY_STATUS_BADGE,
} from '../components/ui';
import { toast } from '../stores/useToastStore';

// ─── Workflow Steps ──────────────────────────────────────────────────────────

const WORKFLOW_STEPS = [
  { key: 'DRAFT', label: 'Brouillon', icon: '📝' },
  { key: 'COMPTAGE', label: 'En cours', icon: '🔄' },
  { key: 'CALCUL', label: 'Écarts calculés', icon: '📊' },
  { key: 'VALIDATION', label: 'Validé', icon: '🔒' },
];

const INVENTORY_BADGE_KEY: Record<string, keyof typeof INVENTORY_STATUS_BADGE> = {
  DRAFT: 'DRAFT',
  COMPTAGE: 'COUNTING',
  CALCUL: 'GAPS_CALCULATED',
  VALIDATION: 'VALIDATED',
};

const getInventoryBadge = (status: string) => {
  const key = INVENTORY_BADGE_KEY[status.trim()] ?? 'DRAFT';
  return INVENTORY_STATUS_BADGE[key] ?? INVENTORY_STATUS_BADGE.DRAFT;
};

const getStepIndex = (status: string): number => {
  const idx = WORKFLOW_STEPS.findIndex((s) => s.key === status.trim());
  return idx >= 0 ? idx : 0;
};

// ─── Step Indicator Component ────────────────────────────────────────────────

const StepIndicator: React.FC<{ currentStatus: string }> = ({ currentStatus }) => {
  const currentIdx = getStepIndex(currentStatus);

  return (
    <div className="flex items-center" style={{ margin: '20px 0', overflowX: 'auto' }}>
      {WORKFLOW_STEPS.map((step, idx) => {
        const isActive = idx === currentIdx;
        const isCompleted = idx < currentIdx;
        const isPending = idx > currentIdx;

        return (
          <React.Fragment key={step.key}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                minWidth: 100,
                opacity: isPending ? 0.4 : 1,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  backgroundColor: isCompleted ? 'var(--success)' : isActive ? 'var(--primary)' : 'var(--border)',
                  color: isCompleted || isActive ? 'var(--on-primary)' : 'var(--muted)',
                  fontWeight: 'bold',
                  transition: 'all 0.3s ease',
                  border: isActive ? '3px solid var(--primary-soft)' : 'none',
                }}
              >
                {isCompleted ? '✓' : step.icon}
              </div>
              <span
                className="text-xs"
                style={{
                  marginTop: 6,
                  color: isActive ? 'var(--info)' : isCompleted ? 'var(--success)' : 'var(--muted)',
                  fontWeight: isActive ? 'bold' : 'normal',
                  textAlign: 'center',
                  lineHeight: 1.2,
                }}
              >
                {step.label}
              </span>
            </div>
            {idx < WORKFLOW_STEPS.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 3,
                  backgroundColor: idx < currentIdx ? 'var(--success)' : 'var(--border)',
                  marginTop: -18,
                  minWidth: 20,
                  transition: 'background-color 0.3s ease',
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

// ─── Main Page ───────────────────────────────────────────────────────────────

export const InventoryPage: React.FC = () => {
  const {
    sessions,
    selectedSession,
    versions,
    isLoading,
    error,
    loadSessions,
    loadSessionById,
    createSession,
    updateSession,
    startCounting,
    countItem,
    calculateGaps,
    validateSession,
    deleteSession,
    selectSession,
    createVersion,
    getVersions,
    restoreVersion,
    correctValidatedInventory,
  } = useInventoryStore();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [countInput, setCountInput] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [showEditForm, setShowEditForm] = useState(false);
  const [editName, setEditName] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editStatus, setEditStatus] = useState<InventorySessionStatus>('DRAFT');

  useEffect(() => {
    loadSessions();
  }, []);

  const handleCreateSession = async () => {
    if (!newName.trim()) return;
    try {
      const session = await createSession(newName.trim(), newNotes.trim() || undefined);
      toast.success(`Session « ${newName.trim()} » créée.`);
      setNewName('');
      setNewNotes('');
      setShowCreateForm(false);
      if (session) {
        await loadSessionById(session.id);
      }
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleEditSession = () => {
    if (!selectedSession) return;
    setEditName(selectedSession.name);
    setEditNotes(selectedSession.notes ?? '');
    setEditStatus(selectedSession.status);
    setShowEditForm(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedSession) return;
    const name = editName.trim();
    if (!name) {
      toast.error('Le nom de la session est obligatoire.');
      return;
    }
    try {
      await updateSession(selectedSession.id, { name, notes: editNotes.trim() || undefined, status: editStatus });
      toast.success('Session modifiée.');
      setShowEditForm(false);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleSelectSession = async (session: InventorySession) => {
    selectSession(session);
    await loadSessionById(session.id);
    await getVersions(session.id);
  };

  const handleStartCounting = async () => {
    if (!selectedSession) return;
    try {
      await startCounting(selectedSession.id);
      toast.success('Comptage démarré.');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleCountItem = async (itemId: string) => {
    try {
      await countItem(itemId, countInput);
      setEditingItemId(null);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleCalculateGaps = async () => {
    if (!selectedSession) return;
    try {
      await calculateGaps(selectedSession.id);
      toast.success('Écarts calculés avec succès.');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleCreateVersion = async () => {
    if (!selectedSession) return;
    try {
      await createVersion(selectedSession.id);
      toast.success('Version enregistrée.');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (!selectedSession) return;
    setPendingConfirm({
      title: 'Restaurer cette version ?',
      message: (
        <>
          Les comptages seront remplacés par ceux de la version choisie.<br />
          <strong>Une nouvelle version sera créée</strong> (l'historique reste intact).
        </>
      ),
      danger: true,
      confirmLabel: 'Restaurer',
      action: async () => {
        try {
          await restoreVersion(selectedSession!.id, versionId);
          toast.success('Version restaurée. Une nouvelle version a été créée.');
        } catch (e: any) {
          toast.error(e.message);
        }
      },
    });
  };

  const handleCorrectItem = async (itemId: string, correctedQty: number) => {
    if (!selectedSession) return;
    try {
      await correctValidatedInventory(selectedSession.id, { [itemId]: correctedQty });
      toast.success('Correction appliquée. Le stock a été ajusté.');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    message: React.ReactNode;
    danger?: boolean;
    confirmLabel: string;
    action: () => void;
  } | null>(null);

  const handleValidate = async () => {
    if (!selectedSession) return;
    setPendingConfirm({
      title: 'Valider cette session d\'inventaire ?',
      message: (
        <>
          <strong>Cette action est irréversible</strong> : les stocks seront définitivement ajustés selon les écarts comptés.
        </>
      ),
      danger: true,
      confirmLabel: 'Valider l\'inventaire',
      action: async () => {
        try {
          await validateSession(selectedSession!.id);
          toast.success('Session d\'inventaire validée. Les stocks ont été ajustés.');
        } catch (e: any) {
          toast.error(e.message);
        }
      },
    });
  };

  const handleDelete = async (id: string) => {
    setPendingConfirm({
      title: 'Supprimer cette session ?',
      message: (
        <>
          La session et ses résultats de comptage seront <strong>définitivement supprimés</strong>.
        </>
      ),
      danger: true,
      confirmLabel: 'Supprimer',
      action: async () => {
        try {
          await deleteSession(id);
          toast.success('Session d\'inventaire supprimée.');
        } catch (e: any) {
          toast.error(e.message);
        }
      },
    });
  };

  const filteredItems = selectedSession?.items?.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.product_reference?.toLowerCase().includes(q) ||
      item.product_designation?.toLowerCase().includes(q)
    );
  }) || [];

  const countedItems = selectedSession?.items?.filter((i) => i.counted_qty !== null).length || 0;
  const totalItems = selectedSession?.items?.length || 0;
  const status = selectedSession?.status ?? 'DRAFT';
  const canCount = status === 'COMPTAGE';
  const canCorrect = status === 'VALIDATION';

  const diffBadgeVariant = (diff: number): 'success' | 'info' | 'danger' => {
    if (diff === 0) return 'success';
    if (diff > 0) return 'info';
    return 'danger';
  };

  return (
    <div className="page-shell">
      <PageHeader
        icon="📋"
        title="Inventaire Physique"
        actions={
          <Button onClick={() => setShowCreateForm(true)}>+ Nouvelle Session</Button>
        }
      />

      <div className="page-content">
        {error && (
          <div className="surface-danger" style={{ padding: '12px 20px', marginBottom: 20, fontSize: 'var(--font-size-sm)' }}>
            <span className="text-danger">⚠️ {error}</span>
          </div>
        )}

        {showCreateForm && (
          <Card padding className="mb-4">
            <h3 style={{ margin: '0 0 16px' }}>Nouvelle Session d'Inventaire</h3>
            <div className="flex flex-col gap-3">
              <Input
                placeholder="Nom de la session (ex: Inventaire mensuel Janvier 2025)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                inputSize="lg"
                autoFocus
              />
              <Textarea
                placeholder="Notes (optionnel)"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                rows={2}
              />
              <div className="flex gap-2">
                <Button variant="success" onClick={handleCreateSession} disabled={!newName.trim() || isLoading}>
                  Créer la Session
                </Button>
                <Button variant="secondary" onClick={() => { setShowCreateForm(false); setNewName(''); setNewNotes(''); }}>
                  Annuler
                </Button>
              </div>
            </div>
          </Card>
        )}

        <div className="flex gap-4">
          <Card padding style={{ width: 340, minWidth: 340, maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 'var(--font-size-lg)' }}>
              Sessions ({sessions.length})
            </h2>
            {sessions.length === 0 ? (
              <div className="state-box" style={{ padding: '40px 20px' }}>
                <div className="state-icon">📋</div>
                <div className="state-text">Aucune session d'inventaire</div>
                <div className="text-sm text-muted">Créez une nouvelle session pour commencer</div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {sessions.map((session) => {
                  const isActive = selectedSession?.id === session.id;
                  const badgeInfo = getInventoryBadge(session.status);
                  return (
                    <div
                      key={session.id}
                      onClick={() => handleSelectSession(session)}
                      className={isActive ? 'list-item-selected' : 'list-item'}
                      style={{ padding: 14 }}
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex-1">
                          <div className="font-semibold" style={{ marginBottom: 4 }}>
                            {session.name}
                          </div>
                          <div className="text-xs text-muted">
                            {new Date(session.created_at).toLocaleDateString('fr-FR', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </div>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                          <Badge variant={badgeInfo.variant}>{badgeInfo.label}</Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); handleDelete(session.id); }}
                            title="Supprimer"
                          >
                            🗑️
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card padding className="flex-1" style={{ maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>
            {!selectedSession ? (
              <div className="state-box" style={{ padding: '80px 40px' }}>
                <div className="state-icon">📋</div>
                <div className="state-title">Sélectionnez une session</div>
                <div className="state-text">Choisissez une session dans la liste ou créez-en une nouvelle</div>
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h2 style={{ margin: '0 0 4px' }}>{selectedSession.name}</h2>
                      {selectedSession.notes && (
                        <p className="text-sm text-secondary" style={{ margin: '0 0 8px' }}>
                          {selectedSession.notes}
                        </p>
                      )}
                    </div>
                    <Button variant="secondary" size="sm" onClick={handleEditSession} title="Modifier la session">
                      ✏️ Modifier
                    </Button>
                  </div>
                  <div className="text-sm text-muted">
                    Créée le {new Date(selectedSession.created_at).toLocaleDateString('fr-FR', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>

                  {showEditForm && (
                    <div style={{ marginTop: 16, padding: 16, backgroundColor: 'var(--surface-2, #f5f5f5)', borderRadius: 8 }}>
                      <div className="flex flex-col gap-3">
                        <Input
                          placeholder="Nom de la session"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          inputSize="lg"
                          autoFocus
                        />
                        <Textarea
                          placeholder="Notes (optionnel)"
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          rows={2}
                        />
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-muted" style={{ marginBottom: 2 }}>Statut</label>
                          <select
                            className="input"
                            value={editStatus}
                            onChange={(e) => setEditStatus(e.target.value as InventorySessionStatus)}
                          >
                            <option value="DRAFT">Brouillon</option>
                            <option value="COMPTAGE">En cours</option>
                            <option value="CALCUL">Écarts calculés</option>
                            <option value="VALIDATION">Validé</option>
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="success" onClick={handleSaveEdit} disabled={isLoading}>
                            Enregistrer
                          </Button>
                          <Button variant="secondary" onClick={() => setShowEditForm(false)}>
                            Annuler
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <StepIndicator currentStatus={status} />

                <div className="flex gap-2 mb-4" style={{ flexWrap: 'wrap' }}>
                  {status === 'DRAFT' && (
                    <Button onClick={handleStartCounting} disabled={isLoading}>
                      🔄 Démarrer le Comptage
                    </Button>
                  )}
                  {status === 'COMPTAGE' && (
                    <Button onClick={handleCalculateGaps} disabled={isLoading} style={{ background: 'var(--warning)', borderColor: 'transparent' }}>
                      📊 Calculer les Écarts
                    </Button>
                  )}
                  {status === 'CALCUL' && (
                    <Button variant="success" onClick={handleValidate} disabled={isLoading}>
                      ✅ Valider l'Inventaire
                    </Button>
                  )}
                  {status !== 'DRAFT' && (
                    <Button variant="secondary" onClick={handleCreateVersion} disabled={isLoading} title="Enregistrer un instantané des comptages">
                      💾 Enregistrer une version
                    </Button>
                  )}
                </div>

                {versions.length > 0 && status !== 'DRAFT' && (
                  <div className="mb-4" style={{ padding: 12, backgroundColor: 'var(--surface-2, #f5f5f5)', borderRadius: 8 }}>
                    <div className="font-semibold text-sm" style={{ marginBottom: 8 }}>
                      🕘 Historique des versions
                    </div>
                    <div className="flex flex-col gap-1">
                      {versions.map(v => (
                        <div key={v.id} className="flex justify-between items-center" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                          <div>
                            <span className="font-semibold text-sm">Version {v.version_number}</span>
                            <span className="text-xs text-muted" style={{ marginLeft: 8 }}>
                              {new Date(v.created_at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {v.note && <span className="text-xs text-muted"> — {v.note}</span>}
                          </div>
                          <Button variant="secondary" size="sm" onClick={() => handleRestoreVersion(v.id)} disabled={isLoading}>
                            Restaurer
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedSession.items && selectedSession.items.length > 0 && (
                  <div className="mb-4">
                    <div className="flex justify-between text-sm text-secondary mb-2">
                      <span>Progression du comptage</span>
                      <span>{countedItems} / {totalItems} articles comptés</span>
                    </div>
                    <div style={{ width: '100%', height: 8, backgroundColor: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${totalItems > 0 ? (countedItems / totalItems) * 100 : 0}%`,
                          height: '100%',
                          backgroundColor: countedItems === totalItems ? 'var(--success)' : 'var(--primary)',
                          borderRadius: 4,
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                  </div>
                )}

                {selectedSession.items && selectedSession.items.length > 0 && (
                  <Input
                    placeholder="🔍 Rechercher un produit..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="mb-4"
                  />
                )}

                {selectedSession.items && selectedSession.items.length > 0 ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Réf</th>
                          <th>Désignation</th>
                          <th>Unité</th>
                          <th className="text-center">Stock Attendu</th>
                          <th className="text-center">Compté</th>
                          <th className="text-center">Écart</th>
                          <th className="text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredItems.map((item) => {
                          const isEditing = editingItemId === item.id;
                          const diff = item.difference;
                          return (
                            <tr key={item.id}>
                              <td className="font-semibold text-secondary">{item.product_reference || '—'}</td>
                              <td>{item.product_designation || '—'}</td>
                              <td className="text-muted">{item.unit || 'PIÈCE'}</td>
                              <td className="qty text-center font-semibold">{item.expected_qty}</td>
                              <td className="text-center">
                                {isEditing ? (
                                  <div className="flex gap-2 items-center justify-center">
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={countInput}
                                      onChange={(e) => setCountInput(Number(e.target.value))}
                                      className="input input-sm text-center"
                                      style={{ width: 80 }}
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleCountItem(item.id);
                                        if (e.key === 'Escape') setEditingItemId(null);
                                      }}
                                    />
                                    <Button variant="success" size="sm" onClick={() => (canCorrect ? handleCorrectItem(item.id, countInput) : handleCountItem(item.id))}>✓</Button>
                                  </div>
                                ) : (
                                  <span className={`qty font-semibold ${item.counted_qty !== null ? '' : 'text-muted'}`}>
                                    {item.counted_qty !== null ? item.counted_qty : '—'}
                                  </span>
                                )}
                              </td>
                              <td className="text-center">
                                {diff !== null && diff !== undefined ? (
                                  <Badge variant={diffBadgeVariant(diff)}>
                                    {diff > 0 ? '+' : ''}{diff}
                                  </Badge>
                                ) : (
                                  <span className="text-muted">—</span>
                                )}
                              </td>
                              <td className="text-center">
                                {!isEditing && canCount && (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => {
                                      setEditingItemId(item.id);
                                      setCountInput(item.counted_qty ?? item.expected_qty);
                                    }}
                                  >
                                    Compter
                                  </Button>
                                )}
                                {!isEditing && canCorrect && (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => {
                                      setEditingItemId(item.id);
                                      setCountInput(item.counted_qty ?? item.expected_qty);
                                    }}
                                  >
                                    Corriger
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="state-box" style={{ padding: 40 }}>
                    <div className="state-icon">📦</div>
                    <div className="state-text">
                      {status === 'DRAFT'
                        ? 'Démarrez le comptage pour voir les articles'
                        : 'Aucun article dans cette session'}
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      </div>

      {pendingConfirm && (
        <ConfirmDialog
          open
          title={pendingConfirm.title}
          message={pendingConfirm.message}
          danger={pendingConfirm.danger}
          confirmLabel={pendingConfirm.confirmLabel}
          onConfirm={() => {
            pendingConfirm.action();
            setPendingConfirm(null);
          }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  );
};

export default InventoryPage;
