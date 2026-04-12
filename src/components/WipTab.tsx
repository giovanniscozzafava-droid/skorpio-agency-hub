import React from 'react';

const WIP_TABS: Record<string, { emoji: string; title: string; subtitle: string; features: string[] }> = {
  monitor: {
    emoji: '🖥️',
    title: 'Palinsesto Monitor',
    subtitle: 'Gestione contenuti monitor pubblicitari interni ai centri estetici',
    features: [
      'Palinsesto settimanale/mensile per ogni cliente',
      'Upload immagini e video per i monitor',
      'Programmazione fasce orarie e rotazione contenuti',
      'Preview di cosa è in onda NOW su ogni monitor',
      'Storico contenuti trasmessi',
    ],
  },
  siti: {
    emoji: '🌐',
    title: 'Siti Web',
    subtitle: 'Dashboard di controllo dei siti web dei clienti',
    features: [
      'Stato sito per ogni cliente (online/manutenzione/in sviluppo)',
      'Scadenze dominio e hosting con alert automatici',
      'Link diretto al pannello admin del sito',
      'Note e changelog interventi',
      'Uptime monitoring',
    ],
  },
  andromeda: {
    emoji: '🏥',
    title: 'Andromeda CRM',
    subtitle: 'Collegamento diretto al gestionale dei centri estetici',
    features: [
      'Accesso rapido ad Andromeda per ogni cliente',
      'Statistiche appuntamenti e clienti dal CRM',
      'Sync dati: appuntamenti → strategia editoriale',
      'Consultazione AI integrata',
      'Report GDPR e privacy',
    ],
  },
  report: {
    emoji: '📊',
    title: 'Report Social',
    subtitle: 'Report automatici sulle performance social dei clienti',
    features: [
      'Report mensile automatico via Meta Graph API',
      'Grafici interazioni, reach, engagement per cliente',
      'Confronto mese su mese',
      'Analisi AI del mercato e trend',
      'Export PDF per il cliente',
    ],
  },
};

export function WipTab({ tabId }: { tabId: string }) {
  const config = WIP_TABS[tabId];
  if (!config) return null;

  return (
    <div className="flex-1 overflow-auto p-6" style={{ background: 'hsl(var(--skorpio-bg))' }}>
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <span className="text-6xl mb-4 block">{config.emoji}</span>
          <h1 className="text-2xl font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
            {config.title}
          </h1>
          <p className="text-sm mt-2" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
            {config.subtitle}
          </p>
        </div>

        {/* WIP Badge */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold"
            style={{ background: 'hsl(38 92% 50% / 0.12)', color: 'hsl(38 80% 40%)', border: '1px solid hsl(38 92% 50% / 0.3)' }}>
            <span className="animate-pulse">🚧</span>
            Work in Progress
            <span className="animate-pulse">🚧</span>
          </div>
        </div>

        {/* Features card */}
        <div className="rounded-xl border p-5" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
          <p className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
            Funzionalità in arrivo
          </p>
          <div className="space-y-3">
            {config.features.map((f, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold"
                  style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
                  {i + 1}
                </div>
                <p className="text-sm" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{f}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Coming soon footer */}
        <p className="text-center text-xs mt-6" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
          Questa sezione è in fase di sviluppo. Stay tuned! 🚀
        </p>
      </div>
    </div>
  );
}
