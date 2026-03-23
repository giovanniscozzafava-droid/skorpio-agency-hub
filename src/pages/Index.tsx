import React, { useEffect, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { SplashScreen } from './components/SplashScreen';
import { TopBar } from './components/TopBar';
import { ToastContainer } from './components/ToastContainer';
import { KanbanTab } from './components/KanbanTab';
import type { TeamMember, Cliente, Task } from './types';
import { supabase } from './lib/supabase';

function MainApp() {
  const { utente, tab } = useApp();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [clienti, setClienti] = useState<Cliente[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [personaView, setPersonaView] = useState<string | null>(null);

  useEffect(() => {
    if (!utente) return;
    supabase.from('team').select('*').order('created_at').then(({ data }) => setTeam(data || []));
    supabase.from('clienti').select('*').order('nome').then(({ data }) => setClienti(data || []));
    supabase.from('task').select('*').neq('stato', 'Archiviato').then(({ data }) => setTasks(data || []));
  }, [utente]);

  if (!utente) return <SplashScreen />;

  const oggi = new Date(); oggi.setHours(0,0,0,0);
  const myTasks = utente.ruolo === 'Admin' ? tasks : tasks.filter(t => t.assegnato_a === utente.nome);
  const daFare = myTasks.filter(t => t.stato === 'Da fare').length;
  const urgenti = myTasks.filter(t => t.priorita === '🔴 Alta' && t.stato !== 'Completato').length;
  const scaduti = myTasks.filter(t => {
    if (!t.scadenza || t.stato === 'Completato') return false;
    return new Date(t.scadenza) < oggi;
  }).length;

  return (
    <div className="min-h-screen" style={{ background: 'hsl(var(--skorpio-bg))' }}>
      <TopBar
        team={team}
        taskCounts={{ daFare, urgenti, scaduti }}
        onViewPersona={setPersonaView}
        personaView={personaView}
      />

      <div className="skorpio-main">
        {tab === 'kanban' && (
          <KanbanTab team={team} clienti={clienti} personaView={personaView} />
        )}
        {tab === 'calendario' && (
          <div className="p-8 text-center text-muted-foreground">
            <div className="text-5xl mb-4">📅</div>
            <p className="text-lg font-medium">Calendario</p>
            <p className="text-sm mt-1">In costruzione — prossimo aggiornamento</p>
          </div>
        )}
        {tab === 'creative' && (
          <div className="p-8 text-center text-muted-foreground">
            <div className="text-5xl mb-4">🤖</div>
            <p className="text-lg font-medium">Creative Engine</p>
            <p className="text-sm mt-1">In costruzione — prossimo aggiornamento</p>
          </div>
        )}
        {tab === 'contenuti' && (
          <div className="p-8 text-center text-muted-foreground">
            <div className="text-5xl mb-4">📹</div>
            <p className="text-lg font-medium">Contenuti (CLP)</p>
            <p className="text-sm mt-1">In costruzione — prossimo aggiornamento</p>
          </div>
        )}
        {tab === 'clienti' && (
          <div className="p-8 text-center text-muted-foreground">
            <div className="text-5xl mb-4">👥</div>
            <p className="text-lg font-medium">Clienti</p>
            <p className="text-sm mt-1">In costruzione — prossimo aggiornamento</p>
          </div>
        )}
        {tab === 'riprese' && (
          <div className="p-8 text-center text-muted-foreground">
            <div className="text-5xl mb-4">🎬</div>
            <p className="text-lg font-medium">Riprese</p>
            <p className="text-sm mt-1">In costruzione — prossimo aggiornamento</p>
          </div>
        )}
        {tab === 'chat' && (
          <div className="p-8 text-center text-muted-foreground">
            <div className="text-5xl mb-4">💬</div>
            <p className="text-lg font-medium">Chat</p>
            <p className="text-sm mt-1">In costruzione — prossimo aggiornamento</p>
          </div>
        )}
      </div>

      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <MainApp />
    </AppProvider>
  );
}
