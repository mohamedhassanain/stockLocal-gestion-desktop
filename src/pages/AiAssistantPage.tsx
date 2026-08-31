import React, { useEffect, useRef, useState } from 'react';
import { toast } from '../stores/useToastStore';

type Provider = 'anthropic' | 'openai' | 'openai-compatible' | 'custom';
type ProviderCard = 'anthropic' | 'openai' | 'other';

interface AiConfigView {
  provider: Provider;
  providerName: string;
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
  'openai-compatible': '',
  custom: '',
};

const KEY_URLS: Record<Provider, string | null> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  'openai-compatible': null,
  custom: null,
};

function getProviderDisplayName(provider: Provider, providerName: string): string {
  switch (provider) {
    case 'anthropic': return 'Claude (Anthropic)';
    case 'openai': return 'OpenAI';
    case 'openai-compatible': return providerName || 'fournisseur compatible OpenAI';
    case 'custom': return providerName || 'endpoint personnalisé';
    default: return provider;
  }
}

export const AiAssistantPage: React.FC = () => {
  const [config, setConfig] = useState<AiConfigView | null>(null);
  // Zone 1 — Mode A
  const [selectedCard, setSelectedCard] = useState<ProviderCard>('anthropic');
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [providerName, setProviderName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [expiryMode, setExpiryMode] = useState<'none' | 'date'>('none');
  const [expiryDate, setExpiryDate] = useState('');
  const [rateLimit, setRateLimit] = useState(30);
  const [connecting, setConnecting] = useState(false);
  const [connectStatus, setConnectStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [connectMessage, setConnectMessage] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Zone 2 — Mode B
  const [mcpClient, setMcpClient] = useState<'claude' | 'cursor'>('claude');
  const [mcpSteps, setMcpSteps] = useState<string[]>([]);
  const [showManualConfig, setShowManualConfig] = useState(false);
  // Chat — inchangé
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [showConfigTab, setShowConfigTab] = useState(true);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const loadConfig = async () => {
    const cfg = await window.api.ai.getConfig();
    setConfig(cfg);
    setProvider(cfg.provider);
    setProviderName(cfg.providerName ?? '');
    setBaseUrl(cfg.baseUrl);
    setModel(cfg.model);
    setExpiryMode(cfg.expiryMode);
    setExpiryDate(cfg.expiryDate);
    setRateLimit(cfg.rateLimitPerMin);
    setSelectedCard(cfg.provider === 'anthropic' ? 'anthropic' : cfg.provider === 'openai' ? 'openai' : 'other');
  };

  useEffect(() => { loadConfig(); }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  // ─── Zone 1 : sélection de la carte provider ─────────────────────────────
  const selectCard = (card: ProviderCard) => {
    setSelectedCard(card);
    if (card === 'anthropic') {
      if (!baseUrl || baseUrl === PROVIDER_URLS[provider]) setBaseUrl(PROVIDER_URLS.anthropic);
      setProvider('anthropic');
    } else if (card === 'openai') {
      if (!baseUrl || baseUrl === PROVIDER_URLS[provider]) setBaseUrl(PROVIDER_URLS.openai);
      setProvider('openai');
    } else {
      if (provider !== 'custom') {
        if (!baseUrl || baseUrl === PROVIDER_URLS[provider]) setBaseUrl(PROVIDER_URLS['openai-compatible']);
        setProvider('openai-compatible');
      }
    }
    setConnectStatus('idle');
  };

  // ─── Zone 1 : « Connecter » = sauvegarder PUIS tester PUIS afficher ──────
  const handleConnect = async () => {
    setConnecting(true);
    setConnectStatus('idle');
    setConnectMessage('');
    try {
      await window.api.ai.saveConfig({
        provider,
        providerName: providerName.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        model: model.trim(),
        expiryMode,
        expiryDate: expiryMode === 'date' ? expiryDate : undefined,
        rateLimitPerMin: rateLimit,
      });
      const res = await window.api.ai.testConnection({
        provider,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
      });
      await loadConfig();
      if (res.success) {
        setConnectStatus('success');
        setConnectMessage(getProviderDisplayName(provider, providerName.trim()));
      } else {
        setConnectStatus('error');
      }
    } catch (e: unknown) {
      setConnectStatus('error');
      setConnectMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  };

  // ─── Zone 1 : déconnexion ────────────────────────────────────────────────
  const handleDisconnect = async () => {
    if (!window.confirm('Déconnecter l\'assistant IA ? La clé stockée localement sera révoquée.')) return;
    await window.api.ai.disconnect();
    setApiKey('');
    setConnectStatus('idle');
    setConnectMessage('');
    toast.info('Assistant IA déconnecté.');
    await loadConfig();
  };

  // ─── Zone 1 : lien clé API (shell.openExternal via IPC allowlist) ────────
  const handleOpenKeyUrl = async () => {
    const url = KEY_URLS[provider];
    if (!url) return;
    const res = await window.api.ai.openExternal(url);
    if (!res.success) toast.error(res.error ?? 'Impossible d\'ouvrir la page.');
  };

  // ─── Zone 2 : Connecter automatiquement = copier config + ouvrir dossier ──
  const handleConnectMcpClient = async () => {
    try {
      // Étape 1 : copier la configuration MCP
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
      // Étape 2 : ouvrir le dossier de configuration
      const openRes = await window.api.ai.openMcpConfigFolder(mcpClient);
      const clientName = mcpClient === 'cursor' ? 'Cursor' : 'Claude Desktop';
      setMcpSteps([
        '✅ Configuration copiée dans le presse-papier',
        `📁 Dossier ouvert — collez le contenu copié dans le fichier, puis redémarrez ${clientName}`,
      ]);
      if (!openRes.success) {
        toast.error(openRes.error ?? 'Impossible d\'ouvrir le dossier.');
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const isConfigTabActive = showConfigTab;
  const clientName = mcpClient === 'cursor' ? 'Cursor' : 'Claude Desktop';
  const keyUrl = KEY_URLS[provider];

  return (
    <div style={{ padding: '24px', maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 20, color: '#1f2937' }}>Assistant IA</h1>

      {config?.expired && (
        <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '12px 16px', borderRadius: 8, marginBottom: 16 }}>
          Connexion IA expirée le {config.expiryDate ? new Date(config.expiryDate).toLocaleDateString('fr-MA') : '—'}. Réactivez la connexion ou déconnectez-la.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setShowConfigTab(true)} style={btnStyle({ active: isConfigTabActive })}>Configuration</button>
        <button onClick={() => setShowConfigTab(false)} style={btnStyle({ active: !isConfigTabActive })}>Chat</button>
      </div>

      {isConfigTabActive && (
        <>
          {/* ═══════════════════ ZONE 1 — Mode A ═══════════════════ */}
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #e5e7eb', marginBottom: 24 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: '#1f2937' }}>💬 Discuter avec l'IA depuis StockLocal</h2>
            <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 20 }}>Posez vos questions ou demandez des actions directement dans l'application.</p>

            {/* Cartes provider */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              <button
                onClick={() => selectCard('anthropic')}
                style={cardStyle({ active: selectedCard === 'anthropic' })}
              >
                <div style={{ fontSize: 18, fontWeight: 700 }}>Anthropic</div>
                <div style={{ fontSize: 13, color: '#4b5563' }}>Claude</div>
              </button>
              <button
                onClick={() => selectCard('openai')}
                style={cardStyle({ active: selectedCard === 'openai' })}
              >
                <div style={{ fontSize: 18, fontWeight: 700 }}>OpenAI</div>
                <div style={{ fontSize: 13, color: '#4b5563' }}>Codex / GPT</div>
              </button>
              <button
                onClick={() => selectCard('other')}
                style={cardStyle({ active: selectedCard === 'other', small: true })}
              >
                <div style={{ fontSize: 15, fontWeight: 700 }}>Autre fournisseur</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>Kimi, DeepSeek, etc.</div>
              </button>
            </div>

            {/* Champs « Autre fournisseur » (révélés uniquement si sélectionné) */}
            {selectedCard === 'other' && (
              <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <label style={labelStyle}>Provider Name</label>
                    <input value={providerName} onChange={(e) => setProviderName(e.target.value)} placeholder="Kimi, DeepSeek, Groq, OpenRouter…" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>URL de base de l'API</label>
                    <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={PROVIDER_URLS[provider] || 'https://api.exemple.com/v1'} style={inputStyle} />
                  </div>
                </div>
              </div>
            )}

            {/* Clé API — seul champ visible par défaut */}
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Collez votre clé API ici</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={config?.apiKeySet ? '•••••••• (déjà enregistrée)' : 'Clé API'}
                style={{ ...inputStyle, padding: '12px 14px', fontSize: 15 }}
              />
            </div>

            {/* Aide clé API */}
            {keyUrl && (
              <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
                Pas encore de clé ?{' '}
                <button onClick={handleOpenKeyUrl} style={linkBtnStyle}>Cliquez ici pour en créer une gratuitement.</button>
              </p>
            )}

            {/* Bouton Connecter */}
            <button onClick={handleConnect} disabled={connecting} style={{ ...primaryBtn, fontSize: 16, padding: '12px 24px', width: '100%' }}>
              {connecting ? 'Connexion en cours…' : 'Connecter'}
            </button>

            {/* Résultat */}
            {connectStatus === 'success' && connectMessage && (
              <p style={{ fontSize: 16, fontWeight: 600, color: '#16a34a', marginTop: 16 }}>✅ Connecté à {connectMessage}</p>
            )}
            {connectStatus === 'error' && (
              <p style={{ fontSize: 16, color: '#dc2626', marginTop: 16 }}>
                ❌ La clé ne fonctionne pas. Vérifiez que vous l'avez copiée en entier, sans espace.
                {connectMessage ? ` (${connectMessage})` : ''}
              </p>
            )}

            {/* Déconnecter (discret, si déjà connecté) */}
            {config?.connected && (
              <button onClick={handleDisconnect} style={{ ...secondaryBtn, marginTop: 12, fontSize: 13, color: '#dc2626' }}>Déconnecter</button>
            )}

            {/* Paramètres avancés (accordéon) */}
            <div style={{ marginTop: 20, borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
              <button onClick={() => setShowAdvanced(!showAdvanced)} style={accordionBtnStyle}>
                Paramètres avancés {showAdvanced ? '▴' : '▾'}
              </button>
              {showAdvanced && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
                  {provider === 'custom' && (
                    <div>
                      <label style={labelStyle}>URL de base de l'API</label>
                      <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.exemple.com/v1" style={inputStyle} />
                    </div>
                  )}
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
              )}
            </div>
          </div>

          {/* ═══════════════════ ZONE 2 — Mode B ═══════════════════ */}
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #e5e7eb', marginBottom: 24 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: '#1f2937' }}>🔌 Utiliser StockLocal depuis Claude Desktop ou Cursor</h2>
            <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 20 }}>
              Connectez StockLocal à une autre application IA pour lui poser des questions sur votre stock, vos ventes, vos clients directement depuis cette application.
            </p>

            {/* Sélecteur client */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <label style={labelStyle}>Client</label>
                <select value={mcpClient} onChange={(e) => setMcpClient(e.target.value as 'claude' | 'cursor')} style={{ ...inputStyle, width: 'auto' }}>
                  <option value="claude">Claude Desktop</option>
                  <option value="cursor">Cursor</option>
                </select>
              </div>
            </div>

            {/* Bouton principal : Connecter automatiquement */}
            <button onClick={handleConnectMcpClient} style={{ ...primaryBtn, fontSize: 16, padding: '12px 24px', width: '100%' }}>
              Connecter {clientName} automatiquement
            </button>

            {/* Résultat en 2 étapes */}
            {mcpSteps.length > 0 && (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 14, marginTop: 16, fontSize: 14, color: '#166534' }}>
                {mcpSteps.map((step, i) => (
                  <div key={i} style={{ marginBottom: i === mcpSteps.length - 1 ? 0 : 6 }}>{step}</div>
                ))}
              </div>
            )}

            {/* Configuration manuelle (accordéon) */}
            <div style={{ marginTop: 20, borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
              <button onClick={() => setShowManualConfig(!showManualConfig)} style={accordionBtnStyle}>
                Configuration manuelle {showManualConfig ? '▴' : '▾'}
              </button>
              {showManualConfig && (
                <ul style={{ fontSize: 13, color: '#374151', margin: '12px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
                  <li><strong>Claude Desktop (Windows)</strong> : <code>%APPDATA%\Claude\claude_desktop_config.json</code></li>
                  <li><strong>Claude Desktop (macOS)</strong> : <code>~/Library/Application Support/Claude/claude_desktop_config.json</code></li>
                  <li><strong>Cursor (Windows)</strong> : <code>%APPDATA%\Cursor\mcp.json</code></li>
                  <li><strong>Cursor (macOS)</strong> : <code>~/Library/Application Support/Cursor/mcp.json</code></li>
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      {!isConfigTabActive && (
        <>
          {/* ═══════════════════ Chat (B.5) ═══════════════════ */}
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
        </>
      )}
    </div>
  );

  // ─── Handlers Chat (inchangés) ──────────────────────────────────────────
  function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    const history: ChatMsg[] = [...messages, { role: 'user', content: text }];
    setMessages(history);
    setBusy(true);
    window.api.ai.chat(history).then((result) => {
      setMessages((prev) => [...prev, { role: 'assistant', content: result.reply }]);
      if (result.pendingAction) setPendingAction(result.pendingAction);
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${msg}` }]);
    }).finally(() => setBusy(false));
  }

  function handleConfirmAction(confirmed: boolean) {
    if (!pendingAction) return;
    window.api.ai.confirmAction(pendingAction.actionId, confirmed).then((res) => {
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
    }).catch((e: unknown) => {
      setPendingAction(null);
      toast.error(e instanceof Error ? e.message : String(e));
    });
  }
};

const inputStyle: React.CSSProperties = { padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, width: '100%', boxSizing: 'border-box' };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 };
const primaryBtn: React.CSSProperties = { padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 };
const secondaryBtn: React.CSSProperties = { padding: '8px 16px', background: '#f3f4f6', color: '#1f2937', border: '1px solid #d1d5db', borderRadius: 8, cursor: 'pointer', fontWeight: 600 };
const btnStyle = ({ active }: { active: boolean }): React.CSSProperties => ({ padding: '8px 16px', background: active ? '#2563eb' : '#f3f4f6', color: active ? '#fff' : '#374151', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 });
const cardStyle = ({ active, small }: { active: boolean; small?: boolean }): React.CSSProperties => ({
  flex: small ? 0.8 : 1,
  padding: small ? '14px 16px' : '20px',
  border: active ? '2px solid #2563eb' : '1px solid #e5e7eb',
  borderRadius: 12,
  background: active ? '#eff6ff' : '#fff',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'border-color 0.15s',
});
const accordionBtnStyle: React.CSSProperties = { background: 'none', border: 'none', color: '#4b5563', fontWeight: 600, cursor: 'pointer', fontSize: 14, padding: '4px 0' };
const linkBtnStyle: React.CSSProperties = { background: 'none', border: 'none', color: '#2563eb', textDecoration: 'underline', cursor: 'pointer', fontSize: 13, padding: 0 };
