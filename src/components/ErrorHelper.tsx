import React, { useState } from 'react';
import { supabase } from '../integrations/supabase/client';
import { useApp } from '../context/AppContext';

// ─── Known error patterns → user-friendly fix instructions ─────────────────

interface KnownError {
  match: (msg: string) => boolean;
  icon: string;
  title: string;
  instruction: string;
}

const KNOWN_ERRORS: KnownError[] = [
  {
    match: (m) => /expired|revoked|Refresh fallito|invalid_grant/i.test(m),
    icon: '🔑',
    title: 'Token Google Drive scaduto',
    instruction: 'Vai in Impostazioni → Integrazioni, scollega Google Drive e ricollegalo.',
  },
  {
    match: (m) => /quota|storage.*full|insufficient/i.test(m),
    icon: '💾',
    title: 'Spazio Drive esaurito',
    instruction: 'Lo spazio su Google Drive è pieno. Libera spazio o usa un altro account.',
  },
  {
    match: (m) => /network|fetch|Failed to fetch|ERR_NETWORK|CORS/i.test(m),
    icon: '🌐',
    title: 'Errore di rete',
    instruction: 'Controlla la connessione internet e riprova. Se usi un WiFi pubblico, prova con i dati mobili.',
  },
  {
    match: (m) => /timeout|timed out|deadline/i.test(m),
    icon: '⏱️',
    title: 'Timeout',
    instruction: 'Il server ha impiegato troppo tempo. Riprova tra qualche minuto.',
  },
  {
    match: (m) => /403|forbidden|permission/i.test(m),
    icon: '🔒',
    title: 'Permessi insufficienti',
    instruction: 'Non hai i permessi per questa operazione. Contatta Giovanni.',
  },
  {
    match: (m) => /404|not found/i.test(m),
    icon: '🔍',
    title: 'Risorsa non trovata',
    instruction: 'Il file o la cartella non esiste più. Potrebbe essere stato eliminato.',
  },
  {
    match: (m) => /413|too large|troppo grande|max.*size/i.test(m),
    icon: '📦',
    title: 'File troppo grande',
    instruction: 'Il file supera il limite massimo. Prova a comprimerlo prima di caricarlo.',
  },
  {
    match: (m) => /500|internal server|edge function/i.test(m),
    icon: '🔧',
    title: 'Errore del server',
    instruction: 'Errore interno. Riprova tra qualche minuto. Se persiste, segnala il bug.',
  },
];

// ─── Component ──────────────────────────────────────────────────────────────

interface ErrorHelperProps {
  errorMsg: string;
  context?: string; // e.g. "Upload clip C9058.MP4 → CLP418"
  compact?: boolean; // per versione inline (UploadIndicator)
}

export function ErrorHelper({ errorMsg, context, compact = false }: ErrorHelperProps) {
  const { utente } = useApp();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const known = KNOWN_ERRORS.find(e => e.match(errorMsg));

  const handleReport = async () => {
    if (sent || sending) return;
    setSending(true);

    const bugMsg = [
      `🐛 Bug segnalato da ${utente?.nome || 'utente sconosciuto'}`,
      '',
      `Errore: ${errorMsg}`,
      context ? `Contesto: ${context}` : '',
      `Ora: ${new Date().toLocaleString('it-IT')}`,
      `User-Agent: ${navigator.userAgent.slice(0, 80)}`,
    ].filter(Boolean).join('\n');

    await supabase.from('notifiche').insert({
      destinatario: 'Giovanni',
      tipo: 'bug_report',
      titolo: `🐛 Bug: ${errorMsg.slice(0, 60)}`,
      messaggio: bugMsg,
      task_id: null,
      task_id_display: null,
    });

    setSent(true);
    setSending(false);
  };

  if (compact) {
    return (
      <div className="ml-6 mt-1.5">
        {known ? (
          <div className="rounded-lg px-2.5 py-2" style={{ background: 'hsl(38 92% 50% / 0.10)', border: '1px solid hsl(38 80% 55% / 0.30)' }}>
            <p className="text-[11px] font-semibold" style={{ color: 'hsl(32 95% 35%)' }}>
              {known.icon} {known.title}
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: 'hsl(32 60% 30%)' }}>
              {known.instruction}
            </p>
          </div>
        ) : (
          <button
            onClick={handleReport}
            disabled={sending || sent}
            className="text-[10px] px-2 py-1 rounded-md font-medium transition-all"
            style={{
              background: sent ? 'hsl(142 70% 45% / 0.10)' : 'hsl(0 70% 50% / 0.08)',
              color: sent ? 'hsl(142 60% 35%)' : 'hsl(0 60% 45%)',
              border: `1px solid ${sent ? 'hsl(142 70% 45% / 0.25)' : 'hsl(0 60% 50% / 0.20)'}`,
            }}
          >
            {sent ? '✅ Bug segnalato' : sending ? '⏳ Invio…' : '🐛 Segnala bug a Giovanni'}
          </button>
        )}
      </div>
    );
  }

  // Full version (for modals, panels, etc.)
  return (
    <div className="rounded-xl border p-3 space-y-2" style={{
      background: known ? 'hsl(38 92% 50% / 0.06)' : 'hsl(0 70% 50% / 0.04)',
      borderColor: known ? 'hsl(38 80% 55% / 0.25)' : 'hsl(0 60% 50% / 0.15)',
    }}>
      {known ? (
        <>
          <div className="flex items-center gap-1.5">
            <span className="text-base">{known.icon}</span>
            <p className="text-xs font-bold" style={{ color: 'hsl(32 95% 35%)' }}>{known.title}</p>
          </div>
          <p className="text-xs" style={{ color: 'hsl(32 60% 30%)' }}>{known.instruction}</p>
        </>
      ) : (
        <>
          <p className="text-xs font-semibold" style={{ color: 'hsl(0 60% 45%)' }}>
            ❓ Errore imprevisto
          </p>
          <p className="text-[11px] font-mono break-all" style={{ color: 'hsl(0 40% 35%)' }}>
            {errorMsg}
          </p>
          <button
            onClick={handleReport}
            disabled={sending || sent}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-all w-full"
            style={{
              background: sent ? '#059669' : '#DC2626',
              color: 'white',
              opacity: sending ? 0.6 : 1,
            }}
          >
            {sent ? '✅ Bug segnalato a Giovanni' : sending ? '⏳ Invio in corso…' : '🐛 Segnala bug a Giovanni'}
          </button>
        </>
      )}
    </div>
  );
}
