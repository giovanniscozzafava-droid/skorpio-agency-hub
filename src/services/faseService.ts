/**
 * FaseService — Centralised CLP phase-change logic.
 *
 * V2: usa la stored procedure `cambio_fase_clp` per eseguire
 * tutto il cambio fase in una singola query DB (1 roundtrip).
 * I side effects non critici (Drive, calendario, cleanup) restano
 * fire-and-forget lato client.
 */
import { supabase } from '../lib/supabase';
import type { Contenuto, FaseCLP, TeamMember } from '../types';
import { isTransitionValid } from '../config/faseConfig';
import { creaTaskCleanup } from '../lib/clpWorkflow';

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

// [OLD - replaced by stored procedure]
// async function logFaseChange(...) { ... }
// async function verifyNoDataLoss(...) { ... }

// ── Main function (V2 — stored procedure) ─────────────────────────────────────

export async function cambiaFaseCLP(params: CambiaFaseParams): Promise<FaseChangeResult> {
  const { contenutoId, nuovaFase, source, userId } = params;
  const errors: string[] = [];

  console.time('[FaseService] total');
  console.log('[FaseService] cambiaFaseCLP V2 (stored procedure)', { contenutoId, nuovaFase, source, userId });

  // ── 1. VALIDA la transizione lato client (fail-fast senza roundtrip) ────
  // Serve un fetch veloce della fase corrente per la validazione client-side
  console.time('[FaseService] validate');
  const { data: currentRow, error: fetchErr } = await supabase
    .from('contenuti')
    .select('fase')
    .eq('id', contenutoId)
    .single();
  console.timeEnd('[FaseService] validate');

  if (fetchErr || !currentRow) {
    return {
      success: false, oldFase: '', newFase: nuovaFase,
      errors: ['Contenuto non trovato: ' + (fetchErr?.message || contenutoId)],
    };
  }

  const oldFase = currentRow.fase as string;

  if (oldFase === nuovaFase) {
    return { success: true, oldFase, newFase: nuovaFase, errors: [] };
  }

  if (!isTransitionValid(oldFase, nuovaFase)) {
    return {
      success: false, oldFase, newFase: nuovaFase,
      errors: [`Transizione non permessa: ${oldFase} → ${nuovaFase}`],
    };
  }

  // ── 2. CHIAMATA STORED PROCEDURE — 1 solo roundtrip DB ─────────────────
  console.time('[FaseService] rpc');
  const { data: rpcResult, error: rpcError } = await supabase.rpc('cambio_fase_clp', {
    p_contenuto_id: contenutoId,
    p_nuova_fase: nuovaFase,
    p_source: source,
    p_user_id: userId,
  });
  console.timeEnd('[FaseService] rpc');

  if (rpcError) {
    console.error('[FaseService] RPC error:', rpcError);
    return {
      success: false, oldFase, newFase: nuovaFase,
      errors: ['Errore stored procedure: ' + rpcError.message],
    };
  }

  if (!rpcResult?.success) {
    console.error('[FaseService] RPC returned failure:', rpcResult);
    return {
      success: false, oldFase, newFase: nuovaFase,
      errors: [rpcResult?.error || 'Errore sconosciuto dalla stored procedure'],
    };
  }

  console.log('[FaseService] RPC success:', rpcResult);

  // ── 3. SIDE EFFECTS ASINCRONI — fire and forget ────────────────────────
  // La stored procedure ha già fatto: update fase, completamento task,
  // creazione nuovo task, reel increment, revision_count, log.
  // Restano solo: Drive folder, cleanup task, calendario sync.
  const contenuto = rpcResult.contenuto;

  const asyncSideEffects = async () => {
    try {
      // ── Drive folder (se fase = Montato e non ha già link_drive) ───────
      if (nuovaFase === 'Montato' && !contenuto?.link_drive) {
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

      // ── Cleanup task (se Pubblicato) ───────────────────────────────────
      if (nuovaFase === 'Pubblicato') {
        try {
          const team = await getTeam();
          await creaTaskCleanup(contenuto as unknown as Contenuto, team);
          console.log('[FaseService][async] task cleanup creato');
        } catch (e) {
          console.error('[FaseService][async] errore cleanup task:', e);
        }
      }

      // ── Calendario sync ────────────────────────────────────────────────
      if (contenuto?.data_pubblicazione) {
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

      // ── Upload esportato: aggiungi nota Drive al task ──────────────────
      if (rpcResult.task_created === 'Upload esportato' && rpcResult.task_id) {
        try {
          const slug = (contenuto.titolo || '').replace(/\s+/g, '-').slice(0, 40);
          const folderPath = `SKORPIO_Clip/${contenuto.cliente_nome}/${contenuto.id_display}_${slug}/file_esportato/`;
          const driveNote = contenuto.link_drive
            ? `📂 Carica il file esportato nella cartella "file_esportato/" su Google Drive:\n${contenuto.link_drive}\n\nPercorso: ${folderPath}`
            : `📂 Carica il file esportato nella sezione Riprese del CLP ${contenuto.id_display}, zona "File esportato".\n\nPercorso Drive: ${folderPath}`;
          await supabase.from('task').update({ note: driveNote }).eq('id', rpcResult.task_id);
          console.log('[FaseService][async] nota Drive aggiunta al task Upload');
        } catch (e) {
          console.error('[FaseService][async] errore nota Drive:', e);
        }
      }
    } catch (e) {
      console.error('[FaseService][async] side effect non gestito:', e);
    }
  };

  // Fire and forget — non blocca il return
  console.time('[FaseService] async-side-effects');
  asyncSideEffects().finally(() => console.timeEnd('[FaseService] async-side-effects'));

  console.timeEnd('[FaseService] total');
  // ── 4. RETURN ──────────────────────────────────────────────────────────
  return {
    success: true,
    oldFase: rpcResult.old_fase,
    newFase: rpcResult.new_fase,
    taskCreated: rpcResult.task_created || undefined,
    driveFolder: undefined,
    calendarUpdated: false,
    reelIncremented: !!rpcResult.task_created, // la SP lo fa
    cleanupTaskCreated: false,
    errors,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// [OLD - replaced by stored procedure]
// Il codice originale faceva 5-6 query sequenziali:
//   1. SELECT contenuto
//   2. UPDATE contenuti SET fase
//   3. UPDATE task SET stato='Completato'
//   4. SELECT team
//   5. INSERT task (nuovo)
//   6. INSERT _fase_change_log
// Ora tutto questo è in cambio_fase_clp() — 1 roundtrip.
// ══════════════════════════════════════════════════════════════════════════════
