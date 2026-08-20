import React, { useEffect, useState } from 'react';

// ─── Onglets ────────────────────────────────────────────────────────────────
type Tab = 'company' | 'categories' | 'discounts' | 'data' | 'backups' | 'audit' | 'units' | 'alerts';

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
  action: string;
  entity_type: string;
  details: string | null;
  created_at: string;
}

interface BackupInfo {
  name: string;
  path: string;
  date: string;
  sizeKB: number;
  valid: boolean;
}

interface UnitConversion {
  id: string;
  from_unit: string;
  to_unit: string;
  factor: number;
  product_id?: string | null;
}

interface GlobalSettings {
  low_stock_threshold_multiplier: number;
  critical_stock_threshold: number;
  show_low_stock_alerts: boolean;
  show_overdue_alerts: boolean;
  default_vat_rate: number;
  auto_backup_enabled: boolean;
  auto_backup_frequency: 'on_close' | 'daily' | 'weekly';
  max_backups: number;
  inactive_product_days: number;
  show_inactive_product_alerts: boolean;
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
  const [company, setCompany] = useState({ name: '', tagline: '', ice: '', rc: '', if_: '', patente: '', address: '', phone: '', email: '', logo_path: '' });

  // Catégories
  const [categories, setCategories] = useState<Category[]>([]);
  const [newCat, setNewCat] = useState('');
  const [newSubs, setNewSubs] = useState<Record<string, string>>({});

  // Remises
  const [discounts, setDiscounts] = useState<VolumeDiscount[]>([]);
  const [discountForm, setDiscountForm] = useState({ name: '', min_qty: 1, max_qty: '', discount_pct: 0 });

  // Audit
  const [logs, setLogs] = useState<AuditLog[]>([]);

  // Données
  const [dataPath, setDataPath] = useState('');
  const [isChangingLocation, setIsChangingLocation] = useState(false);
  const [integrityResult, setIntegrityResult] = useState<{ valid: boolean; message: string } | null>(null);

  // Backup
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupLoading, setBackupLoading] = useState(false);

  // Import CSV
  const [importResult, setImportResult] = useState<{ imported: number; errors: number; messages: string[] } | null>(null);

  // Unit Conversions
  const [conversions, setConversions] = useState<UnitConversion[]>([]);
  const [conversionForm, setConversionForm] = useState({ from_unit: '', to_unit: '', factor: 1, product_id: '' });
  const [editingConversion, setEditingConversion] = useState<UnitConversion | null>(null);

  // Global Settings (Alertes)
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>({
    low_stock_threshold_multiplier: 1.5,
    critical_stock_threshold: 5,
    show_low_stock_alerts: true,
    show_overdue_alerts: true,
    default_vat_rate: 20,
    auto_backup_enabled: true,
    auto_backup_frequency: 'daily',
    max_backups: 10,
    inactive_product_days: 30,
    show_inactive_product_alerts: true,
  });
  const [productsList, setProductsList] = useState<Array<{ id: string; designation: string }>>([]);

  const notify = (text: string) => { setMessage(text); setTimeout(() => setMessage(null), 3500); };

  const loadAll = async () => {
    try {
      const [companyData, cats, disc, auditLogs, path, convs, gs, prods] = await Promise.all([
        window.api.company.get(),
        window.api.categories.getAll(),
        window.api.discounts.getAll(),
        window.api.audit.getLogs(100),
        window.api.storage.getDataPath(),
        window.api.conversions.getAll(),
        window.api.globalSettings.get(),
        window.api.products.getAll(),
      ]);
      setCompany(companyData);
      setCategories(cats);
      setDiscounts(disc);
      setLogs(auditLogs);
      setDataPath(path);
      setConversions(convs ?? []);
      if (gs) setGlobalSettings(prev => ({ ...prev, ...gs }));
      setProductsList((prods ?? []).map((p: any) => ({ id: p.id, designation: p.designation })));
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

  // ─── Catégories ─────────────────────────────────────────────────────────────
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

  // ─── Remises ────────────────────────────────────────────────────────────────
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

  // ─── Données ────────────────────────────────────────────────────────────────
  const handleChangeDataLocation = async () => {
    const result = await window.api.storage.pickFolder();
    if (result.canceled || !result.path) return;

    setIsChangingLocation(true);
    try {
      const validation = await window.api.storage.validatePath(result.path);
      if (!validation.valid) {
        notify(`❌ ${validation.error}`);
        return;
      }

      // Déplacer les données
      const currentPath = await window.api.storage.getDataPath();
      const migrateResult = await window.api.storage.migrateData(currentPath, result.path);
      if (migrateResult.success) {
        setDataPath(result.path);
        notify('✅ Emplacement des données modifié. Redémarrage recommandé.');
      } else {
        notify(`❌ ${migrateResult.error}`);
      }
    } catch (e: any) {
      notify(`❌ Erreur : ${e.message}`);
    } finally {
      setIsChangingLocation(false);
    }
  };

  const handleCheckIntegrity = async () => {
    const result = await window.api.db.integrityCheck();
    setIntegrityResult(result);
    if (result.valid) {
      notify('✅ Base de données intacte');
    } else {
      notify(`⚠️ ${result.message}`);
    }
  };

  // ─── Backups ────────────────────────────────────────────────────────────────
  const loadBackups = async () => {
    try {
      const list = await window.api.backup.list();
      setBackups(list);
    } catch (e: any) {
      notify(`❌ Erreur : ${e.message}`);
    }
  };

  useEffect(() => {
    if (tab === 'backups') loadBackups();
  }, [tab]);

  const handleBackupNow = async () => {
    setBackupLoading(true);
    try {
      const result = await window.api.backup.now();
      if (result.success) {
        notify(`✅ Sauvegarde créée : ${result.path}`);
        loadBackups();
      } else {
        notify(`❌ ${result.error}`);
      }
    } catch (e: any) {
      notify(`❌ ${e.message}`);
    } finally {
      setBackupLoading(false);
    }
  };

  const handleRestoreBackup = async (backupPath: string, backupName: string) => {
    if (!confirm(`⚠️ Restaurer le backup "${backupName}" ?\n\nL'état actuel sera sauvegardé avant la restauration.\nL'application devra être redémarrée.`)) return;
    try {
      const result = await window.api.backup.restore(backupPath);
      if (result.success) {
        notify('✅ Restauration planifiée. Veuillez redémarrer l\'application — elle sera appliquée au prochain démarrage.');
      } else {
        notify(`❌ ${result.error}`);
      }
    } catch (e: any) {
      notify(`❌ ${e.message}`);
    }
  };

  const handleDeleteBackup = async (backupPath: string) => {
    if (!confirm('Supprimer cette sauvegarde ?')) return;
    try {
      const result = await window.api.backup.delete(backupPath);
      if (result.success) {
        notify('🗑️ Sauvegarde supprimée');
        loadBackups();
      } else {
        notify(`❌ ${result.error}`);
      }
    } catch (e: any) {
      notify(`❌ ${e.message}`);
    }
  };

  const [csvFilePath, setCsvFilePath] = useState('');

  const handlePickCsv = async () => {
    const result = await window.api.products.pickCsv();
    if (!result.canceled && result.path) {
      setCsvFilePath(result.path);
    }
  };

  const importCsv = async () => {
    const path = csvFilePath || ((document.getElementById('csv-path') as HTMLInputElement)?.value ?? '');
    if (!path.trim()) { notify('Veuillez sélectionner un fichier CSV'); return; }
    const result = await window.api.products.importCsv(path.trim());
    if (result.success) {
      setImportResult({ imported: result.imported, errors: result.errors, messages: result.messages ?? [] });
      notify(`✅ Import terminé : ${result.imported} produits, ${result.errors} erreurs`);
    } else {
      notify(`❌ ${result.error}`);
    }
  };

  // ─── Unit Conversions ────────────────────────────────────────────────────────
  const addConversion = async () => {
    if (!conversionForm.from_unit.trim() || !conversionForm.to_unit.trim()) return;
    const data: any = {
      from_unit: conversionForm.from_unit.trim(),
      to_unit: conversionForm.to_unit.trim(),
      factor: conversionForm.factor,
    };
    if (conversionForm.product_id) data.product_id = conversionForm.product_id;

    if (editingConversion) {
      const result = await window.api.conversions.update(editingConversion.id, data);
      if (result.success) {
        setEditingConversion(null);
        setConversionForm({ from_unit: '', to_unit: '', factor: 1, product_id: '' });
        loadAll();
        notify('✅ Conversion mise à jour');
      } else notify(`❌ ${result.error}`);
    } else {
      const result = await window.api.conversions.create(data);
      if (result.success) {
        setConversionForm({ from_unit: '', to_unit: '', factor: 1, product_id: '' });
        loadAll();
        notify('✅ Conversion créée');
      } else notify(`❌ ${result.error}`);
    }
  };

  const editConversion = (conv: UnitConversion) => {
    setEditingConversion(conv);
    setConversionForm({
      from_unit: conv.from_unit,
      to_unit: conv.to_unit,
      factor: conv.factor,
      product_id: conv.product_id ?? '',
    });
  };

  const cancelEditConversion = () => {
    setEditingConversion(null);
    setConversionForm({ from_unit: '', to_unit: '', factor: 1, product_id: '' });
  };

  const deleteConversion = async (id: string) => {
    if (!confirm('Supprimer cette conversion ?')) return;
    const result = await window.api.conversions.delete(id);
    if (result.success) { loadAll(); notify('🗑️ Conversion supprimée'); }
    else notify(`❌ ${result.error}`);
  };

  // ─── Global Settings ────────────────────────────────────────────────────────
  const saveGlobalSettings = async () => {
    const result = await window.api.globalSettings.save(globalSettings);
    if (result.success) {
      notify('✅ Paramètres d\'alertes enregistrés');
    } else {
      notify(`❌ ${result.error}`);
    }
  };

  // ─── Tabs ───────────────────────────────────────────────────────────────────
  const tabs: Array<{ id: Tab; label: string; icon: string }> = [
    { id: 'company', label: 'Entreprise', icon: '🏢' },
    { id: 'categories', label: 'Catégories', icon: '🏷️' },
    { id: 'discounts', label: 'Remises volume', icon: '📊' },
    { id: 'units', label: 'Unités', icon: '📏' },
    { id: 'alerts', label: 'Alertes', icon: '🔔' },
    { id: 'data', label: 'Données', icon: '💾' },
    { id: 'backups', label: 'Sauvegardes', icon: '🔐' },
    { id: 'audit', label: 'Journal d\'audit', icon: '📜' },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#f8fafc', height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '24px 30px 16px', borderBottom: '1px solid #e5e7eb', background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, fontSize: '28px', color: '#0f172a' }}>⚙️ Paramètres & Configuration</h1>
        {message && <div style={{ padding: '8px 16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', fontSize: '14px', fontWeight: '600', color: '#1e40af' }}>{message}</div>}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', padding: '12px 30px', background: 'white', borderBottom: '1px solid #e5e7eb', flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '10px 18px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600', background: tab === t.id ? '#0f172a' : '#f3f4f6', color: tab === t.id ? 'white' : '#6b7280' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Contenu */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '30px' }}>
        {/* ─── Entreprise ───────────────────────────────────────────────────── */}
        {tab === 'company' && (
          <div style={{ maxWidth: '720px', background: 'white', borderRadius: '14px', padding: '28px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <SectionTitle icon="🏢" title="Informations de l'entreprise" />
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
            <button onClick={saveCompany} style={{ padding: '12px 28px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer', marginTop: '12px' }}>
              💾 Enregistrer
            </button>
          </div>
        )}

        {/* ─── Catégories ──────────────────────────────────────────────────── */}
        {tab === 'categories' && (
          <div style={{ maxWidth: '820px' }}>
            {/* Import CSV */}
            <div style={{ background: 'white', borderRadius: '14px', padding: '22px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '20px' }}>
              <SectionTitle icon="📥" title="Import produits (CSV)" />
              <p style={{ marginTop: 0, color: '#6b7280', fontSize: '13px' }}>
                Colonnes : reference;designation;purchase_price;selling_price;wholesale_price;min_stock;barcode;unit
              </p>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input id="csv-path" value={csvFilePath} onChange={e => setCsvFilePath(e.target.value)} placeholder="Chemin du fichier CSV..." style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
                <button onClick={handlePickCsv} style={{ padding: '12px 24px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  📂 Parcourir
                </button>
                <button onClick={importCsv} disabled={!csvFilePath} style={{ padding: '12px 24px', background: csvFilePath ? '#10b981' : '#9ca3af', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: csvFilePath ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}>
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
              {categories.length === 0 && <div style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>Aucune catégorie.</div>}
              {categories.map(cat => (
                <div key={cat.id} style={{ border: '1px solid #e5e7eb', borderRadius: '10px', padding: '14px', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <strong style={{ flex: 1 }}>{cat.name}</strong>
                    <button onClick={() => deleteCategory(cat.id)} style={{ padding: '6px 12px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}>🗑️</button>
                  </div>
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

        {/* ─── Remises ─────────────────────────────────────────────────────── */}
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

        {/* ─── Unités ──────────────────────────────────────────────────────── */}
        {tab === 'units' && (
          <div style={{ maxWidth: '920px', background: 'white', borderRadius: '14px', padding: '28px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <SectionTitle icon="📏" title="Conversions d'unités" />
            <p style={{ marginTop: 0, color: '#6b7280', fontSize: '13px', marginBottom: '20px' }}>
              Définissez les facteurs de conversion entre unités. Ex : 1 carton = 12 pièces (factor = 12).
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: '10px', marginBottom: '16px', alignItems: 'end' }}>
              <div>
                <label style={labelStyle}>Unité source</label>
                <input style={inputStyle} placeholder="Ex : carton" value={conversionForm.from_unit} onChange={e => setConversionForm({ ...conversionForm, from_unit: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>Unité cible</label>
                <input style={inputStyle} placeholder="Ex : pièce" value={conversionForm.to_unit} onChange={e => setConversionForm({ ...conversionForm, to_unit: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>Facteur</label>
                <input style={inputStyle} type="number" step="0.01" min="0" value={conversionForm.factor} onChange={e => setConversionForm({ ...conversionForm, factor: Number(e.target.value) })} />
              </div>
              <div>
                <label style={labelStyle}>Produit (optionnel)</label>
                <select style={inputStyle} value={conversionForm.product_id} onChange={e => setConversionForm({ ...conversionForm, product_id: e.target.value })}>
                  <option value="">— Tous les produits —</option>
                  {productsList.map(p => <option key={p.id} value={p.id}>{p.designation}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={addConversion} style={{ padding: '10px 18px', background: editingConversion ? '#f59e0b' : '#2563eb', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  {editingConversion ? '💾 Modifier' : '+ Ajouter'}
                </button>
                {editingConversion && (
                  <button onClick={cancelEditConversion} style={{ padding: '10px 14px', background: '#f3f4f6', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
                    ✕
                  </button>
                )}
              </div>
            </div>

            {conversions.length === 0 ? (
              <div style={{ color: '#9ca3af', textAlign: 'center', padding: '30px' }}>Aucune conversion définie.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                    <th style={{ padding: '10px', borderBottom: '2px solid #e5e7eb' }}>De</th>
                    <th style={{ padding: '10px', borderBottom: '2px solid #e5e7eb' }}>Vers</th>
                    <th style={{ padding: '10px', borderBottom: '2px solid #e5e7eb' }}>Facteur</th>
                    <th style={{ padding: '10px', borderBottom: '2px solid #e5e7eb' }}>Produit</th>
                    <th style={{ padding: '10px', borderBottom: '2px solid #e5e7eb' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {conversions.map(c => (
                    <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px', fontWeight: '600' }}>{c.from_unit}</td>
                      <td style={{ padding: '10px', fontWeight: '600' }}>{c.to_unit}</td>
                      <td style={{ padding: '10px', fontWeight: 'bold', color: '#2563eb' }}>{c.factor}</td>
                      <td style={{ padding: '10px', color: '#6b7280', fontSize: '13px' }}>
                        {c.product_id ? (productsList.find(p => p.id === c.product_id)?.designation ?? c.product_id) : '— Général —'}
                      </td>
                      <td style={{ padding: '10px', display: 'flex', gap: '6px' }}>
                        <button onClick={() => editConversion(c)} style={{ padding: '4px 10px', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: 'bold' }}>✏️</button>
                        <button onClick={() => deleteConversion(c.id)} style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>🗑️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ─── Alertes ─────────────────────────────────────────────────────── */}
        {tab === 'alerts' && (
          <div style={{ maxWidth: '720px', background: 'white', borderRadius: '14px', padding: '28px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <SectionTitle icon="🔔" title="Paramètres d'alertes" />
            <p style={{ marginTop: 0, color: '#6b7280', fontSize: '13px', marginBottom: '24px' }}>
              Configurez les seuils et comportements des alertes système.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px', marginBottom: '24px' }}>
              <div>
                <label style={labelStyle}>Seuil critique de stock (qté)</label>
                <input style={inputStyle} type="number" min="0" value={globalSettings.critical_stock_threshold} onChange={e => setGlobalSettings({ ...globalSettings, critical_stock_threshold: Number(e.target.value) })} />
                <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af' }}>Stock ≤ cette valeur = alerte critique 🔴</p>
              </div>
              <div>
                <label style={labelStyle}>Multiplicateur seuil bas (× min_stock)</label>
                <input style={inputStyle} type="number" step="0.1" min="0" value={globalSettings.low_stock_threshold_multiplier} onChange={e => setGlobalSettings({ ...globalSettings, low_stock_threshold_multiplier: Number(e.target.value) })} />
                <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af' }}>Ex : 1.5 signifie alerte si stock {'<'} 1.5 × min_stock</p>
              </div>
              <div>
                <label style={labelStyle}>Taux de TVA par défaut (%)</label>
                <input style={inputStyle} type="number" step="0.5" min="0" max="100" value={globalSettings.default_vat_rate} onChange={e => setGlobalSettings({ ...globalSettings, default_vat_rate: Number(e.target.value) })} />
                <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af' }}>Utilisé pour les documents et calculs</p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '24px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: '600', color: '#374151' }}>
                <input type="checkbox" checked={globalSettings.show_low_stock_alerts} onChange={e => setGlobalSettings({ ...globalSettings, show_low_stock_alerts: e.target.checked })} style={{ width: '18px', height: '18px', accentColor: '#3b82f6' }} />
                🔴 Activer les alertes de stock bas
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: '600', color: '#374151' }}>
                <input type="checkbox" checked={globalSettings.show_overdue_alerts} onChange={e => setGlobalSettings({ ...globalSettings, show_overdue_alerts: e.target.checked })} style={{ width: '18px', height: '18px', accentColor: '#3b82f6' }} />
                ⏰ Activer les alertes d'échéances dépassées
              </label>
            </div>

            <button onClick={saveGlobalSettings} style={{ padding: '12px 28px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer' }}>
              💾 Enregistrer les paramètres
            </button>
          </div>
        )}

        {/* ─── Données ─────────────────────────────────────────────────────── */}
        {tab === 'data' && (
          <div style={{ maxWidth: '720px' }}>
            <div style={{ background: 'white', borderRadius: '14px', padding: '28px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '20px' }}>
              <SectionTitle icon="💾" title="Emplacement des données" />
              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle}>Emplacement actuel</label>
                <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px', fontFamily: 'monospace', fontSize: '14px', color: '#374151', border: '1px solid #e2e8f0' }}>
                  📁 {dataPath || 'Chargement...'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button onClick={handleChangeDataLocation} disabled={isChangingLocation}
                  style={{ padding: '12px 24px', background: isChangingLocation ? '#9ca3af' : '#f59e0b', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: isChangingLocation ? 'not-allowed' : 'pointer' }}>
                  {isChangingLocation ? '⏳ Migration...' : '📁 Changer l\'emplacement'}
                </button>
                {dataPath && (
                  <button onClick={() => window.api.storage.openFolder(dataPath)}
                    style={{ padding: '12px 24px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
                    📂 Ouvrir le dossier
                  </button>
                )}
              </div>
              <p style={{ marginTop: '12px', color: '#6b7280', fontSize: '12px' }}>
                ⚠️ Le changement d'emplacement copie toutes vos données vers le nouvel emplacement. L'ancien emplacement est conservé par sécurité.
              </p>
            </div>

            <div style={{ background: 'white', borderRadius: '14px', padding: '28px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <SectionTitle icon="🔍" title="Intégrité de la base de données" />
              <button onClick={handleCheckIntegrity} style={{ padding: '12px 24px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '12px' }}>
                🔍 Vérifier l'intégrité
              </button>
              {integrityResult && (
                <div style={{ padding: '12px', borderRadius: '8px', background: integrityResult.valid ? '#f0fdf4' : '#fef2f2', color: integrityResult.valid ? '#166534' : '#991b1b', fontSize: '14px', fontWeight: '600' }}>
                  {integrityResult.valid ? '✅ ' : '⚠️ '}{integrityResult.message}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── Sauvegardes ─────────────────────────────────────────────────── */}
        {tab === 'backups' && (
          <div style={{ maxWidth: '920px' }}>
            <div style={{ background: 'white', borderRadius: '14px', padding: '28px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '20px' }}>
              <SectionTitle icon="🔐" title="Sauvegardes" />
              {/* Backup auto settings */}
              <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '8px', marginBottom: '20px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600', color: '#374151' }}>
                    <input type="checkbox" checked={globalSettings.auto_backup_enabled} onChange={e => setGlobalSettings({ ...globalSettings, auto_backup_enabled: e.target.checked })} style={{ width: '18px', height: '18px', accentColor: '#22c55e' }} />
                    ⚡ Sauvegarde automatique
                  </label>
                </div>
                {globalSettings.auto_backup_enabled && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                    <div>
                      <label style={labelStyle}>Fréquence</label>
                      <select style={inputStyle} value={globalSettings.auto_backup_frequency} onChange={e => setGlobalSettings({ ...globalSettings, auto_backup_frequency: e.target.value as 'on_close' | 'daily' | 'weekly' })}>
                        <option value="on_close">À chaque fermeture</option>
                        <option value="daily">Chaque jour</option>
                        <option value="weekly">Chaque semaine</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Nombre max de sauvegardes</label>
                      <input style={inputStyle} type="number" min="1" max="50" value={globalSettings.max_backups} onChange={e => setGlobalSettings({ ...globalSettings, max_backups: Number(e.target.value) })} />
                    </div>
                  </div>
                )}
                <button onClick={saveGlobalSettings} style={{ marginTop: '10px', padding: '8px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer' }}>
                  💾 Enregistrer les paramètres de sauvegarde
                </button>
              </div>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
                <button onClick={handleBackupNow} disabled={backupLoading}
                  style={{ padding: '12px 24px', background: backupLoading ? '#9ca3af' : '#22c55e', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: backupLoading ? 'not-allowed' : 'pointer' }}>
                  {backupLoading ? '⏳ Sauvegarde...' : '💾 Créer une sauvegarde'}
                </button>
                <button onClick={loadBackups} style={{ padding: '12px 24px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
                  🔄 Actualiser
                </button>
              </div>

              {backups.length === 0 ? (
                <div style={{ color: '#9ca3af', textAlign: 'center', padding: '30px' }}>
                  <div style={{ fontSize: '36px', marginBottom: '8px' }}>📦</div>
                  Aucune sauvegarde disponible.
                </div>
              ) : (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '8px', padding: '10px 0', borderBottom: '2px solid #e5e7eb', fontSize: '13px', fontWeight: '600', color: '#6b7280' }}>
                    <div>Fichier</div>
                    <div>Date</div>
                    <div>Taille</div>
                    <div>Actions</div>
                  </div>
                  {backups.map(b => (
                    <div key={b.name} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '8px', padding: '12px 0', borderBottom: '1px solid #f1f5f9', alignItems: 'center' }}>
                      <div style={{ fontFamily: 'monospace', fontSize: '13px', color: '#374151' }}>
                        {b.name}
                        {b.valid === false && <span style={{ color: '#991b1b', marginLeft: '6px', fontSize: '12px' }}>⚠️</span>}
                      </div>
                      <div style={{ fontSize: '13px', color: '#6b7280', whiteSpace: 'nowrap' }}>{b.date}</div>
                      <div style={{ fontSize: '13px', color: '#6b7280' }}>{b.sizeKB} KB</div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => handleRestoreBackup(b.path, b.name)} style={{ padding: '4px 12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}>
                          Restaurer
                        </button>
                        <button onClick={() => handleDeleteBackup(b.path)} style={{ padding: '4px 12px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}>
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── Audit ───────────────────────────────────────────────────────── */}
        {tab === 'audit' && (
          <div style={{ maxWidth: '920px', background: 'white', borderRadius: '14px', padding: '28px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <SectionTitle icon="📜" title="Journal d'audit (traçabilité)" />
            {logs.length === 0 ? (
              <div style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>Aucune action journalisée.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                    <th style={{ padding: '10px', borderBottom: '2px solid #e5e7eb' }}>Date</th>
                    <th style={{ padding: '10px', borderBottom: '2px solid #e5e7eb' }}>Action</th>
                    <th style={{ padding: '10px', borderBottom: '2px solid #e5e7eb' }}>Type</th>
                    <th style={{ padding: '10px', borderBottom: '2px solid #e5e7eb' }}>Détails</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: '#6b7280' }}>{new Date(log.created_at).toLocaleString('fr-MA')}</td>
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
