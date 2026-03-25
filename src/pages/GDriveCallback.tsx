import { useEffect, useState } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

/**
 * Pagina minimale di callback OAuth Google Drive.
 * Aperta come popup — non renderizza l'app completa.
 * Estrae il code, scambia i token tramite edge function,
 * notifica la finestra padre e si chiude.
 */
export default function GDriveCallback() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Connessione in corso…');

  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const code  = params.get('code');
      const error = params.get('error');
      const state = params.get('state'); // contiene team_id

      if (error || !code) {
        setStatus('error');
        setMessage(error === 'access_denied' ? 'Accesso negato.' : 'Codice OAuth mancante.');
        return;
      }

      const teamId = state || sessionStorage.getItem('gdrive_team_id');
      if (!teamId) {
        setStatus('error');
        setMessage('Sessione scaduta — riprova la connessione.');
        return;
      }

      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/google-drive-oauth?action=exchange`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: ANON_KEY,
            },
            body: JSON.stringify({
              code,
              redirect_uri: `${window.location.origin}/gdrive-callback`,
              team_id: teamId,
              state,
            }),
          }
        );

        const data = await res.json();

        if (data.error) {
          setStatus('error');
          setMessage(data.error);
          return;
        }

        sessionStorage.removeItem('gdrive_team_id');
        setStatus('success');
        setMessage('Google Drive connesso!');

        // Notifica la finestra padre
        try {
          if (window.opener) {
            window.opener.postMessage(
              { type: 'GDRIVE_CONNECTED', teamId },
              window.location.origin
            );
          }
        } catch { /* ignora errori cross-origin */ }

        // Chiudi il popup dopo 800ms
        setTimeout(() => window.close(), 800);

      } catch (e: unknown) {
        setStatus('error');
        setMessage(e instanceof Error ? e.message : 'Errore sconosciuto');
      }
    };

    run();
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0f0f0f',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        background: '#1a1a1a',
        border: '1px solid #2a2a2a',
        borderRadius: '16px',
        padding: '32px',
        maxWidth: '320px',
        width: '100%',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>
          {status === 'loading' ? '⏳' : status === 'success' ? '✅' : '❌'}
        </div>
        <p style={{ color: '#ffffff', fontWeight: 600, marginBottom: '8px' }}>
          {status === 'loading'
            ? 'Connessione a Google Drive…'
            : status === 'success'
            ? 'Google Drive connesso!'
            : 'Errore connessione'}
        </p>
        <p style={{ color: '#888', fontSize: '0.85rem' }}>{message}</p>
        {status === 'error' && (
          <button
            onClick={() => window.close()}
            style={{ marginTop: '16px', color: '#888', fontSize: '0.75rem', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Chiudi questa finestra
          </button>
        )}
      </div>
    </div>
  );
}
