import React, { useEffect, useRef, useState } from 'react';
import { toast } from '../stores/useToastStore';

type Provider = 'anthropic' | 'openai' | 'custom';

interface AiConfigView {
  provider: Provider;
  baseUrl: string;
  model: string;
  expiryMode: 'none' | 'date';
  expiryDate: string;
  rateLimitPerMin: number;
  apiKeySet: boolean;
  connected: boolean;
  expired: boolean;
}

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

interface PendingAction {
  actionId: string;
  toolName: string;
  toolKind: string;
  summary: string;
  params: unknown;
}

const PROVIDER_URLS: Record<Provider, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  custom: '',
};

export const AiAssistantPage: React.FC = () => {
  const [config, setConfig] = useState<AiConfigView | null>(null);
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [expiryMode, setExpiryMode] = useState<'none' | 'date'>('none');
  const [expiryDate, setExpiryDate] = useState('');
  const [rateLimit, setRateLimit] = useState(30);
  const [testing, setTesting] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [showConfigTab, setShowConfigTab] = useState(true);
  const [copied, setCopied] = useState(false);
  const [mcpClient, setMcpClient] = useState<'claude' | 'cursor'>('claude');
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const loadConfig = async () => {
    const cfg = await window.api.ai.getConfig();
    setConfig(cfg);
    setProvider(cfg.provider);
    setBaseUrl(cfg.baseUrl);
    setModel(cfg.model);
    setExpiryMode(cfg.expiryMode);
    setExpiryDate(cfg.expiryDate);
    setRateLimit(cfg.rateLimitPerMin);
  };

  useEffect(() => { loadConfig(); }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const handleProviderChange = (p: Provider) => {
    setProvider(p);
    if (!baseUrl || baseUrl === PROVIDER_URLS[provider]) {
      setBaseUrl(PROVIDER_URLS[p]);
    }
  };

  const handleSave = async () => {
    try {
      await window.api.ai.saveConfig({
        provider,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        model: model.trim(),
        expiryMode,
        expiryDate: expiryMode === 'date' ? expiryDate : undefined,
        rateLimitPerMin: rateLimit,
      });
      toast.success('Configuration IA enregistrée.');
      await loadConfig();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await window.api.ai.testConnection({
        provider,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
      });
      if (res.success) toast.success(res.message);
      else toast.error(res.message);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Déconnecter l\'assistant IA ? La clé stockée localement sera révoquée.')) return;
    await window.api.ai.disconnect();
    toast.info('Assistant IA déconnecté.');
    await loadConfig();
  };

  /** Génère le bloc JSON MCP exact pour Claude Desktop / Cursor, puis le copie. */
  const handleCopyMcpConfig = async () => {
    try {
      const info = await window.api.ai.getMcpConfig();
      const json = JSON.stringify({
        mcpServers: {
          stocklocal: {
            command: 'node',
            args: [info.mcpServerPath],
            env: { STOCKLOCAL_USER_DATA_DIR: info.userDataDir },
          },
        },
      }, null, 2);
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      toast.success('Configuration MCP copiée dans le presse-papier.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  /** Ouvre le dossier contenant le fichier de config du client (Claude/Cursor). */
  const handleOpenConfigFolder = async () => {
    try {
      // Ouvre le dossier de configuration du client sélectionné (Claude/Cursor).
      const folder = await window.api.ai.getMcpConfigFolder(mcpClient);
      await window.api.storage.openFolder(folder);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    const history: ChatMsg[] = [...messages, { role: 'user', content: text }];
    setMessages(history);
    setBusy(true);
    try {
      const result = await window.api.ai.chat(history);
      setMessages((prev) => [...prev, { role: 'assistant', content: result.reply }]);
      if (result.pendingAction) setPendingAction(result.pendingAction);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${msg}` }]);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmAction = async (confirmed: boolean) => {
    if (!pendingAction) return;
    const res = await window.api.ai.confirmAction(pendingAction.actionId, confirmed);
    if (confirmed && res.success) {
      toast.success(`Action « ${pendingAction.summary} » exécutée.`);
      setMessages((prev) => [...prev, { role: 'assistant', content: `✅ Action « ${pendingAction.summary} » exécutée avec succès.` }]);
    } else if (confirmed) {
      toast.error(res.error ?? 'Action refusée.');
      setMessages((prev) => [...prev, { role: 'assistant', content: `❌ ${res.error ?? 'Échec de l\'action.'}` }]);
    } else {
      toast.info('Action annulée.');
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Action annulée par l\'utilisateur.' }]);
    }
    setPendingAction(null);
  };

  const isConfigTabActive = showConfigTab;

  return (
    <div style={{ padding: '24px', maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 20, color: '#1f2937' }}>Assistant IA</h1>

      {config?.expired && (
        <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '12px 16px', borderRadius: 8, marginBottom: 16 }}>
          Connexion IA expirée le {config.expiryDate ? new Date(config.expiryDate).toLocaleDateString('fr-MA') : '—'}. Réactivez la connexion ou déconnectez-la.
        </div>
      )}

      {/* ─── Configuration (B.1) ─────────────────────────────────────────── */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #e5e7eb', marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button onClick={() => setShowConfigTab(true)} style={btnStyle({ active: isConfigTabActive })}>Configuration</button>
          <button onClick={() => setShowConfigTab(false)} style={btnStyle({ active: !isConfigTabActive })}>Chat</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={labelStyle}>Fournisseur</label>
            <select value={provider} onChange={(e) => handleProviderChange(e.target.value as Provider)} style={inputStyle}>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI (Codex/GPT)</option>
              <option value="custom">Endpoint personnalisé</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>URL de base de l'API</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={PROVIDER_URLS[provider]}
              disabled={provider !== 'custom'}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Clé API</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={config?.apiKeySet ? '•••••••• (déjà enregistrée)' : 'Clé API'}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Modèle</label>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-3-7-sonnet-latest, gpt-4o, etc." style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Expiration de session</label>
            <select value={expiryMode} onChange={(e) => setExpiryMode(e.target.value as 'none' | 'date')} style={inputStyle}>
              <option value="none">Sans expiration</option>
              <option value="date">Date précise</option>
            </select>
          </div>
          {expiryMode === 'date' && (
            <div>
              <label style={labelStyle}>Date d'expiration</label>
              <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} style={inputStyle} />
            </div>
          )}
          <div>
            <label style={labelStyle}>Limite d'appels / minute</label>
            <input type="number" min={1} max={200} value={rateLimit} onChange={(e) => setRateLimit(parseInt(e.target.value, 10) || 30)} style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
          <button onClick={handleSave} style={primaryBtn}>Enregistrer</button>
          <button onClick={handleTest} disabled={testing} style={secondaryBtn}>{testing ? 'Test en cours...' : 'Tester la connexion'}</button>
          {config?.connected && <button onClick={handleDisconnect} style={dangerBtn}>Déconnecter</button>}
        </div>
      </div>

      {/* ─── Connexion MCP externe (Mode B) — Claude Desktop / Cursor ───── */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #e5e7eb', marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#1f2937' }}>Connexion à un client MCP externe (Mode B)</h2>
        <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 16 }}>
          Utilisez StockLocal comme outil depuis <strong>Claude Desktop</strong>, <strong>Cursor</strong> ou tout autre client MCP,
          sans passer par l'écran de chat intégré. Copiez le bloc ci-dessous dans le fichier de configuration du client.
        </p>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={labelStyle}>Client</label>
            <select value={mcpClient} onChange={(e) => setMcpClient(e.target.value as 'claude' | 'cursor')} style={{ ...inputStyle, width: 'auto' }}>
              <option value="claude">Claude Desktop</option>
              <option value="cursor">Cursor</option>
            </select>
          </div>
          <button onClick={handleCopyMcpConfig} style={primaryBtn}>
            {copied ? '✓ Copié !' : 'Copier la configuration MCP'}
          </button>
          <button onClick={handleOpenConfigFolder} style={secondaryBtn}>Ouvrir le dossier de configuration</button>
        </div>

        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 6 }}>Emplacement du fichier de config (selon l'OS / le client) :</div>
          <ul style={{ fontSize: 13, color: '#374151', margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            <li><strong>Claude Desktop (Windows)</strong> : <code>%APPDATA%\Claude\claude_desktop_config.json</code></li>
            <li><strong>Claude Desktop (macOS)</strong> : <code>~/Library/Application Support/Claude/claude_desktop_config.json</code></li>
            <li><strong>Cursor (Windows)</strong> : <code>%APPDATA%\Cursor\mcp.json</code></li>
            <li><strong>Cursor (macOS)</strong> : <code>~/Library/Application Support/Cursor/mcp.json</code></li>
          </ul>
        </div>

        <div style={{ fontSize: 13, color: '#6b7280' }}>
          Collez le JSON copié, avec le nom <code>stocklocal</code> sous <code>mcpServers</code>, puis redémarrez le client.
          Les garde-fous (audit, rate-limit, confirmation des actions destructives) s'appliquent identiquement à ce mode externe.
        </div>
      </div>

      {/* ─── Chat (B.5) ─────────────────────────────────────────────────── */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #e5e7eb' }}>
        {!config?.connected ? (
          <div style={{ textAlign: 'center', color: '#6b7280', padding: '40px 0' }}>
            <p>Aucune connexion IA configurée. Renseignez le fournisseur, l'URL, la clé API et le modèle ci-dessus, puis cliquer sur « Enregistrer ».</p>
          </div>
        ) : (
          <>
            <div style={{ height: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16, padding: 8 }}>
              {messages.length === 0 && (
                <div style={{ color: '#9ca3af', textAlign: 'center', marginTop: 40 }}>
                  Posez une question sur votre stock, vos ventes, vos clients... L'assistant peut aussi créer/modifier des données avec votre confirmation.
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '80%', background: m.role === 'user' ? '#2563eb' : '#f3f4f6', color: m.role === 'user' ? '#fff' : '#1f2937', padding: '10px 14px', borderRadius: 12, whiteSpace: 'pre-wrap', fontSize: 14 }}>
                  {m.content}
                </div>
              ))}
              {busy && <div style={{ color: '#9ca3af', fontStyle: 'italic', fontSize: 13 }}>L'assistant réfléchit...</div>}
              <div ref={chatEndRef} />
            </div>

            {/* Confirmation d'action destructive (B.4) */}
            {pendingAction && (
              <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 8, padding: 14, marginBottom: 16 }}>
                <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 8 }}>
                  {pendingAction.toolKind === 'DESTRUCTIVE' ? '⚠️ Action destructive proposée :' : pendingAction.toolKind === 'FINANCIAL' ? '💰 Action financière — vérifiez le montant avant de confirmer :' : '⚠️ Action d\'écriture proposée :'}
                </div>
                <div style={{ color: '#78350f', marginBottom: 10, fontSize: 14 }}>{pendingAction.summary}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleConfirmAction(true)} style={primaryBtn}>Confirmer & exécuter</button>
                  <button onClick={() => handleConfirmAction(false)} style={secondaryBtn}>Annuler</button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }} placeholder="Votre message..." style={{ ...inputStyle, flex: 1 }} />
              <button onClick={handleSend} disabled={busy} style={primaryBtn}>Envoyer</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const inputStyle: React.CSSProperties = { padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, width: '100%', boxSizing: 'border-box' };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 };
const primaryBtn: React.CSSProperties = { padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 };
const secondaryBtn: React.CSSProperties = { padding: '8px 16px', background: '#f3f4f6', color: '#1f2937', border: '1px solid #d1d5db', borderRadius: 8, cursor: 'pointer', fontWeight: 600 };
const dangerBtn: React.CSSProperties = { padding: '8px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 };
const btnStyle = ({ active }: { active: boolean }): React.CSSProperties => ({ padding: '8px 16px', background: active ? '#2563eb' : '#f3f4f6', color: active ? '#fff' : '#374151', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 });
