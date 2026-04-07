import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { Avatar } from './Avatar';
import type { TeamMember } from '../types';
import { DailyPriorityManager } from './DailyPriorityManager';
import { FeatureLearningAdmin } from './WhatsNewModal';

const SUPABASE_URL        = import.meta.env.VITE_SUPABASE_URL as string;
const GCAL_REDIRECT_URI   = `${window.location.origin}/gcal-callback`;
const GDRIVE_REDIRECT_URI = `${window.location.origin}/gdrive-callback`;

const COLORI_PRESET = [
  '#F59E0B', '#EC4899', '#06B6D4', '#22C55E',
  '#8B5CF6', '#EF4444', '#3B82F6', '#F97316',
  '#14B8A6', '#A855F7', '#64748B', '#E11D48',
];

interface Props {
  team: TeamMember[];
  onTeamChange: (team: TeamMember[]) => void;
  onClose: () => void;
}

interface MembroForm {
  id?: string;
  nome: string;
  label: string;
  colore: string;
  ruolo: 'Admin' | 'Team';
}

const EMPTY_FORM: MembroForm = { nome: '', label: '', colore: '#3B82F6', ruolo: 'Team' };

export function ImpostazioniPanel({ team, onTeamChange, onClose }: Props) {
  const { utente, addToast, logout } = useApp();
  const isAdmin = utente?.ruolo === 'Admin';
  const panelRef = useRef<HTMLDivElement>(null);

  const [showForm, setShowForm]     = useState(false);
  const [form, setForm]             = useState<MembroForm>(EMPTY_FORM);
  const [saving, setSaving]         = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<TeamMember | null>(null);
  const [taskCount, setTaskCount]       = useState(0);
  const [riassegnaA, setRiassegnaA]     = useState('');
  const [deleting, setDeleting]         = useState(false);

  const [section, setSection] = useState<'profilo' | 'team' | 'integrazioni' | 'audit' | 'priorita'>('profilo');

  // ── Snapshot dati ──────────────────────────────────────────────────────────
  const [snapshotRunning, setSnapshotRunning] = useState(false);
  const [snapshotResult, setSnapshotResult] = useState<Record<string, number> | null>(null);
  const [snapshotBreakdowns, setSnapshotBreakdowns] = useState<Record<string, Record<string, number>> | null>(null);

  const runSnapshot = async () => {
    setSnapshotRunning(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/backup-snapshot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
          'apikey': supabaseKey,
        },
        body: JSON.stringify({ note: `Manual snapshot by ${utente?.nome || 'admin'}` }),
      });
      const data = await res.json();
      if (data.success) {
        setSnapshotResult(data.counts);
        setSnapshotBreakdowns(data.breakdowns || null);
        addToast('📸 Snapshot salvato!', 'success');
      } else {
        addToast('Errore snapshot', 'error');
      }
    } catch (e) {
      addToast('Errore snapshot: ' + (e as Error).message, 'error');
    }
    setSnapshotRunning(false);
  };

  // ── Audit Clienti ↔ CLP ──────────────────────────────────────────────────
  const [auditRunning, setAuditRunning] = useState(false);
  const [auditReport, setAuditReport] = useState<Array<{ cliente: string; clpCount: number; inClienti: boolean; clienteId: string | null }>>([]);
  const [auditDone, setAuditDone] = useState(false);

  const runAudit = async () => {
    setAuditRunning(true);
    setAuditDone(false);
    const { data: clpData } = await supabase
      .from('contenuti')
      .select('cliente_nome, cliente_id');
    const { data: clientiData } = await supabase
      .from('clienti')
      .select('id, nome, stato');

    const grouped: Record<string, { count: number; clienteId: string | null }> = {};
    for (const row of clpData || []) {
      const nome = row.cliente_nome?.trim() || '';
      if (!nome) continue;
      if (!grouped[nome]) grouped[nome] = { count: 0, clienteId: row.cliente_id };
      grouped[nome].count++;
    }

    const report = Object.entries(grouped).map(([cliente, { count, clienteId }]) => {
      const found = (clientiData || []).find(c => c.nome.trim().toLowerCase() === cliente.toLowerCase());
      return {
        cliente,
        clpCount: count,
        inClienti: !!found,
        clienteId,
        statoCliente: found?.stato || null,
      };
    }).sort((a, b) => (a.inClienti === b.inClienti ? 0 : a.inClienti ? 1 : -1));

    setAuditReport(report as any);
    setAuditDone(true);
    setAuditRunning(false);
  };

  // ── Sync Drive Folders ────────────────────────────────────────────────────
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncLog, setSyncLog] = useState<Array<{ icon: string; label: string; detail: string }>>([]);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);
  const syncLogRef = useRef<HTMLDivElement>(null);

  const runDriveSync = useCallback(async () => {
    if (!utente) return;
    setSyncRunning(true);
    setSyncLog([]);
    setSyncSummary(null);

    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/sync-drive-folders`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
          body: JSON.stringify({ team_id: utente.id }),
        }
      );

      if (!res.ok || !res.body) {
        const err = await res.text();
        addToast(`❌ Errore sincronizzazione: ${err}`, 'error');
        setSyncRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const msg = JSON.parse(line.slice(5).trim());
            if (msg.type === 'log') {
              setSyncLog(prev => [...prev, { icon: msg.icon, label: msg.label, detail: msg.detail }]);
              setTimeout(() => syncLogRef.current?.scrollTo({ top: syncLogRef.current.scrollHeight, behavior: 'smooth' }), 50);
            } else if (msg.type === 'section' || msg.type === 'section_done') {
              setSyncLog(prev => [...prev, { icon: '', label: msg.text, detail: '' }]);
            } else if (msg.type === 'done') {
              setSyncSummary(
                `✅ Completato — Clienti: ${msg.clientiCreati} create, ${msg.clientiEsistenti} esistenti · CLP: ${msg.clpCreati} create/aggiornate, ${msg.clpEsistenti} OK, ${msg.clpSkipped} saltate`
              );
            } else if (msg.type === 'error') {
              addToast(`❌ ${msg.message}`, 'error');
            }
          } catch { /* non JSON, skip */ }
        }
      }
    } catch (e: unknown) {
      addToast(`❌ Errore connessione: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setSyncRunning(false);
    }
  }, [utente, addToast]);
  // ── Google Calendar ───────────────────────────────────────────────────────
  const [gcalLoading, setGcalLoading]     = useState(false);
  const [gcalConnected, setGcalConnected] = useState(false);

  // ── Google Drive ──────────────────────────────────────────────────────────
  const [gdriveLoading, setGdriveLoading]     = useState(false);
  const [gdriveConnected, setGdriveConnected] = useState(false);

  useEffect(() => {
    if (utente) {
      setGcalConnected(!!(utente as any).google_calendar_connected);
      setGdriveConnected(!!(utente as any).google_drive_connected);
    }
  }, [utente]);

  // Ascolta callback OAuth dalle finestre popup
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'GCAL_CONNECTED') {
        setGcalConnected(true);
        addToast('✅ Google Calendar connesso con successo!', 'success');
      }
      if (e.data?.type === 'GDRIVE_CONNECTED') {
        setGdriveConnected(true);
        addToast('✅ Google Drive connesso! I file verranno caricati nel tuo My Drive.', 'success');
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [addToast]);

  // Gestisce il caso in cui OAuth è avvenuto nella finestra principale (popup bloccato)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('gdrive_connected') === '1') {
      setGdriveConnected(true);
      addToast('✅ Google Drive connesso! I file verranno caricati nel tuo My Drive.', 'success');
      // Rimuovi il parametro dall'URL senza ricaricare la pagina
      const url = new URL(window.location.href);
      url.searchParams.delete('gdrive_connected');
      window.history.replaceState({}, '', url.toString());
    }
    if (params.get('gcal_connected') === '1') {
      setGcalConnected(true);
      addToast('✅ Google Calendar connesso con successo!', 'success');
      const url = new URL(window.location.href);
      url.searchParams.delete('gcal_connected');
      window.history.replaceState({}, '', url.toString());
    }
  }, [addToast]);

  // ── Handlers Google Calendar ──────────────────────────────────────────────
  // Polling generico: aspetta che il popup si chiuda, poi legge i dati aggiornati dal DB
  const pollPopupClosed = useCallback((popup: Window, onClosed: () => void) => {
    const interval = setInterval(() => {
      try {
        if (popup.closed) {
          clearInterval(interval);
          onClosed();
        }
      } catch { clearInterval(interval); onClosed(); }
    }, 800);
    // Timeout di sicurezza dopo 5 minuti
    setTimeout(() => clearInterval(interval), 5 * 60 * 1000);
  }, []);

  const connectGoogleCalendar = useCallback(async () => {
    if (!utente) return;
    setGcalLoading(true);
    const popup = window.open('', 'gcal_oauth', 'width=500,height=600,left=200,top=100');
    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/google-calendar-oauth?action=get_url`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
          body: JSON.stringify({ redirect_uri: GCAL_REDIRECT_URI, team_id: utente.id }),
        }
      );
      const { url } = await res.json();
      if (url && popup && !popup.closed) {
        popup.location.href = url;
        // Polling: quando il popup si chiude, rileggi dal DB
        pollPopupClosed(popup, async () => {
          const { data } = await supabase.from('team').select('google_calendar_connected').eq('id', utente.id).single();
          if ((data as any)?.google_calendar_connected) {
            setGcalConnected(true);
            addToast('✅ Google Calendar connesso con successo!', 'success');
          }
        });
      } else if (!popup || popup.closed) {
        window.location.href = url;
      } else {
        popup?.close();
      }
    } catch {
      popup?.close();
      addToast('❌ Errore connessione Google Calendar', 'error');
    } finally {
      setGcalLoading(false);
    }
  }, [utente, addToast, pollPopupClosed]);

  const disconnectGoogleCalendar = useCallback(async () => {
    if (!utente) return;
    setGcalLoading(true);
    try {
      await fetch(
        `${SUPABASE_URL}/functions/v1/google-calendar-oauth?action=disconnect`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
          body: JSON.stringify({ team_id: utente.id }),
        }
      );
      setGcalConnected(false);
      addToast('🔌 Google Calendar disconnesso', 'info');
    } catch {
      addToast('❌ Errore disconnessione', 'error');
    } finally {
      setGcalLoading(false);
    }
  }, [utente, addToast]);

  // ── Handlers Google Drive ─────────────────────────────────────────────────
  const connectGoogleDrive = useCallback(async () => {
    if (!utente) return;
    setGdriveLoading(true);
    const popup = window.open('', 'gdrive_oauth', 'width=500,height=600,left=200,top=100');
    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/google-drive-oauth?action=get_url`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
          body: JSON.stringify({ redirect_uri: GDRIVE_REDIRECT_URI, team_id: utente.id }),
        }
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.url && popup && !popup.closed) {
        popup.location.href = data.url;
        // Polling: quando il popup si chiude, rileggi dal DB
        pollPopupClosed(popup, async () => {
          const { data: row } = await supabase.from('team').select('google_drive_connected').eq('id', utente.id).single();
          if ((row as any)?.google_drive_connected) {
            setGdriveConnected(true);
            addToast('✅ Google Drive connesso! I file verranno caricati nel tuo My Drive.', 'success');
          }
        });
      } else if (!popup || popup.closed) {
        window.location.href = data.url;
      } else {
        popup?.close();
      }
    } catch (e: unknown) {
      popup?.close();
      addToast(`❌ Errore connessione Google Drive: ${e instanceof Error ? e.message : ''}`, 'error');
    } finally {
      setGdriveLoading(false);
    }
  }, [utente, addToast, pollPopupClosed]);

  const disconnectGoogleDrive = useCallback(async () => {
    if (!utente) return;
    setGdriveLoading(true);
    try {
      await fetch(
        `${SUPABASE_URL}/functions/v1/google-drive-oauth?action=disconnect`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
          body: JSON.stringify({ team_id: utente.id }),
        }
      );
      setGdriveConnected(false);
      addToast('🔌 Google Drive disconnesso', 'info');
    } catch {
      addToast('❌ Errore disconnessione Google Drive', 'error');
    } finally {
      setGdriveLoading(false);
    }
  }, [utente, addToast]);

  // Close on ESC
  useEffect(() => {
    const fn = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);

  // Click fuori
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => document.addEventListener('mousedown', fn), 50);
    return () => document.removeEventListener('mousedown', fn);
  }, [onClose]);

  const openEdit = (m: TeamMember) => {
    setForm({ id: m.id, nome: m.nome, label: m.label, colore: m.colore, ruolo: m.ruolo });
    setShowForm(true);
  };

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const salvaForm = async () => {
    if (!form.nome.trim()) { addToast('Nome obbligatorio', 'error'); return; }
    setSaving(true);
    try {
      if (form.id) {
        // Modifica
        const { data, error } = await supabase
          .from('team')
          .update({ nome: form.nome, label: form.label, colore: form.colore, ruolo: form.ruolo })
          .eq('id', form.id)
          .select()
          .single();
        if (error) throw error;
        onTeamChange(team.map(m => m.id === form.id ? data as TeamMember : m));
        addToast(`✅ ${form.nome} aggiornato`, 'success');
      } else {
        // Nuovo membro
        const { data, error } = await supabase
          .from('team')
          .insert({ nome: form.nome, label: form.label, colore: form.colore, ruolo: form.ruolo })
          .select()
          .single();
        if (error) throw error;
        onTeamChange([...team, data as TeamMember]);
        addToast(`✅ ${form.nome} aggiunto al team`, 'success');
      }
      setShowForm(false);
    } catch (e: any) {
      addToast(`❌ ${e.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const openDelete = async (m: TeamMember) => {
    setDeleteTarget(m);
    setRiassegnaA('');
    // conta task attivi
    const { count } = await supabase
      .from('task')
      .select('*', { count: 'exact', head: true })
      .eq('assegnato_a', m.nome)
      .neq('stato', 'Archiviato')
      .neq('stato', 'Completato');
    setTaskCount(count || 0);
  };

  const confermaElimina = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // Se ha task attivi e non è stata scelta riassegnazione
      if (taskCount > 0 && !riassegnaA) {
        addToast('Seleziona un membro a cui riassegnare i task', 'error');
        setDeleting(false);
        return;
      }
      // Riassegna task se necessario
      if (taskCount > 0 && riassegnaA) {
        await supabase
          .from('task')
          .update({ assegnato_a: riassegnaA })
          .eq('assegnato_a', deleteTarget.nome)
          .neq('stato', 'Archiviato')
          .neq('stato', 'Completato');
      }
      // Elimina membro
      const { error } = await supabase.from('team').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      onTeamChange(team.filter(m => m.id !== deleteTarget.id));
      addToast(`🗑️ ${deleteTarget.nome} rimosso dal team`, 'info');
      setDeleteTarget(null);
    } catch (e: any) {
      addToast(`❌ ${e.message}`, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const altriMembri = team.filter(m => m.id !== deleteTarget?.id);

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.4)' }} />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 h-full z-50 flex flex-col"
        style={{
          width: 420,
          background: 'hsl(var(--card))',
          borderLeft: '1px solid hsl(var(--border))',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.15)',
          animation: 'slideInRight 0.2s ease-out',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0"
          style={{ borderColor: 'hsl(var(--border))' }}>
          <div className="flex items-center gap-2">
            <span className="text-lg">⚙️</span>
            <h2 className="font-bold text-base" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
              Impostazioni
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-base transition-colors hover:bg-muted"
            style={{ color: 'hsl(var(--skorpio-text-secondary))' }}
          >×</button>
        </div>

        {/* Sezione tabs */}
        <div className="flex border-b flex-shrink-0" style={{ borderColor: 'hsl(var(--border))' }}>
          <button
            onClick={() => setSection('profilo')}
            className="flex-1 py-2.5 text-xs font-semibold transition-colors"
            style={{
              color: section === 'profilo' ? '#3B82F6' : 'hsl(var(--skorpio-text-secondary))',
              borderBottom: section === 'profilo' ? '2px solid #3B82F6' : '2px solid transparent',
              background: 'transparent',
            }}
          >
            👤 Profilo
          </button>
          <button
            onClick={() => setSection('integrazioni')}
            className="flex-1 py-2.5 text-xs font-semibold transition-colors"
            style={{
              color: section === 'integrazioni' ? '#3B82F6' : 'hsl(var(--skorpio-text-secondary))',
              borderBottom: section === 'integrazioni' ? '2px solid #3B82F6' : '2px solid transparent',
              background: 'transparent',
            }}
          >
            🔗 Integrazioni
          </button>
          {isAdmin && (
            <button
              onClick={() => setSection('team')}
              className="flex-1 py-2.5 text-xs font-semibold transition-colors"
              style={{
                color: section === 'team' ? '#3B82F6' : 'hsl(var(--skorpio-text-secondary))',
                borderBottom: section === 'team' ? '2px solid #3B82F6' : '2px solid transparent',
                background: 'transparent',
              }}
            >
              🐾 Team Fuyue
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setSection('audit')}
              className="flex-1 py-2.5 text-xs font-semibold transition-colors"
              style={{
                color: section === 'audit' ? '#3B82F6' : 'hsl(var(--skorpio-text-secondary))',
                borderBottom: section === 'audit' ? '2px solid #3B82F6' : '2px solid transparent',
                background: 'transparent',
              }}
            >
              🔍 Audit
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setSection('priorita')}
              className="flex-1 py-2.5 text-xs font-semibold transition-colors"
              style={{
                color: section === 'priorita' ? '#6C5CE7' : 'hsl(var(--skorpio-text-secondary))',
                borderBottom: section === 'priorita' ? '2px solid #6C5CE7' : '2px solid transparent',
                background: 'transparent',
              }}
            >
              Daily Priority
            </button>
          )}
        </div>

        {/* Contenuto scrollabile */}
        <div className="flex-1 overflow-y-auto">

          {/* ── SEZIONE PROFILO ── */}
          {section === 'profilo' && utente && (
            <div className="px-5 py-6 space-y-6">
              {/* Avatar grande */}
              <div className="flex flex-col items-center gap-3 py-4 rounded-xl"
                style={{ background: 'hsl(210 20% 97%)' }}>
                <div className="relative">
                  <Avatar nome={utente.nome} colore={utente.colore} size={72} avatarUrl={utente.avatar_url} />
                  <div
                    className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs border-2 border-white"
                    style={{ background: utente.colore }}
                  >
                    {utente.ruolo === 'Admin' ? '👑' : '🐾'}
                  </div>
                </div>
                <div className="text-center">
                  <p className="font-bold text-base" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                    {utente.nome}
                  </p>
                  <p className="text-sm font-medium mt-0.5" style={{ color: utente.colore }}>
                    {utente.label}
                  </p>
                  <span
                    className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{
                      background: utente.ruolo === 'Admin' ? '#FEF3C7' : '#EFF6FF',
                      color: utente.ruolo === 'Admin' ? '#D97706' : '#2563EB',
                    }}
                  >
                    {utente.ruolo === 'Admin' ? '👑 Admin' : '🐾 Team'}
                  </span>
                </div>
              </div>

              {/* Info rows */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                  Informazioni personali
                </h3>

                {[
                  { label: 'Nome completo', value: utente.nome },
                  { label: 'Soprannome', value: utente.label },
                  { label: 'Ruolo', value: utente.ruolo },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between py-2.5 px-3 rounded-lg"
                    style={{ background: 'hsl(210 20% 98%)', border: '1px solid hsl(var(--border))' }}>
                    <span className="text-xs" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>{label}</span>
                    <span className="text-sm font-medium" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{value}</span>
                  </div>
                ))}

                {/* Colore */}
                <div className="flex items-center justify-between py-2.5 px-3 rounded-lg"
                  style={{ background: 'hsl(210 20% 98%)', border: '1px solid hsl(var(--border))' }}>
                  <span className="text-xs" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Colore</span>
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full" style={{ background: utente.colore }} />
                    <span className="text-xs font-mono" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                      {utente.colore}
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-xs text-center" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                💡 Solo un Admin può modificare le informazioni del profilo
              </p>
            </div>
          )}

          {/* ── SEZIONE INTEGRAZIONI ── */}
          {section === 'integrazioni' && utente && (
            <div className="px-5 py-6 space-y-5">
              <h3 className="text-xs font-bold uppercase tracking-wider"
                style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                Connessioni esterne
              </h3>

              {/* ── Google Drive Card ─────────────────────────────────────── */}
              <div
                className="rounded-xl border p-4 space-y-3"
                style={{
                  borderColor: gdriveConnected ? '#86EFAC' : 'hsl(var(--border))',
                  background:  gdriveConnected ? '#F0FDF4' : 'hsl(210 20% 98%)',
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                      style={{ background: '#FFF', border: '1px solid hsl(var(--border))', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
                    >
                      ☁️
                    </div>
                    <div>
                      <p className="font-semibold text-sm" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                        Google Drive
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                        {gdriveConnected
                          ? '✅ Connesso — upload clip attivo su My Drive'
                          : 'Carica le clip video nel tuo Google Drive'}
                      </p>
                    </div>
                  </div>
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ background: gdriveConnected ? '#22C55E' : '#D1D5DB' }}
                  />
                </div>

                {gdriveConnected ? (
                  <div className="space-y-2">
                    <div className="rounded-lg p-3 text-xs" style={{ background: '#DCFCE7', border: '1px solid #86EFAC' }}>
                      <p className="font-semibold" style={{ color: '#15803D' }}>Dove vengono salvati i file:</p>
                      <ul className="mt-1 space-y-0.5" style={{ color: '#166534' }}>
                        <li>• 📁 My Drive → <strong>SKORPIO_Clip</strong> → {'{'}Nome Cliente{'}'}</li>
                        <li>• 🔄 Token rinnovato automaticamente</li>
                        <li>• 💾 7 TB disponibili con Google Workspace</li>
                      </ul>
                    </div>

                    {/* ── Sync cartelle Drive ── */}
                    <div className="rounded-lg p-3 space-y-2" style={{ background: '#F0F9FF', border: '1px solid #BAE6FD' }}>
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold" style={{ color: '#0369A1' }}>📁 Sincronizza cartelle Drive</p>
                        <button
                          onClick={runDriveSync}
                          disabled={syncRunning}
                          className="px-3 py-1 rounded-lg text-[11px] font-bold text-white disabled:opacity-50 transition-all"
                          style={{ background: syncRunning ? '#94A3B8' : '#0284C7' }}
                        >
                          {syncRunning ? '⏳ In esecuzione…' : '▶ Avvia'}
                        </button>
                      </div>
                      <p className="text-[10px]" style={{ color: '#0369A1' }}>
                        Crea le cartelle su Drive per tutti i clienti attivi e tutti i CLP in produzione.
                      </p>

                      {/* Log area */}
                      {syncLog.length > 0 && (
                        <div
                          ref={syncLogRef}
                          className="rounded overflow-y-auto font-mono text-[10px] space-y-0.5 p-2"
                          style={{ maxHeight: 200, background: '#0F172A', color: '#94A3B8' }}
                        >
                          {syncLog.map((entry, i) => (
                            <div key={i} className={entry.icon === '' ? 'text-sky-400 font-bold mt-1' : ''}>
                              {entry.icon && <span>{entry.icon} </span>}
                              <span style={{ color: entry.icon === '❌' ? '#F87171' : entry.icon === '' ? undefined : '#E2E8F0' }}>
                                {entry.label}
                              </span>
                              {entry.detail && (
                                <span style={{ color: entry.icon === '❌' ? '#FCA5A5' : '#64748B' }}>
                                  {' — '}{entry.detail}
                                </span>
                              )}
                            </div>
                          ))}
                          {syncRunning && (
                            <div className="animate-pulse text-sky-400">● elaborazione…</div>
                          )}
                        </div>
                      )}

                      {syncSummary && (
                        <p className="text-[10px] font-semibold rounded px-2 py-1"
                          style={{ background: '#DCFCE7', color: '#15803D', border: '1px solid #86EFAC' }}>
                          {syncSummary}
                        </p>
                      )}
                    </div>

                    <button
                      onClick={disconnectGoogleDrive}
                      disabled={gdriveLoading}
                      className="w-full py-2 rounded-lg text-xs font-semibold border transition-all disabled:opacity-50"
                      style={{ color: '#EF4444', borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)' }}
                    >
                      {gdriveLoading ? '⏳ Disconnessione…' : '🔌 Disconnetti Google Drive'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="rounded-lg p-3 text-xs" style={{ background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
                      <p className="font-semibold" style={{ color: '#1D4ED8' }}>Come funziona:</p>
                      <ul className="mt-1 space-y-0.5" style={{ color: '#1E40AF' }}>
                        <li>• Autorizza l'accesso al tuo Google Drive personale</li>
                        <li>• I file clip vengono salvati in <strong>SKORPIO_Clip/</strong></li>
                        <li>• Il token si rinnova automaticamente (no scadenze)</li>
                      </ul>
                    </div>
                    <button
                      onClick={connectGoogleDrive}
                      disabled={gdriveLoading}
                      className="w-full py-2.5 rounded-lg text-xs font-bold text-white transition-all disabled:opacity-50"
                      style={{ background: gdriveLoading ? '#94A3B8' : '#4285F4' }}
                    >
                      {gdriveLoading ? '⏳ Apertura finestra…' : '🔗 Connetti Google Drive'}
                    </button>
                    <p className="text-[10px] text-center" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                      Si aprirà una finestra Google per autorizzare l'accesso
                    </p>
                  </div>
                )}
              </div>

              {/* ── Google Calendar Card ──────────────────────────────────── */}
              <div
                className="rounded-xl border p-4 space-y-3"
                style={{
                  borderColor: gcalConnected ? '#86EFAC' : 'hsl(var(--border))',
                  background: gcalConnected ? '#F0FDF4' : 'hsl(210 20% 98%)',
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                      style={{ background: '#FFF', border: '1px solid hsl(var(--border))', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
                    >
                      📅
                    </div>
                    <div>
                      <p className="font-semibold text-sm" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                        Google Calendar
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                        {gcalConnected ? '✅ Connesso — sync automatico attivo' : 'Sincronizza eventi sul tuo calendario'}
                      </p>
                    </div>
                  </div>
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ background: gcalConnected ? '#22C55E' : '#D1D5DB' }}
                  />
                </div>

                {gcalConnected ? (
                  <div className="space-y-2">
                    <div
                      className="rounded-lg p-3 text-xs"
                      style={{ background: '#DCFCE7', border: '1px solid #86EFAC' }}
                    >
                      <p className="font-semibold" style={{ color: '#15803D' }}>Cosa viene sincronizzato sul tuo Google Calendar:</p>
                      <ul className="mt-1 space-y-0.5" style={{ color: '#166534' }}>
                        {utente.ruolo === 'Admin' ? (
                          <>
                            <li>• 📱 Tutte le pubblicazioni (calendario editoriale)</li>
                            <li>• 📅 I tuoi appuntamenti e task personali</li>
                            <li className="opacity-70 text-[10px] mt-1">* Gli altri task del team restano visibili in-app ma non sul tuo Google Calendar</li>
                          </>
                        ) : (
                          <>
                            <li>• 📱 Tutte le pubblicazioni (calendario editoriale)</li>
                            <li>• 📅 I tuoi appuntamenti e task</li>
                          </>
                        )}
                      </ul>
                    </div>
                    <button
                      onClick={disconnectGoogleCalendar}
                      disabled={gcalLoading}
                      className="w-full py-2 rounded-lg text-xs font-semibold border transition-all disabled:opacity-50"
                      style={{
                        color: '#EF4444',
                        borderColor: 'rgba(239,68,68,0.3)',
                        background: 'rgba(239,68,68,0.05)',
                      }}
                    >
                      {gcalLoading ? '⏳ Disconnessione…' : '🔌 Disconnetti Google Calendar'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div
                      className="rounded-lg p-3 text-xs"
                      style={{ background: '#EFF6FF', border: '1px solid #BFDBFE' }}
                    >
                      <p className="font-semibold" style={{ color: '#1D4ED8' }}>Come funziona:</p>
                      <ul className="mt-1 space-y-0.5" style={{ color: '#1E40AF' }}>
                        <li>• Autorizza Fuyue a scrivere sul tuo Google Calendar</li>
                        <li>• Gli eventi vengono sincronizzati automaticamente</li>
                        {utente.ruolo === 'Admin' ? (
                          <li>• Vedrai i tuoi appuntamenti + il calendario editoriale</li>
                        ) : (
                          <li>• Vedrai i tuoi task + tutte le pubblicazioni</li>
                        )}
                      </ul>
                    </div>
                    <button
                      onClick={connectGoogleCalendar}
                      disabled={gcalLoading}
                      className="w-full py-2.5 rounded-lg text-xs font-bold text-white transition-all disabled:opacity-50"
                      style={{ background: gcalLoading ? '#94A3B8' : '#4285F4' }}
                    >
                      {gcalLoading ? '⏳ Apertura finestra…' : '🔗 Collega Google Calendar'}
                    </button>
                    <p className="text-[10px] text-center" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                      Si aprirà una finestra Google per autorizzare l'accesso
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── SEZIONE TEAM ── */}
          {section === 'team' && isAdmin && (
            <div className="px-5 py-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                  Membri del team ({team.length})
                </h3>
                <button
                  onClick={openAdd}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white"
                  style={{ background: '#3B82F6' }}
                >
                  + Aggiungi
                </button>
              </div>

              {/* Lista membri */}
              <div className="space-y-2">
                {team.map(m => (
                  <div
                    key={m.id}
                    className="flex items-center gap-3 p-3 rounded-xl border transition-all"
                    style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
                  >
                    <Avatar nome={m.nome} colore={m.colore} size={40} avatarUrl={m.avatar_url} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm truncate"
                          style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                          {m.nome}
                        </span>
                        <span className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0"
                          style={{
                            background: m.ruolo === 'Admin' ? '#FEF3C7' : '#EFF6FF',
                            color: m.ruolo === 'Admin' ? '#D97706' : '#2563EB',
                          }}>
                          {m.ruolo === 'Admin' ? '👑' : '🐾'} {m.ruolo}
                        </span>
                      </div>
                      <p className="text-xs mt-0.5 truncate" style={{ color: m.colore }}>
                        {m.label || '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => openEdit(m)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-colors hover:bg-blue-50"
                        title="Modifica"
                        style={{ color: '#3B82F6' }}
                      >✏️</button>
                      {m.id !== utente?.id && (
                        <button
                          onClick={() => openDelete(m)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-colors hover:bg-red-50"
                          title="Rimuovi"
                          style={{ color: '#EF4444' }}
                        >🗑️</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Form aggiungi/modifica inline */}
              {showForm && (
                <div className="rounded-xl border p-4 space-y-3 mt-2"
                  style={{ background: 'hsl(214 100% 98%)', borderColor: '#BFDBFE' }}>
                  <h4 className="font-bold text-sm" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                    {form.id ? '✏️ Modifica membro' : '➕ Nuovo membro'}
                  </h4>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-semibold mb-1"
                        style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                        Nome *
                      </label>
                      <input
                        className="sk-input text-sm w-full"
                        placeholder="es: Marco"
                        value={form.nome}
                        onChange={e => setForm(p => ({ ...p, nome: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1"
                        style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                        Soprannome
                      </label>
                      <input
                        className="sk-input text-sm w-full"
                        placeholder="es: Il Falco"
                        value={form.label}
                        onChange={e => setForm(p => ({ ...p, label: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold mb-1"
                      style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                      Ruolo
                    </label>
                    <div className="flex gap-2">
                      {(['Admin', 'Team'] as const).map(r => (
                        <button
                          key={r}
                          onClick={() => setForm(p => ({ ...p, ruolo: r }))}
                          className="flex-1 py-2 rounded-lg text-xs font-semibold border transition-all"
                          style={form.ruolo === r
                            ? { background: r === 'Admin' ? '#FEF3C7' : '#EFF6FF', color: r === 'Admin' ? '#D97706' : '#2563EB', borderColor: r === 'Admin' ? '#FDE68A' : '#BFDBFE' }
                            : { background: 'transparent', color: 'hsl(var(--skorpio-text-secondary))', borderColor: 'hsl(var(--border))' }
                          }
                        >
                          {r === 'Admin' ? '👑 Admin' : '🐾 Team'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold mb-2"
                      style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                      Colore avatar
                    </label>
                    <div className="flex flex-wrap gap-2 items-center">
                      {COLORI_PRESET.map(c => (
                        <button
                          key={c}
                          onClick={() => setForm(p => ({ ...p, colore: c }))}
                          className="w-7 h-7 rounded-full transition-all border-2"
                          style={{
                            background: c,
                            borderColor: form.colore === c ? 'hsl(var(--skorpio-text-primary))' : 'transparent',
                            transform: form.colore === c ? 'scale(1.2)' : 'scale(1)',
                          }}
                        />
                      ))}
                      <input
                        type="color"
                        value={form.colore}
                        onChange={e => setForm(p => ({ ...p, colore: e.target.value }))}
                        className="w-7 h-7 rounded-full cursor-pointer border-0 p-0"
                        title="Colore personalizzato"
                        style={{ background: 'none' }}
                      />
                    </div>
                    {/* Preview */}
                    <div className="flex items-center gap-2 mt-2">
                      <Avatar nome={form.nome || '?'} colore={form.colore} size={32} />
                      <span className="text-xs" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                        {form.nome || 'Anteprima'} — {form.label || 'soprannome'}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={salvaForm}
                      disabled={saving}
                      className="flex-1 py-2 rounded-lg text-xs font-bold text-white transition-all"
                      style={{ background: saving ? '#94A3B8' : '#3B82F6' }}
                    >
                      {saving ? '⏳ Salvataggio…' : form.id ? '✅ Aggiorna membro' : '✅ Aggiungi membro'}
                    </button>
                    <button
                      onClick={() => setShowForm(false)}
                      className="px-4 py-2 rounded-lg text-xs font-semibold border transition-colors"
                      style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--skorpio-text-secondary))' }}
                    >
                      Annulla
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── SEZIONE AUDIT ── */}
           {section === 'audit' && isAdmin && (
            <div className="px-5 py-5 space-y-4 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                  📸 Snapshot Dati
                </h3>
                <button
                  onClick={runSnapshot}
                  disabled={snapshotRunning}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white disabled:opacity-50"
                  style={{ background: snapshotRunning ? '#94A3B8' : '#22C55E' }}
                >
                  {snapshotRunning ? '⏳ Conteggio…' : '📸 Snapshot dati'}
                </button>
              </div>
              <div className="rounded-xl p-3 text-xs"
                style={{ background: 'hsl(142 70% 45% / 0.08)', border: '1px solid hsl(142 70% 45% / 0.20)', color: 'hsl(142 50% 30%)' }}>
                Conta i record nelle tabelle principali e salva uno snapshot per confronto futuro. Usa dopo ogni modifica critica.
              </div>
              {snapshotResult && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(snapshotResult).map(([table, count]) => (
                      <div key={table} className="rounded-lg p-2.5"
                        style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))' }}>
                        <div className="flex items-baseline justify-between">
                          <p className="text-xs font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{count}</p>
                          <p className="text-[10px]" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>{table}</p>
                        </div>
                        {snapshotBreakdowns?.[table] && (
                          <div className="mt-1.5 pt-1.5 space-y-0.5" style={{ borderTop: '1px solid hsl(var(--border))' }}>
                            {Object.entries(snapshotBreakdowns[table])
                              .sort(([, a], [, b]) => b - a)
                              .map(([stato, n]) => (
                                <div key={stato} className="flex justify-between text-[10px]">
                                  <span style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>{stato}</span>
                                  <span className="font-semibold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{n}</span>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {section === 'audit' && isAdmin && (
            <div className="px-5 py-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                  🔍 Audit Clienti ↔ CLP
                </h3>
                <button
                  onClick={runAudit}
                  disabled={auditRunning}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white disabled:opacity-50"
                  style={{ background: auditRunning ? '#94A3B8' : '#3B82F6' }}
                >
                  {auditRunning ? '⏳ Analisi…' : '▶ Esegui audit'}
                </button>
              </div>

              <div className="rounded-xl p-3 text-xs"
                style={{ background: 'hsl(214 80% 55% / 0.08)', border: '1px solid hsl(214 80% 55% / 0.20)', color: 'hsl(214 70% 44%)' }}>
                Analizza tutti i CLP e verifica che ogni cliente_nome corrisponda a un record valido nella tabella Clienti. Mostra discrepanze e clienti mancanti.
              </div>

              {auditDone && (
                <div className="space-y-2">
                  {(auditReport as any[]).map((row, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2.5 p-2.5 rounded-lg"
                      style={{
                        background: row.inClienti ? 'hsl(142 70% 45% / 0.07)' : 'hsl(0 80% 55% / 0.08)',
                        border: `1px solid ${row.inClienti ? 'hsl(142 70% 45% / 0.20)' : 'hsl(0 80% 55 / 0.25)'}`,
                      }}
                    >
                      <span className="text-base flex-shrink-0">{row.inClienti ? '✅' : '⚠️'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-xs truncate"
                          style={{ color: row.inClienti ? 'hsl(142 60% 35%)' : 'hsl(0 70% 38%)' }}>
                          "{row.cliente}"
                        </p>
                        <p className="text-xs mt-0.5"
                          style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                          {row.clpCount} CLP — {row.inClienti
                            ? '✓ allineato'
                            : '✗ NON presente in tabella Clienti'}
                        </p>
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-center pt-2"
                    style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                    {(auditReport as any[]).filter((r: any) => r.inClienti).length}/{(auditReport as any[]).length} clienti allineati
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── SEZIONE DAILY PRIORITY ── */}
          {section === 'priorita' && isAdmin && (
            <div className="px-5 py-5">
              <DailyPriorityManager team={team} utente={utente} />
              <div className="mt-8 pt-6" style={{ borderTop: '1px solid hsl(var(--border))' }}>
                <FeatureLearningAdmin team={team} />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t flex-shrink-0 flex flex-col gap-2" style={{ borderColor: 'hsl(var(--border))' }}>
          <button
            onClick={() => {
              logout();
              onClose();
            }}
            className="w-full text-xs py-2.5 px-3 rounded-lg text-left font-medium transition-colors"
            style={{ color: '#EF4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            🚪 Logout
          </button>
        </div>
      </div>

      {/* ── Dialog Elimina / Riassegna ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.55)' }}>
          <div className="rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            <div className="flex items-center gap-3 mb-4">
              <Avatar nome={deleteTarget.nome} colore={deleteTarget.colore} size={44} avatarUrl={deleteTarget.avatar_url} />
              <div>
                <h3 className="font-bold text-base" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                  Rimuovi {deleteTarget.nome}
                </h3>
                <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                  {deleteTarget.label}
                </p>
              </div>
            </div>

            {taskCount > 0 ? (
              <div className="space-y-3">
                <div className="p-3 rounded-lg" style={{ background: '#FEF3C7', border: '1px solid #FDE68A' }}>
                  <p className="text-xs font-semibold" style={{ color: '#D97706' }}>
                    ⚠️ {deleteTarget.nome} ha <strong>{taskCount} task attivi</strong>
                  </p>
                  <p className="text-xs mt-1" style={{ color: '#92400E' }}>
                    Scegli a chi riassegnarli prima di eliminare il membro.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1"
                    style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                    Riassegna task a:
                  </label>
                  <select
                    className="sk-select text-sm w-full"
                    value={riassegnaA}
                    onChange={e => setRiassegnaA(e.target.value)}
                  >
                    <option value="">Seleziona membro…</option>
                    {altriMembri.map(m => (
                      <option key={m.id} value={m.nome}>{m.nome} ({m.ruolo})</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <p className="text-sm mb-2" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                Sei sicuro di voler rimuovere <strong>{deleteTarget.nome}</strong> dal team?
                <br />
                <span className="text-xs" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                  Nessun task attivo da riassegnare.
                </span>
              </p>
            )}

            <div className="flex gap-2 mt-5">
              <button
                onClick={confermaElimina}
                disabled={deleting || (taskCount > 0 && !riassegnaA)}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
                style={{ background: deleting ? '#94A3B8' : '#EF4444' }}
              >
                {deleting ? '⏳ Eliminazione…' : '🗑️ Conferma rimozione'}
              </button>
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2.5 rounded-xl text-sm border font-medium"
                style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--skorpio-text-secondary))' }}
              >
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
