import React, { useCallback, useEffect, useState } from 'react';
import { AppProvider, useApp } from '../context/AppContext';
import { UploadProvider } from '../context/UploadContext';
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
import { DeadlineAlertModal } from '../components/DeadlineAlertModal';
import { DailyPriorityPopup, useDailyPopup } from '../components/DailyPriorityPopup';
import { TaskDetailPanel } from '../components/TaskDetailPanel';
import { WhatsNewModal, useWhatsNew } from '../components/WhatsNewModal';
import { parseLocalDate } from '../lib/dateUtils';
import type { TeamMember, Cliente, Task } from '../types';
import { supabase } from '../integrations/supabase/client';

function MainApp() {
  const { utente, session, tab, setTab } = useApp();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [clienti, setClienti] = useState<Cliente[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [personaView, setPersonaView] = useState<string | null>(null);
  const dailyPopup = useDailyPopup(utente);
  const [popupTask, setPopupTask] = useState<Task | null>(null);
  const whatsNew = useWhatsNew(utente?.nome ?? null);

  const loadSharedData = useCallback(() => {
    if (!utente) return;
    supabase.from('team').select('*').order('created_at').then(({ data }) => setTeam((data as TeamMember[]) || []));
    supabase.from('clienti').select('*').order('nome').then(({ data }) => setClienti((data as Cliente[]) || []));
    supabase.from('task').select('*').neq('stato', 'Archiviato').neq('stato', 'Completato').then(({ data }) => setTasks((data as Task[]) || []));
  }, [utente]);

  useEffect(() => {
    loadSharedData();
    const interval = setInterval(loadSharedData, 30000);
    const refreshHandler = () => loadSharedData();
    window.addEventListener('skorpio-refresh-tasks', refreshHandler);
    return () => { clearInterval(interval); window.removeEventListener('skorpio-refresh-tasks', refreshHandler); };
  }, [loadSharedData, tab]);

  // 1. Non autenticato → Landing Page
  if (!session) return <LandingPage onAuthenticated={() => {}} />;

  // 2. Autenticato ma profilo non ancora collegato → scelta profilo team
  if (!utente) return <SplashProfile />;

  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const myTasks = utente.ruolo === 'Admin' ? tasks : tasks.filter(t => t.assegnato_a === utente.nome);
  const clpTasks = myTasks.filter(t => t.id_contenuto?.trim());
  const genTasks = myTasks.filter(t => !t.id_contenuto?.trim());
  const daFare = myTasks.filter(t => t.stato === 'Da fare').length;
  const clpDaFare = clpTasks.filter(t => t.stato !== 'Completato').length;
  const taskDaFare = genTasks.filter(t => t.stato !== 'Completato').length;
  const urgenti = myTasks.filter(t => t.priorita === '🔴 Alta' && t.stato !== 'Completato').length;
  const scaduti = myTasks.filter(t => {
    if (!t.scadenza || t.stato === 'Completato') return false;
    return parseLocalDate(t.scadenza) < oggi;
  }).length;

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'hsl(var(--skorpio-bg))' }} data-build="publish-refresh-2026-03-27-1728">
      <TopBar
        team={team}
        taskCounts={{ daFare, clpDaFare, taskDaFare, urgenti, scaduti }}
        tasks={myTasks}
        onViewPersona={setPersonaView}
        personaView={personaView}
        onTeamChange={setTeam}
        onGoToTask={() => {}}
        onTaskReassigned={(taskId, newDate, newPersona) => {
          setTasks(prev => prev.map(t => t.id === taskId ? { ...t, scadenza: newDate, ...(newPersona ? { assegnato_a: newPersona } : {}) } : t));
        }}
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
      <DeadlineAlertModal
        tasks={tasks}
        utente={utente}
        onGoToTask={() => setTab('kanban')}
      />
      {dailyPopup.show && utente && (
        <DailyPriorityPopup
          utente={utente}
          team={team}
          onClose={dailyPopup.close}
          onTaskClick={(task) => { setPopupTask(task); }}
        />
      )}
      {popupTask && (
        <TaskDetailPanel
          task={popupTask}
          team={team}
          onClose={() => setPopupTask(null)}
          onUpdate={async () => { setPopupTask(null); }}
          onDelete={async () => { setPopupTask(null); }}
        />
      )}
      {whatsNew.show && utente && (
        <WhatsNewModal userName={utente.nome} onClose={whatsNew.close} />
      )}
    </div>
  );
}

export default function Index() {
  return (
    <AppProvider>
      <UploadProvider>
        <MainApp />
      </UploadProvider>
    </AppProvider>
  );
}
