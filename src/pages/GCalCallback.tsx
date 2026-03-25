import React, { useEffect, useState } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

/**
 * Pagina di callback per il flusso OAuth di Google Calendar.
 * Il team_id arriva come parametro OAuth "state" nell'URL (non da sessionStorage,
 * che non è condiviso cross-frame quando il popup è aperto da window.top).
 */
export default function GCalCallback() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Connessione in corso…');

  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const code   = params.get('code');
      const error  = params.get('error');
      // team_id arriva come state OAuth
      const state  = params.get('state');

      if (error || !code) {
        setStatus('error');
        setMessage(error === 'access_denied' ? 'Accesso negato dall\'utente.' : 'Parametro code mancante.');
        return;
      }

      // Fallback a sessionStorage per retrocompatibilità
      const team_id = state || sessionStorage.getItem('gcal_team_id');
      if (!team_id) {
        setStatus('error');
        setMessage('Sessione scaduta — riprova la connessione.');
        return;
      }

      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/google-calendar-oauth?action=exchange`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({
              code,
              redirect_uri: `${window.location.origin}/gcal-callback`,
              team_id,
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

        sessionStorage.removeItem('gcal_team_id');
        setStatus('success');
        setMessage('Google Calendar connesso! Reindirizzamento in corso…');

        // Notifica la finestra padre (popup) o reindirizza se siamo nella finestra principale
        const target = window.opener || (window.top !== window ? window.top : null);
        if (target) {
          try {
            target.postMessage({ type: 'GCAL_CONNECTED', team_id }, window.location.origin);
          } catch {
            // cross-origin parent — ignora
          }
          setTimeout(() => window.close(), 1500);
        } else {
          // Siamo nella finestra principale (popup bloccato) — reindirizza alla home
          setTimeout(() => {
            window.location.href = '/?gcal_connected=1';
          }, 1500);
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
          {status === 'loading' ? 'Connessione a Google Calendar' : status === 'success' ? 'Connesso!' : 'Errore'}
        </h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        {status !== 'loading' && (
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
