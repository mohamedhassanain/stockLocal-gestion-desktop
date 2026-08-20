import React, { useEffect, useState } from 'react';
import { useInventoryStore, INVENTORY_STATUS_LABELS, type InventorySession } from '../stores/useInventoryStore';

// ─── Workflow Steps ──────────────────────────────────────────────────────────

const WORKFLOW_STEPS = [
  { key: 'DRAFT', label: 'Brouillon', icon: '📝' },
  { key: 'COMPTAGE', label: 'En cours', icon: '🔄' },
  { key: 'CALCUL', label: 'Écarts calculés', icon: '📊' },
  { key: 'VALIDATION', label: 'Validé', icon: '🔒' },
];

const getStepIndex = (status: string): number => {
  const idx = WORKFLOW_STEPS.findIndex((s) => s.key === status.trim());
  return idx >= 0 ? idx : 0;
};

// ─── Step Indicator Component ────────────────────────────────────────────────

const StepIndicator: React.FC<{ currentStatus: string }> = ({ currentStatus }) => {
  const currentIdx = getStepIndex(currentStatus);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0', margin: '20px 0', overflowX: 'auto' }}>
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
                minWidth: '100px',
                opacity: isPending ? 0.4 : 1,
              }}
            >
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                  backgroundColor: isCompleted ? '#10b981' : isActive ? '#3b82f6' : '#e2e8f0',
                  color: isCompleted || isActive ? 'white' : '#94a3b8',
                  fontWeight: 'bold',
                  transition: 'all 0.3s ease',
                  border: isActive ? '3px solid #93c5fd' : 'none',
                }}
              >
                {isCompleted ? '✓' : step.icon}
              </div>
              <span
                style={{
                  marginTop: '6px',
                  fontSize: '11px',
                  color: isActive ? '#1e40af' : isCompleted ? '#065f46' : '#94a3b8',
                  fontWeight: isActive ? 'bold' : 'normal',
                  textAlign: 'center',
                  lineHeight: '1.2',
                }}
              >
                {step.label}
              </span>
            </div>
            {idx < WORKFLOW_STEPS.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: '3px',
                  backgroundColor: idx < currentIdx ? '#10b981' : '#e2e8f0',
                  marginTop: '-18px',
                  minWidth: '20px',
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
    isLoading,
    error,
    loadSessions,
    loadSessionById,
    createSession,
    startCounting,
    countItem,
    calculateGaps,
    validateSession,
    deleteSession,
    selectSession,
  } = useInventoryStore();

  // Local state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [countInput, setCountInput] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState('');

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, []);

  // Handlers
  const handleCreateSession = async () => {
    if (!newName.trim()) return;
    try {
      const session = await createSession(newName.trim(), newNotes.trim() || undefined);
      setNewName('');
      setNewNotes('');
      setShowCreateForm(false);
      if (session) {
        await loadSessionById(session.id);
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleSelectSession = async (session: InventorySession) => {
    selectSession(session);
    await loadSessionById(session.id);
  };

  const handleStartCounting = async () => {
    if (!selectedSession) return;
    try {
      await startCounting(selectedSession.id);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleCountItem = async (itemId: string) => {
    try {
      await countItem(itemId, countInput);
      setEditingItemId(null);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleCalculateGaps = async () => {
    if (!selectedSession) return;
    try {
      await calculateGaps(selectedSession.id);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleValidate = async () => {
    if (!selectedSession) return;
    if (!confirm('Valider cette session d\'inventaire ? Cette action est irréversible et ajustera les stocks.')) return;
    try {
      await validateSession(selectedSession.id);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette session d\'inventaire ?')) return;
    try {
      await deleteSession(id);
    } catch (e: any) {
      alert(e.message);
    }
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

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '30px', flex: 1, backgroundColor: '#f8fafc', height: '100vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1 style={{ fontSize: '32px', color: '#0f172a', margin: 0 }}>📋 Inventaire Physique</h1>
        <button
          onClick={() => setShowCreateForm(true)}
          style={{
            padding: '12px 24px',
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        >
          + Nouvelle Session
        </button>
      </div>

      {error && (
        <div style={{
          padding: '12px 20px',
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '8px',
          color: '#991b1b',
          marginBottom: '20px',
          fontSize: '14px',
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Create Session Form */}
      {showCreateForm && (
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          marginBottom: '24px',
          border: '1px solid #e2e8f0',
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '18px', color: '#0f172a' }}>Nouvelle Session d'Inventaire</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <input
              type="text"
              placeholder="Nom de la session (ex: Inventaire mensuel Janvier 2025)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{
                padding: '14px',
                fontSize: '16px',
                borderRadius: '8px',
                border: '2px solid #cbd5e1',
              }}
              autoFocus
            />
            <textarea
              placeholder="Notes (optionnel)"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              rows={2}
              style={{
                padding: '14px',
                fontSize: '14px',
                borderRadius: '8px',
                border: '2px solid #cbd5e1',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={handleCreateSession}
                disabled={!newName.trim() || isLoading}
                style={{
                  padding: '12px 24px',
                  backgroundColor: newName.trim() ? '#10b981' : '#94a3b8',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '15px',
                  fontWeight: 'bold',
                  cursor: newName.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                Créer la Session
              </button>
              <button
                onClick={() => { setShowCreateForm(false); setNewName(''); setNewNotes(''); }}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#f1f5f9',
                  color: '#64748b',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '15px',
                  cursor: 'pointer',
                }}
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '20px' }}>
        {/* ─── Sessions List ──────────────────────────────────────── */}
        <div style={{
          width: '340px',
          minWidth: '340px',
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          maxHeight: 'calc(100vh - 160px)',
          overflowY: 'auto',
        }}>
          <h2 style={{ margin: '0 0 16px', fontSize: '18px', color: '#0f172a' }}>
            Sessions ({sessions.length})
          </h2>
          {sessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📋</div>
              <p>Aucune session d'inventaire</p>
              <p style={{ fontSize: '13px' }}>Créez une nouvelle session pour commencer</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {sessions.map((session) => {
                const isActive = selectedSession?.id === session.id;
                const stepIdx = getStepIndex(session.status);
                const isDone = stepIdx >= 3;
                return (
                  <div
                    key={session.id}
                    onClick={() => handleSelectSession(session)}
                    style={{
                      padding: '14px',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      backgroundColor: isActive ? '#eff6ff' : '#f8fafc',
                      border: isActive ? '2px solid #3b82f6' : '2px solid transparent',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontSize: '15px',
                          fontWeight: isActive ? 'bold' : '600',
                          color: '#0f172a',
                          marginBottom: '4px',
                        }}>
                          {session.name}
                        </div>
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>
                          {new Date(session.created_at).toLocaleDateString('fr-FR', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                        <span style={{
                          padding: '3px 10px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 'bold',
                          backgroundColor: isDone ? '#dcfce7' : stepIdx >= 1 ? '#dbeafe' : '#f1f5f9',
                          color: isDone ? '#166534' : stepIdx >= 1 ? '#1e40af' : '#64748b',
                        }}>
                          {INVENTORY_STATUS_LABELS[session.status] ?? session.status}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(session.id); }}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '14px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            color: '#94a3b8',
                          }}
                          title="Supprimer"
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#fee2e2'; e.currentTarget.style.color = '#ef4444'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#94a3b8'; }}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ─── Session Detail ────────────────────────────────────── */}
        <div style={{
          flex: 1,
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          maxHeight: 'calc(100vh - 160px)',
          overflowY: 'auto',
        }}>
          {!selectedSession ? (
            <div style={{ textAlign: 'center', padding: '80px 40px', color: '#94a3b8' }}>
              <div style={{ fontSize: '60px', marginBottom: '16px' }}>📋</div>
              <h3 style={{ color: '#64748b', margin: '0 0 8px' }}>Sélectionnez une session</h3>
              <p style={{ fontSize: '14px' }}>Choisissez une session dans la liste ou créez-en une nouvelle</p>
            </div>
          ) : (
            <>
              {/* Session Header */}
              <div style={{ marginBottom: '20px' }}>
                <h2 style={{ margin: '0 0 4px', fontSize: '22px', color: '#0f172a' }}>
                  {selectedSession.name}
                </h2>
                {selectedSession.notes && (
                  <p style={{ margin: '0 0 8px', fontSize: '14px', color: '#6b7280' }}>
                    {selectedSession.notes}
                  </p>
                )}
                <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                  Créée le {new Date(selectedSession.created_at).toLocaleDateString('fr-FR', {
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>

              {/* Step Indicator */}
              <StepIndicator currentStatus={status} />

              {/* Action Buttons based on status */}
              <div style={{
                display: 'flex',
                gap: '10px',
                margin: '16px 0',
                flexWrap: 'wrap',
              }}>
                {status === 'DRAFT' && (
                  <button
                    onClick={handleStartCounting}
                    disabled={isLoading}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '15px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                    }}
                  >
                    🔄 Démarrer le Comptage
                  </button>
                )}

                {status === 'COMPTAGE' && (
                  <button
                    onClick={handleCalculateGaps}
                    disabled={isLoading}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: '#f59e0b',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '15px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                    }}
                  >
                    📊 Calculer les Écarts
                  </button>
                )}

                {status === 'CALCUL' && (
                  <button
                    onClick={handleValidate}
                    disabled={isLoading}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '15px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                    }}
                  >
                    ✅ Valider l'Inventaire
                  </button>
                )}
              </div>

              {/* Progress Bar */}
              {selectedSession.items && selectedSession.items.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#6b7280', marginBottom: '6px' }}>
                    <span>Progression du comptage</span>
                    <span>{countedItems} / {totalItems} articles comptés</span>
                  </div>
                  <div style={{
                    width: '100%',
                    height: '8px',
                    backgroundColor: '#e2e8f0',
                    borderRadius: '4px',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${totalItems > 0 ? (countedItems / totalItems) * 100 : 0}%`,
                      height: '100%',
                      backgroundColor: countedItems === totalItems ? '#10b981' : '#3b82f6',
                      borderRadius: '4px',
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                </div>
              )}

              {/* Search */}
              {selectedSession.items && selectedSession.items.length > 0 && (
                <input
                  type="text"
                  placeholder="🔍 Rechercher un produit..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    fontSize: '14px',
                    borderRadius: '8px',
                    border: '2px solid #e2e8f0',
                    marginBottom: '16px',
                    boxSizing: 'border-box',
                  }}
                />
              )}

              {/* Items Table */}
              {selectedSession.items && selectedSession.items.length > 0 ? (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{
                    width: '100%',
                    borderCollapse: 'separate',
                    borderSpacing: '0',
                    fontSize: '14px',
                  }}>
                    <thead>
                      <tr>
                        {[
                          { label: 'Réf', width: '100px' },
                          { label: 'Désignation', width: 'auto' },
                          { label: 'Unité', width: '80px' },
                          { label: 'Stock Attendu', width: '120px' },
                          { label: 'Compté', width: '120px' },
                          { label: 'Écart', width: '100px' },
                          { label: 'Actions', width: '100px' },
                        ].map((col) => (
                          <th key={col.label} style={{
                            textAlign: 'left',
                            padding: '12px 14px',
                            backgroundColor: '#0f172a',
                            color: 'white',
                            fontWeight: '600',
                            fontSize: '13px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            whiteSpace: 'nowrap',
                          }}>
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map((item, idx) => {
                        const isEditing = editingItemId === item.id;
                        const diff = item.difference;
                        return (
                          <tr
                            key={item.id}
                            style={{
                              backgroundColor: idx % 2 === 0 ? 'white' : '#f8fafc',
                            }}
                          >
                            <td style={{ padding: '12px 14px', borderBottom: '1px solid #f1f5f9', fontWeight: '600', color: '#334155' }}>
                              {item.product_reference || '—'}
                            </td>
                            <td style={{ padding: '12px 14px', borderBottom: '1px solid #f1f5f9', color: '#0f172a' }}>
                              {item.product_designation || '—'}
                            </td>
                            <td style={{ padding: '12px 14px', borderBottom: '1px solid #f1f5f9', color: '#6b7280' }}>
                              {item.unit || 'PIÈCE'}
                            </td>
                            <td style={{
                              padding: '12px 14px',
                              borderBottom: '1px solid #f1f5f9',
                              textAlign: 'center',
                              fontWeight: 'bold',
                              color: '#334155',
                            }}>
                              {item.expected_qty}
                            </td>
                            <td style={{
                              padding: '12px 14px',
                              borderBottom: '1px solid #f1f5f9',
                              textAlign: 'center',
                            }}>
                              {isEditing ? (
                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={countInput}
                                    onChange={(e) => setCountInput(Number(e.target.value))}
                                    style={{
                                      width: '80px',
                                      padding: '6px 10px',
                                      fontSize: '14px',
                                      borderRadius: '6px',
                                      border: '2px solid #3b82f6',
                                      textAlign: 'center',
                                    }}
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleCountItem(item.id);
                                      if (e.key === 'Escape') setEditingItemId(null);
                                    }}
                                  />
                                  <button
                                    onClick={() => handleCountItem(item.id)}
                                    style={{
                                      padding: '6px 10px',
                                      backgroundColor: '#10b981',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '6px',
                                      cursor: 'pointer',
                                      fontSize: '13px',
                                    }}
                                  >
                                    ✓
                                  </button>
                                </div>
                              ) : (
                                <span style={{
                                  fontWeight: 'bold',
                                  color: item.counted_qty !== null ? '#0f172a' : '#cbd5e1',
                                  fontSize: '15px',
                                }}>
                                  {item.counted_qty !== null ? item.counted_qty : '—'}
                                </span>
                              )}
                            </td>
                            <td style={{
                              padding: '12px 14px',
                              borderBottom: '1px solid #f1f5f9',
                              textAlign: 'center',
                              fontWeight: 'bold',
                            }}>
                              {diff !== null && diff !== undefined ? (
                                <span style={{
                                  padding: '3px 10px',
                                  borderRadius: '12px',
                                  fontSize: '13px',
                                  backgroundColor: diff === 0 ? '#dcfce7' : diff > 0 ? '#dbeafe' : '#fee2e2',
                                  color: diff === 0 ? '#166534' : diff > 0 ? '#1e40af' : '#991b1b',
                                }}>
                                  {diff > 0 ? '+' : ''}{diff}
                                </span>
                              ) : (
                                <span style={{ color: '#cbd5e1' }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: '12px 14px', borderBottom: '1px solid #f1f5f9', textAlign: 'center' }}>
                              {!isEditing && canCount && (
                                <button
                                  onClick={() => {
                                    setEditingItemId(item.id);
                                    setCountInput(item.counted_qty ?? item.expected_qty);
                                  }}
                                  style={{
                                    padding: '6px 14px',
                                    backgroundColor: '#eff6ff',
                                    color: '#3b82f6',
                                    border: '1px solid #bfdbfe',
                                    borderRadius: '6px',
                                    fontSize: '13px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                  }}
                                >
                                  Compter
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                  <div style={{ fontSize: '40px', marginBottom: '12px' }}>📦</div>
                  <p>
                    {status === 'DRAFT'
                      ? 'Démarrez le comptage pour voir les articles'
                      : 'Aucun article dans cette session'
                    }
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default InventoryPage;
