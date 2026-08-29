import React, { useEffect, useState } from 'react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Button, Card, Input, Select, PageHeader } from '../components/ui';

// ─── Onglets ────────────────────────────────────────────────────────────────
type Tab = 'company' | 'categories' | 'discounts' | 'data' | 'backups' | 'audit' | 'units' | 'alerts' | 'updates';

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

const SectionTitle: React.FC<{ icon: string; title: string }> = ({ icon, title }) => (
  <h2 className="section-title" style={{ margin: '0 0 16px', fontSize: 'var(--font-size-lg)' }}>
    <span>{icon}</span>{title}
  </h2>
);

// Icône de suppression (poubelle) — SVG en currentColor → suit la couleur
// du bouton (rouge, hover rouge clair). Plus propre qu'un emoji.
const TrashIcon: React.FC<{ size?: number }> = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export const SettingsPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('company');
  const [message, setMessage] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    message: React.ReactNode;
    danger?: boolean;
    confirmLabel: string;
    action: () => void;
  } | null>(null);

  const [company, setCompany] = useState({ name: '', tagline: '', ice: '', rc: '', if_: '', patente: '', address: '', phone: '', email: '', logo_path: '' });
  const [categories, setCategories] = useState<Category[]>([]);
  const [newCat, setNewCat] = useState('');
  const [newSubs, setNewSubs] = useState<Record<string, string>>({});
  const [discounts, setDiscounts] = useState<VolumeDiscount[]>([]);
  const [discountForm, setDiscountForm] = useState({ name: '', min_qty: 1, max_qty: '', discount_pct: 0 });
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [dataPath, setDataPath] = useState('');
  const [isChangingLocation, setIsChangingLocation] = useState(false);
  const [integrityResult, setIntegrityResult] = useState<{ valid: boolean; message: string } | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; errors: number; messages: string[] } | null>(null);
  const [conversions, setConversions] = useState<UnitConversion[]>([]);
  const [conversionForm, setConversionForm] = useState({ from_unit: '', to_unit: '', factor: 1, product_id: '' });
  const [editingConversion, setEditingConversion] = useState<UnitConversion | null>(null);
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

  const doDeleteCategory = async (id: string) => {
    const result = await window.api.categories.delete(id);
    if (result.success) { loadAll(); notify('🗑️ Catégorie supprimée'); }
    else notify(`❌ ${result.error}`);
  };

  const deleteCategory = async (id: string) => {
    setPendingConfirm({
      title: 'Supprimer cette catégorie ?',
      message: (
        <>
          La catégorie et <strong>toutes ses sous-catégories</strong> seront supprimées.
        </>
      ),
      danger: true,
      confirmLabel: 'Supprimer',
      action: () => doDeleteCategory(id),
    });
  };

  const doDeleteSubcategory = async (id: string) => {
    const result = await window.api.categories.deleteSub(id);
    if (result.success) { loadAll(); notify('🗑️ Sous-catégorie supprimée'); }
    else notify(`❌ ${result.error}`);
  };

  const deleteSubcategory = async (id: string, name: string) => {
    setPendingConfirm({
      title: 'Supprimer cette sous-catégorie ?',
      message: (
        <>
          La sous-catégorie <strong>{name}</strong> sera <strong>définitivement supprimée</strong>.
          <br />Les produits liés resteront sans sous-catégorie.
        </>
      ),
      danger: true,
      confirmLabel: 'Supprimer',
      action: () => doDeleteSubcategory(id),
    });
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

  const doDeleteDiscount = async (id: string) => {
    const result = await window.api.discounts.delete(id);
    if (result.success) { loadAll(); notify('🗑️ Règle supprimée'); }
    else notify(`❌ ${result.error}`);
  };

  const deleteDiscount = async (id: string) => {
    setPendingConfirm({
      title: 'Supprimer cette règle de remise ?',
      message: (
        <>
          La règle de remise sera <strong>définitivement supprimée</strong>.
        </>
      ),
      danger: true,
      confirmLabel: 'Supprimer',
      action: () => doDeleteDiscount(id),
    });
  };

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

  const doRestoreBackup = async (backupPath: string) => {
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

  const handleRestoreBackup = async (backupPath: string, backupName: string) => {
    setPendingConfirm({
      title: 'Restaurer cette sauvegarde ?',
      message: (
        <>
          <strong>{backupName}</strong> sera restaurée.
          <br />L'état actuel sera sauvegardé avant la restauration.
          <br /><span className="text-danger font-semibold">L'application devra être redémarrée.</span>
        </>
      ),
      danger: true,
      confirmLabel: 'Restaurer',
      action: () => doRestoreBackup(backupPath),
    });
  };

  const handleDeleteBackup = async (backupPath: string) => {
    setPendingConfirm({
      title: 'Supprimer cette sauvegarde ?',
      message: (
        <>
          La sauvegarde sera <strong>définitivement supprimée</strong>. Cette action est irréversible.
        </>
      ),
      danger: true,
      confirmLabel: 'Supprimer',
      action: async () => {
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
      },
    });
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

  const doDeleteConversion = async (id: string) => {
    const result = await window.api.conversions.delete(id);
    if (result.success) { loadAll(); notify('🗑️ Conversion supprimée'); }
    else notify(`❌ ${result.error}`);
  };

  const deleteConversion = async (id: string) => {
    setPendingConfirm({
      title: 'Supprimer cette conversion ?',
      message: (
        <>
          La conversion d'unité sera <strong>définitivement supprimée</strong>.
        </>
      ),
      danger: true,
      confirmLabel: 'Supprimer',
      action: () => doDeleteConversion(id),
    });
  };

  const saveGlobalSettings = async () => {
    const result = await window.api.globalSettings.save(globalSettings);
    if (result.success) {
      notify('✅ Paramètres d\'alertes enregistrés');
    } else {
      notify(`❌ ${result.error}`);
    }
  };

  const [updateResult, setUpdateResult] = useState<string | null>(null);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);

  const handleCheckForUpdates = async () => {
    setIsCheckingUpdates(true);
    setUpdateResult(null);
    try {
      const result = await window.api.updates.checkForUpdates();
      setUpdateResult(result.success ? result.message : `❌ ${result.message}`);
    } catch (e: any) {
      setUpdateResult(`❌ ${e.message}`);
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  const handleExportErrorLog = async () => {
    try {
      const result = await window.api.logs.exportErrorLog();
      if (result.success) {
        notify(`📄 Journal exporté : ${result.filePath}`);
      } else {
        notify(`❌ ${result.error}`);
      }
    } catch (e: any) {
      notify(`❌ ${e.message}`);
    }
  };

  const tabs: Array<{ id: Tab; label: string; icon: string }> = [
    { id: 'company', label: 'Entreprise', icon: '🏢' },
    { id: 'categories', label: 'Catégories', icon: '🏷️' },
    { id: 'discounts', label: 'Remises volume', icon: '📊' },
    { id: 'units', label: 'Unités', icon: '📏' },
    { id: 'alerts', label: 'Alertes', icon: '🔔' },
    { id: 'data', label: 'Données', icon: '💾' },
    { id: 'backups', label: 'Sauvegardes', icon: '🔐' },
    { id: 'audit', label: 'Journal d\'audit', icon: '📜' },
    { id: 'updates', label: 'Mises à jour', icon: '🔄' },
  ];

  return (
    <div className="page-shell">
      <PageHeader
        icon="⚙️"
        title="Paramètres & Configuration"
        actions={
          message ? (
            <span className="badge badge-info">{message}</span>
          ) : undefined
        }
      />

      <div style={{ display: 'flex', gap: 4, padding: '12px 30px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="page-content">
        {tab === 'company' && (
          <Card padding style={{ maxWidth: 720 }}>
            <SectionTitle icon="🏢" title="Informations de l'entreprise" />
            <p className="text-sm text-secondary" style={{ marginTop: 0 }}>
              Ces informations apparaissent sur les factures, devis, bons de livraison, avoirs, étiquettes et rapports.
            </p>
            <div className="form-row">
              <Input label="Nom de l'entreprise" value={company.name} onChange={e => setCompany({ ...company, name: e.target.value })} />
              <Input label="Slogan / secteur" value={company.tagline} onChange={e => setCompany({ ...company, tagline: e.target.value })} />
              <Input label="ICE *" value={company.ice} onChange={e => setCompany({ ...company, ice: e.target.value })} />
              <Input label="RC *" value={company.rc} onChange={e => setCompany({ ...company, rc: e.target.value })} />
              <Input label="IF *" value={company.if_} onChange={e => setCompany({ ...company, if_: e.target.value })} />
              <Input label="Téléphone" value={company.phone} onChange={e => setCompany({ ...company, phone: e.target.value })} />
              <Input label="Email" value={company.email} onChange={e => setCompany({ ...company, email: e.target.value })} />
              <Input label="Adresse" value={company.address} onChange={e => setCompany({ ...company, address: e.target.value })} />
            </div>
            <Button onClick={saveCompany} className="mt-4">💾 Enregistrer</Button>
          </Card>
        )}

        {tab === 'categories' && (
          <div style={{ maxWidth: 820 }}>
            <Card padding className="mb-4">
              <SectionTitle icon="📥" title="Import produits (CSV)" />
              <p className="text-sm text-secondary" style={{ marginTop: 0 }}>
                Colonnes : reference;designation;purchase_price;selling_price;wholesale_price;min_stock;barcode;unit
              </p>
              <div className="flex gap-2">
                <Input id="csv-path" value={csvFilePath} onChange={e => setCsvFilePath(e.target.value)} placeholder="Chemin du fichier CSV..." className="flex-1" />
                <Button onClick={handlePickCsv}>📂 Parcourir</Button>
                <Button variant="success" onClick={importCsv} disabled={!csvFilePath}>📥 Importer</Button>
              </div>
              {importResult && (
                <div className="text-sm mt-3">
                  <strong>Importés : {importResult.imported}</strong> · Erreurs : {importResult.errors}
                  {importResult.messages.length > 0 && (
                    <div className="surface-danger" style={{ maxHeight: 120, overflowY: 'auto', marginTop: 6, padding: 10 }}>
                      {importResult.messages.slice(0, 10).map((m, i) => <div key={i}>{m}</div>)}
                    </div>
                  )}
                </div>
              )}
            </Card>

            <Card padding>
              <SectionTitle icon="🏷️" title="Catégories & Sous-catégories" />
              <div className="flex gap-2 mb-4">
                <Input placeholder="Nouvelle catégorie" value={newCat} onChange={e => setNewCat(e.target.value)} className="flex-1" />
                <Button onClick={addCategory}>+ Ajouter</Button>
              </div>
              {categories.length === 0 && <div className="text-muted text-center" style={{ padding: 20 }}>Aucune catégorie.</div>}
              {categories.map(cat => (
                <div key={cat.id} className="card card-body-compact mb-2">
                  <div className="flex items-center gap-2">
                    <strong className="flex-1">{cat.name}</strong>
                    <button className="icon-btn icon-btn-danger" onClick={() => deleteCategory(cat.id)} title="Supprimer la catégorie" aria-label={`Supprimer la catégorie ${cat.name}`}>
                      <TrashIcon />
                    </button>
                  </div>
                  <div style={{ marginTop: 10, paddingLeft: 14, borderLeft: '2px solid var(--border)' }}>
                    {(cat.subcategories ?? []).map(sub => (
                      <div key={sub.id} className="text-sm text-secondary" style={{ padding: '3px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>• {sub.name}</span>
                        <button className="icon-btn icon-btn-danger icon-btn-xs" onClick={() => deleteSubcategory(sub.id, sub.name)} title="Supprimer" aria-label={`Supprimer la sous-catégorie ${sub.name}`}>
                          <TrashIcon size={13} />
                        </button>
                      </div>
                    ))}
                    <div className="flex gap-2 mt-2">
                      <Input
                        placeholder="Sous-catégorie"
                        value={newSubs[cat.id] ?? ''}
                        onChange={e => setNewSubs({ ...newSubs, [cat.id]: e.target.value })}
                        inputSize="sm"
                        className="flex-1"
                      />
                      <Button variant="secondary" size="sm" onClick={() => addSubcategory(cat.id)}>+ Sous-catégorie</Button>
                    </div>
                  </div>
                </div>
              ))}
            </Card>
          </div>
        )}

        {tab === 'discounts' && (
          <Card padding style={{ maxWidth: 720 }}>
            <SectionTitle icon="📊" title="Remises par volume (tarification)" />
            <div className="grid-3 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <Input label="Nom" placeholder="Ex : 10-49" value={discountForm.name} onChange={e => setDiscountForm({ ...discountForm, name: e.target.value })} />
              <Input label="Qté min" type="number" value={discountForm.min_qty} onChange={e => setDiscountForm({ ...discountForm, min_qty: Number(e.target.value) })} />
              <Input label="Qté max" type="number" placeholder="vide = ∞" value={discountForm.max_qty} onChange={e => setDiscountForm({ ...discountForm, max_qty: e.target.value })} />
              <Input label="Remise %" type="number" step="0.5" value={discountForm.discount_pct} onChange={e => setDiscountForm({ ...discountForm, discount_pct: Number(e.target.value) })} />
            </div>
            <Button onClick={addDiscount}>+ Ajouter la règle</Button>

            {discounts.length > 0 && (
              <table className="table mt-4">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Qté min</th>
                    <th>Qté max</th>
                    <th>Remise</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {discounts.map(d => (
                    <tr key={d.id}>
                      <td className="font-semibold">{d.name}</td>
                      <td>{d.min_qty}</td>
                      <td>{d.max_qty ?? '∞'}</td>
                      <td className="text-success font-semibold">{d.discount_pct}%</td>
                      <td>
                        <Button variant="danger" size="sm" onClick={() => deleteDiscount(d.id)}>🗑️</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}

        {tab === 'units' && (
          <Card padding style={{ maxWidth: 920 }}>
            <SectionTitle icon="📏" title="Conversions d'unités" />
            <p className="text-sm text-secondary" style={{ marginTop: 0, marginBottom: 20 }}>
              Définissez les facteurs de conversion entre unités. Ex : 1 carton = 12 pièces (factor = 12).
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 10, marginBottom: 16, alignItems: 'end' }}>
              <Input label="Unité source" placeholder="Ex : carton" value={conversionForm.from_unit} onChange={e => setConversionForm({ ...conversionForm, from_unit: e.target.value })} />
              <Input label="Unité cible" placeholder="Ex : pièce" value={conversionForm.to_unit} onChange={e => setConversionForm({ ...conversionForm, to_unit: e.target.value })} />
              <Input label="Facteur" type="number" step="0.01" min="0" value={conversionForm.factor} onChange={e => setConversionForm({ ...conversionForm, factor: Number(e.target.value) })} />
              <Select label="Produit (optionnel)" value={conversionForm.product_id} onChange={e => setConversionForm({ ...conversionForm, product_id: e.target.value })}>
                <option value="">— Tous les produits —</option>
                {productsList.map(p => <option key={p.id} value={p.id}>{p.designation}</option>)}
              </Select>
              <div className="flex gap-2">
                <Button onClick={addConversion} style={editingConversion ? { background: 'var(--warning)', borderColor: 'transparent' } : undefined}>
                  {editingConversion ? '💾 Modifier' : '+ Ajouter'}
                </Button>
                {editingConversion && (
                  <Button variant="secondary" onClick={cancelEditConversion}>✕</Button>
                )}
              </div>
            </div>

            {conversions.length === 0 ? (
              <div className="text-muted text-center" style={{ padding: 30 }}>Aucune conversion définie.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>De</th>
                    <th>Vers</th>
                    <th>Facteur</th>
                    <th>Produit</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {conversions.map(c => (
                    <tr key={c.id}>
                      <td className="font-semibold">{c.from_unit}</td>
                      <td className="font-semibold">{c.to_unit}</td>
                      <td className="font-semibold" style={{ color: 'var(--info)' }}>{c.factor}</td>
                      <td className="text-sm text-secondary">
                        {c.product_id ? (productsList.find(p => p.id === c.product_id)?.designation ?? c.product_id) : '— Général —'}
                      </td>
                      <td>
                        <div className="flex gap-2">
                          <Button variant="secondary" size="sm" onClick={() => editConversion(c)}>✏️</Button>
                          <Button variant="danger" size="sm" onClick={() => deleteConversion(c.id)}>🗑️</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}

        {tab === 'alerts' && (
          <Card padding style={{ maxWidth: 720 }}>
            <SectionTitle icon="🔔" title="Paramètres d'alertes" />
            <p className="text-sm text-secondary" style={{ marginTop: 0, marginBottom: 24 }}>
              Configurez les seuils et comportements des alertes système.
            </p>

            <div className="form-row mb-4">
              <div>
                <Input label="Seuil critique de stock (qté)" type="number" min="0" value={globalSettings.critical_stock_threshold} onChange={e => setGlobalSettings({ ...globalSettings, critical_stock_threshold: Number(e.target.value) })} />
                <p className="text-xs text-muted" style={{ margin: 0 }}>Stock ≤ cette valeur = alerte critique 🔴</p>
              </div>
              <div>
                <Input label="Multiplicateur seuil bas (× min_stock)" type="number" step="0.1" min="0" value={globalSettings.low_stock_threshold_multiplier} onChange={e => setGlobalSettings({ ...globalSettings, low_stock_threshold_multiplier: Number(e.target.value) })} />
                <p className="text-xs text-muted" style={{ margin: 0 }}>Ex : 1.5 signifie alerte si stock {'<'} 1.5 × min_stock</p>
              </div>
              <div>
                <Input label="Taux de TVA par défaut (%)" type="number" step="0.5" min="0" max="100" value={globalSettings.default_vat_rate} onChange={e => setGlobalSettings({ ...globalSettings, default_vat_rate: Number(e.target.value) })} />
                <p className="text-xs text-muted" style={{ margin: 0 }}>Utilisé pour les documents et calculs</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 mb-4">
              <label className="flex items-center gap-2 cursor-pointer font-semibold text-secondary">
                <input type="checkbox" checked={globalSettings.show_low_stock_alerts} onChange={e => setGlobalSettings({ ...globalSettings, show_low_stock_alerts: e.target.checked })} style={{ width: 18, height: 18, accentColor: 'var(--primary)' }} />
                🔴 Activer les alertes de stock bas
              </label>
              <label className="flex items-center gap-2 cursor-pointer font-semibold text-secondary">
                <input type="checkbox" checked={globalSettings.show_overdue_alerts} onChange={e => setGlobalSettings({ ...globalSettings, show_overdue_alerts: e.target.checked })} style={{ width: 18, height: 18, accentColor: 'var(--primary)' }} />
                ⏰ Activer les alertes d'échéances dépassées
              </label>
            </div>

            <Button onClick={saveGlobalSettings}>💾 Enregistrer les paramètres</Button>
          </Card>
        )}

        {tab === 'data' && (
          <div style={{ maxWidth: 720 }}>
            <Card padding className="mb-4">
              <SectionTitle icon="💾" title="Emplacement des données" />
              <div className="form-group mb-4">
                <label className="form-label">Emplacement actuel</label>
                <div className="surface-muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-md)' }}>
                  📁 {dataPath || 'Chargement...'}
                </div>
              </div>
              <div className="flex gap-3">
                <Button onClick={handleChangeDataLocation} disabled={isChangingLocation} style={{ background: 'var(--warning)', borderColor: 'transparent' }}>
                  {isChangingLocation ? '⏳ Migration...' : '📁 Changer l\'emplacement'}
                </Button>
                {dataPath && (
                  <Button onClick={() => window.api.storage.openFolder(dataPath)}>📂 Ouvrir le dossier</Button>
                )}
              </div>
              <p className="text-xs text-secondary mt-3">
                ⚠️ Le changement d'emplacement copie toutes vos données vers le nouvel emplacement. L'ancien emplacement est conservé par sécurité.
              </p>
            </Card>

            <Card padding>
              <SectionTitle icon="🔍" title="Intégrité de la base de données" />
              <Button onClick={handleCheckIntegrity} className="mb-3">🔍 Vérifier l'intégrité</Button>
              {integrityResult && (
                <div className={integrityResult.valid ? 'surface-success' : 'surface-danger'} style={{ padding: 12, fontSize: 'var(--font-size-md)', fontWeight: 600 }}>
                  <span className={integrityResult.valid ? 'text-success' : 'text-danger'}>
                    {integrityResult.valid ? '✅ ' : '⚠️ '}{integrityResult.message}
                  </span>
                </div>
              )}
            </Card>
          </div>
        )}

        {tab === 'backups' && (
          <div style={{ maxWidth: 920 }}>
            <Card padding>
              <SectionTitle icon="🔐" title="Sauvegardes" />
              <div className="surface-muted mb-4" style={{ padding: 16, border: '1px solid var(--border)' }}>
                <label className="flex items-center gap-2 cursor-pointer font-semibold text-secondary mb-3">
                  <input type="checkbox" checked={globalSettings.auto_backup_enabled} onChange={e => setGlobalSettings({ ...globalSettings, auto_backup_enabled: e.target.checked })} style={{ width: 18, height: 18, accentColor: 'var(--success)' }} />
                  ⚡ Sauvegarde automatique
                </label>
                {globalSettings.auto_backup_enabled && (
                  <div className="form-row">
                    <Select label="Fréquence" value={globalSettings.auto_backup_frequency} onChange={e => setGlobalSettings({ ...globalSettings, auto_backup_frequency: e.target.value as 'on_close' | 'daily' | 'weekly' })}>
                      <option value="on_close">À chaque fermeture</option>
                      <option value="daily">Chaque jour</option>
                      <option value="weekly">Chaque semaine</option>
                    </Select>
                    <Input label="Nombre max de sauvegardes" type="number" min="1" max="50" value={globalSettings.max_backups} onChange={e => setGlobalSettings({ ...globalSettings, max_backups: Number(e.target.value) })} />
                  </div>
                )}
                <Button size="sm" onClick={saveGlobalSettings} className="mt-2">💾 Enregistrer les paramètres de sauvegarde</Button>
              </div>
              <div className="flex gap-3 mb-4">
                <Button variant="success" onClick={handleBackupNow} disabled={backupLoading}>
                  {backupLoading ? '⏳ Sauvegarde...' : '💾 Créer une sauvegarde'}
                </Button>
                <Button variant="secondary" onClick={loadBackups}>🔄 Actualiser</Button>
              </div>

              {backups.length === 0 ? (
                <div className="state-box" style={{ padding: 30 }}>
                  <div className="state-icon">📦</div>
                  <div className="state-text">Aucune sauvegarde disponible.</div>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, padding: '10px 0', borderBottom: '2px solid var(--border)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }} className="text-secondary">
                    <div>Fichier</div>
                    <div>Date</div>
                    <div>Taille</div>
                    <div>Actions</div>
                  </div>
                  {backups.map(b => (
                    <div key={b.name} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, padding: '12px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)' }}>
                        {b.name}
                        {b.valid === false && <span className="text-danger text-xs" style={{ marginLeft: 6 }}>⚠️</span>}
                      </div>
                      <div className="text-sm text-secondary" style={{ whiteSpace: 'nowrap' }}>{b.date}</div>
                      <div className="text-sm text-secondary">{b.sizeKB} KB</div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleRestoreBackup(b.path, b.name)}>Restaurer</Button>
                        <Button variant="danger" size="sm" onClick={() => handleDeleteBackup(b.path)}>🗑️</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}

        {tab === 'audit' && (
          <Card padding style={{ maxWidth: 920 }}>
            <SectionTitle icon="📜" title="Journal d'audit (traçabilité)" />
            {logs.length === 0 ? (
              <div className="text-muted text-center" style={{ padding: 20 }}>Aucune action journalisée.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Action</th>
                    <th>Type</th>
                    <th>Détails</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id}>
                      <td className="text-sm text-secondary" style={{ whiteSpace: 'nowrap' }}>{new Date(log.created_at).toLocaleString('fr-MA')}</td>
                      <td>{log.action}</td>
                      <td className="text-secondary">{log.entity_type}</td>
                      <td>{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}

        {tab === 'updates' && (
          <div style={{ maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <Card padding>
              <SectionTitle icon="🔄" title="Mises à jour de l'application" />
              <p className="text-sm text-secondary" style={{ marginTop: 0, marginBottom: 20 }}>
                StockLocal vérifie automatiquement les mises à jour au démarrage (en arrière-plan, sans interruption).
                Vous pouvez aussi vérifier manuellement à tout moment.
              </p>
              <Button onClick={handleCheckForUpdates} disabled={isCheckingUpdates}>
                {isCheckingUpdates ? '⏳ Vérification...' : '🔄 Vérifier les mises à jour'}
              </Button>
              {updateResult && (
                <div className={updateResult.startsWith('❌') ? 'surface-danger' : 'surface-success'} style={{ marginTop: 12, padding: 12, fontSize: 'var(--font-size-md)', fontWeight: 600 }}>
                  <span className={updateResult.startsWith('❌') ? 'text-danger' : 'text-success'}>{updateResult}</span>
                </div>
              )}
            </Card>

            <Card padding>
              <SectionTitle icon="🛟" title="Support & diagnostic" />
              <p className="text-sm text-secondary" style={{ marginTop: 0, marginBottom: 20 }}>
                En cas de problème, exportez le journal d'erreurs local et envoyez-le à votre support (WhatsApp / email).
                L'application ne transmet rien automatiquement : tout reste sur votre machine.
              </p>
              <Button variant="success" onClick={handleExportErrorLog}>📄 Exporter le journal d'erreurs</Button>
            </Card>
          </div>
        )}
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
