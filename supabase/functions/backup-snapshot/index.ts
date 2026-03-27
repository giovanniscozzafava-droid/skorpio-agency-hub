import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const tables = ['contenuti', 'task', 'calendario', 'log_riprese', 'clienti'];
    const counts: Record<string, number> = {};

    for (const table of tables) {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        console.error(`[backup-snapshot] Error counting ${table}:`, error);
        counts[table] = -1;
      } else {
        counts[table] = count ?? 0;
      }
    }

    // Task breakdown by stato
    const taskBreakdown: Record<string, number> = {};
    const { data: taskData, error: taskError } = await supabase
      .from('task')
      .select('stato');
    
    if (!taskError && taskData) {
      for (const row of taskData) {
        const stato = row.stato || '(nessuno stato)';
        taskBreakdown[stato] = (taskBreakdown[stato] || 0) + 1;
      }
    }

    // Contenuti breakdown by fase
    const contenutoBreakdown: Record<string, number> = {};
    const { data: contData, error: contError } = await supabase
      .from('contenuti')
      .select('fase');
    
    if (!contError && contData) {
      for (const row of contData) {
        const fase = row.fase || '(nessuna fase)';
        contenutoBreakdown[fase] = (contenutoBreakdown[fase] || 0) + 1;
      }
    }

    // Parse optional note from body
    let note = '';
    try {
      const body = await req.json();
      note = body?.note || '';
    } catch { /* no body */ }

    // Save to _backup_counts
    const inserts = Object.entries(counts).map(([tabella, record_count]) => ({
      tabella,
      record_count,
      note: note || `Snapshot ${new Date().toISOString()}`,
    }));

    const { error: insertError } = await supabase
      .from('_backup_counts')
      .insert(inserts);

    if (insertError) {
      console.error('[backup-snapshot] Insert error:', insertError);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      counts,
      breakdowns: {
        task: taskBreakdown,
        contenuti: contenutoBreakdown,
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[backup-snapshot] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
