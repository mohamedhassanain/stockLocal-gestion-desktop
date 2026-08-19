import React, { useState, useEffect } from 'react';

interface OnboardingWizardProps {
  onComplete: () => void;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onComplete }) => {
  const [step, setStep] = useState<'welcome' | 'choose' | 'validating' | 'error' | 'done'>('welcome');
  const [recommendedPath, setRecommendedPath] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [selectedPath, setSelectedPath] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    window.api.storage.getRecommendedPath().then((p: string) => {
      setRecommendedPath(p);
      setSelectedPath(p);
    });
  }, []);

  const handleUseRecommended = async () => {
    setSelectedPath(recommendedPath);
    await applyPath(recommendedPath);
  };

  const handleChooseCustom = async () => {
    setStep('choose');
  };

  const handlePickFolder = async () => {
    const result = await window.api.storage.pickFolder();
    if (!result.canceled && result.path) {
      setCustomPath(result.path);
      setSelectedPath(result.path);
    }
  };

  const handleStart = async () => {
    const pathToUse = customPath || recommendedPath;
    if (!pathToUse) return;
    await applyPath(pathToUse);
  };

  const applyPath = async (pathToUse: string) => {
    setStep('validating');
    setErrorMsg('');

    const validation = await window.api.storage.validatePath(pathToUse);
    if (!validation.valid) {
      setErrorMsg(validation.error || 'Chemin invalide');
      setStep('error');
      return;
    }

    const result = await window.api.storage.setDataPath(pathToUse);
    if (!result.success) {
      setErrorMsg(result.error || 'Erreur lors de la configuration');
      setStep('error');
      return;
    }

    await window.api.storage.completeFirstRun();
    setStep('done');
    setTimeout(() => onComplete(), 500);
  };

  // ─── Welcome ────────────────────────────────────────────────────────────────
  if (step === 'welcome') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: '48px', textAlign: 'center', marginBottom: '16px' }}>📦</div>
          <h1 style={{ textAlign: 'center', color: '#0f172a', margin: '0 0 8px', fontSize: '28px' }}>
            Bienvenue dans StockLocal
          </h1>
          <p style={{ textAlign: 'center', color: '#6b7280', margin: '0 0 32px', fontSize: '15px' }}>
            Application de gestion de stock pour commerçants et grossistes.
            <br />
            Vos données restent 100% locales sur votre PC.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <button onClick={handleUseRecommended} style={primaryBtnStyle}>
              Utiliser l'emplacement recommandé
            </button>
            <button onClick={handleChooseCustom} style={secondaryBtnStyle}>
              Choisir un autre emplacement
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Choose custom path ─────────────────────────────────────────────────────
  if (step === 'choose') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <h2 style={{ color: '#0f172a', margin: '0 0 8px', fontSize: '22px' }}>
            Emplacement des données
          </h2>
          <p style={{ color: '#6b7280', margin: '0 0 20px', fontSize: '14px' }}>
            Choisissez le dossier où vos données seront stockées.
            Nous recommandons un emplacement facile d'accès.
          </p>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '13px', color: '#374151' }}>
              Chemin recommandé
            </label>
            <div style={{ padding: '10px', background: '#f8fafc', borderRadius: '6px', fontSize: '13px', color: '#6b7280', fontFamily: 'monospace' }}>
              {recommendedPath}
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '13px', color: '#374151' }}>
              Votre choix
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={customPath || selectedPath}
                readOnly
                style={{ flex: 1, padding: '10px', border: '2px solid #e5e7eb', borderRadius: '6px', fontSize: '14px', fontFamily: 'monospace', background: '#f8fafc' }}
              />
              <button onClick={handlePickFolder} style={{ padding: '10px 20px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                📁 Parcourir
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={() => setStep('welcome')} style={secondaryBtnStyle}>← Retour</button>
            <button onClick={handleStart} disabled={!customPath} style={{ ...primaryBtnStyle, flex: 1, opacity: customPath ? 1 : 0.5 }}>
              Commencer
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Validating ─────────────────────────────────────────────────────────────
  if (step === 'validating') {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px', animation: 'spin 1s linear infinite' }}>⚙️</div>
          <h2 style={{ color: '#0f172a' }}>Configuration en cours...</h2>
          <p style={{ color: '#6b7280' }}>Vérification de l'emplacement et création des dossiers.</p>
        </div>
      </div>
    );
  }

  // ─── Error ──────────────────────────────────────────────────────────────────
  if (step === 'error') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: '48px', textAlign: 'center', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ color: '#991b1b', textAlign: 'center', margin: '0 0 12px' }}>Problème détecté</h2>
          <div style={{ padding: '16px', background: '#fef2f2', borderRadius: '8px', border: '1px solid #fecaca', color: '#991b1b', fontSize: '14px', marginBottom: '24px' }}>
            {errorMsg}
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={() => { setStep('welcome'); setErrorMsg(''); }} style={secondaryBtnStyle}>← Recommencer</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Done ───────────────────────────────────────────────────────────────────
  return (
    <div style={containerStyle}>
      <div style={{ ...cardStyle, textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
        <h2 style={{ color: '#166534' }}>Configuration terminée !</h2>
        <p style={{ color: '#6b7280' }}>Démarrage de l'application...</p>
      </div>
    </div>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
};

const cardStyle: React.CSSProperties = {
  background: 'white', borderRadius: '16px', padding: '40px', width: '480px',
  boxShadow: '0 25px 50px rgba(0,0,0,0.3)',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '16px 24px', background: '#2563eb', color: 'white', border: 'none',
  borderRadius: '8px', fontSize: '16px', fontWeight: '700', cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '16px 24px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db',
  borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: 'pointer',
};
