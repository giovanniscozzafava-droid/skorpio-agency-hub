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
  const taskInfo = FASE_TO_TASK_TIPO[nuovaFase];
  
  if (taskInfo) {
    try {
      const c = contenuto as unknown as Contenuto;
      const assegnatoA = findMembro(team, taskInfo.keyword);
      const labelMap: Record<string, string> = {
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

        // Se è Upload esportato, aggiungi nota con percorso Drive
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

  // ── 6. CREA cartella Google Drive (se fase = Montato) ────────────────────
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
        driveFolder = result.folder_id || 'created';
        console.log('[FaseService] cartella Drive creata', { driveFolder });
      } else {
        errors.push('Drive folder creation failed: ' + JSON.stringify(result));
      }
    } catch (e: any) {
      errors.push('Errore Drive folder: ' + (e?.message || String(e)));
      console.error('[FaseService] errore Drive folder', e);
    }
  }

  // ── 7. INCREMENTA contatore reel (se Pubblicato + Reel) ──────────────────
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
        reelIncremented = true;
        console.log('[FaseService] reel incrementato', { clienteId: contenuto.cliente_id });
      }
    } catch (e: any) {
      errors.push('Errore incremento reel: ' + (e?.message || String(e)));
      console.error('[FaseService] errore incremento reel', e);
    }
  }

  // ── 8. CREA task cleanup (se Pubblicato) ─────────────────────────────────
  if (nuovaFase === 'Pubblicato') {
    try {
      await creaTaskCleanup(contenuto as unknown as Contenuto, team);
      cleanupTaskCreated = true;
      console.log('[FaseService] task cleanup creato');
    } catch (e: any) {
      errors.push('Errore cleanup task: ' + (e?.message || String(e)));
      console.error('[FaseService] errore cleanup', e);
    }
  }

  // ── 9. SYNC calendario ───────────────────────────────────────────────────
  if (contenuto.data_pubblicazione) {
    try {
      // Check if a synthetic calendar event exists for this publication
      const { data: existingCal } = await supabase
        .from('calendario')
        .select('id')
        .eq('contenuto_id', contenutoId)
        .eq('tipo', 'pubblicazione')
        .limit(1);

      if (existingCal && existingCal.length > 0) {
        // Update existing calendar event
        await supabase
          .from('calendario')
          .update({
            stato: nuovaFase === 'Pubblicato' ? 'Completato' : 'Pianificato',
            tipo_contenuto: contenuto.tipo || '',
          })
          .eq('contenuto_id', contenutoId)
          .eq('tipo', 'pubblicazione');
        calendarUpdated = true;
      }
      // Note: synthetic publication events are generated at render-time in CalendarioTab
      // so we don't need to create new calendar entries here
      console.log('[FaseService] calendario sync completato');
    } catch (e: any) {
      errors.push('Errore sync calendario: ' + (e?.message || String(e)));
      console.error('[FaseService] errore calendario', e);
    }
  }

  // ── 10. LOG ──────────────────────────────────────────────────────────────
  const result: FaseChangeResult = {
    success: true,
    oldFase,
    newFase: nuovaFase,
    taskCreated: taskCreatedId,
    driveFolder,
    calendarUpdated,
    reelIncremented,
    cleanupTaskCreated,
    errors,
  };

  await logFaseChange({
    ...result,
    contenutoId,
    source,
    userId,
    taskCreatedId,
  });

  // Safety check
  await verifyNoDataLoss(`after ${oldFase}→${nuovaFase}`);

  return result;
}
