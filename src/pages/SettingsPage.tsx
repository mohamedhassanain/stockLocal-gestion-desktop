import React, { useEffect, useState } from 'react';

// ─── Onglets ────────────────────────────────────────────────────────────────
type Tab = 'company' | 'categories' | 'discounts' | 'audit';

interface Category {
  id: string;
  name: string;
  description?: string;
  subcategories?: Array<{ id: string; category_id: string; name: string; description?: string }>;
}

interface VolumeDiscount {
  id: string;
  name: string;
  min_qty: number;
  max_qty?: number | null;
  discount_pct: number;
}

interface AuditLog {
  id: string;
  username: string;
  action: string;
  entity_type: string;
  details: string | null;
  created_at: string;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px',
  borderRadius: '6px',
  border: '1px solid #cbd5e1',
  boxSizing: 'border-box',
  fontSize: '14px',
  marginBottom: '10px',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '5px',
  fontWeight: '600',
  color: '#374151',
  fontSize: '13px',
};

const SectionTitle: React.FC<{ icon: string; title: string }> = ({ icon, title }) => (
  <h2 style={{ margin: '0 0 16px', fontSize: '18px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
    <span>{icon}</span>{title}
  </h2>
);

export const SettingsPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('company');
  const [message, setMessage] = useState<string | null>(null);

  // Entreprise
  const [company, setCompany] = useState({ name: '', tagline: '', ice: '', rc: '', if_: '', address: '', phone: '', email: '' });

  // Catégories
  const [categories, setCategories] = useState<Category[]>([]);
  const [newCat, setNewCat] = useState('');
  const [newSubs, setNewSubs] = useState<Record<string, string>>({});

  // Remises
  const [discounts, setDiscounts] = useState<VolumeDiscount[]>([]);
  const [discountForm, setDiscountForm] = useState({ name: '', min_qty: 1, max_qty: '', discount_pct: 0 });

  // Audit
  const [logs, setLogs] = useState<AuditLog[]>([]);

  // Import CSV
  const [importResult, setImportResult] = useState<{ imported: number; errors: number; messages: string[] } | null>(null);

  const notify = (text: string) => { setMessage(text); setTimeout(() => setMessage(null), 3500); };

  const loadAll = async () => {
    try {
      const [companyData, cats, disc, auditLogs] = await Promise.all([
        window.api.company.get(),
        window.api.categories.getAll(),
        window.api.discounts.getAll(),
        window.api.audit.getLogs(100),
      ]);
      setCompany(companyData);
      setCategories(cats);
      setDiscounts(disc);
      setLogs(auditLogs);
    } catch (e: any) {
      notify(e.message);
    }
  };

  useEffect(() => {
    loadAll().then();
  }, []);

  const saveCompany = async () => {
    const result = await window.api.company.save(company);
    if (result.success) {
      setCompany(result.data);
      notify('✅ Paramètres entreprise enregistrés');
    } else {
      notify(`❌ ${result.error}`);
    }
  };

  const addCategory = async () => {
    if (!newCat.trim()) return;
    const result = await window.api.categories.create({ name: newCat.trim() });
    if (result.success) {
      setNewCat('');
      loadAll();
      notify('✅ Catégorie créée');
    } else notify(`❌ ${result.error}`);
  };

  const addSubcategory = async (categoryId: string) => {
    const name = newSubs[categoryId] ?? '';
    if (!name.trim()) return;
    const result = await window.api.categories.addSub(categoryId, { name: name.trim() });
    if (result.success) {
      setNewSubs(prev => ({ ...prev, [categoryId]: '' }));
      loadAll();
      notify('✅ Sous-catégorie ajoutée');
    } else notify(`❌ ${result.error}`);
  };

  const deleteCategory = async (id: string) => {
    if (!confirm('Supprimer cette catégorie et ses sous-catégories ?')) return;
    const result = await window.api.categories.delete(id);
    if (result.success) { loadAll(); notify('🗑️ Catégorie supprimée'); }
    else notify(`❌ ${result.error}`);
  };

  const addDiscount = async () => {
    if (!discountForm.name.trim()) return;
    const result = await window.api.discounts.create({
      name: discountForm.name.trim(),
      min_qty: discountForm.min_qty,
      max_qty: discountForm.max_qty === '' ? null : Number(discountForm.max_qty),
      discount_pct: discountForm.discount_pct,
    });
    if (result.success) {
      setDiscountForm({ name: '', min_qty: 1, max_qty: '', discount_pct: 0 });
      loadAll();
      notify('✅ Règle de remise ajoutée');
    } else notify(`❌ ${result.error}`);
  };

  const deleteDiscount = async (id: string) => {
    if (!confirm('Supprimer cette règle de remise ?')) return;
    const result = await window.api.discounts.delete(id);
    if (result.success) { loadAll(); notify('🗑️ Règle supprimée'); }
    else notify(`❌ ${result.error}`);
  };

  const importCsv = async () => {
    const path = (document.getElementById('csv-path') as HTMLInputElement)?.value ?? '';
    if (!path.trim()) { notify('Veuillez indiquer le chemin du fichier CSV'); return; }
    const result = await window.api.products.importCsv(path.trim());
    if (result.success) {
      setImportResult({ imported: result.imported, errors: result.errors, messages: result.messages ?? [] });
      notify(`✅ Import terminé : ${result.imported} produits, ${result.errors} erreurs`);
    } else {
      notify(`❌ ${result.error}`);
    }
  };

  const tabs: Array<{ id: Tab; label: string; icon: string }> = [
    { id: 'company', label: 'Entreprise', icon: '🏢' },
    { id: 'categories', label: 'Catégories', icon: '🏷️' },
    { id: 'discounts', label: 'Remises volume', icon: '📊' },
    { id: 'audit', label: 'Journal d’audit', icon: '📜' },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#f8fafc', height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '24px 30px 16px', borderBottom: '1px solid #e5e7eb', background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, fontSize: '28px', color: '#0f172a' }}>⚙️ Paramètres & Configuration</h1>
        {message && <div style={{ padding: '8px 16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', fontSize: '14px', fontWeight: '600', color: '#1e40af' }}>{message}</div>}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', padding: '12px 30px', background: 'white', borderBottom: '1px solid #e5e7eb' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '10px 18px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600', background: tab === t.id ? '#0f172a' : '#f3f4f6', color: tab === t.id ? 'white' : '#6b7280' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Contenu */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '30px' }}>
        {tab === 'company' && (
          <div style={{ maxWidth: '720px', background: 'white', borderRadius: '14px', padding: '28px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <SectionTitle icon="🏢" title="Informations de l'entreprise (assistant de configuration)" />
            <p style={{ marginTop: 0, color: '#6b7280', fontSize: '13px' }}>
              Ces informations apparaissent sur les factures, devis, bons de livraison, avoirs, étiquettes et rapports.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Nom de l'entreprise</label>
                <input style={inputStyle} value={company.name} onChange={e => setCompany({ ...company, name: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>Slogan / secteur</label>
                <input style={inputStyle} value={company.tagline} onChange={e => setCompany({ ...company, tagline: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>ICE *</label>
                <input style={inputStyle} value={company.ice} onChange={e => setCompany({ ...company, ice: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>RC *</label>
                <input style={inputStyle} value={company.rc} onChange={e => setCompany({ ...company, rc: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>IF *</label>
                <input style={inputStyle} value={company.if_} onChange={e => setCompany({ ...company, if_: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>Téléphone</label>
                <input style={inputStyle} value={company.phone} onChange={e => setCompany({ ...company, phone: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>Email</label>
                <input style={inputStyle} value={company.email} onChange={e => setCompany({ ...company, email: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>Adresse</label>
                <input style={inputStyle} value={company.address} onChange={e => setCompany({ ...company, address: e.target.value })} />
              </div>
            </div>
            <button onClick={saveCompany} style={{ padding: '12px 28px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer' }}>
              💾 Enregistrer
            </button>
          </div>
        )}

        {tab === 'categories' && (
          <div style={{ maxWidth: '820px' }}>
            {/* Import CSV */}
            <div style={{ background: 'white', borderRadius: '14px', padding: '22px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '20px' }}>
              <SectionTitle icon="📥" title="Import produits (CSV)" />
              <p style={{ marginTop: 0, color: '#6b7280', fontSize: '13px' }}>
                Colonnes : reference;designation;purchase_price;selling_price;wholesale_price;min_stock;barcode;unit
              </p>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input id="csv-path" placeholder="C:\chemin\vers\produits.csv" style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
                <button onClick={importCsv} style={{ padding: '12px 24px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  📥 Importer
                </button>
              </div>
              {importResult && (
                <div style={{ marginTop: '12px', fontSize: '13px' }}>
                  <strong>Importés : {importResult.imported}</strong> · Erreurs : {importResult.errors}
                  {importResult.messages.length > 0 && (
                    <div style={{ maxHeight: '120px', overflowY: 'auto', marginTop: '6px', background: '#fef2f2', padding: '10px', borderRadius: '8px' }}>
                      {importResult.messages.slice(0, 10).map((m, i) => <div key={i}>{m}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ background: 'white', borderRadius: '14px', padding: '22px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <SectionTitle icon="🏷️" title="Catégories & Sous-catégories" />
              <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                <input placeholder="Nouvelle catégorie" value={newCat} onChange={e => setNewCat(e.target.value)} style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
                <button onClick={addCategory} style={{ padding: '12px 20px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  + Ajouter
                </button>
              </div>
              {categories.length === 0 && <div style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>Aucune catégorie. Créez-en une.</div>}
              {categories.map(cat => (
                <div key={cat.id} style={{ border: '1px solid #e5e7eb', borderRadius: '10px', padding: '14px', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <strong style={{ flex: 1 }}>{cat.name}</strong>
                    <button onClick={() => deleteCategory(cat.id)} style={{ padding: '6px 12px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}>🗑️</button>
                  </div>
                  {cat.description && <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>{cat.description}</div>}
                  <div style={{ marginTop: '10px', paddingLeft: '14px', borderLeft: '2px solid #f1f5f9' }}>
                    {(cat.subcategories ?? []).map(sub => (
                      <div key={sub.id} style={{ fontSize: '13px', color: '#4b5563', padding: '3px 0' }}>• {sub.name}</div>
                    ))}
                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                      <input placeholder="Sous-catégorie" value={newSubs[cat.id] ?? ''} onChange={e => setNewSubs({ ...newSubs, [cat.id]: e.target.value })}
                        style={{ ...inputStyle, marginBottom: 0, flex: 1, padding: '8px', fontSize: '13px' }} />
                      <button onClick={() => addSubcategory(cat.id)} style={{ padding: '8px 14px', background: '#e0e7ff', color: '#4338ca', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer' }}>
                        + Sous-catégorie
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'discounts' && (
          <div style={{ maxWidth: '720px', background: 'white', borderRadius: '14px', padding: '28px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <SectionTitle icon="📊" title="Remises par volume (tarification)" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px', marginBottom: '16px' }}>
              <div>
                <label style={labelStyle}>Nom</label>
                <input style={inputStyle} placeholder="Ex : 10-49" value={discountForm.name} onChange={e => setDiscountForm({ ...discountForm, name: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>Qté min</label>
                <input style={inputStyle} type="number" value={discountForm.min_qty} onChange={e => setDiscountForm({ ...discountForm, min_qty: Number(e.target.value) })} />
              </div>
              <div>
                <label style={labelStyle}>Qté max</label>
                <input style={inputStyle} type="number" placeholder="vide = ∞" value={discountForm.max_qty} onChange={e => setDiscountForm({ ...discountForm, max_qty: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>Remise %</label>
                <input style={inputStyle} type="number" step="0.5" value={discountForm.discount_pct} onChange={e => setDiscountForm({ ...discountForm, discount_pct: Number(e.target.value) })} />
              </div>
            </div>
            <button onClick={addDiscount} style={{ padding: '12px 24px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
              + Ajouter la règle
            </button>

            {discounts.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px', fontSize: '14px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                    <th style={{ padding: '10px', borderBottom: '2px solid #e5e7eb' }}>Nom</th>
                    <th style={{ padding: '10px', borderBottom: '2px solid #e5e7eb' }}>Qté min</th>
                    <th style={{ padding: '10px', borderBottom: '2px solid #e5e7eb' }}>Qté max</th>
                    <th style={{ padding: '10px', borderBottom: '2px solid #e5e7eb' }}>Remise</th>
                    <th style={{ padding: '10px', borderBottom: '2px solid #e5e7eb' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {discounts.map(d => (
                    <tr key={d.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px', fontWeight: '600' }}>{d.name}</td>
                      <td style={{ padding: '10px' }}>{d.min_qty}</td>
                      <td style={{ padding: '10px' }}>{d.max_qty ?? '∞'}</td>
                      <td style={{ padding: '10px', fontWeight: 'bold', color: '#16a34a' }}>{d.discount_pct}%</td>
                      <td style={{ padding: '10px' }}>
                        <button onClick={() => deleteDiscount(d.id)} style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>🗑️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'audit' && (
          <div style={{ maxWidth: '920px', background: 'white', borderRadius: '14px', padding: '28px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <SectionTitle icon="📜" title="Journal d'audit (traçabilité)" />
            {logs.length === 0 ? (
              <div style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>Aucune action journalisée pour le moment.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                    <th style={{ padding: '10px', borderBottom: '2px solid #e5e7eb' }}>Date</th>
                    <th style={{ padding: '10px', borderBottom: '2px solid #e5e7eb' }}>Utilisateur</th>
                    <th style={{ padding: '10px', borderBottom: '2px solid #e5e7eb' }}>Action</th>
                    <th style={{ padding: '10px', borderBottom: '2px solid #e5e7eb' }}>Type</th>
                    <th style={{ padding: '10px', borderBottom: '2px solid #e5e7eb' }}>Détails</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: '#6b7280' }}>{new Date(log.created_at).toLocaleString('fr-MA')}</td>
                      <td style={{ padding: '8px 10px', fontWeight: '600' }}>{log.username}</td>
                      <td style={{ padding: '8px 10px' }}>{log.action}</td>
                      <td style={{ padding: '8px 10px', color: '#6b7280' }}>{log.entity_type}</td>
                      <td style={{ padding: '8px 10px' }}>{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
