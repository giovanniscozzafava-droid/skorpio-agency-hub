import React, { useEffect, useState } from 'react';
import { AppProvider, useApp } from '../context/AppContext';
import { LandingPage } from './LandingPage';
import { SplashProfile } from '../components/SplashProfile';
import { TopBar } from '../components/TopBar';
import { ToastContainer } from '../components/ToastContainer';
import { KanbanTab } from '../components/KanbanTab';
import { ContenutiTab } from '../components/ContenutiTab';
import { ClientiTab } from '../components/ClientiTab';
import { RipreseTab } from '../components/RipreseTab';
import { CalendarioTab } from '../components/CalendarioTab';
import { CreativeEngineTab } from '../components/CreativeEngineTab';
import { ChatPopup } from '../components/ChatPopup';
import type { TeamMember, Cliente, Task } from '../types';
import { supabase } from '../integrations/supabase/client';

function MainApp() {
  const { utente, session, tab } = useApp();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [clienti, setClienti] = useState<Cliente[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [personaView, setPersonaView] = useState<string | null>(null);

  useEffect(() => {
    if (!utente) return;
    supabase.from('team').select('*').order('created_at').then(({ data }) => setTeam((data as TeamMember[]) || []));
    supabase.from('clienti').select('*').order('nome').then(({ data }) => setClienti((data as Cliente[]) || []));
    supabase.from('task').select('*').neq('stato', 'Archiviato').then(({ data }) => setTasks((data as Task[]) || []));
  }, [utente]);

  // 1. Non autenticato → Landing Page
  if (!session) return <LandingPage onAuthenticated={() => {}} />;

  // 2. Autenticato ma profilo non ancora collegato → scelta profilo team
  if (!utente) return <SplashProfile />;

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
        onTeamChange={setTeam}
      />
      <div className="flex-1 overflow-hidden min-h-0 pt-[100px]">
        {tab === 'kanban' && (
          <KanbanTab team={team} clienti={clienti} personaView={personaView} />
        )}
        {tab === 'calendario' && <CalendarioTab team={team} clienti={clienti} />}
        {tab === 'creative' && <CreativeEngineTab clienti={clienti} team={team} />}
        {tab === 'contenuti' && (
          <ContenutiTab team={team} clienti={clienti} />
        )}
        {tab === 'clienti' && <ClientiTab />}
        {tab === 'riprese' && <RipreseTab clienti={clienti} team={team} />}
      </div>
      <ChatPopup team={team} />
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
