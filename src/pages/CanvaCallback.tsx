import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export default function CanvaCallback() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Connessione a Canva in corso…');
  const navigate = useNavigate();

  useEffect(() => {
    const handleCallback = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');
      const error = params.get('error');

      if (error) {
        setStatus('error');
        setMessage(`Canva ha rifiutato la connessione: ${error}`);
        return;
      }

      if (!code) {
        setStatus('error');
        setMessage('Nessun codice di autorizzazione ricevuto da Canva.');
        return;
      }

      // Verify state
      const savedState = localStorage.getItem('canva_oauth_state');
      if (state && savedState && state !== savedState) {
        setStatus('error');
        setMessage('Errore di sicurezza: state mismatch.');
        return;
      }

      // Exchange code for token via edge function
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/canva-oauth-callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
          body: JSON.stringify({ code, redirect_uri: `${window.location.origin}/canva-callback` }),
        });

        if (res.ok) {
          setStatus('success');
          setMessage('Canva connesso con successo! Chiudi questa finestra.');
          localStorage.removeItem('canva_oauth_state');

          // Notify parent window
          if (window.opener) {
            window.opener.postMessage({ type: 'CANVA_CONNECTED' }, '*');
            setTimeout(() => window.close(), 2000);
          } else {
            setTimeout(() => navigate('/'), 3000);
          }
        } else {
          const data = await res.json().catch(() => ({}));
          setStatus('error');
          setMessage(`Errore token exchange: ${data.error || res.statusText}`);
        }
      } catch (e: any) {
        setStatus('error');
        setMessage(`Errore di rete: ${e.message}`);
      }
    };

    handleCallback();
  }, [navigate]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0f', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>
          {status === 'loading' ? '🔗' : status === 'success' ? '✅' : '❌'}
        </div>
        <h1 style={{ color: '#fff', fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
          {status === 'loading' ? 'Connessione a Canva…' : status === 'success' ? 'Connesso!' : 'Errore'}
        </h1>
        <p style={{ color: '#94A3B8', fontSize: 14 }}>{message}</p>
        {status === 'error' && (
          <button onClick={() => navigate('/')} style={{
            marginTop: 24, padding: '10px 24px', borderRadius: 12,
            background: '#8B5CF6', color: '#fff', fontWeight: 600, fontSize: 14,
            border: 'none', cursor: 'pointer',
          }}>
            Torna a SKORPIO
          </button>
        )}
        {status === 'loading' && (
          <div style={{ marginTop: 24 }}>
            <div style={{ width: 32, height: 32, border: '3px solid #333', borderTopColor: '#8B5CF6', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}
      </div>
    </div>
  );
}
