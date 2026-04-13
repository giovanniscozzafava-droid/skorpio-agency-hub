/**
 * FaseService — Centralised CLP phase-change logic.
 *
 * V3: 1 solo roundtrip DB.
 * - Validazione client-side con oldFase passato dal chiamante (no SELECT)
 * - Stored procedure fa tutto (update, task, log, reel)
 * - Nessun re-fetch dopo RPC (optimistic update lato UI)
 * - Side effects asincroni fire-and-forget
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
  taskAssigned?: string;
  driveFolder?: string;
  calendarUpdated?: boolean;
  reelIncremented?: boolean;
  cleanupTaskCreated?: boolean;
  /** Dati contenuto dalla SP — usabili per optimistic update */
  contenuto?: Record<string, unknown>;
  errors: string[];
}

export interface CambiaFaseParams {
  contenutoId: string;
  nuovaFase: string;
  source: 'kanban' | 'contenuti' | 'riprese' | 'workflow';
  userId: string;
  /** Fase corrente dal local state — evita 1 SELECT */
  oldFase?: string;
  taskIdCompletato?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getTeam(): Promise<TeamMember[]> {
  const { data } = await supabase.from('team').select('*');
  return (data || []) as TeamMember[];
}

// ── Main function (V3 — 1 solo roundtrip) ───────────────────────────────────

export async function cambiaFaseCLP(params: CambiaFaseParams): Promise<FaseChangeResult> {
  const { contenutoId, nuovaFase, source, userId, oldFase } = params;
  const errors: string[] = [];

  console.time('[FaseService] total');
  console.log('[FaseService] cambiaFaseCLP V3 (1 roundtrip)', { contenutoId, nuovaFase, source, userId, oldFase });

  // ── 1. VALIDAZIONE CLIENT-SIDE (0 roundtrip) ─────────────────────────────
  // Se il chiamante passa oldFase (dal local state), validiamo senza query.
  // Se non la passa, la SP farà comunque il check same-fase e validazione.
  if (oldFase) {
    if (oldFase === nuovaFase) {
      console.timeEnd('[FaseService] total');
      return { success: true, oldFase, newFase: nuovaFase, errors: [] };
    }

    if (!isTransitionValid(oldFase, nuovaFase)) {
      console.timeEnd('[FaseService] total');
      return {
        success: false, oldFase, newFase: nuovaFase,
        errors: [`Transizione non permessa: ${oldFase} → ${nuovaFase}`],
      };
    }
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
    console.timeEnd('[FaseService] total');
    return {
      success: false, oldFase: oldFase || '', newFase: nuovaFase,
      errors: ['Errore stored procedure: ' + rpcError.message],
    };
  }

  if (!rpcResult?.success) {
    console.error('[FaseService] RPC returned failure:', rpcResult);
    console.timeEnd('[FaseService] total');
    return {
      success: false, oldFase: oldFase || '', newFase: nuovaFase,
      errors: [rpcResult?.error || 'Errore sconosciuto dalla stored procedure'],
    };
  }

  // SP ha anche un no-op per same-fase (changed=false)
  if (rpcResult.changed === false) {
    console.log('[FaseService] No-op: fase già uguale');
    console.timeEnd('[FaseService] total');
    return { success: true, oldFase: rpcResult.old_fase, newFase: rpcResult.new_fase, errors: [] };
  }

  console.log('[FaseService] RPC success:', rpcResult);

  // ── 3. SIDE EFFECTS ASINCRONI — fire and forget ────────────────────────
  const contenuto = rpcResult.contenuto;

  const asyncSideEffects = async () => {
    try {
      // ── Drive folder (se fase = Montato e non ha già link_drive) ───────
      if (nuovaFase === 'Montato' && contenuto?.id && !contenuto?.link_drive) {
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
  asyncSideEffects().catch(e => console.error('[FaseService][async] unhandled:', e));

  // ── Riassegnazione montatore — SINCRONO (deve completare prima del return) ──
  const MONTAGGIO_TASKS = ['Premontaggio', 'Montaggio', 'Upload esportato'];
  if (rpcResult.task_id && MONTAGGIO_TASKS.includes(rpcResult.task_created)) {
    try {
      const { data: clpData } = await supabase
        .from('contenuti')
        .select('assegnato_montaggio')
        .eq('id', contenutoId)
        .single();
      const montatore = clpData?.assegnato_montaggio;
      if (montatore) {
        await supabase.from('task').update({ assegnato_a: montatore }).eq('id', rpcResult.task_id);
        console.log(`[FaseService] task ${rpcResult.task_created} riassegnato a ${montatore} (assegnato_montaggio)`);
      }
    } catch (e) {
      console.error('[FaseService] errore riassegnazione montatore:', e);
    }
  }

  console.timeEnd('[FaseService] total');

  // ── 4. RETURN ──────────────────────────────────────────────────────────
  return {
    success: true,
    oldFase: rpcResult.old_fase,
    newFase: rpcResult.new_fase,
    taskCreated: rpcResult.task_created || undefined,
    taskAssigned: rpcResult.task_assigned || undefined,
    driveFolder: undefined,
    calendarUpdated: false,
    reelIncremented: (nuovaFase === 'Pubblicato' && contenuto?.tipo === 'Reel'),
    cleanupTaskCreated: false,
    contenuto: contenuto || undefined,
    errors,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// CHANGELOG:
// V1: 5-6 query sequenziali (SELECT, UPDATE, UPDATE task, SELECT team, INSERT task, INSERT log)
// V2: 1 RPC + 1 SELECT pre-validazione + 1 SELECT post-refresh = 3 roundtrip
// V3: 1 RPC. Validazione client-side con oldFase. Optimistic update lato UI.
// ══════════════════════════════════════════════════════════════════════════════
