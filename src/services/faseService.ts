/**
 * FaseService — Centralised CLP phase-change logic.
 *
 * This service AFFIANCA (does not replace) the existing clpWorkflow.ts.
 * Every module (Contenuti, Riprese, Kanban) should call cambiaFaseCLP()
 * instead of writing to contenuti.fase directly.
 */
import { supabase } from '../lib/supabase';
import type { Contenuto, FaseCLP, TeamMember } from '../types';
import { FASE_ORDER, isTransitionValid, FASE_TO_TASK_TIPO } from '../config/faseConfig';
import {
  creaTaskWorkflow,
  creaTaskCleanup,
  calcolaDeadlineARitroso,
  findMembro,
} from '../lib/clpWorkflow';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FaseChangeResult {
  success: boolean;
  oldFase: string;
  newFase: string;
  taskCreated?: string;
  driveFolder?: string;
  calendarUpdated?: boolean;
  reelIncremented?: boolean;
  cleanupTaskCreated?: boolean;
  errors: string[];
}

export interface CambiaFaseParams {
  contenutoId: string;
  nuovaFase: string;
  source: 'kanban' | 'contenuti' | 'riprese' | 'workflow';
  userId: string;
  taskIdCompletato?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getTeam(): Promise<TeamMember[]> {
  const { data } = await supabase.from('team').select('*');
  return (data || []) as TeamMember[];
}

async function logFaseChange(
  result: FaseChangeResult & { contenutoId: string; source: string; userId: string; taskCreatedId?: string }
) {
  try {
    await supabase.from('_fase_change_log').insert({
      contenuto_id: result.contenutoId,
      old_fase: result.oldFase,
      new_fase: result.newFase,
      source: result.source,
      user_id: result.userId,
      task_created_id: result.taskCreatedId || null,
      drive_folder_created: !!result.driveFolder,
      reel_incremented: !!result.reelIncremented,
      cleanup_created: !!result.cleanupTaskCreated,
      calendar_updated: !!result.calendarUpdated,
      errors: result.errors.length > 0 ? result.errors : null,
    });
  } catch (e) {
    console.error('[FaseService] log error:', e);
  }
}

// ── Safety: verify record count didn't decrease ──────────────────────────────

async function verifyNoDataLoss(tag: string): Promise<boolean> {
  const { count } = await supabase
    .from('contenuti')
    .select('*', { count: 'exact', head: true });
  
  // We only log — the caller decides what to do
  console.log(`[FaseService] ${tag} — contenuti count: ${count}`);
  return true;
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function cambiaFaseCLP(params: CambiaFaseParams): Promise<FaseChangeResult> {
  const { contenutoId, nuovaFase, source, userId, taskIdCompletato } = params;
  const errors: string[] = [];
  let taskCreatedId: string | undefined;
  let driveFolder: string | undefined;
  let reelIncremented = false;
  let cleanupTaskCreated = false;
  let calendarUpdated = false;

  console.log('[FaseService] cambiaFaseCLP called', { contenutoId, nuovaFase, source, userId });

  // ── 1. LEGGI lo stato attuale ────────────────────────────────────────────
  const { data: contenuto, error: fetchError } = await supabase
    .from('contenuti')
    .select('*')
    .eq('id', contenutoId)
    .single();

  if (fetchError || !contenuto) {
    console.error('[FaseService] contenuto non trovato', fetchError);
    return {
      success: false,
      oldFase: '',
      newFase: nuovaFase,
      errors: ['Contenuto non trovato: ' + (fetchError?.message || contenutoId)],
    };
  }

  const oldFase = contenuto.fase as string;

  // Se la fase è già uguale → return senza fare nulla
  if (oldFase === nuovaFase) {
    console.log('[FaseService] fase già uguale, skip', { oldFase, nuovaFase });
    return { success: true, oldFase, newFase: nuovaFase, errors: [] };
  }

  // ── 2. VALIDA la transizione ─────────────────────────────────────────────
  if (!isTransitionValid(oldFase, nuovaFase)) {
    console.warn('[FaseService] transizione non valida', { oldFase, nuovaFase });
    return {
      success: false,
      oldFase,
      newFase: nuovaFase,
      errors: [`Transizione non permessa: ${oldFase} → ${nuovaFase}`],
    };
  }

  // ── 3. SCRIVI la nuova fase ──────────────────────────────────────────────
  const { error: updateError } = await supabase
    .from('contenuti')
    .update({ fase: nuovaFase, updated_at: new Date().toISOString() })
    .eq('id', contenutoId);

  if (updateError) {
    console.error('[FaseService] errore update fase', updateError);
    return {
      success: false,
      oldFase,
      newFase: nuovaFase,
      errors: ['Errore update fase: ' + updateError.message],
    };
  }

  console.log('[FaseService] fase cambiata', { clpId: contenutoId, oldFase, newFase: nuovaFase, source });

  // ── FEAT 3: Scartata → Idea reset ─────────────────────────────────────────
  if (oldFase === 'Scartata' && nuovaFase === 'Idea') {
    console.log('[Ripristino] CLP ripristinato da Scartata', { contenutoId });
    await supabase.from('contenuti').update({ revision_count: 0 }).eq('id', contenutoId);
  }

  // ── FEAT 7: Supervisione Giovanni condizionale ───────────────────────────
  const needsSupervisione = nuovaFase === 'Montato' && contenuto.supervisione_giovanni === true;

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 4-5: SINCRONI — bloccano la risposta (critici per UX)
  // ══════════════════════════════════════════════════════════════════════════
  try {

  // ── 4. COMPLETA il task precedente ───────────────────────────────────────
  if (taskIdCompletato) {
    const { error: taskError } = await supabase
      .from('task')
      .update({ stato: 'Completato' })
      .eq('id', taskIdCompletato);

    if (taskError) {
      errors.push('Errore completamento task: ' + taskError.message);
      console.error('[FaseService] errore completamento task', taskError);
    } else {
      console.log('[FaseService] task completato', { taskIdCompletato });
    }
  }

  // ── 5. CREA il task workflow successivo ──────────────────────────────────
  const team = await getTeam();

  if (needsSupervisione) {
    try {
      const c = contenuto as unknown as Contenuto;
      const nomeGiovanni = findMembro(team, 'Giovanni');
      const desc = `👁️ Supervisione ${c.id_display} – ${c.titolo}${c.cliente_nome ? ` (${c.cliente_nome})` : ''}`;
      const newTask = await creaTaskWorkflow(c, nomeGiovanni, 'Supervisione', desc, 'Da fare');
      if (newTask) {
        taskCreatedId = newTask.id;
        console.log('[FaseService] task supervisione creato', { taskId: newTask.id });
      }
    } catch (e: any) {
      errors.push('Errore creazione task supervisione: ' + (e?.message || String(e)));
    }
  } else {
    const taskInfo = FASE_TO_TASK_TIPO[nuovaFase];
    if (taskInfo) {
      try {
        const c = contenuto as unknown as Contenuto;
        const assegnatoA = findMembro(team, taskInfo.keyword);
        const labelMap: Record<string, string> = {
          'Scrittura script': 'Scrittura script',
          'Premontaggio': 'Pre montaggio',
          'Montaggio': 'Montaggio',
          'Upload esportato': 'Upload esportato',
          'Revisione montaggio': 'Revisione',
          'Programmazione': 'Programmazione',
        };
        const desc = `${taskInfo.emoji} ${labelMap[taskInfo.tipo] || taskInfo.tipo} ${c.id_display} – ${c.titolo}${c.cliente_nome ? ` (${c.cliente_nome})` : ''}`;

        const newTask = await creaTaskWorkflow(c, assegnatoA, taskInfo.tipo, desc, 'Da fare');

        if (newTask) {
          taskCreatedId = newTask.id;
          console.log('[FaseService] task workflow creato', { taskId: newTask.id, tipo: taskInfo.tipo });

          // Se è Upload esportato, aggiungi nota con percorso Drive (sincrono — serve subito nel task)
          if (taskInfo.tipo === 'Upload esportato') {
            const slug = c.titolo.replace(/\s+/g, '-').slice(0, 40);
            const folderPath = `SKORPIO_Clip/${c.cliente_nome}/${c.id_display}_${slug}/file_esportato/`;
            const driveNote = c.link_drive
              ? `📂 Carica il file esportato nella cartella "file_esportato/" su Google Drive:\n${c.link_drive}\n\nPercorso: ${folderPath}`
              : `📂 Carica il file esportato nella sezione Riprese del CLP ${c.id_display}, zona "File esportato".\n\nPercorso Drive: ${folderPath}`;
            await supabase.from('task').update({ note: driveNote }).eq('id', newTask.id);
          }
        }
      } catch (e: any) {
        errors.push('Errore creazione task workflow: ' + (e?.message || String(e)));
        console.error('[FaseService] errore creazione task', e);
      }
    }
  }

  } catch (rollbackError: any) {
    // ── FIX D: ROLLBACK — riscrivi fase originale ──────────────────────────
    console.error('[FaseService] ROLLBACK: errore durante step 4-5, ripristino fase', { oldFase, error: rollbackError });
    await supabase.from('contenuti').update({ fase: oldFase }).eq('id', contenutoId);
    errors.push(`ROLLBACK: ${rollbackError?.message || String(rollbackError)}`);

    await logFaseChange({
      success: false, oldFase, newFase: nuovaFase, errors,
      contenutoId, source, userId, taskCreatedId,
      calendarUpdated: false, reelIncremented: false, cleanupTaskCreated: false,
    });

    return {
      success: false, oldFase, newFase: nuovaFase, errors,
      taskCreated: taskCreatedId, driveFolder, calendarUpdated, reelIncremented, cleanupTaskCreated,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 6-9: ASINCRONI — fire and forget, non bloccano la risposta
  // ══════════════════════════════════════════════════════════════════════════
  const asyncSideEffects = async () => {
    try {
      // ── 6. CREA cartella Google Drive (se fase = Montato) ──────────────
      if (nuovaFase === 'Montato' && !contenuto.link_drive) {
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
              team_id: userId,
            }),
          });
          const result = await res.json();
          if (result.success) {
            console.log('[FaseService][async] cartella Drive creata', { folder: result.folder_id });
          } else {
            console.warn('[FaseService][async] Drive folder failed:', result);
          }
        } catch (e) {
          console.error('[FaseService][async] errore Drive folder:', e);
        }
      }

      // ── 7. INCREMENTA contatore reel (se Pubblicato + Reel) ────────────
      if (nuovaFase === 'Pubblicato' && oldFase !== 'Pubblicato' && contenuto.tipo === 'Reel' && contenuto.cliente_id) {
        try {
          const { data: cliente } = await supabase
            .from('clienti')
            .select('reel_fatti')
            .eq('id', contenuto.cliente_id)
            .single();

          if (cliente) {
            await supabase
              .from('clienti')
              .update({ reel_fatti: (cliente.reel_fatti ?? 0) + 1 })
              .eq('id', contenuto.cliente_id);
            console.log('[FaseService][async] reel incrementato', { clienteId: contenuto.cliente_id });
          }
        } catch (e) {
          console.error('[FaseService][async] errore incremento reel:', e);
        }
      }

      // ── 8. CREA task cleanup (se Pubblicato) ───────────────────────────
      if (nuovaFase === 'Pubblicato') {
        try {
          const teamForCleanup = await getTeam();
          await creaTaskCleanup(contenuto as unknown as Contenuto, teamForCleanup);
          console.log('[FaseService][async] task cleanup creato');
        } catch (e) {
          console.error('[FaseService][async] errore cleanup task:', e);
        }
      }

      // ── 9. SYNC calendario ─────────────────────────────────────────────
      if (contenuto.data_pubblicazione) {
        try {
          const { data: existingCal } = await supabase
            .from('calendario')
            .select('id')
            .eq('contenuto_id', contenutoId)
            .eq('tipo', 'pubblicazione')
            .limit(1);

          if (existingCal && existingCal.length > 0) {
            await supabase
              .from('calendario')
              .update({
                stato: nuovaFase === 'Pubblicato' ? 'Completato' : 'Pianificato',
                tipo_contenuto: contenuto.tipo || '',
              })
              .eq('contenuto_id', contenutoId)
              .eq('tipo', 'pubblicazione');
          }
          console.log('[FaseService][async] calendario sync completato');
        } catch (e) {
          console.error('[FaseService][async] errore calendario:', e);
        }
      }
    } catch (e) {
      console.error('[FaseService][async] side effect non gestito:', e);
    }
  };

  // Fire and forget — non blocca la risposta
  asyncSideEffects();

  // ── 10. LOG (sincrono — si scrive sempre) ──────────────────────────────
  const result: FaseChangeResult = {
    success: true,
    oldFase,
    newFase: nuovaFase,
    taskCreated: taskCreatedId,
    driveFolder: undefined, // async — non disponibile subito
    calendarUpdated: false, // async — non disponibile subito
    reelIncremented: false, // async — non disponibile subito
    cleanupTaskCreated: false, // async — non disponibile subito
    errors,
  };

  await logFaseChange({
    ...result,
    contenutoId,
    source,
    userId,
    taskCreatedId,
  });

  return result;
}
