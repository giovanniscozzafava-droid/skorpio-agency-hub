/**
 * CLP Workflow utilities — condivisi tra CLPDetailPanel e TaskDetailPanel
 */
import { supabase } from './supabase';
import type { Contenuto, FaseCLP, TeamMember } from '../types';

// Mappa tipo task → fase CLP che viene completata + prossima fase + prossimo tipo task
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
    descrizioneNext: c => `🔍 Revisiona montaggio ${c.id_display} – ${c.titolo}${c.cliente_nome ? ` (${c.cliente_nome})` : ''}`,
  },
  'Revisione montaggio': {
    faseCurrent: 'Montato',
    faseNext: 'Revisione',
    tipoNext: 'Pubblicazione',
    assegnatoKeyword: 'Elisa',
    descrizioneNext: c => `📱 Programma/pubblica ${c.id_display} – ${c.titolo}${c.cliente_nome ? ` (${c.cliente_nome})` : ''}`,
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
 * Esegue il workflow completo: completa task corrente → avanza fase CLP → crea task successivo
 * Ritorna la nuova fase CLP se ci sono state modifiche, altrimenti null
 */
export async function completaTaskEAvanzaFase(
  taskTipo: string,
  contenutoId: string,
  team: TeamMember[]
): Promise<FaseCLP | null> {
  const step = WORKFLOW_MAP[taskTipo];
  if (!step) return null;

  // 1. Prendi il contenuto aggiornato
  const { data: contenuto } = await supabase
    .from('contenuti')
    .select('*')
    .eq('id', contenutoId)
    .single();

  if (!contenuto) return null;

  // 2. Avanza la fase del CLP
  await supabase
    .from('contenuti')
    .update({ fase: step.faseNext })
    .eq('id', contenutoId);

  // 3. Crea il task successivo
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

  return step.faseNext;
}
