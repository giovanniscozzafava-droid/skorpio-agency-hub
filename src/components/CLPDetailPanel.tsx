import React, { useState, useRef, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import type { Contenuto, FaseCLP, TeamMember, Cliente, LogRipresa } from '../types';
// [UNIFIED - old] import { FASE_CONFIG } from './ContenutiTab';
import { FASE_CONFIG } from '../config/faseConfig';
import { Calendar } from './ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { cn } from '../lib/utils';
import { parseLocalDate } from '../lib/dateUtils';
import {
  findMembro,
  completaTaskPerContenuto,
  creaTaskWorkflow,
  creaTaskCleanup,
  ricalcolaScadenzeTask,
} from '../lib/clpWorkflow';
import { ArubaUpload } from './ArubaUpload';

const STATI_CLIP: LogRipresa['stato'][] = ['Da girare', 'Grezza', 'Buona', 'Scartata', 'Usata'];
const FORMATI_CLIP = ['Verticale 9:16', 'Orizzontale 16:9', 'Quadrato 1:1', 'Foto', 'Raw / LOG', 'Slow Motion', 'Drone', 'Altro'];
const STATO_CLIP_CFG: Record<string, { bg: string; text: string; border: string }> = {
  'Da girare': { bg: 'hsl(45 90% 50% / 0.12)', text: 'hsl(45 90% 40%)',  border: 'hsl(45 90% 50% / 0.35)' },
  'Grezza':    { bg: 'hsl(var(--muted))',        text: 'hsl(var(--muted-foreground))', border: 'hsl(var(--border))' },
  'Buona':     { bg: 'hsl(142 70% 45% / 0.12)',  text: 'hsl(142 60% 35%)',  border: 'hsl(142 70% 45% / 0.35)' },
  'Scartata':  { bg: 'hsl(0 80% 55% / 0.10)',    text: 'hsl(0 70% 45%)',    border: 'hsl(0 80% 55% / 0.35)' },
  'Usata':     { bg: 'hsl(214 80% 55% / 0.12)',  text: 'hsl(214 70% 45%)',  border: 'hsl(214 80% 55% / 0.35)' },
};


async function createDriveFolder(contenuto: Contenuto, teamId?: string): Promise<string | null> {
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const res = await fetch(`${supabaseUrl}/functions/v1/create-drive-folder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey,
      },
      body: JSON.stringify({
        contenuto_id: contenuto.id,
        titolo: contenuto.titolo,
        cliente_nome: contenuto.cliente_nome,
        tipo: contenuto.tipo,
        id_display: contenuto.id_display,
        team_id: teamId,
      }),
    });
    const result = await res.json();
    return result.success ? result.folder_url : null;
  } catch {
    return null;
  }
}

const FASI: FaseCLP[] = ['Idea', 'Script', 'Girato', 'Pre montato', 'Montato', 'Uploadato', 'Revisionato', 'Programmato', 'Pubblicato', 'Scartata'];
const CANALI = ['Instagram', 'Facebook', 'Instagram/Facebook', 'TikTok', 'LinkedIn', 'YouTube', 'Altro'];
const TIPI = ['Reel', 'Post', 'Carosello', 'Story', 'Video', 'Short', 'Altro'];

interface CLPDetailPanelProps {
  contenuto: Contenuto;
  team: TeamMember[];
  clienti: Cliente[];
  onClose: () => void;
  onUpdate: (updated: Contenuto) => void;
  onDelete: (id: string) => void;
  onFaseChange: (c: Contenuto, fase: FaseCLP) => void;
}

type FormData = Partial<Contenuto>;

function Section({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 my-4">
      <div className="flex-1 h-px" style={{ background: 'hsl(var(--border))' }} />
      <span className="text-xs font-bold uppercase tracking-widest px-2"
        style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
        {title}
      </span>
      <div className="flex-1 h-px" style={{ background: 'hsl(var(--border))' }} />
    </div>
  );
}

export function CLPDetailPanel({ contenuto, team, clienti, onClose, onUpdate, onDelete, onFaseChange }: CLPDetailPanelProps) {
  const { addToast, utente } = useApp();
  const [form, setForm] = useState<Contenuto>({ ...contenuto });
  const [saving, setSaving] = useState(false);
  const [creatingDrive, setCreatingDrive] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevFaseRef = useRef<FaseCLP>(contenuto.fase);

  // ─── Publish state (per Elisa) ─────────────────────────────────────────────
  const [pubDate, setPubDate] = useState<Date | undefined>(
    contenuto.data_pubblicazione ? parseLocalDate(contenuto.data_pubblicazione) : undefined
  );
  const [pubOra, setPubOra] = useState(contenuto.ora_pubblicazione?.slice(0, 5) || '');
  const [pubCalOpen, setPubCalOpen] = useState(false);
  const [savingPub, setSavingPub] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ tipo: 'riprogramma' | 'annulla'; open: boolean }>({ tipo: 'riprogramma', open: false });

  // ─── Permessi programmazione ─────────────────────────────────────────────
  const canEditProgrammazione = utente?.nome === 'Elisa' || utente?.nome === 'Giovanni' || utente?.ruolo === 'Admin';

  // ─── Riprese state ────────────────────────────────────────────────────────
  const [clips, setClips] = useState<LogRipresa[]>([]);
  const [showAddClip, setShowAddClip] = useState(false);
  const [addingClip, setAddingClip] = useState(false);
  const [clipForm, setClipForm] = useState({
    codici: '',
    stato: 'Grezza' as LogRipresa['stato'],
    formato: '',
    operatore: '',
  });

  const loadClips = useCallback(async () => {
    const { data } = await supabase
      .from('log_riprese')
      .select('*')
      .eq('contenuto_id', contenuto.id)
      .order('created_at', { ascending: false });
    setClips((data || []) as LogRipresa[]);
  }, [contenuto.id]);

  // Reset form when contenuto changes
  useEffect(() => {
    setForm({ ...contenuto });
    prevFaseRef.current = contenuto.fase;
    setPubDate(contenuto.data_pubblicazione ? parseLocalDate(contenuto.data_pubblicazione) : undefined);
    setPubOra(contenuto.ora_pubblicazione?.slice(0, 5) || '');
    loadClips();
  }, [contenuto.id, loadClips]);

  const set = (k: keyof Contenuto, v: any) => {
    setForm(prev => ({ ...prev, [k]: v }));
    // La fase NON viene autosalvata: il cambio fase si salva solo con il tasto Salva
    // (così prevFaseRef rimane stabile per il workflow automatico)
    if (k === 'fase') return;
    // Auto-save con debounce per gli altri campi
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveField(k, v), 800);
  };

  const saveField = async (k: keyof Contenuto, v: any) => {
    await supabase.from('contenuti').update({ [k]: v }).eq('id', contenuto.id);
    // Aggiorna il parent silenziosamente
    const { data } = await supabase.from('contenuti').select('*').eq('id', contenuto.id).single();
    if (data) onUpdate(data as Contenuto);
    // Se il titolo cambia in fase Programmato, propaga a calendario e task
    if (k === 'titolo' && form.fase === 'Programmato') {
      const newDesc = `📱 Pubblica ${contenuto.id_display} – ${v}`;
      await supabase.from('calendario').update({ descrizione: newDesc })
        .eq('contenuto_id', contenuto.id).eq('tipo', 'pubblicazione');
      // Aggiorna descrizione dei task aperti collegati
      const { data: openTasks } = await supabase.from('task').select('id, tipo')
        .eq('id_contenuto', contenuto.id).in('stato', ['Da fare', 'In lavorazione', 'In revisione']);
      if (openTasks) {
        for (const t of openTasks) {
          const emoji = { 'Programmazione': '📅', 'Scrittura script': '📝', 'Premontaggio': '🎬', 'Montaggio': '✂️', 'Upload esportato': '📤', 'Revisione montaggio': '👁️' }[t.tipo || ''] || '';
          const desc = `${emoji} ${t.tipo} ${contenuto.id_display} – ${v}${contenuto.cliente_nome ? ` (${contenuto.cliente_nome})` : ''}`;
          await supabase.from('task').update({ descrizione: desc }).eq('id', t.id);
        }
      }
    }
  };

  // ─── WORKFLOW AUTOMATICO ──────────────────────────────────────────────────
  // Eseguito ogni volta che si salva un cambio di fase
  const eseguiWorkflowFase = useCallback(async (vecchiaFase: FaseCLP, nuovaFase: FaseCLP, contenutoAggiornato: Contenuto) => {
    if (vecchiaFase === nuovaFase) return;

    const nomeLuca = findMembro(team, 'Luca');
    const nomeAlessandro = findMembro(team, 'Alessandro');
    const nomeElisa = findMembro(team, 'Elisa');

    // GIRATO → crea task premontaggio per Luca (con scadenza = data_pubblicazione se presente)
    if (nuovaFase === 'Girato') {
      const task = await creaTaskWorkflow(
        contenutoAggiornato,
        nomeLuca,
        'Premontaggio',
        `🎬 Premontaggia ${contenutoAggiornato.id_display} – ${contenutoAggiornato.titolo}${contenutoAggiornato.cliente_nome ? ` (${contenutoAggiornato.cliente_nome})` : ''}`,
        'Da fare',
        contenutoAggiornato.data_pubblicazione ?? null,
        contenutoAggiornato.ora_pubblicazione?.slice(0, 5) ?? null
      );
      if (task) addToast(`📋 Task premontaggio creato per ${nomeLuca}`, 'success');
    }

    // PRE MONTATO → completa task Luca (premontaggio) + crea task montaggio per Alessandro
    if (nuovaFase === 'Pre montato') {
      await completaTaskPerContenuto(contenutoAggiornato.id, 'Premontaggio');
      const task = await creaTaskWorkflow(
        contenutoAggiornato,
        nomeAlessandro,
        'Montaggio',
        `✂️ Monta ${contenutoAggiornato.id_display} – ${contenutoAggiornato.titolo}${contenutoAggiornato.cliente_nome ? ` (${contenutoAggiornato.cliente_nome})` : ''}`,
        'Da fare'
      );
      if (task) addToast(`📋 Task montaggio creato per ${nomeAlessandro}`, 'success');
    }

    // MONTATO → completa task Alessandro (montaggio) + crea task pubblicazione per Elisa
    if (nuovaFase === 'Montato') {
      await completaTaskPerContenuto(contenutoAggiornato.id, 'Montaggio');
      const task = await creaTaskWorkflow(
        contenutoAggiornato,
        nomeElisa,
        'Pubblicazione',
        `📱 Programma/pubblica ${contenutoAggiornato.id_display} – ${contenutoAggiornato.titolo}${contenutoAggiornato.cliente_nome ? ` (${contenutoAggiornato.cliente_nome})` : ''}`,
        'Da fare'
      );
      if (task) addToast(`📋 Task pubblicazione creato per ${nomeElisa}`, 'success');
    }
  }, [team, addToast]);

  const handleSaveAll = async () => {
    setSaving(true);
    const vecchiaFase = prevFaseRef.current;
    const { data, error } = await supabase
      .from('contenuti')
      .update(form)
      .eq('id', contenuto.id)
      .select()
      .single();
    setSaving(false);
    if (!error && data) {
      const updatedData = data as Contenuto;
      onUpdate(updatedData);
      addToast('CLP salvato ✅', 'success');

      // 🔄 Workflow task automatico
      await eseguiWorkflowFase(vecchiaFase, form.fase, updatedData);
      prevFaseRef.current = form.fase;

      // 📁 Se la fase è Montato e non c'è ancora link Drive → crea cartella
      if (form.fase === 'Montato' && !updatedData.link_drive) {
        addToast('📁 Creazione cartella Drive…', 'info');
        const url = await createDriveFolder(updatedData, utente?.id);
        if (url) {
          const { data: fresh } = await supabase.from('contenuti').select('*').eq('id', contenuto.id).single();
          if (fresh) onUpdate(fresh as Contenuto);
          addToast('📁 Cartella Drive creata!', 'success');
        } else {
          addToast('⚠️ Errore creazione cartella Drive', 'warn');
        }
      }
    }
  };

  // ─── SALVA DATA PUBBLICAZIONE (senza cambiare fase) ────────────────────────
  const handleSalvaDataPub = async () => {
    if (!pubDate) return;
    setSavingPub(true);
    const dataStr = format(pubDate, 'yyyy-MM-dd');
    const oraStr = pubOra || null;

    const { data, error } = await supabase
      .from('contenuti')
      .update({ data_pubblicazione: dataStr, ora_pubblicazione: oraStr })
      .eq('id', contenuto.id)
      .select()
      .single();

    if (!error && data) {
      onUpdate(data as Contenuto);
      setForm(data as Contenuto);
      // Ricalcola scadenze di TUTTI i task aperti collegati
      const count = await ricalcolaScadenzeTask(contenuto.id, dataStr, oraStr, contenuto.tipo);
      addToast(`📅 Data salvata — ${count} scadenze task ricalcolate a ritroso`, 'success');
    }
    setSavingPub(false);
  };

  // ─── PROGRAMMA / PUBBLICA (Elisa) ─────────────────────────────────────────
  const handleProgramma = async (nuovaFase: 'Programmato' | 'Pubblicato') => {
    setSavingPub(true);
    const dataStr = pubDate ? format(pubDate, 'yyyy-MM-dd') : null;
    const oraStr = pubOra || null;

    // [OLD] await supabase.from('contenuti').update({ fase: nuovaFase, data_pubblicazione: dataStr, ora_pubblicazione: oraStr }).eq('id', contenuto.id).select().single();
    // [NEW - FaseService + data separati]
    const { cambiaFaseCLP } = await import('../services/faseService');
    console.log('[Step2c] CLPDetailPanel handleProgramma via FaseService', { id: contenuto.id, nuovaFase });
    await cambiaFaseCLP({ contenutoId: contenuto.id, nuovaFase, source: 'contenuti', userId: utente?.id || 'unknown' });
    // Aggiorna data/ora separatamente
    const { data, error } = await supabase
      .from('contenuti')
      .update({ data_pubblicazione: dataStr, ora_pubblicazione: oraStr })
      .eq('id', contenuto.id)
      .select()
      .single();
    setSavingPub(false);

    if (!error && data) {
      onUpdate(data as Contenuto);
      setForm(data as Contenuto);
      const vecchiaFase = prevFaseRef.current;
      prevFaseRef.current = nuovaFase;

      // Ricalcola scadenze di tutti i task aperti collegati
      if (dataStr) {
        await ricalcolaScadenzeTask(contenuto.id, dataStr, oraStr, contenuto.tipo);
      }

      // Completa task pubblicazione di Elisa (solo se Pubblicato, non Programmato)
      if (nuovaFase === 'Pubblicato') {
        await completaTaskPerContenuto(contenuto.id, 'Pubblicazione');
        // Crea task cleanup per Elisa
        await creaTaskCleanup(data as Contenuto, team);
        addToast('🗑️ Task cleanup creato per Elisa', 'info');
      }

      // Se programmato, aggiungi evento in calendario
      if (nuovaFase === 'Programmato' && dataStr) {
        await supabase.from('calendario').insert({
          tipo: 'pubblicazione',
          data: dataStr,
          ora: oraStr,
          descrizione: `📱 Pubblica ${contenuto.id_display} – ${contenuto.titolo}`,
          cliente_id: contenuto.cliente_id,
          cliente_nome: contenuto.cliente_nome || '',
          contenuto_id: contenuto.id,
          id_contenuto_display: contenuto.id_display,
          canale: contenuto.canale || '',
          tipo_contenuto: contenuto.tipo || '',
          stato: 'Pianificato',
        });
        addToast(`📅 Programmato per il ${format(pubDate!, 'dd/MM/yyyy')}`, 'success');
      } else if (nuovaFase === 'Pubblicato') {
        addToast('🚀 Contenuto pubblicato!', 'success');
      }

      await eseguiWorkflowFase(vecchiaFase, nuovaFase, data as Contenuto);
    }
  };

  // ─── RIPROGRAMMA (Programmato → Revisionato) ────────────────────────────────
  const handleRiprogramma = async () => {
    setConfirmDialog({ tipo: 'riprogramma', open: false });
    setSavingPub(true);
    const { cambiaFaseCLP } = await import('../services/faseService');
    const result = await cambiaFaseCLP({
      contenutoId: contenuto.id,
      nuovaFase: 'Revisionato',
      source: 'contenuti',
      userId: utente?.id || 'unknown',
    });
    if (result.success) {
      const { data } = await supabase.from('contenuti').select('*').eq('id', contenuto.id).single();
      if (data) {
        onUpdate(data as Contenuto);
        setForm(data as Contenuto);
        prevFaseRef.current = 'Revisionato' as FaseCLP;
      }
      addToast('🔄 Riprogrammato — il CLP torna in revisione', 'success');
    } else {
      addToast('❌ Errore: ' + (result.errors[0] || 'sconosciuto'), 'error');
    }
    setSavingPub(false);
  };

  // ─── ANNULLA PROGRAMMAZIONE (svuota data + Revisionato) ────────────────────
  const handleAnnullaProgrammazione = async () => {
    setConfirmDialog({ tipo: 'annulla', open: false });
    setSavingPub(true);
    // 1. Svuota data/ora pubblicazione
    await supabase.from('contenuti').update({
      data_pubblicazione: null,
      ora_pubblicazione: null,
    }).eq('id', contenuto.id);
    // 2. Cancella evento pubblicazione dal calendario
    await supabase.from('calendario').delete()
      .eq('contenuto_id', contenuto.id)
      .eq('tipo', 'pubblicazione');
    // 3. Cambia fase a Revisionato
    const { cambiaFaseCLP } = await import('../services/faseService');
    const result = await cambiaFaseCLP({
      contenutoId: contenuto.id,
      nuovaFase: 'Revisionato',
      source: 'contenuti',
      userId: utente?.id || 'unknown',
    });
    if (result.success) {
      const { data } = await supabase.from('contenuti').select('*').eq('id', contenuto.id).single();
      if (data) {
        onUpdate(data as Contenuto);
        setForm(data as Contenuto);
        prevFaseRef.current = 'Revisionato' as FaseCLP;
        setPubDate(undefined);
        setPubOra('');
      }
      addToast('❌ Programmazione annullata — il CLP torna in revisione senza data', 'success');
    } else {
      addToast('❌ Errore: ' + (result.errors[0] || 'sconosciuto'), 'error');
    }
    setSavingPub(false);
  };

  // ─── SALVA DATA PUB QUANDO PROGRAMMATO (aggiorna data senza cambiare fase) ─
  const handleSalvaDataPubProgrammato = async () => {
    if (!pubDate) return;
    setSavingPub(true);
    const dataStr = format(pubDate, 'yyyy-MM-dd');
    const oraStr = pubOra || null;
    // 1. Aggiorna contenuto
    const { data, error } = await supabase
      .from('contenuti')
      .update({ data_pubblicazione: dataStr, ora_pubblicazione: oraStr })
      .eq('id', contenuto.id)
      .select()
      .single();
    if (!error && data) {
      onUpdate(data as Contenuto);
      setForm(data as Contenuto);
      // 2. Aggiorna evento calendario
      await supabase.from('calendario').update({
        data: dataStr,
        ora: oraStr,
      }).eq('contenuto_id', contenuto.id).eq('tipo', 'pubblicazione');
      // 3. Ricalcola scadenze task
      const count = await ricalcolaScadenzeTask(contenuto.id, dataStr, oraStr, contenuto.tipo);
      addToast(`📅 Data pubblicazione aggiornata a ${format(pubDate, 'dd/MM/yyyy')} ${oraStr || ''} — ${count} scadenze ricalcolate`, 'success');
    }
    setSavingPub(false);
  };

  const handleCreateDrive = async () => {
    setCreatingDrive(true);
    addToast('📁 Creazione cartella Drive…', 'info');
    const url = await createDriveFolder(form, utente?.id);
    if (url) {
      set('link_drive', url);
      addToast('📁 Cartella Drive creata!', 'success');
    } else {
      addToast('⚠️ Errore creazione cartella Drive', 'warn');
    }
    setCreatingDrive(false);
  };

  const handleAddClips = async () => {
    const rawCodes = clipForm.codici.split(',').map(s => s.trim()).filter(Boolean);
    if (rawCodes.length === 0) { addToast('⚠️ Inserisci almeno un codice Sony', 'warn'); return; }
    setAddingClip(true);

    const rows = rawCodes.map(code => ({
      id_clip: code,
      contenuto_id: contenuto.id,
      id_contenuto_display: contenuto.id_display,
      cliente_id: contenuto.cliente_id || null,
      cliente_nome: contenuto.cliente_nome || '',
      titolo: contenuto.titolo,
      stato: clipForm.stato,
      formato: clipForm.formato,
      operatore: clipForm.operatore,
    }));

    const { error } = await supabase.from('log_riprese').insert(rows);
    setAddingClip(false);

    if (error) {
      addToast(error.code === '23505' ? '⚠️ Codice clip già esistente' : '❌ Errore inserimento', 'warn');
      return;
    }

    // Porta il CLP a Girato se era in Idea o Script + triggera workflow task Luca
    if (['Idea', 'Script'].includes(form.fase)) {
      // [OLD] await supabase.from('contenuti').update({ fase: 'Girato' }).eq('id', contenuto.id);
      const { cambiaFaseCLP: cambiaFaseClip } = await import('../services/faseService');
      console.log('[Step2c] CLPDetailPanel auto-Girato via FaseService', { id: contenuto.id });
      await cambiaFaseClip({ contenutoId: contenuto.id, nuovaFase: 'Girato', source: 'contenuti', userId: utente?.id || 'unknown' });
      const { data: fresh } = await supabase.from('contenuti').select('*').eq('id', contenuto.id).single();
      if (fresh) {
        onUpdate(fresh as Contenuto);
        setForm(fresh as Contenuto);

        // ── WORKFLOW: crea task Premontaggio per Luca ──────────────────────
        const nomeLuca = findMembro(team, 'Luca');
        const newTask = await creaTaskWorkflow(
          fresh as any,
          nomeLuca,
          'Premontaggio',
          `🎬 Premontaggia ${contenuto.id_display} – ${contenuto.titolo}${contenuto.cliente_nome ? ` (${contenuto.cliente_nome})` : ''}`,
          'Da fare',
          fresh.data_pubblicazione ?? null,
          fresh.ora_pubblicazione?.slice(0, 5) ?? null
        );
        if (newTask) addToast(`📋 Task premontaggio creato per ${nomeLuca}`, 'success');
      }
      addToast('🎬 Fase aggiornata a Girato', 'success');
    }

    addToast(`✅ ${rawCodes.length} clip inserita${rawCodes.length > 1 ? 'e' : ''}!`, 'success');
    setClipForm({ codici: '', stato: 'Grezza', formato: '', operatore: '' });
    setShowAddClip(false);
    loadClips();
  };

  const handleClipStatoChange = async (clipId: string, nuovoStato: LogRipresa['stato']) => {
    await supabase.from('log_riprese').update({ stato: nuovoStato }).eq('id', clipId);
    setClips(prev => prev.map(c => c.id === clipId ? { ...c, stato: nuovoStato } : c));
  };

  const handleDeleteClip = async (clipId: string) => {
    await supabase.from('log_riprese').delete().eq('id', clipId);
    setClips(prev => prev.filter(c => c.id !== clipId));
    addToast('Clip rimossa', 'success');
  };

  const faseCfg = FASE_CONFIG[form.fase];
  const clienteSelezionato = clienti.find(c => c.id === form.cliente_id);

  const LabelInput = ({ label, field, type = 'text', placeholder = '' }: {
    label: string; field: keyof Contenuto; type?: string; placeholder?: string;
  }) => (
    <div>
      <label className="sk-label">{label}</label>
      <input
        type={type}
        className="sk-input w-full text-sm"
        value={(form[field] as string) || ''}
        onChange={e => set(field, e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );

  const LabelTextarea = ({ label, field, rows = 2, placeholder = '' }: {
    label: string; field: keyof Contenuto; rows?: number; placeholder?: string;
  }) => (
    <div>
      <label className="sk-label">{label}</label>
      <textarea
        className="sk-textarea w-full text-sm"
        rows={rows}
        value={(form[field] as string) || ''}
        onChange={e => set(field, e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );

  const LabelSelect = ({ label, field, options }: {
    label: string; field: keyof Contenuto; options: string[];
  }) => (
    <div>
      <label className="sk-label">{label}</label>
      <select
        className="sk-select w-full text-sm"
        value={(form[field] as string) || ''}
        onChange={e => set(field, e.target.value)}
      >
        <option value="">— Seleziona —</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 bg-card flex flex-col animate-slide-in-right overflow-hidden"
        style={{
          width: 400,
          borderLeft: '1px solid hsl(var(--border))',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.1)',
        }}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between p-4 border-b bg-card">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs font-bold" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
              {form.id_display}
            </span>
            {form.generato_da_ai && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: '#EDE9FE', color: '#7C3AED' }}>🤖 AI</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveAll}
              disabled={saving}
              className="sk-btn-primary text-xs px-3 py-1.5"
            >
              {saving ? '…' : '💾 Salva'}
            </button>
            <button onClick={onClose} className="sk-btn-ghost px-2 py-1 text-lg">✕</button>
          </div>
        </div>

        {/* Body scrollable */}
        <div className="flex-1 overflow-y-auto p-4">

          {/* Fase — dropdown grande */}
          <div className="mb-4">
            <label className="sk-label">Fase</label>
            <div className="flex flex-wrap gap-1.5">
              {FASI.map(f => {
                const cfg = FASE_CONFIG[f];
                const active = form.fase === f;
                return (
                  <button
                    key={f}
                    onClick={() => {
                      set('fase', f);
                      onFaseChange({ ...form, fase: f }, f);
                    }}
                    className="fase-badge cursor-pointer transition-all text-xs"
                    style={{
                      background: active ? cfg.text : cfg.bg,
                      color: active ? 'white' : cfg.text,
                      border: `1px solid ${cfg.border}`,
                      fontWeight: active ? 700 : 400,
                      transform: active ? 'scale(1.05)' : 'scale(1)',
                    }}
                  >
                    {f}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Titolo */}
          <LabelInput label="Titolo" field="titolo" placeholder="Titolo del contenuto…" />

          <div className="grid grid-cols-2 gap-3 mt-3">
            {/* Cliente */}
            <div>
              <label className="sk-label">Cliente</label>
              <select
                className="sk-select w-full text-sm"
                value={form.cliente_id || ''}
                onChange={e => {
                  const cliente = clienti.find(c => c.id === e.target.value);
                  set('cliente_id', e.target.value || null);
                  set('cliente_nome', cliente?.nome || '');
                }}
              >
                <option value="">— Nessuno —</option>
                {clienti.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>

            {/* Durata */}
            <LabelInput label="Durata" field="durata" placeholder="es: 30s" />
          </div>

          <div className="grid grid-cols-2 gap-3 mt-3">
            <LabelSelect label="Tipo" field="tipo" options={['Reel', 'Post', 'Carosello', 'Story', 'Video', 'Short', 'Altro']} />
            <LabelSelect label="Canale" field="canale" options={['Instagram', 'Facebook', 'Instagram/Facebook', 'TikTok', 'LinkedIn', 'YouTube', 'Altro']} />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <LabelSelect label="🎬 Stile" field="stile" options={['Commedia', 'Storytelling', 'Trend', 'Ispirazione', 'Divulgativo', 'Tutorial', 'Behind the scenes', 'Talking head', 'Testimonial', 'Before/After', 'Unboxing', 'ASMR', 'Vlog', 'Altro']} />
            <div>
              <LabelInput label="🔗 Link ispirazione" field="link_ispirazione" placeholder="https://instagram.com/reel/..." />
              {form.link_ispirazione && form.link_ispirazione.startsWith('http') && (
                <a href={form.link_ispirazione} target="_blank" rel="noopener noreferrer" className="text-xs mt-1 inline-flex items-center gap-1 hover:underline" style={{ color: '#3B82F6' }}>
                  ↗ Apri link
                </a>
              )}
            </div>
          </div>

          {/* ─── CREATIVITÀ ─── */}
          <Section title="CREATIVITÀ" />

          <LabelTextarea label="🎣 Hook" field="hook" rows={2} placeholder="Frase di apertura che cattura l'attenzione…" />
          <div className="mt-3">
            <LabelTextarea label="📝 Script" field="script" rows={4} placeholder="Testo completo del contenuto…" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <LabelInput label="📣 CTA" field="cta" placeholder="es: Clicca il link in bio" />
            <LabelInput label="🎵 Musica" field="musica" placeholder="es: Brano - Artista" />
          </div>
          <div className="mt-3">
            <LabelInput label="#️⃣ Hashtag" field="hashtag" placeholder="#beauty #estetica #skincare…" />
          </div>

          {/* ─── PRODUZIONE ─── */}
          <Section title="PRODUZIONE" />

          <div className="grid grid-cols-2 gap-3">
            <LabelInput label="📍 Location" field="location" placeholder="es: Studio, Sede cliente…" />
            <LabelInput label="🎭 Props" field="props" placeholder="es: prodotti, attrezzatura…" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="sk-label">📷 Riprese →</label>
              <select
                className="sk-select w-full text-sm"
                value={form.assegnato_riprese}
                onChange={e => set('assegnato_riprese', e.target.value)}
              >
                <option value="">— Nessuno —</option>
                {team.map(m => (
                  <option key={m.id} value={m.nome}>{m.nome}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="sk-label">✂️ Montaggio →</label>
              <select
                className="sk-select w-full text-sm"
                value={form.assegnato_montaggio}
                onChange={e => set('assegnato_montaggio', e.target.value)}
              >
                <option value="">— Nessuno —</option>
                {team.map(m => (
                  <option key={m.id} value={m.nome}>{m.nome}</option>
                ))}
              </select>
            </div>
          </div>

          {/* ─── DATE ─── */}
          <Section title="DATE" />

          <div className="grid grid-cols-2 gap-3">
            <LabelInput label="📷 Data ripresa" field="data_ripresa" type="date" />
            <LabelInput label="⏰ Scadenza" field="data_scadenza" type="date" />
          </div>

          {/* ─── PUBBLICAZIONE ─── */}
          {form.fase !== 'Scartata' && (
            <>
              <Section title="📱 PUBBLICAZIONE" />
              <div className="rounded-lg border p-3 space-y-3" style={{ background: 'hsl(271 80% 97%)', borderColor: 'hsl(271 60% 80%)' }}>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'hsl(271 60% 45%)' }}>
                    🟣 Programma o pubblica
                  </span>
                  {form.fase === 'Programmato' && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: 'hsl(271 60% 80%)', color: 'hsl(271 60% 30%)' }}>
                        📅 Programmato
                      </span>
                      {canEditProgrammazione && (
                        <>
                          <button
                            onClick={() => handleProgramma('Pubblicato')}
                            disabled={savingPub}
                            className="text-xs px-2 py-0.5 rounded-full font-semibold transition-all hover:scale-105 disabled:opacity-40"
                            style={{ background: 'hsl(142 60% 45%)', color: 'white' }}
                          >
                            {savingPub ? '⏳' : '🚀 Pubblica ora'}
                          </button>
                          <button
                            onClick={() => setConfirmDialog({ tipo: 'riprogramma', open: true })}
                            disabled={savingPub}
                            className="text-xs px-2 py-0.5 rounded-full font-semibold transition-all hover:scale-105 disabled:opacity-40"
                            style={{ background: 'hsl(38 92% 50%)', color: 'white' }}
                          >
                            🔄 Riprogramma
                          </button>
                          <button
                            onClick={() => setConfirmDialog({ tipo: 'annulla', open: true })}
                            disabled={savingPub}
                            className="text-xs px-2 py-0.5 rounded-full font-semibold transition-all hover:scale-105 disabled:opacity-40"
                            style={{ background: 'hsl(0 70% 50%)', color: 'white' }}
                          >
                            ❌ Annulla
                          </button>
                        </>
                      )}
                      {!canEditProgrammazione && (
                        <span className="text-[10px] italic" style={{ color: 'hsl(271 40% 55%)' }} title="Solo Elisa o Giovanni possono modificare la programmazione">
                          🔒 Solo Elisa o Giovanni
                        </span>
                      )}
                    </div>
                  )}
                  {form.fase === 'Pubblicato' && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: 'hsl(142 60% 80%)', color: 'hsl(142 60% 30%)' }}>
                      🚀 Pubblicato
                    </span>
                  )}
                </div>

                {/* Confirm dialog */}
                {confirmDialog.open && (
                  <div className="rounded-lg border p-3 space-y-2" style={{ background: confirmDialog.tipo === 'annulla' ? 'hsl(0 80% 97%)' : 'hsl(38 90% 97%)', borderColor: confirmDialog.tipo === 'annulla' ? 'hsl(0 60% 80%)' : 'hsl(38 70% 70%)' }}>
                    <p className="text-xs font-semibold" style={{ color: confirmDialog.tipo === 'annulla' ? 'hsl(0 70% 40%)' : 'hsl(38 80% 35%)' }}>
                      {confirmDialog.tipo === 'annulla'
                        ? `❌ Vuoi annullare la programmazione di ${form.id_display}? La data e l'ora verranno rimosse e il CLP tornerà in revisione.`
                        : `🔄 Vuoi riprogrammare ${form.id_display}? Tornerà in revisione mantenendo la data attuale.`}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={confirmDialog.tipo === 'annulla' ? handleAnnullaProgrammazione : handleRiprogramma}
                        disabled={savingPub}
                        className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-all disabled:opacity-40"
                        style={{ background: confirmDialog.tipo === 'annulla' ? 'hsl(0 70% 50%)' : 'hsl(38 92% 50%)', color: 'white' }}
                      >
                        {savingPub ? '⏳…' : 'Conferma'}
                      </button>
                      <button
                        onClick={() => setConfirmDialog({ ...confirmDialog, open: false })}
                        className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                        style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}
                      >
                        Annulla
                      </button>
                    </div>
                  </div>
                )}

                {/* Data pubblicazione con datepicker */}
                <div>
                  <label className="sk-label">📅 Data pubblicazione</label>
                  {form.fase === 'Programmato' && !canEditProgrammazione ? (
                    <div className="sk-input w-full text-sm flex items-center gap-2 opacity-60 cursor-not-allowed" title="Solo Elisa o Giovanni possono modificare la programmazione">
                      <CalendarIcon className="h-3.5 w-3.5 flex-shrink-0" />
                      {pubDate ? format(pubDate, 'dd/MM/yyyy') : '—'}
                    </div>
                  ) : (
                  <Popover open={pubCalOpen} onOpenChange={setPubCalOpen}>
                    <PopoverTrigger asChild>
                      <button
                        className={cn(
                          'sk-input w-full text-sm text-left flex items-center gap-2',
                          !pubDate && 'opacity-50'
                        )}
                      >
                        <CalendarIcon className="h-3.5 w-3.5 flex-shrink-0" />
                        {pubDate ? format(pubDate, 'dd/MM/yyyy') : 'Scegli data…'}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start" style={{ zIndex: 9999 }}>
                      <Calendar
                        mode="single"
                        selected={pubDate}
                        onSelect={d => { setPubDate(d); setPubCalOpen(false); }}
                        initialFocus
                        className={cn('p-3 pointer-events-auto')}
                      />
                    </PopoverContent>
                  </Popover>
                  )}
                </div>

                {/* Ora */}
                <div>
                  <label className="sk-label">🕐 Ora pubblicazione</label>
                  {form.fase === 'Programmato' && !canEditProgrammazione ? (
                    <div className="sk-input w-full text-sm opacity-60 cursor-not-allowed" title="Solo Elisa o Giovanni possono modificare la programmazione">
                      {pubOra || '—'}
                    </div>
                  ) : (
                    <input
                      type="time"
                      className="sk-input w-full text-sm"
                      value={pubOra}
                      onChange={e => setPubOra(e.target.value)}
                    />
                  )}
                </div>

                {/* Bottoni azione */}
                <div className="flex gap-2 pt-1 flex-wrap">
                  {/* Salva data (PRIMA della programmazione + quando Programmato per Elisa/Giovanni) */}
                  {!['Pubblicato'].includes(form.fase) && !(form.fase === 'Programmato' && !canEditProgrammazione) && (
                    <button
                      onClick={form.fase === 'Programmato' ? handleSalvaDataPubProgrammato : handleSalvaDataPub}
                      disabled={savingPub || !pubDate}
                      className="flex-1 text-xs px-3 py-2 rounded-lg font-semibold transition-all disabled:opacity-40"
                      style={{ background: 'hsl(214 80% 55%)', color: 'white' }}
                    >
                      {savingPub ? '⏳…' : '💾 Salva data'}
                    </button>
                  )}
                  {/* Programma (richiede fase Revisionato o superiore) */}
                  {['Revisionato', 'Montato'].includes(form.fase) && (
                    <button
                      onClick={() => handleProgramma('Programmato')}
                      disabled={savingPub || !pubDate || !pubOra}
                      className="flex-1 text-xs px-3 py-2 rounded-lg font-semibold transition-all disabled:opacity-40"
                      style={{ background: 'hsl(271 60% 55%)', color: 'white' }}
                      title={!pubOra ? 'Inserisci anche l\'ora di pubblicazione' : ''}
                    >
                      {savingPub ? '⏳…' : '📅 Programma'}
                    </button>
                  )}
                  {/* Pubblica ora (non quando Programmato — c'è già il bottone in alto) */}
                  {!['Pubblicato', 'Programmato'].includes(form.fase) && (
                    <button
                      onClick={() => handleProgramma('Pubblicato')}
                      disabled={savingPub}
                      className="flex-1 text-xs px-3 py-2 rounded-lg font-semibold transition-all disabled:opacity-40"
                      style={{ background: 'hsl(142 60% 45%)', color: 'white' }}
                    >
                      {savingPub ? '⏳…' : '🚀 Pubblica ora'}
                    </button>
                  )}
                </div>
                {!pubOra && pubDate && !['Programmato', 'Pubblicato'].includes(form.fase) && (
                  <p className="text-xs mt-1" style={{ color: 'hsl(45 90% 50%)' }}>
                    ⚠️ Per programmare devi impostare anche l'ora di pubblicazione
                  </p>
                )}
                {pubDate && !['Programmato', 'Pubblicato'].includes(form.fase) && (
                  <p className="text-xs mt-1" style={{ color: 'hsl(214 70% 50%)' }}>
                    💡 Salvando la data, le scadenze dei task verranno ricalcolate automaticamente
                  </p>
                )}
              </div>
            </>
          )}

          {/* ─── RIPRESE ─── */}
          <Section title="RIPRESE" />

          <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'hsl(var(--border))' }}>
            {/* Header riprese */}
            <div className="flex items-center justify-between px-3 py-2"
              style={{ background: 'hsl(var(--muted))' }}>
              <span className="text-xs font-semibold" style={{ color: 'hsl(var(--muted-foreground))' }}>
                🎬 {clips.length} clip{clips.length !== 1 ? 's' : ''} collegate
              </span>
              <button
                onClick={() => setShowAddClip(v => !v)}
                className="text-xs px-2.5 py-1 rounded-md font-semibold transition-all"
                style={{ background: showAddClip ? 'hsl(var(--muted-foreground))' : 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
              >
                {showAddClip ? '✕ Annulla' : '+ Aggiungi clip'}
              </button>
            </div>

            {/* Form aggiunta clip */}
            {showAddClip && (
              <div className="p-3 border-b space-y-2" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}>
                <div>
                  <label className="sk-label">Codici Sony <span className="font-normal opacity-60">(separati da virgola)</span></label>
                  <input
                    className="sk-input w-full text-sm"
                    placeholder="es: C7876, C7877"
                    value={clipForm.codici}
                    onChange={e => setClipForm(f => ({ ...f, codici: e.target.value }))}
                    autoFocus
                  />
                  {clipForm.codici && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {clipForm.codici.split(',').map(s => s.trim()).filter(Boolean).map(code => (
                        <span key={code} className="px-2 py-0.5 rounded-full text-[11px] font-medium"
                          style={{ background: 'hsl(214 80% 55% / 0.12)', color: 'hsl(214 70% 45%)', border: '1px solid hsl(214 80% 55% / 0.3)' }}>
                          {code}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="sk-label">Stato</label>
                    <select className="sk-select w-full text-sm" value={clipForm.stato}
                      onChange={e => setClipForm(f => ({ ...f, stato: e.target.value as LogRipresa['stato'] }))}>
                      {STATI_CLIP.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="sk-label">Formato</label>
                    <select className="sk-select w-full text-sm" value={clipForm.formato}
                      onChange={e => setClipForm(f => ({ ...f, formato: e.target.value }))}>
                      <option value="">—</option>
                      {FORMATI_CLIP.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="sk-label">Operatore</label>
                    <select className="sk-select w-full text-sm" value={clipForm.operatore}
                      onChange={e => setClipForm(f => ({ ...f, operatore: e.target.value }))}>
                      <option value="">—</option>
                      {team.map(m => <option key={m.id} value={m.nome}>{m.nome}</option>)}
                    </select>
                  </div>
                </div>
                <button
                  onClick={handleAddClips}
                  disabled={addingClip || !clipForm.codici.trim()}
                  className="sk-btn-primary w-full text-sm"
                >
                  {addingClip ? '⏳ Inserimento…' : `✅ Inserisci clip${['Idea', 'Script'].includes(form.fase) ? ' → porta a Girato' : ''}`}
                </button>
              </div>
            )}

            {/* Lista clip */}
            {clips.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Nessuna clip collegata
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'hsl(var(--border))' }}>
                {clips.map(clip => {
                  const cfg = STATO_CLIP_CFG[clip.stato] || STATO_CLIP_CFG['Grezza'];
                  return (
                    <div key={clip.id} className="flex items-center gap-2 px-3 py-2">
                      <span className="font-mono text-xs font-bold flex-shrink-0"
                        style={{ color: 'hsl(var(--muted-foreground))' }}>
                        {clip.id_clip}
                      </span>
                      <select
                        className="text-[11px] font-semibold border rounded-full px-2 py-0.5 cursor-pointer focus:outline-none flex-shrink-0"
                        style={{ background: cfg.bg, color: cfg.text, borderColor: cfg.border }}
                        value={clip.stato}
                        onChange={e => handleClipStatoChange(clip.id, e.target.value as LogRipresa['stato'])}
                      >
                        {STATI_CLIP.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      {clip.operatore && (
                        <span className="text-xs flex-shrink-0" style={{ color: 'hsl(var(--muted-foreground))' }}>
                          {clip.operatore}
                        </span>
                      )}
                      {clip.formato && (
                        <span className="text-xs truncate flex-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
                          {clip.formato}
                        </span>
                      )}
                      <button
                        onClick={() => handleDeleteClip(clip.id)}
                        className="ml-auto flex-shrink-0 text-xs opacity-30 hover:opacity-80 transition-opacity"
                        title="Rimuovi clip"
                      >✕</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ─── NOTE & LINK ─── */}
          <Section title="NOTE E LINK" />

          <LabelTextarea label="Note" field="note" rows={2} placeholder="Note interne…" />
          <div className="mt-3">
            <LabelTextarea label="Note revisione" field="note_revisione" rows={2} placeholder="Feedback dal cliente o per il team…" />
          </div>
          {/* ─── GOOGLE DRIVE ─── */}
          <div className="mt-3 rounded-lg p-3 border" style={{ background: 'hsl(214 100% 98%)', borderColor: 'hsl(214 80% 85%)' }}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold uppercase tracking-widest" style={{ color: 'hsl(214 60% 40%)' }}>
                📁 Google Drive
              </label>
              {!form.link_drive && (
                <button
                  onClick={handleCreateDrive}
                  disabled={creatingDrive}
                  className="text-xs px-2.5 py-1 rounded-md font-semibold transition-all flex items-center gap-1"
                  style={{ background: '#1a73e8', color: 'white', opacity: creatingDrive ? 0.6 : 1 }}
                >
                  {creatingDrive ? (
                    <>⏳ Creazione…</>
                  ) : (
                    <>📁 Crea cartella</>
                  )}
                </button>
              )}
            </div>
            {form.link_drive ? (
              <div className="flex items-center gap-2">
                <a
                  href={form.link_drive}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 rounded-md text-sm font-medium truncate transition-all"
                  style={{ background: '#e8f0fe', color: '#1a73e8', border: '1px solid #c5d8fd' }}
                >
                  <span>📂</span>
                  <span className="truncate">{form.id_display} – {form.cliente_nome || 'Senza cliente'}</span>
                  <span className="ml-auto flex-shrink-0 text-xs opacity-60">↗</span>
                </a>
                <button
                  onClick={() => set('link_drive', '')}
                  className="sk-btn-ghost text-xs px-1.5 py-1 flex-shrink-0 opacity-50 hover:opacity-100"
                  title="Rimuovi link"
                >✕</button>
              </div>
            ) : (
              <div className="text-xs" style={{ color: 'hsl(214 40% 55%)' }}>
                {form.fase === 'Montato' ? (
                  <span>Nessuna cartella — clicca "Crea cartella" per generarla automaticamente su Drive.</span>
                ) : (
                  <span>La cartella verrà creata automaticamente quando il contenuto passa a <strong>Montato</strong>.</span>
                )}
              </div>
            )}
          </div>

          {/* ─── ARUBA DRIVE ─── */}
          <div className="mt-3 rounded-lg p-3 border" style={{ background: 'hsl(205 100% 97%)', borderColor: 'hsl(205 80% 80%)' }}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold uppercase tracking-widest" style={{ color: 'hsl(205 60% 35%)' }}>
                ☁️ Aruba Drive
              </label>
              <ArubaUpload
                percorso={`${form.cliente_nome || 'Generali'}/${form.tipo || 'Contenuti'}/${form.titolo || form.id_display}`}
                contenutoId={form.id}
                label="⬆️ Carica file"
                onUploaded={async (url, nomeFile) => {
                  // Invia notifica al collega assegnato al montaggio
                  if (form.assegnato_montaggio && form.assegnato_montaggio !== '') {
                    await supabase.from('notifiche').insert({
                      destinatario: form.assegnato_montaggio,
                      tipo: 'drive_upload',
                      titolo: '☁️ File caricato su Aruba Drive',
                      messaggio: `"${nomeFile}" per ${form.id_display} – ${form.titolo}`,
                      task_id_display: form.id_display,
                    });
                  }
                  addToast(`📎 Link salvato per ${nomeFile}`, 'success');
                }}
              />
            </div>
            <p className="text-xs" style={{ color: 'hsl(205 40% 50%)' }}>
              Carica clip, video montati o file audio. Verranno salvati in{' '}
              <strong>{form.cliente_nome || 'Generali'}/{form.tipo || 'Contenuti'}/{form.titolo || form.id_display}</strong>
            </p>
          </div>

          {/* Metadati */}
          <div className="mt-4 pt-4 border-t text-xs space-y-1" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
            <p>Creato: {new Date(contenuto.created_at).toLocaleString('it-IT')}</p>
            <p>Aggiornato: {new Date(contenuto.updated_at).toLocaleString('it-IT')}</p>
          </div>
        </div>

        {/* Footer — elimina */}
        <div className="flex-shrink-0 p-4 border-t">
          <button
            onClick={() => onDelete(contenuto.id)}
            className="sk-btn-danger w-full text-sm"
          >
            🗑️ Elimina contenuto {contenuto.id_display}
          </button>
          <p className="text-xs text-center mt-1" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
            Elimina anche le clip collegate su LOG_RIPRESE
          </p>
        </div>
      </div>
    </>
  );
}
