import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { Avatar } from './Avatar';
import type { TeamMember, Task } from '../types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID as string;
const GCAL_REDIRECT_URI = `${window.location.origin}/gcal-callback`;

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

  // Gestione team
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<MembroForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Dialog riassegnazione
  const [deleteTarget, setDeleteTarget] = useState<TeamMember | null>(null);
  const [taskCount, setTaskCount] = useState(0);
  const [riassegnaA, setRiassegnaA] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Sezione attiva
  const [section, setSection] = useState<'profilo' | 'team' | 'integrazioni'>('profilo');

  // Google Calendar state
  const [gcalLoading, setGcalLoading] = useState(false);
  const [gcalConnected, setGcalConnected] = useState(false);

  // Inizializza stato GCal dall'utente
  useEffect(() => {
    if (utente) {
      setGcalConnected(!!(utente as any).google_calendar_connected);
    }
  }, [utente]);

  // Handler OAuth Google Calendar
  const connectGoogleCalendar = useCallback(async () => {
    if (!utente) return;
    setGcalLoading(true);
    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/google-calendar-oauth?action=get_url`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
          body: JSON.stringify({ redirect_uri: GCAL_REDIRECT_URI }),
        }
      );
      const { url } = await res.json();
      if (url) {
        // Salva team_id nel sessionStorage per il callback
        sessionStorage.setItem('gcal_team_id', utente.id);
        window.open(url, '_blank', 'width=500,height=600');
      }
    } catch (e) {
      addToast('❌ Errore connessione Google Calendar', 'error');
    } finally {
      setGcalLoading(false);
    }
  }, [utente, addToast]);

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
    } catch (e) {
      addToast('❌ Errore disconnessione', 'error');
    } finally {
      setGcalLoading(false);
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
                  <Avatar nome={utente.nome} colore={utente.colore} size={72} />
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
                    <Avatar nome={m.nome} colore={m.colore} size={40} />
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
              <Avatar nome={deleteTarget.nome} colore={deleteTarget.colore} size={44} />
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
