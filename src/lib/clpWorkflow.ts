/**
 * CLP Workflow utilities — condivisi tra CLPDetailPanel e TaskDetailPanel
 */
import { supabase } from './supabase';
import type { Contenuto, FaseCLP, TeamMember } from '../types';

// Mappa tipo task → fase CLP corrente + prossima fase + prossimo task
export const WORKFLOW_MAP: Record<string, {
  faseCurrent: FaseCLP;
  faseNext: FaseCLP;
  tipoNext: string;
  assegnatoKeyword: string;
  descrizioneNext: (c: Contenuto) => string;
}> = {
  'Premontaggio': {
    faseCurrent: 'Girato',
    faseNext: 'Pre montato',
    tipoNext: 'Montaggio',
    assegnatoKeyword: 'Alessandro',
    descrizioneNext: c => `✂️ Monta ${c.id_display} – ${c.titolo}${c.cliente_nome ? ` (${c.cliente_nome})` : ''}`,
  },
  'Montaggio': {
    faseCurrent: 'Pre montato',
    faseNext: 'Montato',
    tipoNext: 'Revisione montaggio',
    assegnatoKeyword: 'Elisa',
    descrizioneNext: c => `🔍 Revisiona ${c.id_display} – ${c.titolo}${c.cliente_nome ? ` (${c.cliente_nome})` : ''}`,
  },
  'Revisione montaggio': {
    faseCurrent: 'Montato',
    faseNext: 'Revisionato',
    tipoNext: 'Programmazione',
    assegnatoKeyword: 'Elisa',
    descrizioneNext: c => `📅 Programma ${c.id_display} – ${c.titolo}${c.cliente_nome ? ` (${c.cliente_nome})` : ''}`,
  },
  'Programmazione': {
    faseCurrent: 'Revisionato',
    faseNext: 'Programmato',
    tipoNext: '',
    assegnatoKeyword: 'Elisa',
    descrizioneNext: () => '',
  },
};

export function findMembro(team: TeamMember[], cerca: string): string {
  const m = team.find(t => t.nome.toLowerCase().includes(cerca.toLowerCase()));
  return m?.nome ?? cerca;
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
  const { data: existing } = await supabase
    .from('task')
    .select('id')
    .eq('id_contenuto', contenuto.id)
    .eq('tipo', tipo)
    .neq('stato', 'Completato')
    .neq('stato', 'Archiviato');

  if (existing && existing.length > 0) return null;

  const { data: idData } = await supabase.rpc('generate_display_id', { prefix: 'TSK', seq_name: 'task_seq' });

  const { data, error } = await supabase
    .from('task')
    .insert({
      id_display: idData ?? `TSK${Date.now()}`,
      descrizione,
      tipo,
      stato,
      assegnato_a: assegnatoA,
      assegnato_da: 'Sistema',
      cliente_id: contenuto.cliente_id,
      cliente_nome: contenuto.cliente_nome || '',
      id_contenuto: contenuto.id,
      priorita: scadenza ? '🔴 Alta' : '🟡 Media',
      scadenza: scadenza ?? null,
      ora: ora ?? null,
    })
    .select()
    .single();

  if (error) console.error('Errore creazione task workflow:', error);
  return data;
}

/**
 * Chiamato quando l'utente cambia la fase CLP direttamente dal TaskDetailPanel.
 * Se la nuova fase coincide con faseNext del suo step di workflow:
 *   → completa il task corrente
 *   → avanza il CLP
 *   → crea il task successivo
 *   → trigera Drive se fase = Montato
 * Ritorna { nuovaFase, taskCreato, driveTriggered }
 */
export async function avanzaFaseDaTask(
  taskId: string,
  taskTipo: string,
  contenutoId: string,
  nuovaFase: FaseCLP,
  team: TeamMember[]
): Promise<{ completatoTask: boolean; taskCreato: boolean; driveTriggered: boolean }> {
  const step = WORKFLOW_MAP[taskTipo];
  const isStepCompletion = step && step.faseNext === nuovaFase;

  // 1. Aggiorna sempre la fase del CLP
  await supabase.from('contenuti').update({ fase: nuovaFase }).eq('id', contenutoId);

  if (!isStepCompletion) {
    return { completatoTask: false, taskCreato: false, driveTriggered: false };
  }

  // 2. Completa il task corrente
  await supabase.from('task').update({ stato: 'Completato' }).eq('id', taskId);

  // 3. Prendi contenuto fresco
  const { data: contenuto } = await supabase
    .from('contenuti')
    .select('*')
    .eq('id', contenutoId)
    .single();

  if (!contenuto) return { completatoTask: true, taskCreato: false, driveTriggered: false };

  // 4. Crea il task successivo
  const assegnatoA = findMembro(team, step.assegnatoKeyword);
  const newTask = await creaTaskWorkflow(
    contenuto as Contenuto,
    assegnatoA,
    step.tipoNext,
    step.descrizioneNext(contenuto as Contenuto),
    'Da fare',
    contenuto.data_pubblicazione ?? null,
    contenuto.ora_pubblicazione?.slice(0, 5) ?? null
  );

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
        }),
      });
    } catch (e) {
      console.error('Errore Drive trigger:', e);
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
  team: TeamMember[]
): Promise<FaseCLP | null> {
  const step = WORKFLOW_MAP[taskTipo];
  if (!step) return null;

  const { data: contenuto } = await supabase
    .from('contenuti')
    .select('*')
    .eq('id', contenutoId)
    .single();

  if (!contenuto) return null;

  await supabase
    .from('contenuti')
    .update({ fase: step.faseNext })
    .eq('id', contenutoId);

  const assegnatoA = findMembro(team, step.assegnatoKeyword);
  await creaTaskWorkflow(
    contenuto as Contenuto,
    assegnatoA,
    step.tipoNext,
    step.descrizioneNext(contenuto as Contenuto),
    'Da fare',
    contenuto.data_pubblicazione ?? null,
    contenuto.ora_pubblicazione?.slice(0, 5) ?? null
  );

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
        }),
      });
    } catch (e) {
      console.error('Errore Drive trigger:', e);
    }
  }

  return step.faseNext;
}

/**
 * Check all'avvio: CLPs in stato "Programmato" con data_pubblicazione <= oggi
 * vengono portati a "Pubblicato" e il task Pubblicazione di Elisa viene completato.
 * Ritorna il numero di CLPs auto-pubblicati.
 */
export async function checkAutoPubblica(): Promise<number> {
  const oggi = new Date().toISOString().split('T')[0]; // yyyy-MM-dd

  const { data: daPublicare } = await supabase
    .from('contenuti')
    .select('id')
    .eq('fase', 'Programmato')
    .lte('data_pubblicazione', oggi);

  if (!daPublicare || daPublicare.length === 0) return 0;

  const ids = daPublicare.map(c => c.id);

  // Porta tutti a Pubblicato
  await supabase
    .from('contenuti')
    .update({ fase: 'Pubblicato' })
    .in('id', ids);

  // Completa i task Pubblicazione attivi collegati
  for (const { id } of daPublicare) {
    await completaTaskPerContenuto(id, 'Pubblicazione');
  }

  return ids.length;
}
