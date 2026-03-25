import React, { useEffect, useState } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

/**
 * Pagina di callback per il flusso OAuth di Google Drive.
 * Aperta come popup da ImpostazioniPanel.
 * Prende ?code dalla URL, lo scambia con i token via edge function,
 * poi notifica la finestra padre e si chiude.
 */
export default function GDriveCallback() {
  const [status, setStatus]   = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Connessione in corso…');

  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const code   = params.get('code');
      const error  = params.get('error');

      if (error || !code) {
        setStatus('error');
        setMessage(error === 'access_denied' ? 'Accesso negato dall\'utente.' : 'Codice OAuth mancante.');
        return;
      }

      const teamId = sessionStorage.getItem('gdrive_team_id');
      if (!teamId) {
        setStatus('error');
        setMessage('Sessione scaduta, riprova.');
        return;
      }

      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/google-drive-oauth?action=exchange`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({
              code,
              redirect_uri: `${window.location.origin}/gdrive-callback`,
              team_id: teamId,
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
        setMessage('Google Drive connesso! Puoi chiudere questa finestra.');

        if (window.opener) {
          window.opener.postMessage({ type: 'GDRIVE_CONNECTED', teamId }, window.location.origin);
          setTimeout(() => window.close(), 1500);
        }
      } catch (e: unknown) {
        setStatus('error');
        setMessage(e instanceof Error ? e.message : 'Errore sconosciuto');
      }
    };

    run();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="bg-card rounded-2xl shadow-xl p-8 max-w-sm w-full text-center space-y-4 border border-border">
        <div className="text-4xl">
          {status === 'loading' ? '⏳' : status === 'success' ? '✅' : '❌'}
        </div>
        <h1 className="font-bold text-lg text-foreground">
          {status === 'loading'
            ? 'Connessione a Google Drive'
            : status === 'success'
            ? 'Google Drive connesso!'
            : 'Errore connessione'}
        </h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        {status === 'error' && (
          <button
            onClick={() => window.close()}
            className="mt-2 text-xs text-primary underline"
          >
            Chiudi questa finestra
          </button>
        )}
      </div>
    </div>
  );
}
