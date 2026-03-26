// ─── google-drive-upload-confirm ─────────────────────────────────────────────
// Chiamata dal frontend dopo che l'upload chunked è completato.
// Salva i metadati del file (fileId, fileUrl, fileName, fileSize, ecc.)
// nel record log_riprese corrispondente.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const {
      clipId,       // UUID della riga in log_riprese
      zone,         // 'clip' | 'file_esportato'
      fileId,       // Google Drive file ID
      fileName,
      fileSize,
      mimeType,
      rawFilesCount,  // per zona clip: conteggio aggiornato
      rawFilesSize,   // per zona clip: dimensione totale aggiornata
    } = await req.json();

    if (!clipId || !zone || !fileId || !fileName) {
      return new Response(
        JSON.stringify({ error: 'Parametri mancanti: clipId, zone, fileId, fileName' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const fileUrl  = `https://drive.google.com/file/d/${fileId}/view`;
    const now      = new Date().toISOString();

    let patch: Record<string, unknown>;

    if (zone === 'clip') {
      patch = {
        file_id:          fileId,
        file_url:         fileUrl,
        file_name:        fileName,
        file_size:        fileSize ?? null,
        file_mime_type:   mimeType ?? null,
        file_uploaded_at: now,
        file_deleted_at:  null,
        raw_files_count:  rawFilesCount ?? 1,
        raw_files_size:   rawFilesSize  ?? fileSize ?? 0,
        updated_at:       now,
      };
    } else {
      patch = {
        exported_file_id:          fileId,
        exported_file_url:         fileUrl,
        exported_file_name:        fileName,
        exported_file_size:        fileSize ?? null,
        exported_file_mime_type:   mimeType ?? null,
        exported_file_uploaded_at: now,
        updated_at:                now,
      };
    }

    const { error } = await supabase
      .from('log_riprese')
      .update(patch)
      .eq('id', clipId);

    if (error) throw new Error(`DB update failed: ${error.message}`);

    return new Response(
      JSON.stringify({ ok: true, fileUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Errore sconosciuto';
    console.error('[google-drive-upload-confirm]', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
