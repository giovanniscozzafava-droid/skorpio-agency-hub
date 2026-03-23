import React, { useEffect, useState } from 'react';
import { AppProvider, useApp } from '../context/AppContext';
import { SplashScreen } from '../components/SplashScreen';
import { TopBar } from '../components/TopBar';
import { ToastContainer } from '../components/ToastContainer';
import { KanbanTab } from '../components/KanbanTab';
import { ContenutiTab } from '../components/ContenutiTab';
import { ClientiTab } from '../components/ClientiTab';
import { RipreseTab } from '../components/RipreseTab';
import { CalendarioTab } from '../components/CalendarioTab';
import type { TeamMember, Cliente, Task } from '../types';
import { supabase } from '../lib/supabase';

function Placeholder({ emoji, label }: { emoji: string; label: string }) {
  return (
    <div className="p-8 text-center text-muted-foreground">
      <div className="text-5xl mb-4">{emoji}</div>
      <p className="text-lg font-medium">{label}</p>
      <p className="text-sm mt-1 opacity-60">In costruzione — prossimo aggiornamento</p>
    </div>
  );
}

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

  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const myTasks = utente.ruolo === 'Admin' ? tasks : tasks.filter(t => t.assegnato_a === utente.nome);
  const daFare = myTasks.filter(t => t.stato === 'Da fare').length;
  const urgenti = myTasks.filter(t => t.priorita === '🔴 Alta' && t.stato !== 'Completato').length;
  const scaduti = myTasks.filter(t => {
    if (!t.scadenza || t.stato === 'Completato') return false;
    return new Date(t.scadenza) < oggi;
  }).length;


  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'hsl(var(--skorpio-bg))' }}>
      <TopBar
        team={team}
        taskCounts={{ daFare, urgenti, scaduti }}
        onViewPersona={setPersonaView}
        personaView={personaView}
      />
      {/* pt-[100px] accounts for fixed topbar (56px) + tab bar (44px) */}
      <div className="flex-1 overflow-hidden min-h-0 pt-[100px]">
        {tab === 'kanban' && (
          <KanbanTab team={team} clienti={clienti} personaView={personaView} />
        )}
        {tab === 'calendario' && <CalendarioTab team={team} clienti={clienti} />}
        {tab === 'creative' && <Placeholder emoji="🤖" label="Creative Engine" />}
        {tab === 'contenuti' && (
          <ContenutiTab team={team} clienti={clienti} />
        )}
        {tab === 'clienti' && <ClientiTab />}
        {tab === 'riprese' && <RipreseTab clienti={clienti} team={team} />}
        {tab === 'chat' && <Placeholder emoji="💬" label="Chat" />}
      </div>
      <ToastContainer />
    </div>
  );
}

export default function Index() {
  return (
    <AppProvider>
      <MainApp />
    </AppProvider>
  );
}
