import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';

import { sounds } from '../lib/sounds';
import { TaskFiles } from './TaskFiles';
import { avanzaFaseDaTask, completaTaskEAvanzaFase, WORKFLOW_MAP, richiestaModifiche, approvaRevisione } from '../lib/clpWorkflow';
import type { Task, TeamMember, FaseCLP, Contenuto } from '../types';

import { Avatar } from './Avatar';
import { Calendar } from './ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { parseLocalDate } from '../lib/dateUtils';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// ── Countdown grande per il pannello dettaglio ────────────────────────────────
function getCountdownMs(scadenza: string, ora: string | null): number {
  return new Date(`${scadenza}T${ora ? ora.slice(0, 5) : '23:59'}:00`).getTime() - Date.now();
}

function isScadenzaOggi(scadenza: string): boolean {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return scadenza === today;
}

function CountdownDettaglio({ scadenza, ora }: { scadenza: string; ora: string | null }) {
  const [diff, setDiff] = useState(() => getCountdownMs(scadenza, ora));

  useEffect(() => {
    const id = setInterval(() => setDiff(getCountdownMs(scadenza, ora)), 60000);
    return () => clearInterval(id);
  }, [scadenza, ora]);

  const d = Math.floor(Math.abs(diff) / 86400000);
  const h = Math.floor((Math.abs(diff) % 86400000) / 3600000);
  const m = Math.floor((Math.abs(diff) % 3600000) / 60000);

  const isScaduto = diff <= 0;
  // Task senza ora che scade oggi → urgente (deve essere gestito entro oggi)
  const isUrgent  = !isScaduto && (diff < 24 * 3600000 || (isScadenzaOggi(scadenza) && !ora));
  const isWarning = !isScaduto && !isUrgent && diff < 7 * 86400000;

  const level = isScaduto ? 'scaduto' : isUrgent ? 'urgent' : isWarning ? 'warn' : 'ok';
  const colors = {
    ok:      { bg: 'hsl(214 80% 55% / 0.08)', color: 'hsl(214 70% 44%)', border: 'hsl(214 80% 55% / 0.20)', label: 'SCADE TRA' },
    warn:    { bg: 'hsl(38 92% 50% / 0.10)',  color: 'hsl(32 95% 35%)',  border: 'hsl(38 92% 50% / 0.30)', label: 'IN SCADENZA' },
    urgent:  { bg: 'hsl(0 80% 55% / 0.10)',   color: 'hsl(0 70% 42%)',   border: 'hsl(0 80% 55% / 0.35)', label: '⚡ URGENTE' },
    scaduto: { bg: 'hsl(0 80% 55% / 0.13)',   color: 'hsl(0 70% 38%)',   border: 'hsl(0 80% 55% / 0.45)', label: '⚠️ SCADUTO DA' },
  }[level];

  // Se scade oggi senza ora esplicita, mostra "oggi · Xh Ymin"
  const todayNoOra = isScadenzaOggi(scadenza) && !ora && !isScaduto;
  const timeText = isScaduto
    ? d > 0 ? `${d}g ${h}h` : `${h}h ${m}min`
    : d > 7 ? `${d} giorni`
    : todayNoOra ? `oggi · ${h}h ${m}min`
    : d >= 1 ? `${d}g ${h}h`
    : h >= 1 ? `${h}h ${m}min`
    : `${m} min`;

  return (
    <div
      className={`flex items-center justify-between rounded-xl px-4 py-3${level === 'urgent' ? ' animate-pulse' : ''}`}
      style={{ background: colors.bg, border: `1px solid ${colors.border}` }}
    >
      <div>
        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.color, opacity: 0.8 }}>
          {colors.label}
        </p>
        <p className="text-2xl font-black mt-0.5 font-mono tabular-nums" style={{ color: colors.color }}>
          {timeText}
        </p>
      </div>
      <span style={{ fontSize: 28 }}>{isScaduto ? '⏰' : isUrgent ? '🔴' : isWarning ? '🟡' : '📅'}</span>
    </div>
  );
}

async function invokeEdge(path: string, body: object) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Edge error ${res.status}`);
  return data;
}

const STATI: Task['stato'][] = ['Da fare', 'In lavorazione', 'In revisione', 'Completato', 'Non accettato'];

const STATO_COLORS: Record<string, { bg: string; text: string }> = {
  'Da fare':        { bg: '#FEF3C7', text: '#D97706' },
  'In lavorazione': { bg: '#DBEAFE', text: '#2563EB' },
  'In revisione':   { bg: '#EDE9FE', text: '#7C3AED' },
  'Completato':     { bg: '#DCFCE7', text: '#16A34A' },
  'Non accettato':  { bg: '#FEE2E2', text: '#DC2626' },
  'Archiviato':     { bg: '#F1F5F9', text: '#64748B' },
};

const PRIORITA_COLORS: Record<string, { dot: string; bg: string; text: string }> = {
  '🔴 Alta':  { dot: '#EF4444', bg: '#FEE2E2', text: '#DC2626' },
  '🟡 Media': { dot: '#F59E0B', bg: '#FEF3C7', text: '#D97706' },
  '🟢 Bassa': { dot: '#22C55E', bg: '#DCFCE7', text: '#16A34A' },
};

const FASI_PIPELINE: FaseCLP[] = ['Girato', 'Pre montato', 'Montato', 'Uploadato', 'Revisionato', 'Programmato', 'Pubblicato'];

const FASE_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  'Girato':      { bg: 'hsl(271 80% 55% / 0.12)', text: 'hsl(271 60% 40%)',  border: 'hsl(271 80% 55% / 0.35)' },
  'Pre montato': { bg: 'hsl(214 80% 55% / 0.12)', text: 'hsl(214 70% 40%)',  border: 'hsl(214 80% 55% / 0.35)' },
  'Montato':     { bg: 'hsl(25 90% 55% / 0.12)',  text: 'hsl(25 70% 40%)',   border: 'hsl(25 90% 55% / 0.35)' },
  'Uploadato':   { bg: 'hsl(45 90% 50% / 0.12)',  text: 'hsl(45 80% 30%)',   border: 'hsl(45 90% 50% / 0.35)' },
  'Revisionato': { bg: 'hsl(328 80% 55% / 0.12)', text: 'hsl(328 65% 40%)',  border: 'hsl(328 80% 55% / 0.35)' },
  'Programmato': { bg: 'hsl(142 70% 45% / 0.12)', text: 'hsl(142 60% 35%)',  border: 'hsl(142 70% 45% / 0.35)' },
  'Pubblicato':  { bg: 'hsl(142 70% 45% / 0.20)', text: 'hsl(142 60% 30%)',  border: 'hsl(142 70% 45% / 0.50)' },
};

interface TaskDetailPanelProps {
  task: Task;
  team: TeamMember[];
  onClose: () => void;
  onUpdate: (updated: Task) => void;
  onDelete: (id: string) => void;
}

export function TaskDetailPanel({ task, team, onClose, onUpdate, onDelete }: TaskDetailPanelProps) {
  const { utente, addToast } = useApp();
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);
  const [clpFase, setClpFase] = useState<FaseCLP | null>(null);
  const [savingFase, setSavingFase] = useState(false);
  const [taskCompletato, setTaskCompletato] = useState(task.stato === 'Completato');

  // ── Cleanup task state ─────────────────────────────────────────────────────
  const [cleanupInfo, setCleanupInfo] = useState<{ count: number; totalSize: number; clipFolderId: string } | null>(null);
  const [loadingCleanup, setLoadingCleanup] = useState(false);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [deletingCleanup, setDeletingCleanup] = useState(false);
  const isCleanupTask = task.tipo === 'Cleanup';

  // ── Revisione state ────────────────────────────────────────────────────────
  const [showModificheForm, setShowModificheForm] = useState(false);
  const [noteModifiche, setNoteModifiche] = useState('');
  const [savingRevisione, setSavingRevisione] = useState(false);
  const [contenutoRevisione, setContenutoRevisione] = useState<Contenuto | null>(null);
  const [exportedFileId, setExportedFileId] = useState<string | null>(null);
  const [allExportedFiles, setAllExportedFiles] = useState<{ id: string; fileId: string; fileName: string; uploadedAt: string }[]>([]);
  const [clipFiles, setClipFiles] = useState<{ id: string; fileId: string; fileName: string; stato: string }[]>([]);
  const [supervisioneGiovanni, setSupervisioneGiovanni] = useState(false);
  const isRevisioneTask = task.tipo === 'Revisione montaggio';
  const isSupervisoneTask = task.tipo === 'Supervisione';
  const isAutoTask = task.assegnato_da?.includes('Sistema') || task.assegnato_da?.includes('⚡');

  // ── Programmazione date picker ─────────────────────────────────────────────
  const [dataPub, setDataPub] = useState<Date | undefined>(
    task.scadenza ? parseLocalDate(task.scadenza) : undefined
  );
  const [oraPub, setOraPub] = useState<string>(task.ora ? task.ora.slice(0, 5) : '');
  const [savingProg, setSavingProg] = useState(false);
  const isProgrammazioneTask = task.tipo === 'Programmazione';
  // Pre-fill data/ora dal CLP se il task non ha scadenza propria
  useEffect(() => {
    if (isProgrammazioneTask && !task.scadenza && contenutoRevisione?.data_pubblicazione) {
      setDataPub(parseLocalDate(contenutoRevisione.data_pubblicazione));
      if (contenutoRevisione.ora_pubblicazione) {
        setOraPub(contenutoRevisione.ora_pubblicazione.slice(0, 5));
      }
    }
  }, [contenutoRevisione, isProgrammazioneTask, task.scadenza]);
  const isUploadTask = task.tipo === 'Upload esportato';
  const isMontaggioTask = task.tipo === 'Montaggio';
  const isMontaggioConModifiche = isMontaggioTask && !!contenutoRevisione?.note_revisione;
  const isPremontaggio = task.tipo === 'Premontaggio';

  // ── Upload esportato state (shared by Upload and Montaggio re-upload) ──────
  const [uploadProgress, setUploadProgress] = useState<{ percent: number; fileName: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadCheck, setUploadCheck] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const montaggioUploadRef = useRef<HTMLInputElement>(null);
  

  const isCLPTask = !!(task.id_contenuto && WORKFLOW_MAP[task.tipo]);
  const workflowStep = WORKFLOW_MAP[task.tipo];

  // Load cleanup info when it's a Cleanup task
  useEffect(() => {
    if (!isCleanupTask || !task.id_contenuto) return;
    setLoadingCleanup(true);
    supabase
      .from('contenuti')
      .select('drive_clip_folder_id')
      .eq('id', task.id_contenuto)
      .single()
      .then(async ({ data }) => {
        if (!data?.drive_clip_folder_id || !utente?.id) { setLoadingCleanup(false); return; }
        try {
          const result = await invokeEdge('google-drive-list-files', { folderId: data.drive_clip_folder_id, teamId: utente.id });
          setCleanupInfo({ count: result.count, totalSize: result.totalSize, clipFolderId: data.drive_clip_folder_id });
        } catch { /* ignore */ }
        setLoadingCleanup(false);
      });
  }, [task.id_contenuto, isCleanupTask, utente?.id]);

  const handleDeleteRawFiles = async () => {
    if (!cleanupInfo || !utente?.id) return;
    setDeletingCleanup(true);
    try {
      await invokeEdge('google-drive-delete-folder-contents', { folderId: cleanupInfo.clipFolderId, teamId: utente.id });
      // Mark raw files deleted in DB
      if (task.id_contenuto) {
        const { data: clips } = await supabase.from('log_riprese').select('id').eq('contenuto_id', task.id_contenuto);
        if (clips && clips.length > 0) {
          await supabase.from('log_riprese').update({ file_deleted_at: new Date().toISOString(), file_id: null, file_url: null }).in('id', clips.map((c: any) => c.id));
        }
      }
      await supabase.from('task').update({ stato: 'Completato' }).eq('id', task.id);
      const { data: updated } = await supabase.from('task').select('*').eq('id', task.id).single();
      if (updated) onUpdate(updated as Task);
      addToast('🗑️ File grezzi eliminati. File esportato conservato.', 'success');
      setShowCleanupConfirm(false);
      setTaskCompletato(true);
    } catch (err: any) {
      addToast(`❌ Errore eliminazione: ${err.message}`, 'error');
    }
    setDeletingCleanup(false);
  };

  // Load contenuto for Revisione tasks (video preview + approve/reject)
  useEffect(() => {
    if (!task.id_contenuto) return;
    supabase
      .from('contenuti')
      .select('*')
      .eq('id', task.id_contenuto)
      .single()
      .then(({ data }) => {
        if (data) setContenutoRevisione(data as Contenuto);
      });
    // Load ALL exported files from log_riprese for version history
    supabase
      .from('log_riprese')
      .select('id, exported_file_id, exported_file_name, exported_file_uploaded_at')
      .eq('contenuto_id', task.id_contenuto)
      .not('exported_file_id', 'is', null)
      .order('exported_file_uploaded_at', { ascending: true })
      .then(({ data }) => {
        if (data && data.length > 0) {
          setExportedFileId(data[data.length - 1].exported_file_id);
          setAllExportedFiles(data.map(d => ({
            id: d.id,
            fileId: d.exported_file_id!,
            fileName: d.exported_file_name || 'export',
            uploadedAt: d.exported_file_uploaded_at || '',
          })));
        }
      });
    // Load clip files for Premontaggio tasks
    supabase
      .from('log_riprese')
      .select('id, file_id, file_name, stato')
      .eq('contenuto_id', task.id_contenuto)
      .not('file_id', 'is', null)
      .is('file_deleted_at', null)
      .order('file_name', { ascending: true })
      .then(({ data }) => {
        if (data) {
          setClipFiles(data.map(d => ({
            id: d.id,
            fileId: d.file_id!,
            fileName: d.file_name || 'clip',
            stato: d.stato || '',
          })));
        }
      });
  }, [task.id_contenuto]);

  const handleApprovaRevisione = async () => {
    if (!contenutoRevisione) return;
    setSavingRevisione(true);
    try {
      await approvaRevisione(contenutoRevisione, team);
      
      if (supervisioneGiovanni) {
        // Archivia il task Programmazione appena creato dalla SP
        const { data: progTasks } = await supabase
          .from('task')
          .select('id')
          .eq('id_contenuto', contenutoRevisione.id)
          .eq('tipo', 'Programmazione')
          .neq('stato', 'Completato')
          .neq('stato', 'Archiviato');
        if (progTasks && progTasks.length > 0) {
          await supabase.from('task').update({ stato: 'Archiviato' }).in('id', progTasks.map(t => t.id));
        }
        // Crea task Supervisione per Giovanni
        const { data: idData } = await supabase.rpc('generate_display_id', { prefix: 'TSK', seq_name: 'task_seq' });
        const nomeGiovanni = team.find(t => t.nome.toLowerCase().includes('giovanni'))?.nome || 'Giovanni';
        await supabase.from('task').insert({
          id_display: idData || `TSK${Date.now()}`,
          descrizione: `👁️ Supervisione ${contenutoRevisione.id_display} – ${contenutoRevisione.titolo}${contenutoRevisione.cliente_nome ? ` (${contenutoRevisione.cliente_nome})` : ''}`,
          tipo: 'Supervisione',
          stato: 'Da fare',
          assegnato_a: nomeGiovanni,
          assegnato_da: '⚡ Sistema',
          cliente_id: contenutoRevisione.cliente_id,
          cliente_nome: contenutoRevisione.cliente_nome || '',
          id_contenuto: contenutoRevisione.id,
          priorita: '🔴 Alta',
        });
        await supabase.from('contenuti').update({ supervisione_giovanni: true }).eq('id', contenutoRevisione.id);
        addToast('✅ Revisione approvata → inviata a Giovanni per supervisione', 'success');
      } else {
        addToast('✅ Revisione approvata → CLP avanzato a Revisionato — task Programmazione creato!', 'success');
      }
      
      setClpFase('Revisionato');
      setTaskCompletato(true);
      sounds.taskCompletato();
      const { data } = await supabase.from('task').select('*').eq('id', task.id).single();
      if (data) onUpdate(data as Task);
    } catch (err: any) {
      addToast(`❌ Errore: ${err.message}`, 'error');
    }
    setSavingRevisione(false);
  };

  const handleRichiestaModifiche = async () => {
    if (!contenutoRevisione || !noteModifiche.trim()) {
      addToast('⚠️ Scrivi cosa va corretto', 'warn');
      return;
    }
    setSavingRevisione(true);
    try {
      await richiestaModifiche(contenutoRevisione, team, noteModifiche.trim());
      setClpFase('Montato');
      setTaskCompletato(true);
      sounds.salva();
      addToast('🔄 Richiesta modifiche inviata → task Upload esportato creato per Alessandro', 'success');
      const { data } = await supabase.from('task').select('*').eq('id', task.id).single();
      if (data) onUpdate(data as Task);
      setShowModificheForm(false);
      setNoteModifiche('');
    } catch (err: any) {
      addToast(`❌ Errore: ${err.message}`, 'error');
    }
    setSavingRevisione(false);
  };

  useEffect(() => {
    if (!task.id_contenuto) return;
    supabase
      .from('contenuti')
      .select('fase')
      .eq('id', task.id_contenuto)
      .single()
      .then(({ data }) => {
        if (data) setClpFase(data.fase as FaseCLP);
      });
  }, [task.id_contenuto]);

  useEffect(() => {
    setTaskCompletato(task.stato === 'Completato');
  }, [task.stato]);

  useEffect(() => {
    setDataPub(task.scadenza ? parseLocalDate(task.scadenza) : undefined);
    setOraPub(task.ora ? task.ora.slice(0, 5) : '');
  }, [task.scadenza, task.ora]);

  const scad = task.scadenza ? parseLocalDate(task.scadenza) : null;
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const isScaduto = scad && scad < oggi && task.stato !== 'Completato';

  // ── Salva data/ora di pubblicazione (task Programmazione) ─────────────────
  const handleSalvaProgrammazione = async () => {
    if (!dataPub || !task.id_contenuto) return;
    setSavingProg(true);
    const dataStr = format(dataPub, 'yyyy-MM-dd');
    const oraStr = oraPub || null;

    // Aggiorna scadenza del task e data_pubblicazione del CLP
    await Promise.all([
      supabase.from('task').update({ scadenza: dataStr, ora: oraStr }).eq('id', task.id),
      supabase.from('contenuti').update({
        data_pubblicazione: dataStr,
        ora_pubblicazione: oraStr,
      }).eq('id', task.id_contenuto),
    ]);

    const { cambiaFaseCLP } = await import('../services/faseService');
    await cambiaFaseCLP({
      contenutoId: task.id_contenuto,
      nuovaFase: 'Programmato',
      source: 'kanban',
      userId: utente?.id || 'workflow',
      oldFase: clpFase || 'Revisionato',
    });

    // Completa il task
    
    // Completa il task e aggiunge evento calendario
    await supabase.from('task').update({ stato: 'Completato' }).eq('id', task.id);

    // Crea evento calendario per la pubblicazione
    const { data: contenuto } = await supabase
      .from('contenuti')
      .select('*')
      .eq('id', task.id_contenuto)
      .single();

    if (contenuto) {
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
        persona: 'Elisa',
        stato: 'Pianificato',
      });
    }

    setClpFase('Programmato');
    setTaskCompletato(true);
    sounds.taskCompletato();
    addToast(`📅 CLP programmato per ${format(dataPub, 'd MMM yyyy', { locale: it })}${oraStr ? ' alle ' + oraStr : ''} — verrà pubblicato automaticamente!`, 'success');

    const { data: updated } = await supabase.from('task').select('*').eq('id', task.id).single();
    if (updated) onUpdate(updated as Task);
    setSavingProg(false);
  };

  // ── Upload esportato handler ──────────────────────────────────────────────
  const handleUploadEsportato = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !task.id_contenuto || !utente?.id || !contenutoRevisione) return;

    setUploading(true);
    setUploadProgress({ percent: 0, fileName: file.name });

    try {
      const ext = file.name.split('.').pop() || 'mp4';
      const mimeType = file.type || 'video/mp4';
      const slug = (contenutoRevisione.titolo || '').toLowerCase()
        .replace(/[àáâ]/g,'a').replace(/[èéê]/g,'e').replace(/[ìí]/g,'i')
        .replace(/[òó]/g,'o').replace(/[ùú]/g,'u')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
      const fileName = `${contenutoRevisione.id_display}_${slug}_export.${ext}`;

      // Init resumable upload
      const initResult = await invokeEdge('google-drive-upload-init', {
        fileName,
        mimeType,
        fileSize: file.size,
        teamId: utente.id,
        clientName: contenutoRevisione.cliente_nome || 'Generale',
        zone: 'file_esportato',
        contenutoId: task.id_contenuto,
        idDisplay: contenutoRevisione.id_display,
        titolo: contenutoRevisione.titolo,
      });

      const uploadUrl = initResult.uploadUrl;
      const CHUNK = 4 * 1024 * 1024;
      let uploaded = 0;
      let fileId = '';

      while (uploaded < file.size) {
        const end = Math.min(uploaded + CHUNK, file.size);
        const chunk = file.slice(uploaded, end);
        const contentRange = `bytes ${uploaded}-${end - 1}/${file.size}`;

        let result: any = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const proxyUrl = `${SUPABASE_URL}/functions/v1/google-drive-upload-chunk`;
            const res = await fetch(proxyUrl, {
              method: 'POST',
              headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'x-upload-url': uploadUrl,
                'x-content-range': contentRange,
                'x-content-type': mimeType,
                'Content-Type': 'application/octet-stream',
              },
              body: chunk,
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
              throw new Error(err?.error || `Proxy error ${res.status}`);
            }
            result = await res.json();
            break;
          } catch (err) {
            if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
            else throw err;
          }
        }

        if (result.status === 308) {
          uploaded = result.range ? parseInt(result.range.split('-')[1]) + 1 : end;
        } else if (result.status === 200 || result.status === 201) {
          fileId = result.fileId;
          break;
        }

        setUploadProgress({
          percent: Math.min(99, Math.round((uploaded / file.size) * 100)),
          fileName: file.name,
        });
      }

      if (!fileId) throw new Error('Upload completato senza fileId');

      const fileUrl = `${SUPABASE_URL}/functions/v1/google-drive-download?fileId=${fileId}`;

      // Update log_riprese with exported file info
      const { data: clips } = await supabase
        .from('log_riprese')
        .select('id')
        .eq('contenuto_id', task.id_contenuto)
        .order('riga', { ascending: true })
        .limit(1);

      if (clips && clips.length > 0) {
        await supabase.from('log_riprese').update({
          exported_file_id: fileId,
          exported_file_url: fileUrl,
          exported_file_name: fileName,
          exported_file_size: file.size,
          exported_file_uploaded_at: new Date().toISOString(),
          exported_file_mime_type: mimeType,
        }).eq('id', clips[0].id);
      } else {
        // Create a log_riprese entry if none exists
        await supabase.from('log_riprese').insert({
          id_clip: contenutoRevisione.id_display || 'CLIP',
          contenuto_id: task.id_contenuto,
          cliente_id: contenutoRevisione.cliente_id,
          cliente_nome: contenutoRevisione.cliente_nome,
          id_contenuto_display: contenutoRevisione.id_display,
          titolo: contenutoRevisione.titolo,
          exported_file_id: fileId,
          exported_file_url: fileUrl,
          exported_file_name: fileName,
          exported_file_size: file.size,
          exported_file_uploaded_at: new Date().toISOString(),
          exported_file_mime_type: mimeType,
          operatore: utente.nome,
          stato: 'Uploadato',
          riga: 1,
        });
      }

      // Complete task and advance CLP
      const nuovaFase = await completaTaskEAvanzaFase(task.tipo, task.id_contenuto, team, utente.id);
      setClpFase(nuovaFase || 'Uploadato');
      setTaskCompletato(true);
      sounds.taskCompletato();
      addToast(`✅ File caricato su Drive — CLP avanzato a "Uploadato"!`, 'success');

      const { data: updated } = await supabase.from('task').select('*').eq('id', task.id).single();
      if (updated) onUpdate(updated as Task);
    } catch (err: any) {
      addToast(`❌ Errore upload: ${err.message}`, 'error');
    }
    setUploading(false);
    setUploadProgress(null);
    if (uploadInputRef.current) uploadInputRef.current.value = '';
  };

  // ── Upload versione modificata (task Montaggio dopo revisione) ─────────────
  const handleUploadModificato = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !task.id_contenuto || !utente?.id || !contenutoRevisione) return;

    setUploading(true);
    setUploadProgress({ percent: 0, fileName: file.name });

    try {
      const ext = file.name.split('.').pop() || 'mp4';
      const mimeType = file.type || 'video/mp4';
      const slug = (contenutoRevisione.titolo || '').toLowerCase()
        .replace(/[àáâ]/g,'a').replace(/[èéê]/g,'e').replace(/[ìí]/g,'i')
        .replace(/[òó]/g,'o').replace(/[ùú]/g,'u')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
      const versionNum = allExportedFiles.length + 1;
      const fileName = `${contenutoRevisione.id_display}_${slug}_export_v${versionNum}.${ext}`;

      const initResult = await invokeEdge('google-drive-upload-init', {
        fileName,
        mimeType,
        fileSize: file.size,
        teamId: utente.id,
        clientName: contenutoRevisione.cliente_nome || 'Generale',
        zone: 'file_esportato',
        contenutoId: task.id_contenuto,
        idDisplay: contenutoRevisione.id_display,
        titolo: contenutoRevisione.titolo,
      });

      const uploadUrl = initResult.uploadUrl;
      const CHUNK = 4 * 1024 * 1024;
      let uploaded = 0;
      let fileId = '';

      while (uploaded < file.size) {
        const end = Math.min(uploaded + CHUNK, file.size);
        const chunk = file.slice(uploaded, end);
        const contentRange = `bytes ${uploaded}-${end - 1}/${file.size}`;

        let result: any = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const proxyUrl = `${SUPABASE_URL}/functions/v1/google-drive-upload-chunk`;
            const res = await fetch(proxyUrl, {
              method: 'POST',
              headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'x-upload-url': uploadUrl,
                'x-content-range': contentRange,
                'x-content-type': mimeType,
                'Content-Type': 'application/octet-stream',
              },
              body: chunk,
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
              throw new Error(err?.error || `Proxy error ${res.status}`);
            }
            result = await res.json();
            break;
          } catch (err) {
            if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
            else throw err;
          }
        }

        if (result.status === 308) {
          uploaded = result.range ? parseInt(result.range.split('-')[1]) + 1 : end;
        } else if (result.status === 200 || result.status === 201) {
          fileId = result.fileId;
          break;
        }

        setUploadProgress({
          percent: Math.min(99, Math.round((uploaded / file.size) * 100)),
          fileName: file.name,
        });
      }

      if (!fileId) throw new Error('Upload completato senza fileId');

      const fileUrl = `${SUPABASE_URL}/functions/v1/google-drive-download?fileId=${fileId}`;

      // Create a NEW log_riprese record for the new version
      const maxRiga = allExportedFiles.length + 1;
      await supabase.from('log_riprese').insert({
        id_clip: `${contenutoRevisione.id_display}_v${versionNum}`,
        contenuto_id: task.id_contenuto,
        cliente_id: contenutoRevisione.cliente_id,
        cliente_nome: contenutoRevisione.cliente_nome,
        id_contenuto_display: contenutoRevisione.id_display,
        titolo: contenutoRevisione.titolo,
        exported_file_id: fileId,
        exported_file_url: fileUrl,
        exported_file_name: fileName,
        exported_file_size: file.size,
        exported_file_uploaded_at: new Date().toISOString(),
        exported_file_mime_type: mimeType,
        operatore: utente.nome,
        stato: 'Uploadato',
        riga: maxRiga,
      });

      // [OLD] await supabase.from('contenuti').update({ fase: 'Uploadato', note_revisione: '' }).eq('id', task.id_contenuto);
      // [NEW - FaseService centralizzato]
      const { cambiaFaseCLP } = await import('../services/faseService');
      console.log('[Step2c] TaskDetailPanel upload esportato via FaseService', { id: task.id_contenuto });
      await cambiaFaseCLP({ contenutoId: task.id_contenuto, nuovaFase: 'Uploadato', source: 'workflow', userId: utente?.id || 'unknown', oldFase: 'Montato' });
      await supabase.from('contenuti').update({ note_revisione: '' }).eq('id', task.id_contenuto);
      await supabase.from('task').update({ stato: 'Completato' }).eq('id', task.id);

      // Create new Revisione task for Elisa
      const elisa = team.find(m => m.ruolo === 'Admin' || m.nome === 'Elisa');
      if (elisa) {
        await supabase.from('task').insert({
          tipo: 'Revisione montaggio',
          descrizione: `Revisione v${versionNum}: ${contenutoRevisione.titolo}`,
          assegnato_a: elisa.nome,
          assegnato_da: '⚡ Sistema',
          id_contenuto: task.id_contenuto,
          cliente_id: contenutoRevisione.cliente_id,
          cliente_nome: contenutoRevisione.cliente_nome,
          stato: 'Da fare',
          priorita: '🔴 Alta',
          id_display: `TSK${Date.now().toString().slice(-3)}`,
        });
      }

      setClpFase('Uploadato');
      setTaskCompletato(true);
      sounds.taskCompletato();
      addToast(`✅ Versione v${versionNum} caricata — nuovo task Revisione creato per Elisa!`, 'success');

      const { data: updated } = await supabase.from('task').select('*').eq('id', task.id).single();
      if (updated) onUpdate(updated as Task);
    } catch (err: any) {
      addToast(`❌ Errore upload: ${err.message}`, 'error');
    }
    setUploading(false);
    setUploadProgress(null);
    if (montaggioUploadRef.current) montaggioUploadRef.current.value = '';
  };


  // ── Cambia solo lo stato del task (senza toccare il CLP) ──────────────────
  const handleStatoChange = async (nuovoStato: Task['stato']) => {
    setSaving(true);
    const { data, error } = await supabase
      .from('task')
      .update({ stato: nuovoStato })
      .eq('id', task.id)
      .select()
      .single();

    if (!error && nuovoStato === 'Completato' && isCLPTask) {
      sounds.taskCompletato();
      const nuovaFase = await completaTaskEAvanzaFase(task.tipo, task.id_contenuto!, team, utente?.id);
      if (nuovaFase) {
        setClpFase(nuovaFase);
        setTaskCompletato(true);
        const isDrive = nuovaFase === 'Montato';
        addToast(
          `✅ Task completato → CLP avanzato a "${nuovaFase}"${isDrive ? ' + 📁 Drive in creazione…' : ' — nuovo task creato!'}`,
          'success'
        );
      }
    } else if (!error) {
      if (nuovoStato === 'Completato') sounds.taskCompletato();
      else sounds.salva();
      addToast(`Stato → ${nuovoStato}`, 'success');
    }

    setSaving(false);
    if (!error && data) onUpdate(data as Task);
  };

  // ── Cambia la fase CLP: se coincide con faseNext → completa task + avanza ─
  const handleFaseCLPChange = async (nuovaFase: FaseCLP) => {
    if (!task.id_contenuto || savingFase) return;
    setSavingFase(true);

    try {
      const result = await avanzaFaseDaTask(
        task.id,
        task.tipo,
        task.id_contenuto,
        nuovaFase,
        team,
        utente?.id
      );

      setClpFase(nuovaFase);

      if (result.completatoTask) {
        setTaskCompletato(true);
        sounds.taskCompletato();
        const { data } = await supabase.from('task').select('*').eq('id', task.id).single();
        if (data) onUpdate(data as Task);

        const msgs: string[] = [`✅ Task completato — CLP → "${nuovaFase}"`];
        if (result.taskCreato) msgs.push('Nuovo task creato!');
        if (result.driveTriggered) msgs.push('📁 Drive in creazione…');
        addToast(msgs.join(' · '), 'success');
      } else {
        sounds.salva();
        addToast(`🔄 Fase CLP → ${nuovaFase}`, 'success');
      }
    } catch (err: any) {
      addToast(`⚠️ ${err.message}`, 'warn');
    }
    setSavingFase(false);
  };

  const handleArchivia = async () => {
    if (!confirm(`Archiviare il task ${task.id_display}?`)) return;
    sounds.elimina();
    await supabase.from('task').update({ stato: 'Archiviato' }).eq('id', task.id);
    onDelete(task.id);
    addToast('Task archiviato', 'info');
  };

  const handleAddNota = async () => {
    if (!nota.trim()) return;
    const nuovaNota = task.note ? `${task.note}\n---\n${nota}` : nota;
    const { data, error } = await supabase
      .from('task')
      .update({ note: nuovaNota })
      .eq('id', task.id)
      .select()
      .single();
    if (!error && data) {
      sounds.salva();
      onUpdate(data as Task);
      setNota('');
      addToast('Nota aggiunta', 'success');
    }
  };

  const handleSpostaA = async (nome: string) => {
    const { data, error } = await supabase
      .from('task')
      .update({ assegnato_a: nome, assegnato_da: utente?.nome || '' })
      .eq('id', task.id)
      .select()
      .single();
    if (!error && data) {
      onUpdate(data as Task);
      addToast(`Task spostato a ${nome}`, 'success');
    }
  };

  const statoInfo = STATO_COLORS[task.stato] || STATO_COLORS['Da fare'];
  const prioritaInfo = PRIORITA_COLORS[task.priorita] || PRIORITA_COLORS['🟡 Media'];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      <div
        className="fixed right-0 top-0 bottom-0 z-50 bg-card flex flex-col animate-slide-in-right"
        style={{ width: 360, borderLeft: '1px solid hsl(var(--border))', boxShadow: '-4px 0 20px rgba(0,0,0,0.08)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">{task.id_display}</span>
            {isAutoTask && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: 'hsl(38 92% 50% / 0.15)', color: 'hsl(32 95% 40%)', border: '1px solid hsl(38 92% 50% / 0.35)' }}>
                ⚡ Auto
              </span>
            )}
          </div>
          <button onClick={onClose} className="sk-btn-ghost text-lg px-2 py-1">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Descrizione */}
          <p className="text-base font-semibold leading-snug" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
            {task.descrizione}
          </p>

          {/* Badges */}
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full"
              style={{ background: statoInfo.bg, color: statoInfo.text }}>
              {task.stato}
            </span>
            <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full"
              style={{ background: prioritaInfo.bg, color: prioritaInfo.text }}>
              {task.priorita}
            </span>
            {isScaduto && (
              <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full"
                style={{ background: '#FEE2E2', color: '#DC2626' }}>⚠ SCADUTO</span>
            )}
          </div>

          {/* ── Countdown grande nel dettaglio ──────────────────────────────── */}
          {task.scadenza && task.stato !== 'Completato' && (
            <CountdownDettaglio scadenza={task.scadenza} ora={task.ora} />
          )}

          {/* Info rows */}
          <div className="space-y-2">
            {[
              ['Tipo', task.tipo || '—'],
              ['Cliente', task.cliente_nome || '—'],
              ['Contenuto', task.id_contenuto || '—'],
              ['Assegnato da', task.assegnato_da || '—'],
              ['Scadenza', task.scadenza
                ? parseLocalDate(task.scadenza).toLocaleDateString('it-IT')
                : contenutoRevisione?.data_pubblicazione
                  ? '📡 ' + parseLocalDate(contenutoRevisione.data_pubblicazione).toLocaleDateString('it-IT')
                  : '—'],
              ['Ora', task.ora
                ? task.ora.slice(0, 5)
                : contenutoRevisione?.ora_pubblicazione
                  ? contenutoRevisione.ora_pubblicazione.slice(0, 5)
                  : '—'],
            ].map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <span className="flex-shrink-0 text-xs font-medium w-28" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>{label}</span>
                <span className="text-xs" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{value}</span>
              </div>
            ))}
          </div>

          {task.note && (
            <div className="rounded-lg p-3 text-xs whitespace-pre-wrap leading-relaxed"
              style={{ background: 'hsl(210 40% 96%)', color: 'hsl(var(--skorpio-text-secondary))' }}>
              {task.note}
            </div>
          )}

          {/* ─── BRIEF MONTAGGIO (hook + POV + istruzioni dal CLP collegato) ────────── */}
          {(isPremontaggio || isMontaggioTask || isUploadTask) && contenutoRevisione && (contenutoRevisione.hook || contenutoRevisione.pov || contenutoRevisione.istruzioni_montaggio) && (
            <div className="rounded-xl border-2 overflow-hidden"
              style={{ borderColor: '#8B5CF6', background: '#F5F3FF' }}>
              <div className="px-3 py-2 flex items-center gap-2" style={{ background: '#8B5CF6' }}>
                <span className="text-white text-xs font-bold">🎬 BRIEF MONTAGGIO</span>
              </div>
              <div className="p-3 space-y-2">
                {contenutoRevisione.hook && (
                  <div>
                    <span className="text-xs font-bold" style={{ color: '#6D28D9' }}>🎣 HOOK (apertura)</span>
                    <p className="text-sm mt-0.5" style={{ color: '#1E1B4B' }}>{contenutoRevisione.hook}</p>
                  </div>
                )}
                {contenutoRevisione.pov && (
                  <div>
                    <span className="text-xs font-bold" style={{ color: '#6D28D9' }}>👁️ POV (testo in sovrimpressione)</span>
                    <p className="text-sm mt-0.5" style={{ color: '#1E1B4B' }}>{contenutoRevisione.pov}</p>
                  </div>
                )}
                {contenutoRevisione.istruzioni_montaggio && (
                  <div>
                    <span className="text-xs font-bold" style={{ color: '#6D28D9' }}>🔧 ISTRUZIONI MONTAGGIO</span>
                    <p className="text-sm mt-0.5 whitespace-pre-wrap" style={{ color: '#1E1B4B' }}>{contenutoRevisione.istruzioni_montaggio}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── NOTE REVISIONE (task Montaggio con modifiche richieste) ──── */}
          {isMontaggioTask && contenutoRevisione?.note_revisione && (
            <div className="rounded-xl p-3.5 space-y-2"
              style={{ background: 'hsl(38 92% 50% / 0.08)', border: '1px solid hsl(38 92% 50% / 0.30)' }}>
              <div className="flex items-center gap-1.5">
                <span style={{ fontSize: 16 }}>📝</span>
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'hsl(32 95% 35%)' }}>
                  Modifiche richieste da Elisa
                </p>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap"
                style={{ color: 'hsl(32 80% 25%)' }}>
                {contenutoRevisione.note_revisione}
              </p>
            </div>
          )}

          {/* ─── ANTEPRIMA VIDEO per task Montaggio (per vedere cosa modificare) ── */}
          {isMontaggioTask && exportedFileId && utente?.id && (
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                🎬 VIDEO DA MODIFICARE
              </p>
              <video
                controls
                className="w-full rounded-lg border border-border"
                style={{ maxHeight: 220 }}
                src={`${SUPABASE_URL}/functions/v1/google-drive-stream?fileId=${exportedFileId}&teamId=${utente.id}`}
              >
                Il tuo browser non supporta il player video.
              </video>
            </div>
          )}

          {/* ─── UPLOAD VERSIONE MODIFICATA (task Montaggio dopo revisione) ──── */}
          {isMontaggioConModifiche && !taskCompletato && (
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                📤 CARICA VERSIONE MODIFICATA
              </p>
              <div className="rounded-xl p-3 space-y-3"
                style={{ background: 'hsl(214 80% 55% / 0.06)', border: '1px solid hsl(214 80% 55% / 0.25)' }}>
                <p className="text-xs leading-relaxed" style={{ color: 'hsl(214 70% 40%)' }}>
                  Carica la versione corretta. Il CLP tornerà a <strong>Uploadato</strong> e verrà creato un nuovo task di <strong>Revisione</strong> per Elisa.
                </p>

                {uploadProgress ? (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px]" style={{ color: 'hsl(214 70% 40%)' }}>
                      <span>📁 {uploadProgress.fileName}</span>
                      <span className="font-mono font-bold">{uploadProgress.percent}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'hsl(214 80% 55% / 0.15)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${uploadProgress.percent}%`, background: 'hsl(214 80% 55%)' }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">Caricamento in corso… non chiudere il pannello.</p>
                  </div>
                ) : (
                  <>
                    <input
                      ref={montaggioUploadRef}
                      type="file"
                      accept="video/*,.mp4,.mov,.avi,.mkv,.webm"
                      onChange={handleUploadModificato}
                      className="hidden"
                    />
                    <button
                      onClick={() => montaggioUploadRef.current?.click()}
                      disabled={uploading}
                      className="w-full py-3 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2"
                      style={{
                        background: 'hsl(214 80% 55%)',
                        color: 'white',
                        opacity: uploading ? 0.6 : 1,
                      }}
                    >
                      📤 Carica versione corretta
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          <hr style={{ borderColor: 'hsl(var(--border))' }} />

          {/* ─── ANTEPRIMA VIDEO ESPORTATO (qualsiasi task CLP con file) ──── */}
          {exportedFileId && utente?.id && !isRevisioneTask && (
            <div className="mb-4">
              <p className="text-xs font-medium mb-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                📹 ANTEPRIMA FILE ESPORTATO
              </p>
              <video
                controls
                className="w-full rounded-lg border border-border"
                style={{ maxHeight: 220 }}
                src={`${SUPABASE_URL}/functions/v1/google-drive-stream?fileId=${exportedFileId}&teamId=${utente.id}`}
              >
                Il tuo browser non supporta il player video.
              </video>
            </div>
          )}

          {/* ─── PROGRAMMAZIONE DATE PICKER (task Programmazione) ───────────── */}
          {isProgrammazioneTask && !taskCompletato && (
            <div>
              <p className="text-xs font-medium mb-3" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                📅 SCEGLI DATA DI PUBBLICAZIONE
              </p>
              <div className="rounded-xl p-4 space-y-3"
                style={{ background: 'hsl(328 80% 55% / 0.06)', border: '1px solid hsl(328 80% 55% / 0.25)' }}>
                <p className="text-xs leading-relaxed" style={{ color: 'hsl(328 65% 40%)' }}>
                  Scegli quando pubblicare questo contenuto. Il CLP passerà a <strong>Programmato</strong> e a quella data diventerà <strong>Pubblicato</strong> in automatico.
                </p>

                {/* Date picker */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-all"
                      style={{
                        background: dataPub ? 'hsl(328 80% 55% / 0.10)' : 'hsl(var(--muted))',
                        border: `1px solid ${dataPub ? 'hsl(328 80% 55% / 0.40)' : 'hsl(var(--border))'}`,
                        color: dataPub ? 'hsl(328 65% 40%)' : 'hsl(var(--muted-foreground))',
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <CalendarIcon size={14} />
                        {dataPub ? format(dataPub, 'd MMMM yyyy', { locale: it }) : 'Seleziona data…'}
                      </span>
                      {dataPub && <span className="text-xs opacity-60">cambia</span>}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dataPub}
                      onSelect={setDataPub}
                      initialFocus
                      disabled={(d) => d < new Date(new Date().setHours(0,0,0,0))}
                    />
                  </PopoverContent>
                </Popover>

                {/* Ora opzionale */}
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                    Ora pubblicazione (opzionale)
                  </label>
                  <input
                    type="time"
                    value={oraPub}
                    onChange={e => setOraPub(e.target.value)}
                    className="sk-input w-full text-sm"
                  />
                </div>

                <button
                  onClick={handleSalvaProgrammazione}
                  disabled={!dataPub || savingProg}
                  className="sk-btn-primary w-full text-sm font-semibold"
                  style={{ opacity: (!dataPub || savingProg) ? 0.5 : 1 }}
                >
                  {savingProg ? '⏳ Salvando…' : `📅 Programma per ${dataPub ? format(dataPub, 'd MMM', { locale: it }) : '…'}`}
                </button>
              </div>
            </div>
          )}

          {isProgrammazioneTask && taskCompletato && (
            <div className="rounded-lg px-3 py-2.5 text-xs"
              style={{ background: 'hsl(142 70% 45% / 0.08)', color: 'hsl(142 60% 35%)', border: '1px solid hsl(142 70% 45% / 0.25)' }}>
              ✅ Programmato per {task.scadenza ? format(parseLocalDate(task.scadenza), 'd MMM yyyy', { locale: it }) : '—'}
              {task.ora ? ` alle ${task.ora.slice(0,5)}` : ''} — verrà pubblicato automaticamente!
            </div>
          )}

          {/* ─── CLIP DA MONTARE (task Premontaggio) ─────────────────── */}
          {isPremontaggio && clipFiles.length > 0 && utente?.id && (
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                🎬 CLIP DA MONTARE ({clipFiles.length})
              </p>
              <div className="rounded-xl p-2.5 space-y-1.5"
                style={{ background: 'hsl(214 80% 55% / 0.06)', border: '1px solid hsl(214 80% 55% / 0.25)' }}>
                {clipFiles.map(clip => (
                  <a
                    key={clip.id}
                    href={`${SUPABASE_URL}/functions/v1/google-drive-stream?fileId=${clip.fileId}&teamId=${utente.id}&download=1`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                    style={{ background: 'hsl(214 80% 55% / 0.1)', color: 'hsl(214 80% 40%)' }}
                  >
                    <span>📎</span>
                    <span className="flex-1 truncate">{clip.fileName}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'hsl(214 80% 55% / 0.15)' }}>⬇️</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {isPremontaggio && clipFiles.length === 0 && (
            <div className="rounded-xl p-3 text-center"
              style={{ background: 'hsl(38 92% 50% / 0.06)', border: '1px solid hsl(38 92% 50% / 0.2)' }}>
              <p className="text-xs" style={{ color: 'hsl(38 80% 35%)' }}>
                ⚠️ Nessuna clip caricata per questo CLP
              </p>
            </div>
          )}

          {/* ─── PIPELINE FASE CLP (solo task workflow NON Programmazione) ──── */}
          {isCLPTask && !isProgrammazioneTask && (
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                FASE CLP
              </p>

              {/* Pipeline visiva */}
              <div className="flex items-center mb-3 overflow-x-auto pb-1">
                {FASI_PIPELINE.map((fase, i) => {
                  const isCurrent = clpFase === fase;
                  const isPast = clpFase ? FASI_PIPELINE.indexOf(clpFase) > i : false;
                  const style = FASE_STYLE[fase] || FASE_STYLE['Girato'];
                  return (
                    <React.Fragment key={fase}>
                      <div className="flex flex-col items-center gap-0.5 flex-shrink-0" style={{ minWidth: 52 }}>
                        <div
                          className="w-3 h-3 rounded-full border-2"
                          style={{
                            background: isCurrent ? style.text : isPast ? style.text : 'hsl(var(--muted))',
                            borderColor: isCurrent ? style.text : isPast ? style.text : 'hsl(var(--border))',
                            opacity: isPast ? 0.45 : 1,
                          }}
                        />
                        <span className="text-[9px] font-medium text-center leading-tight"
                          style={{
                            color: isCurrent ? style.text : isPast ? style.text : 'hsl(var(--muted-foreground))',
                            opacity: isPast ? 0.55 : 1,
                            fontWeight: isCurrent ? 700 : 400,
                          }}>
                          {fase}
                        </span>
                      </div>
                      {i < FASI_PIPELINE.length - 1 && (
                        <div className="flex-1 h-px mx-0.5 flex-shrink-0"
                          style={{ background: isPast ? style.text : 'hsl(var(--border))', opacity: isPast ? 0.4 : 1, minWidth: 6 }} />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Bottoni fase */}
              <div className="flex flex-wrap gap-1.5">
                {FASI_PIPELINE.map(fase => {
                  const style = FASE_STYLE[fase] || FASE_STYLE['Girato'];
                  const isCurrent = clpFase === fase;
                  const isNextStep = workflowStep?.faseNext === fase && !taskCompletato;
                  return (
                    <button
                      key={fase}
                      onClick={() => handleFaseCLPChange(fase)}
                      disabled={isCurrent || savingFase || taskCompletato}
                      className="text-xs px-2.5 py-1.5 rounded-md font-medium transition-all"
                      style={{
                        background: isCurrent ? style.text : isNextStep ? style.text : style.bg,
                        color: isCurrent || isNextStep ? 'white' : style.text,
                        border: `1px solid ${isNextStep ? style.text : style.border}`,
                        opacity: (savingFase || taskCompletato) && !isCurrent ? 0.45 : 1,
                        fontWeight: isCurrent || isNextStep ? 700 : 500,
                        cursor: isCurrent || taskCompletato ? 'default' : 'pointer',
                        boxShadow: isNextStep ? `0 0 0 2px ${style.text}40` : 'none',
                      }}
                    >
                      {isCurrent ? `● ${fase}` : isNextStep ? `→ ${fase}` : fase}
                    </button>
                  );
                })}
              </div>

              {/* Hint contestuale */}
              {workflowStep && !taskCompletato && (
                <div className="mt-2 text-[11px] rounded-md px-2.5 py-1.5"
                  style={{ background: 'hsl(214 80% 55% / 0.08)', color: 'hsl(214 70% 40%)', border: '1px solid hsl(214 80% 55% / 0.25)' }}>
                  💡 Clicca <strong>→ {workflowStep.faseNext}</strong> per completare il tuo task e passare il lavoro a <strong>{workflowStep.assegnatoKeyword}</strong>
                  {workflowStep.faseNext === 'Montato' && <> · 📁 Drive verrà creato automaticamente</>}
                </div>
              )}
              {taskCompletato && (
                <div className="mt-2 text-[11px] rounded-md px-2.5 py-1.5"
                  style={{ background: 'hsl(142 70% 45% / 0.08)', color: 'hsl(142 60% 35%)', border: '1px solid hsl(142 70% 45% / 0.25)' }}>
                  ✅ Task completato — il lavoro è stato passato al prossimo membro del team
                </div>
              )}
            </div>
          )}
          {/* ─── NOTE REVISIONE (task Upload esportato con modifiche richieste) ── */}
          {isUploadTask && contenutoRevisione?.note_revisione && (
            <div className="rounded-xl p-3.5 space-y-2"
              style={{ background: 'hsl(38 92% 50% / 0.08)', border: '1px solid hsl(38 92% 50% / 0.30)' }}>
              <div className="flex items-center gap-1.5">
                <span style={{ fontSize: 16 }}>📝</span>
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'hsl(32 95% 35%)' }}>
                  Modifiche richieste
                </p>
                {contenutoRevisione.revision_count && contenutoRevisione.revision_count > 1 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: '#FEF3C7', color: '#D97706' }}>
                    Revisione #{contenutoRevisione.revision_count}
                  </span>
                )}
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap"
                style={{ color: 'hsl(32 80% 25%)' }}>
                {contenutoRevisione.note_revisione}
              </p>
            </div>
          )}

          {/* ─── VIDEO PRECEDENTE (task Upload dopo revisione — per vedere cosa modificare) ── */}
          {isUploadTask && contenutoRevisione?.note_revisione && exportedFileId && utente?.id && (
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                🎬 VIDEO DA MODIFICARE
              </p>
              <video
                controls
                className="w-full rounded-lg border border-border"
                style={{ maxHeight: 200 }}
                src={`${SUPABASE_URL}/functions/v1/google-drive-stream?fileId=${exportedFileId}&teamId=${utente.id}`}
              />
            </div>
          )}

          {/* ─── UPLOAD ESPORTATO: file picker + progress ──────────────── */}
          {isUploadTask && !taskCompletato && (
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                📤 CARICA FILE ESPORTATO
              </p>
              <div className="rounded-xl p-3 space-y-3"
                style={{ background: 'hsl(45 90% 50% / 0.06)', border: '1px solid hsl(45 90% 50% / 0.25)' }}>
                <p className="text-xs leading-relaxed" style={{ color: 'hsl(45 80% 30%)' }}>
                  Seleziona il file esportato da caricare su Google Drive nella cartella <strong>file_esportato/</strong>.
                  Il CLP avanzerà automaticamente a <strong>Uploadato</strong>.
                </p>

                {uploadProgress ? (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px]" style={{ color: 'hsl(45 80% 30%)' }}>
                      <span>📁 {uploadProgress.fileName}</span>
                      <span className="font-mono font-bold">{uploadProgress.percent}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'hsl(45 90% 50% / 0.15)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${uploadProgress.percent}%`, background: 'hsl(45 90% 50%)' }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">Caricamento in corso… non chiudere il pannello.</p>
                  </div>
                ) : (
                  <>
                    <input
                      ref={uploadInputRef}
                      type="file"
                      accept="video/*,.mp4,.mov,.avi,.mkv,.webm"
                      onChange={handleUploadEsportato}
                      className="hidden"
                    />
                    {/* Checkpoint: conferma hook/POV prima di uploadare */}
                    {!uploadCheck && contenutoRevisione && (contenutoRevisione.hook || contenutoRevisione.pov || contenutoRevisione.istruzioni_montaggio) ? (
                      <div className="space-y-2">
                        <div className="rounded-lg p-2.5" style={{ background: '#F5F3FF', border: '1px solid #C4B5FD' }}>
                          <p className="text-xs font-bold mb-1" style={{ color: '#6D28D9' }}>⚠️ Checkpoint: hai rispettato il brief?</p>
                          {contenutoRevisione.hook && <p className="text-xs" style={{ color: '#3B0764' }}>🎣 Hook: {contenutoRevisione.hook}</p>}
                          {contenutoRevisione.pov && <p className="text-xs mt-1" style={{ color: '#3B0764' }}>👁️ POV: {contenutoRevisione.pov}</p>}
                          {contenutoRevisione.istruzioni_montaggio && <p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: '#3B0764' }}>🔧 Istruzioni: {contenutoRevisione.istruzioni_montaggio}</p>}
                        </div>
                        <button
                          onClick={() => setUploadCheck(true)}
                          className="w-full py-3 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2"
                          style={{ background: '#8B5CF6', color: 'white' }}
                        >
                          ✅ Confermo, hook{contenutoRevisione.pov ? ' e POV' : ''} inseriti — procedi
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => uploadInputRef.current?.click()}
                        disabled={uploading}
                        className="w-full py-3 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2"
                        style={{
                          background: 'hsl(45 90% 50%)',
                          color: 'white',
                          opacity: uploading ? 0.6 : 1,
                        }}
                      >
                        📤 Seleziona file da caricare
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {isUploadTask && taskCompletato && (
            <div className="rounded-lg px-3 py-2.5 text-xs"
              style={{ background: 'hsl(142 70% 45% / 0.08)', color: 'hsl(142 60% 35%)', border: '1px solid hsl(142 70% 45% / 0.25)' }}>
              ✅ File esportato caricato — il task Revisione è stato creato per Elisa!
            </div>
          )}

          {/* ─── CLEANUP TASK: bottone elimina file grezzi ──────────────── */}
          {isCleanupTask && !taskCompletato && (
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                🗑️ AZIONI CLEANUP
              </p>
              <div className="rounded-xl p-3 space-y-2"
                style={{ background: 'hsl(0 80% 55% / 0.06)', border: '1px solid hsl(0 80% 55% / 0.2)' }}>
                {loadingCleanup ? (
                  <p className="text-xs text-muted-foreground">Verifica file su Drive…</p>
                ) : cleanupInfo ? (
                  <>
                    <p className="text-xs" style={{ color: 'hsl(0 70% 40%)' }}>
                      📁 {cleanupInfo.count} file grezzi · {cleanupInfo.totalSize > 0 ? `${(cleanupInfo.totalSize / 1024 / 1024 / 1024).toFixed(2)} GB` : '—'} da liberare
                    </p>
                    {!showCleanupConfirm ? (
                      <button
                        onClick={() => setShowCleanupConfirm(true)}
                        className="w-full py-2 rounded-lg text-xs font-semibold transition-all"
                        style={{ background: 'hsl(0 80% 55%)', color: 'white' }}
                      >
                        🗑️ Cancella file da montare
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs font-medium" style={{ color: 'hsl(0 70% 40%)' }}>
                          Stai per cancellare {cleanupInfo.count} file dalla cartella clip/. Il file esportato non verrà toccato. Confermi?
                        </p>
                        <div className="flex gap-2">
                          <button onClick={handleDeleteRawFiles} disabled={deletingCleanup}
                            className="flex-1 py-1.5 rounded-lg text-xs font-semibold"
                            style={{ background: 'hsl(0 80% 55%)', color: 'white', opacity: deletingCleanup ? 0.6 : 1 }}>
                            {deletingCleanup ? '⏳ Eliminando…' : '✅ Sì, elimina'}
                          </button>
                          <button onClick={() => setShowCleanupConfirm(false)}
                            className="flex-1 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-muted">
                            Annulla
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Nessun file trovato nella cartella clip/ — già pulita o Drive non connesso.</p>
                )}
              </div>
            </div>
          )}

          {/* ─── REVISIONE: Approva / Richiedi modifiche ─────────────────── */}
          {isRevisioneTask && !taskCompletato && (
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                👁️ AZIONI REVISIONE
              </p>

              {/* Video preview — all versions */}
              {utente?.id && allExportedFiles.length > 0 && (
                <div className="mb-3 space-y-3">
                  {allExportedFiles.map((ef, idx) => {
                    const isLatest = idx === allExportedFiles.length - 1;
                    const vLabel = allExportedFiles.length > 1
                      ? `v${idx + 1}${isLatest ? ' (ultima)' : ' (precedente)'}`
                      : '';
                    return (
                      <div key={ef.id}>
                        <p className="text-[11px] text-muted-foreground mb-1.5">
                          {isLatest ? '📹' : '📼'} {vLabel ? `Versione ${vLabel}` : 'Anteprima file esportato'}
                          {ef.uploadedAt && (
                            <span className="ml-1 opacity-60">
                              · {new Date(ef.uploadedAt).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </p>
                        <video
                          controls
                          className="w-full rounded-lg border"
                          style={{
                            maxHeight: isLatest ? 200 : 140,
                            borderColor: isLatest ? 'hsl(214 80% 55% / 0.4)' : 'hsl(var(--border))',
                            opacity: isLatest ? 1 : 0.75,
                          }}
                          src={`${SUPABASE_URL}/functions/v1/google-drive-stream?fileId=${ef.fileId}&teamId=${utente.id}`}
                        >
                          Il tuo browser non supporta il player video.
                        </video>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="rounded-xl p-3 space-y-2"
                style={{ background: 'hsl(270 60% 55% / 0.06)', border: '1px solid hsl(270 60% 55% / 0.2)' }}>

                {!showModificheForm ? (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={supervisioneGiovanni}
                        onChange={e => setSupervisioneGiovanni(e.target.checked)}
                        className="rounded"
                      />
                      <span className="text-xs font-medium" style={{ color: 'hsl(38 80% 35%)' }}>
                        👁️ Fai supervisionare anche a Giovanni
                      </span>
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={handleApprovaRevisione}
                        disabled={savingRevisione}
                        className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
                        style={{ background: 'hsl(142 70% 45%)', color: 'white', opacity: savingRevisione ? 0.6 : 1 }}
                      >
                        {savingRevisione ? '⏳…' : supervisioneGiovanni ? '✅ Approva + Supervisione' : '✅ Approvato'}
                      </button>
                      <button
                        onClick={() => setShowModificheForm(true)}
                        disabled={savingRevisione}
                        className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
                        style={{ background: 'hsl(38 92% 50% / 0.15)', color: 'hsl(32 95% 35%)', border: '1px solid hsl(38 92% 50% / 0.35)' }}
                      >
                        🔄 Richiedi modifiche
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs font-medium" style={{ color: 'hsl(270 50% 40%)' }}>
                      Descrivi cosa va corretto:
                    </p>
                    <textarea
                      value={noteModifiche}
                      onChange={e => setNoteModifiche(e.target.value)}
                      className="sk-textarea w-full text-sm"
                      rows={3}
                      placeholder="es. Accorcia l'intro, il logo è fuori inquadratura…"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleRichiestaModifiche}
                        disabled={savingRevisione || !noteModifiche.trim()}
                        className="flex-1 py-1.5 rounded-lg text-xs font-semibold"
                        style={{ background: 'hsl(38 92% 50%)', color: 'white', opacity: (savingRevisione || !noteModifiche.trim()) ? 0.5 : 1 }}
                      >
                        {savingRevisione ? '⏳…' : '🔄 Invia richiesta'}
                      </button>
                      <button
                        onClick={() => { setShowModificheForm(false); setNoteModifiche(''); }}
                        className="flex-1 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-muted"
                      >
                        Annulla
                      </button>
                    </div>
                  </div>
                )}

                <p className="text-[10px] text-muted-foreground mt-1">
                  ✅ Approvato → CLP avanza a Revisionato + task Programmazione per Elisa<br />
                  🔄 Modifiche → CLP torna a Montato + task Upload esportato per Alessandro
                </p>
              </div>
            </div>
          )}

          {/* ─── SUPERVISIONE GIOVANNI: Approva / Respingi ─────────────────── */}
          {isSupervisoneTask && !taskCompletato && (
            <div className="space-y-3">
              {allExportedFiles.length > 0 && (
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1.5">📹 Anteprima file esportato</p>
                  <video
                    controls
                    className="w-full rounded-lg border"
                    style={{ maxHeight: 200, borderColor: 'hsl(214 80% 55% / 0.4)' }}
                    src={`${SUPABASE_URL}/functions/v1/google-drive-stream?fileId=${allExportedFiles[allExportedFiles.length - 1].fileId}&teamId=${utente.id}`}
                  />
                </div>
              )}

              <div className="rounded-xl p-3 space-y-2"
                style={{ background: 'hsl(38 92% 50% / 0.06)', border: '1px solid hsl(38 92% 50% / 0.2)' }}>
                <p className="text-xs font-semibold" style={{ color: 'hsl(38 80% 35%)' }}>
                  👁️ Supervisione richiesta da Elisa
                </p>
                {contenutoRevisione?.note_revisione && (
                  <p className="text-xs italic" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                    Note: {contenutoRevisione.note_revisione}
                  </p>
                )}
                {!showModificheForm ? (
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        if (!contenutoRevisione) return;
                        setSavingRevisione(true);
                        try {
                          await supabase.from('task').update({ stato: 'Completato' }).eq('id', task.id);
                          const nomeElisa = team.find(t => t.nome.toLowerCase().includes('elisa'))?.nome || 'Elisa';
                          const { data: idData } = await supabase.rpc('generate_display_id', { prefix: 'TSK', seq_name: 'task_seq' });
                          await supabase.from('task').insert({
                            id_display: idData || `TSK${Date.now()}`,
                            descrizione: `📅 Programmazione ${contenutoRevisione.id_display} – ${contenutoRevisione.titolo}${contenutoRevisione.cliente_nome ? ` (${contenutoRevisione.cliente_nome})` : ''}`,
                            tipo: 'Programmazione',
                            stato: 'Da fare',
                            assegnato_a: nomeElisa,
                            assegnato_da: '⚡ Sistema',
                            cliente_id: contenutoRevisione.cliente_id,
                            cliente_nome: contenutoRevisione.cliente_nome || '',
                            id_contenuto: contenutoRevisione.id,
                            priorita: '🔴 Alta',
                            scadenza: contenutoRevisione.data_pubblicazione || null,
                          });
                          await supabase.from('contenuti').update({ supervisione_giovanni: false }).eq('id', contenutoRevisione.id);
                          setTaskCompletato(true);
                          sounds.taskCompletato();
                          addToast('✅ Supervisione approvata → task Programmazione creato per Elisa!', 'success');
                          const { data } = await supabase.from('task').select('*').eq('id', task.id).single();
                          if (data) onUpdate(data as Task);
                        } catch (err: any) {
                          addToast(`❌ Errore: ${err.message}`, 'error');
                        }
                        setSavingRevisione(false);
                      }}
                      disabled={savingRevisione}
                      className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
                      style={{ background: 'hsl(142 70% 45%)', color: 'white', opacity: savingRevisione ? 0.6 : 1 }}
                    >
                      {savingRevisione ? '⏳…' : '✅ Approva'}
                    </button>
                    <button
                      onClick={() => setShowModificheForm(true)}
                      disabled={savingRevisione}
                      className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
                      style={{ background: 'hsl(0 80% 55% / 0.15)', color: 'hsl(0 70% 42%)', border: '1px solid hsl(0 80% 55% / 0.35)' }}
                    >
                      🔄 Richiedi modifiche
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <textarea
                      value={noteModifiche}
                      onChange={e => setNoteModifiche(e.target.value)}
                      className="sk-textarea w-full text-sm"
                      rows={3}
                      placeholder="Cosa va corretto?"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          if (!contenutoRevisione || !noteModifiche.trim()) return;
                          setSavingRevisione(true);
                          try {
                            await richiestaModifiche(contenutoRevisione, team, noteModifiche.trim(), utente?.id);
                            setClpFase('Montato');
                            setTaskCompletato(true);
                            sounds.salva();
                            addToast('🔄 Giovanni ha richiesto modifiche → task Upload esportato per Alessandro', 'success');
                            const { data } = await supabase.from('task').select('*').eq('id', task.id).single();
                            if (data) onUpdate(data as Task);
                            setShowModificheForm(false);
                            setNoteModifiche('');
                          } catch (err: any) {
                            addToast(`❌ Errore: ${err.message}`, 'error');
                          }
                          setSavingRevisione(false);
                        }}
                        disabled={savingRevisione || !noteModifiche.trim()}
                        className="flex-1 py-1.5 rounded-lg text-xs font-semibold"
                        style={{ background: 'hsl(38 92% 50%)', color: 'white', opacity: (savingRevisione || !noteModifiche.trim()) ? 0.5 : 1 }}
                      >
                        {savingRevisione ? '⏳…' : '🔄 Invia'}
                      </button>
                      <button
                        onClick={() => { setShowModificheForm(false); setNoteModifiche(''); }}
                        className="flex-1 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-muted"
                      >
                        Annulla
                      </button>
                    </div>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground mt-1">
                  ✅ Approva → task Programmazione per Elisa<br />
                  🔄 Modifiche → CLP torna a Montato + task Upload esportato per Alessandro
                </p>
              </div>
            </div>
          )}


          {!isCLPTask && (
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>CAMBIA STATO TASK</p>
            <div className="flex flex-wrap gap-1.5">
              {STATI.map(s => (
                <button
                  key={s}
                  onClick={() => handleStatoChange(s)}
                  disabled={task.stato === s || saving}
                  className="text-xs px-2.5 py-1.5 rounded-md transition-all font-medium"
                  style={{
                    background: task.stato === s ? (STATO_COLORS[s]?.bg || '#F1F5F9') : 'hsl(210 40% 96%)',
                    color: task.stato === s ? (STATO_COLORS[s]?.text || '#64748B') : '#64748B',
                    opacity: saving ? 0.5 : 1,
                    fontWeight: task.stato === s ? 700 : 500,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          )}

          {/* ─── SPOSTA A ────────────────────────────────────────────────────── */}
          {(utente?.ruolo === 'Admin' || task.assegnato_a === utente?.nome) && (
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>SPOSTA A</p>
              <div className="flex flex-wrap gap-2">
                {team.filter(m => m.nome !== task.assegnato_a).map(m => (
                  <button
                    key={m.id}
                    onClick={() => handleSpostaA(m.nome)}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition-colors"
                    style={{ background: `${m.colore}15`, color: m.colore, border: `1px solid ${m.colore}30` }}
                  >
                    <Avatar nome={m.nome} colore={m.colore} size={16} avatarUrl={m.avatar_url} />
                    {m.nome}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ─── ALLEGATI ────────────────────────────────────────────────────── */}
          <TaskFiles taskId={task.id} userName={utente?.nome || ''} />

          {/* ─── NOTA ────────────────────────────────────────────────────────── */}
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>AGGIUNGI NOTA</p>
            <textarea
              value={nota}
              onChange={e => setNota(e.target.value)}
              className="sk-textarea w-full text-sm"
              rows={2}
              placeholder="Scrivi una nota…"
            />
            <button onClick={handleAddNota} className="sk-btn-primary text-xs mt-1.5 w-full">
              Aggiungi nota
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t">
          <button onClick={handleArchivia} className="sk-btn-danger w-full text-sm">
            🗄️ Archivia task {task.id_display}
          </button>
        </div>
      </div>
    </>
  );
}
