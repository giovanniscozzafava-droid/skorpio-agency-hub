/**
 * CLP Workflow utilities — condivisi tra CLPDetailPanel e TaskDetailPanel
 */
import { supabase } from './supabase';
import { toDateStr, addDays } from './dateUtils';
import type { Contenuto, FaseCLP, TeamMember } from '../types';

// ── Default lead times (giorni lavorativi prima della pubblicazione) ──────────
export const DEFAULT_LEAD_TIMES: Record<string, number> = {
  'Premontaggio': 5,
  'Montaggio': 3,
  'Upload esportato': 2,
  'Revisione montaggio': 2,
  'Programmazione': 1,
  'Pubblicazione': 0,
};

export function getLeadTimes(): Record<string, number> {
  try {
    const stored = localStorage.getItem('skorpio_lead_times');
    if (stored) return { ...DEFAULT_LEAD_TIMES, ...JSON.parse(stored) };
  } catch { /* fallback */ }
  return { ...DEFAULT_LEAD_TIMES };
}

export function saveLeadTimes(times: Record<string, number>) {
  localStorage.setItem('skorpio_lead_times', JSON.stringify(times));
}

/** Calcola la deadline a ritroso dalla data di pubblicazione */
export function calcolaDeadlineARitroso(dataPubblicazione: string | null, tipoTask: string): string | null {
  if (!dataPubblicazione) return null;
  const leadTimes = getLeadTimes();
  const giorni = leadTimes[tipoTask];
  if (giorni === undefined || giorni === 0) return dataPubblicazione;
  // Sottrai N giorni
  const pubDate = new Date(dataPubblicazione + 'T00:00:00');
  const deadline = addDays(pubDate, -giorni);
  return toDateStr(deadline);
}

/**
 * Ricalcola le scadenze di tutti i task aperti collegati a un CLP
 * in base alla nuova data di pubblicazione e ai lead times.
 */
export async function ricalcolaScadenzeTask(contenutoId: string, dataPubblicazione: string, oraPubblicazione: string | null): Promise<number> {
  const leadTimes = getLeadTimes();

  const { data: openTasks } = await supabase
    .from('task')
    .select('id, tipo')
    .eq('id_contenuto', contenutoId)
    .neq('stato', 'Completato')
    .neq('stato', 'Archiviato');

  if (!openTasks || openTasks.length === 0) return 0;

  let updated = 0;
  for (const task of openTasks) {
    const giorni = leadTimes[task.tipo];
    if (giorni === undefined) continue;

    const deadline = giorni === 0
      ? dataPubblicazione
      : toDateStr(addDays(new Date(dataPubblicazione + 'T00:00:00'), -giorni));

    const ora = giorni === 0 ? oraPubblicazione : null;

    await supabase
      .from('task')
      .update({ scadenza: deadline, ora: ora || null })
      .eq('id', task.id);
    updated++;
  }

  return updated;
}

// ── Workflow step definitions ────────────────────────────────────────────────
export interface WorkflowStep {
  faseCurrent: FaseCLP;
  faseNext: FaseCLP;
  tipoNext: string;
  assegnatoKeyword: string;
  emojiNext: string;
  descrizioneNext: (c: Contenuto) => string;
}

export const WORKFLOW_MAP: Record<string, WorkflowStep> = {
  'Premontaggio': {
    faseCurrent: 'Girato',
    faseNext: 'Pre montato',
    tipoNext: 'Montaggio',
    assegnatoKeyword: 'Alessandro',
    emojiNext: '✂️',
    descrizioneNext: c => `✂️ Montaggio ${c.id_display} – ${c.titolo}${c.cliente_nome ? ` (${c.cliente_nome})` : ''}`,
  },
  'Montaggio': {
    faseCurrent: 'Pre montato',
    faseNext: 'Montato',
    tipoNext: 'Upload esportato',
    assegnatoKeyword: 'Alessandro',
    emojiNext: '📤',
    descrizioneNext: c => `📤 Upload esportato ${c.id_display} – ${c.titolo}${c.cliente_nome ? ` (${c.cliente_nome})` : ''}`,
  },
  'Upload esportato': {
    faseCurrent: 'Montato',
    faseNext: 'Uploadato',
    tipoNext: 'Revisione montaggio',
    assegnatoKeyword: 'Elisa',
    emojiNext: '👁️',
    descrizioneNext: c => `👁️ Revisione ${c.id_display} – ${c.titolo}${c.cliente_nome ? ` (${c.cliente_nome})` : ''}`,
  },
  'Revisione montaggio': {
    faseCurrent: 'Uploadato',
    faseNext: 'Revisionato',
    tipoNext: 'Programmazione',
    assegnatoKeyword: 'Elisa',
    emojiNext: '📅',
    descrizioneNext: c => `📅 Programmazione ${c.id_display} – ${c.titolo}${c.cliente_nome ? ` (${c.cliente_nome})` : ''}`,
  },
  'Programmazione': {
    faseCurrent: 'Revisionato',
    faseNext: 'Programmato',
    tipoNext: '',
    assegnatoKeyword: 'Elisa',
    emojiNext: '',
    descrizioneNext: () => '',
  },
};

// ── Workflow ordered steps for timeline display ──────────────────────────────
export const WORKFLOW_STEPS_ORDER = [
  { fase: 'Girato', tipo: 'Premontaggio', label: 'Pre montaggio', emoji: '🎬', assegnato: 'Luca' },
  { fase: 'Pre montato', tipo: 'Montaggio', label: 'Montaggio', emoji: '✂️', assegnato: 'Alessandro' },
  { fase: 'Montato', tipo: 'Upload esportato', label: 'Upload esportato', emoji: '📤', assegnato: 'Alessandro' },
  { fase: 'Uploadato', tipo: 'Revisione montaggio', label: 'Revisione', emoji: '👁️', assegnato: 'Elisa' },
  { fase: 'Revisionato', tipo: 'Programmazione', label: 'Programmazione', emoji: '📅', assegnato: 'Elisa' },
  { fase: 'Programmato', tipo: '', label: 'Pubblicazione', emoji: '📤', assegnato: 'Elisa' },
  { fase: 'Pubblicato', tipo: 'Cleanup', label: 'Pubblicato', emoji: '✅', assegnato: '' },
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

export function findMembro(team: TeamMember[], cerca: string): string {
  const m = team.find(t => t.nome.toLowerCase().includes(cerca.toLowerCase()));
  return m?.nome ?? cerca;
}

async function clpHasExportedFile(contenutoId: string): Promise<boolean> {
  const { data } = await supabase
    .from('log_riprese')
    .select('id')
    .eq('contenuto_id', contenutoId)
    .not('exported_file_id', 'is', null)
    .limit(1);

  return !!data?.length;
}

export async function completaTaskPerContenuto(contenutoId: string, tipo: string) {
  const { data } = await supabase
    .from('task')
    .select('id')
    .eq('id_contenuto', contenutoId)
    .eq('tipo', tipo)
    .neq('stato', 'Completato')
    .neq('stato', 'Archiviato');

  if (data && data.length > 0) {
    await supabase
      .from('task')
      .update({ stato: 'Completato' })
      .in('id', data.map(t => t.id));
  }
}

export async function creaTaskWorkflow(
  contenuto: Contenuto,
  assegnatoA: string,
  tipo: string,
  descrizione: string,
  stato: string = 'Da fare',
  scadenza?: string | null,
  ora?: string | null
) {
  // Anti-duplicato
  const { data: existing } = await supabase
    .from('task')
    .select('id')
    .eq('id_contenuto', contenuto.id)
    .eq('tipo', tipo)
    .neq('stato', 'Completato')
    .neq('stato', 'Archiviato');

  if (existing && existing.length > 0) return null;

  // Check if user manually deleted this task type before — respect that
  // (We skip this check for simplicity; the anti-duplicate check suffices)

  // Calcola deadline a ritroso se non già fornita
  const deadlineCalcolata = scadenza || calcolaDeadlineARitroso(contenuto.data_pubblicazione, tipo);

  const { data: idData } = await supabase.rpc('generate_display_id', { prefix: 'TSK', seq_name: 'task_seq' });

  const { data, error } = await supabase
    .from('task')
    .insert({
      id_display: idData ?? `TSK${Date.now()}`,
      descrizione,
      tipo,
      stato,
      assegnato_a: assegnatoA,
      assegnato_da: '⚡ Sistema',
      cliente_id: contenuto.cliente_id,
      cliente_nome: contenuto.cliente_nome || '',
      id_contenuto: contenuto.id,
      priorita: deadlineCalcolata ? '🔴 Alta' : '🟡 Media',
      scadenza: deadlineCalcolata ?? null,
      ora: ora ?? null,
    })
    .select()
    .single();

  if (error) console.error('Errore creazione task workflow:', error);
  return data;
}

/**
 * Crea task di Premontaggio per Luca quando vengono caricate clip su un CLP
 */
export async function creaTaskPremontaggio(contenuto: Contenuto, team: TeamMember[], numClip: number): Promise<any> {
  const nomeLuca = findMembro(team, 'Luca');
  return creaTaskWorkflow(
    contenuto,
    nomeLuca,
    'Premontaggio',
    `🎬 Pre montaggio ${contenuto.id_display} – ${contenuto.titolo}${contenuto.cliente_nome ? ` (${contenuto.cliente_nome})` : ''}`,
    'Da fare',
    null,
    null,
  );
}

/**
 * Revisione: Elisa richiede modifiche → CLP torna a "Pre montato", nuovo task per Alessandro
 */
export async function richiestaModifiche(
  contenuto: Contenuto,
  team: TeamMember[],
  noteRevisione: string
): Promise<any> {
  // Completa il task di revisione corrente
  await completaTaskPerContenuto(contenuto.id, 'Revisione montaggio');

  // Riporta CLP a Pre montato
  await supabase.from('contenuti').update({ fase: 'Pre montato', note_revisione: noteRevisione }).eq('id', contenuto.id);

  // Crea nuovo task di Montaggio per Alessandro
  const nomeAlessandro = findMembro(team, 'Alessandro');
  return creaTaskWorkflow(
    { ...contenuto, fase: 'Pre montato' as FaseCLP },
    nomeAlessandro,
    'Montaggio',
    `🔄 Modifiche ${contenuto.id_display} – ${contenuto.titolo}${contenuto.cliente_nome ? ` (${contenuto.cliente_nome})` : ''}\n📝 ${noteRevisione}`,
    'Da fare',
    null,
    null,
  );
}

/**
 * Revisione: Elisa approva → CLP passa a Revisionato, crea task Programmazione
 */
export async function approvaRevisione(
  contenuto: Contenuto,
  team: TeamMember[]
): Promise<any> {
  // Completa il task di revisione
  await completaTaskPerContenuto(contenuto.id, 'Revisione montaggio');

  // Avanza a Revisionato
  await supabase.from('contenuti').update({ fase: 'Revisionato' }).eq('id', contenuto.id);

  // Crea task Programmazione per Elisa
  const nomeElisa = findMembro(team, 'Elisa');
  return creaTaskWorkflow(
    { ...contenuto, fase: 'Revisionato' as FaseCLP },
    nomeElisa,
    'Programmazione',
    `📅 Programmazione ${contenuto.id_display} – ${contenuto.titolo}${contenuto.cliente_nome ? ` (${contenuto.cliente_nome})` : ''}`,
    'Da fare',
    null,
    null,
  );
}

/**
 * Chiamato quando l'utente cambia la fase CLP direttamente dal TaskDetailPanel.
 * Completa SEMPRE il task corrente se la fase avanza in avanti, e crea il task
 * che "vive" nella nuova fase.
 */
export async function avanzaFaseDaTask(
  taskId: string,
  taskTipo: string,
  contenutoId: string,
  nuovaFase: FaseCLP,
  team: TeamMember[],
  teamId?: string
): Promise<{ completatoTask: boolean; taskCreato: boolean; driveTriggered: boolean }> {
  const FASE_SEQ = ['Girato', 'Pre montato', 'Montato', 'Uploadato', 'Revisionato', 'Programmato', 'Pubblicato'];
  const step = WORKFLOW_MAP[taskTipo];
  const faseCurrent = step?.faseCurrent;
  const currentIdx = faseCurrent ? FASE_SEQ.indexOf(faseCurrent) : -1;
  const targetIdx = FASE_SEQ.indexOf(nuovaFase);
  const isForward = targetIdx > currentIdx;

  // BLOCCO: non si può andare a Uploadato o oltre senza un file esportato
  // Bypass per task creati prima del 28/03/2026 (migrazione vecchia logica)
  const BYPASS_DATE = '2026-03-28';
  if (targetIdx >= FASE_SEQ.indexOf('Uploadato')) {
    const { data: taskRow } = await supabase
      .from('task')
      .select('created_at')
      .eq('id_contenuto', contenutoId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    const isOldTask = taskRow?.created_at && taskRow.created_at < BYPASS_DATE;
    if (!isOldTask) {
      const hasFile = await clpHasExportedFile(contenutoId);
      if (!hasFile) {
        throw new Error('Non puoi avanzare a questa fase senza aver prima caricato il file esportato.');
      }
    }
  }

  // 1. Aggiorna sempre la fase del CLP
  await supabase.from('contenuti').update({ fase: nuovaFase }).eq('id', contenutoId);

  // Se stiamo andando INDIETRO, non completare il task corrente
  if (!isForward) {
    return { completatoTask: false, taskCreato: false, driveTriggered: false };
  }

  // 2. Completa il task corrente (e tutti i task di fasi precedenti rimasti aperti)
  await supabase.from('task').update({ stato: 'Completato' }).eq('id', taskId);

  // Completa anche eventuali task orfani di fasi precedenti
  const FASE_TIPO_MAP: Record<string, string> = {
    'Girato': 'Premontaggio', 'Pre montato': 'Montaggio', 'Montato': 'Upload esportato',
    'Uploadato': 'Revisione montaggio', 'Revisionato': 'Programmazione',
  };
  for (let i = 0; i < targetIdx; i++) {
    const prevTipo = FASE_TIPO_MAP[FASE_SEQ[i]];
    if (prevTipo) {
      await supabase.from('task')
        .update({ stato: 'Completato' })
        .eq('id_contenuto', contenutoId)
        .eq('tipo', prevTipo)
        .neq('stato', 'Completato')
        .neq('stato', 'Archiviato');
    }
  }

  // 3. Prendi contenuto fresco
  const { data: contenuto } = await supabase
    .from('contenuti')
    .select('*')
    .eq('id', contenutoId)
    .single();

  if (!contenuto) return { completatoTask: true, taskCreato: false, driveTriggered: false };

  // 4. Trova il task che dovrebbe "vivere" nella nuova fase e crealo
  // Es: fase Uploadato → task tipo "Revisione montaggio"
  const tipoNuovaFase = FASE_TIPO_MAP[nuovaFase];
  let newTask = null;
  if (tipoNuovaFase) {
    // Controlla se esiste già un task aperto di questo tipo
    const { data: existing } = await supabase.from('task')
      .select('id')
      .eq('id_contenuto', contenutoId)
      .eq('tipo', tipoNuovaFase)
      .neq('stato', 'Completato')
      .neq('stato', 'Archiviato')
      .limit(1);

    if (!existing || existing.length === 0) {
      // Trova il WORKFLOW_MAP entry per il tipo che stiamo creando
      // Es: tipoNuovaFase = 'Revisione montaggio' → WORKFLOW_MAP['Revisione montaggio']
      const wfStep = WORKFLOW_MAP[tipoNuovaFase];
      if (wfStep) {
        const assegnatoA = findMembro(team, wfStep.assegnatoKeyword);
        const c = contenuto as Contenuto;
        const desc = `${wfStep.emojiNext || '📋'} ${tipoNuovaFase} ${c.id_display} – ${c.titolo}${c.cliente_nome ? ` (${c.cliente_nome})` : ''}`;
        newTask = await creaTaskWorkflow(c, assegnatoA, tipoNuovaFase, desc, 'Da fare');
      } else {
        // Fallback per tipi senza entry in WORKFLOW_MAP (es: step iniziale)
        const wfEntry = Object.entries(WORKFLOW_MAP).find(([, v]) => v.faseCurrent === nuovaFase);
        if (wfEntry) {
          const [, entryStep] = wfEntry;
          const assegnatoA = findMembro(team, entryStep.assegnatoKeyword);
          const c = contenuto as Contenuto;
          const desc = `${entryStep.emojiNext || '📋'} ${tipoNuovaFase} ${c.id_display} – ${c.titolo}${c.cliente_nome ? ` (${c.cliente_nome})` : ''}`;
          newTask = await creaTaskWorkflow(c, assegnatoA, tipoNuovaFase, desc, 'Da fare');
        }
      }

      // Se è Upload esportato, aggiungi nota con percorso Drive
      if (tipoNuovaFase === 'Upload esportato' && newTask) {
        const slug = (contenuto as Contenuto).titolo.replace(/\s+/g, '-').slice(0, 40);
        const folderPath = `SKORPIO_Clip/${(contenuto as Contenuto).cliente_nome}/${(contenuto as Contenuto).id_display}_${slug}/file_esportato/`;
        const driveNote = contenuto.link_drive
          ? `📂 Carica il file esportato nella cartella "file_esportato/" su Google Drive:\n${contenuto.link_drive}\n\nPercorso: ${folderPath}`
          : `📂 Carica il file esportato nella sezione Riprese del CLP ${(contenuto as Contenuto).id_display}, zona "File esportato".\n\nPercorso Drive: ${folderPath}`;
        await supabase.from('task').update({ note: driveNote }).eq('id', newTask.id);
      }
    }
  }

  // 5. Se la fase è Montato → triggera Drive
  let driveTriggered = false;
  if (nuovaFase === 'Montato' && !contenuto.link_drive) {
    driveTriggered = true;
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      await fetch(`${supabaseUrl}/functions/v1/create-drive-folder`, {
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
    } catch (e) {
      console.error('Errore Drive trigger:', e);
    }
  }

  // 6. Se fase = Programmato e data+ora già passati → pubblica subito + cleanup
  if (nuovaFase === 'Programmato' && contenuto.data_pubblicazione && contenuto.ora_pubblicazione) {
    if (isProntoPerPubblicazione(contenuto.data_pubblicazione, contenuto.ora_pubblicazione)) {
      // [OLD] await supabase.from('contenuti').update({ fase: 'Pubblicato' }).eq('id', contenutoId);
      const { cambiaFaseCLP: cambiaFase } = await import('../services/faseService');
      console.log('[Step2c] auto-publish via FaseService', { contenutoId });
      await cambiaFase({ contenutoId, nuovaFase: 'Pubblicato', source: 'workflow', userId: teamId || 'workflow' });
      await creaTaskCleanup(contenuto as Contenuto, team as any[]);
      return { completatoTask: true, taskCreato: !!newTask, driveTriggered };
    }
  }

  return { completatoTask: true, taskCreato: !!newTask, driveTriggered };
}


/**
 * Funzione di completamento via tasto "Completato" del task:
 * avanza la fase CLP + crea il task successivo.
 */
export async function completaTaskEAvanzaFase(
  taskTipo: string,
  contenutoId: string,
  team: TeamMember[],
  teamId?: string
): Promise<FaseCLP | null> {
  // Completa TUTTI i task aperti di questo tipo per questo contenuto
  await completaTaskPerContenuto(contenutoId, taskTipo);
  const step = WORKFLOW_MAP[taskTipo];
  if (!step) return null;

  const { data: contenuto } = await supabase
    .from('contenuti')
    .select('*')
    .eq('id', contenutoId)
    .single();

  if (!contenuto) return null;

  let faseNext = step.faseNext;
  let stepForNextTask = step;

  // Se l'esportato è già stato caricato fuori dal task dedicato,
  // salta automaticamente lo step "Upload esportato" e porta Elisa in Uploadato.
  if (step.faseNext === 'Montato' && await clpHasExportedFile(contenutoId)) {
    const uploadStep = WORKFLOW_MAP['Upload esportato'];
    faseNext = uploadStep.faseNext;
    stepForNextTask = uploadStep;
    await completaTaskPerContenuto(contenutoId, 'Upload esportato');
  }

  // [OLD - replaced by FaseService]
  // await supabase.from('contenuti').update({ fase: faseNext }).eq('id', contenutoId);

  // [NEW - FaseService centralizzato]
  const { cambiaFaseCLP } = await import('../services/faseService');
  console.log('[Step2c] completaTaskEAvanzaFase via FaseService', { contenutoId, faseNext });
  const faseResult = await cambiaFaseCLP({
    contenutoId,
    nuovaFase: faseNext,
    source: 'kanban',
    userId: teamId || 'workflow',
    taskIdCompletato: undefined, // task già completato sopra
  });
  console.log('[Step2c] risultato:', faseResult);

  if (stepForNextTask.tipoNext) {
    const assegnatoA = findMembro(team, stepForNextTask.assegnatoKeyword);
    const newTask = await creaTaskWorkflow(
      contenuto as Contenuto,
      assegnatoA,
      stepForNextTask.tipoNext,
      stepForNextTask.descrizioneNext(contenuto as Contenuto),
      'Da fare',
    );
    // Se è Upload esportato, aggiungi nota con percorso Drive
    if (stepForNextTask.tipoNext === 'Upload esportato' && newTask) {
      const slug = contenuto.titolo.replace(/\s+/g, '-').slice(0, 40);
      const folderPath = `SKORPIO_Clip/${contenuto.cliente_nome}/${contenuto.id_display}_${slug}/file_esportato/`;
      const driveNote = contenuto.link_drive
        ? `📂 Carica il file esportato nella cartella "file_esportato/" su Google Drive:\n${contenuto.link_drive}\n\nPercorso: ${folderPath}`
        : `📂 Carica il file esportato nella sezione Riprese del CLP ${contenuto.id_display}, zona "File esportato".\n\nPercorso Drive: ${folderPath}`;
      await supabase.from('task').update({ note: driveNote }).eq('id', newTask.id);
    }
  }

  // Se faseNext = Montato → triggera Drive
  if (step.faseNext === 'Montato' && !contenuto.link_drive) {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      await fetch(`${supabaseUrl}/functions/v1/create-drive-folder`, {
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
    } catch (e) {
      console.error('Errore Drive trigger:', e);
    }
  }

  // Se faseNext = Programmato e data+ora già passati → pubblica subito + cleanup
  if (faseNext === 'Programmato' && contenuto.data_pubblicazione && contenuto.ora_pubblicazione) {
    if (isProntoPerPubblicazione(contenuto.data_pubblicazione, contenuto.ora_pubblicazione)) {
      // [OLD] await supabase.from('contenuti').update({ fase: 'Pubblicato' }).eq('id', contenutoId);
      const { cambiaFaseCLP: cambiaFase2 } = await import('../services/faseService');
      console.log('[Step2c] auto-publish via FaseService (completaTaskEAvanzaFase)', { contenutoId });
      await cambiaFase2({ contenutoId, nuovaFase: 'Pubblicato', source: 'kanban', userId: teamId || 'workflow' });
      await creaTaskCleanup(contenuto as Contenuto, team as any[]);
      return 'Pubblicato' as FaseCLP;
    }
  }

  return faseNext;
}

/**
 * Helper: controlla se un CLP programmato con data+ora è pronto per la pubblicazione.
 * Richiede OBBLIGATORIAMENTE ora_pubblicazione — senza orario resta Programmato.
 */
function isProntoPerPubblicazione(dataPub: string | null, oraPub: string | null): boolean {
  if (!dataPub || !oraPub) return false;
  const now = new Date();
  const scheduled = new Date(`${dataPub}T${oraPub.length === 5 ? oraPub + ':00' : oraPub}`);
  return now >= scheduled;
}

/**
 * Check periodico: CLPs in stato "Programmato" con data+ora passati
 * vengono portati a "Pubblicato" e il task Programmazione/Pubblicazione viene completato.
 * NOTA: senza ora_pubblicazione il CLP resta in Programmato.
 */
export async function checkAutoPubblica(): Promise<number> {
  const oggi = toDateStr(new Date());

  // Prendi tutti i CLPs programmati con data <= oggi (filtro orario fatto dopo in JS)
  const { data: candidati } = await supabase
    .from('contenuti')
    .select('id, data_pubblicazione, ora_pubblicazione')
    .eq('fase', 'Programmato')
    .lte('data_pubblicazione', oggi);

  if (!candidati || candidati.length === 0) return 0;

  // Filtra solo quelli il cui orario è effettivamente passato
  const daPublicare = candidati.filter(c =>
    isProntoPerPubblicazione(c.data_pubblicazione, c.ora_pubblicazione)
  );

  if (daPublicare.length === 0) return 0;

  const ids = daPublicare.map(c => c.id);

  await supabase.from('contenuti').update({ fase: 'Pubblicato' }).in('id', ids);

  for (const { id } of daPublicare) {
    await completaTaskPerContenuto(id, 'Programmazione');
    await completaTaskPerContenuto(id, 'Pubblicazione');
    try {
      const { data: contenuto } = await supabase.from('contenuti').select('*').eq('id', id).single();
      if (contenuto) {
        const { data: teamData } = await supabase.from('team').select('*');
        const team = (teamData || []) as any[];
        await creaTaskCleanup(contenuto as Contenuto, team);
      }
    } catch (e) {
      console.error('[checkAutoPubblica] errore creaTaskCleanup:', e);
    }
  }

  return ids.length;
}

/**
 * Crea il task di cleanup per Elisa quando un CLP viene pubblicato.
 */
export async function creaTaskCleanup(contenuto: Contenuto, team: any[]): Promise<void> {
  const { data: existing } = await supabase
    .from('task')
    .select('id')
    .eq('id_contenuto', contenuto.id)
    .eq('tipo', 'Cleanup')
    .neq('stato', 'Completato')
    .neq('stato', 'Archiviato');

  if (existing && existing.length > 0) return;

  const nomeElisa = findMembro(team, 'Elisa');

  const { data: idData } = await supabase.rpc('generate_display_id', { prefix: 'TSK', seq_name: 'task_seq' });

  await supabase.from('task').insert({
    id_display: idData ?? `TSK${Date.now()}`,
    descrizione: `🗑️ Cleanup ${contenuto.id_display} – ${contenuto.titolo}${contenuto.cliente_nome ? ` (${contenuto.cliente_nome})` : ''}`,
    tipo: 'Cleanup',
    stato: 'Da fare',
    assegnato_a: nomeElisa,
    assegnato_da: '⚡ Sistema',
    cliente_id: contenuto.cliente_id,
    cliente_nome: contenuto.cliente_nome || '',
    id_contenuto: contenuto.id,
    priorita: '🟢 Bassa',
    note: `La clip ${contenuto.id_display} è stata pubblicata. Cancella i file grezzi dalla cartella clip/ su Google Drive. Il file esportato resta.`,
  });
}

/**
 * Sync: trova CLPs in fasi workflow che non hanno il task corrispondente e li crea.
 * Inoltre completa automaticamente i task di fasi precedenti che sono rimasti aperti.
 * Chiamato all'avvio per recuperare CLPs entrati nel workflow prima dell'automazione.
 */
export async function syncMissingWorkflowTasks(): Promise<number> {
  const FASE_ORDER = ['Girato', 'Pre montato', 'Montato', 'Uploadato', 'Revisionato', 'Programmato', 'Pubblicato'];
  const FASE_TO_TIPO: Record<string, { tipo: string; keyword: string; emoji: string }> = {
    'Girato': { tipo: 'Premontaggio', keyword: 'Luca', emoji: '🎬' },
    'Pre montato': { tipo: 'Montaggio', keyword: 'Alessandro', emoji: '✂️' },
    'Montato': { tipo: 'Upload esportato', keyword: 'Alessandro', emoji: '📤' },
    'Uploadato': { tipo: 'Revisione montaggio', keyword: 'Elisa', emoji: '👁️' },
    'Revisionato': { tipo: 'Programmazione', keyword: 'Elisa', emoji: '📅' },
  };
  const FASE_TIPO_MAP: Record<string, string> = {
    'Girato': 'Premontaggio',
    'Pre montato': 'Montaggio',
    'Montato': 'Upload esportato',
    'Uploadato': 'Revisione montaggio',
    'Revisionato': 'Programmazione',
  };

  const { data: teamData } = await supabase.from('team').select('*');
  const team = (teamData || []) as TeamMember[];

  let created = 0;

  for (const [fase, info] of Object.entries(FASE_TO_TIPO)) {
    const { data: clps } = await supabase
      .from('contenuti')
      .select('*')
      .eq('fase', fase);

    if (!clps || clps.length === 0) continue;

    for (const clp of clps) {
      // 1. Completa i task di fasi PRECEDENTI rimasti aperti
      const currentIdx = FASE_ORDER.indexOf(fase);
      for (let i = 0; i < currentIdx; i++) {
        const prevFase = FASE_ORDER[i];
        const prevTipo = FASE_TIPO_MAP[prevFase];
        if (prevTipo) {
          await completaTaskPerContenuto(clp.id, prevTipo);
        }
      }

      // Self-healing: se il file esportato esiste già, il CLP non deve restare in Montato.
      if (fase === 'Montato' && await clpHasExportedFile(clp.id)) {
        await completaTaskPerContenuto(clp.id, 'Upload esportato');
        await supabase.from('contenuti').update({ fase: 'Uploadato' }).eq('id', clp.id);
        continue;
      }

      // 2. Cancella task di fasi FUTURE che non dovrebbero esistere
      const futureTipi: string[] = [];
      for (let i = currentIdx + 1; i < FASE_ORDER.length; i++) {
        const futFase = FASE_ORDER[i];
        const futTipo = FASE_TIPO_MAP[futFase];
        if (futTipo) futureTipi.push(futTipo);
      }
      if (futureTipi.length > 0) {
        const { data: futureTasks } = await supabase
          .from('task')
          .select('id')
          .eq('id_contenuto', clp.id)
          .in('tipo', futureTipi)
          .neq('stato', 'Completato')
          .neq('stato', 'Archiviato');
        if (futureTasks && futureTasks.length > 0) {
          await supabase.from('task').delete().in('id', futureTasks.map(t => t.id));
        }
      }

      // 3. Crea task per fase corrente se mancante
      const { data: existing } = await supabase
        .from('task')
        .select('id')
        .eq('id_contenuto', clp.id)
        .eq('tipo', info.tipo)
        .neq('stato', 'Completato')
        .neq('stato', 'Archiviato');

      if (existing && existing.length > 0) continue;

      const { data: completed } = await supabase
        .from('task')
        .select('id')
        .eq('id_contenuto', clp.id)
        .eq('tipo', info.tipo)
        .eq('stato', 'Completato');

      // Se esiste già un task completato della fase corrente ma il CLP è ANCORA in questa fase,
      // significa che il task successivo non è stato creato correttamente: ricrealo comunque.
      // Quindi non facciamo continue qui.

      const assegnatoA = findMembro(team, info.keyword);
      const labelMap: Record<string, string> = {
        'Premontaggio': 'Pre montaggio',
        'Montaggio': 'Montaggio',
        'Upload esportato': 'Upload esportato',
        'Revisione montaggio': 'Revisione',
        'Programmazione': 'Programmazione',
      };
      await creaTaskWorkflow(
        clp as Contenuto,
        assegnatoA,
        info.tipo,
        `${info.emoji} ${labelMap[info.tipo] || info.tipo} ${clp.id_display} – ${clp.titolo}${clp.cliente_nome ? ` (${clp.cliente_nome})` : ''}`,
        'Da fare',
      );
      created++;
    }
  }

  return created;
}

/**
 * Recupera i task workflow per un CLP (per la timeline nella tab Riprese)
 */
export async function getWorkflowTasks(contenutoId: string): Promise<Array<{
  tipo: string;
  stato: string;
  assegnato_a: string;
  created_at: string;
  updated_at: string;
  scadenza: string | null;
}>> {
  const { data } = await supabase
    .from('task')
    .select('tipo, stato, assegnato_a, created_at, updated_at, scadenza')
    .eq('id_contenuto', contenutoId)
    .order('created_at', { ascending: true });
  return (data || []) as any[];
}
