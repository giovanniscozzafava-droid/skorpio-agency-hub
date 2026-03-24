import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Notifica {
  id: string;
  destinatario: string;
  tipo: 'task_assegnato' | 'task_stato' | 'task_scadenza' | 'menzione';
  titolo: string;
  messaggio: string;
  task_id: string | null;
  task_id_display: string | null;
  letto: boolean;
  created_at: string;
}

export function useNotifiche(utenteNome: string | null) {
  const [notifiche, setNotifiche] = useState<Notifica[]>([]);
  const [loading, setLoading] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const carica = useCallback(async () => {
    if (!utenteNome) return;
    setLoading(true);
    const { data } = await supabase
      .from('notifiche')
      .select('*')
      .eq('destinatario', utenteNome)
      .order('created_at', { ascending: false })
      .limit(50);
    setNotifiche((data as Notifica[]) || []);
    setLoading(false);
  }, [utenteNome]);

  // Caricamento iniziale + realtime
  useEffect(() => {
    if (!utenteNome) return;

    carica();

    // Cleanup precedente
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase
      .channel(`notifiche-${utenteNome}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifiche',
          filter: `destinatario=eq.${utenteNome}`,
        },
        (payload) => {
          const nuova = payload.new as Notifica;
          setNotifiche(prev => [nuova, ...prev]);
          // Suono notifica (se non silenziato)
          try {
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
            osc.start();
            osc.stop(ctx.currentTime + 0.3);
          } catch (_) { /* ignore */ }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [utenteNome, carica]);

  const marcaLetta = useCallback(async (id: string) => {
    setNotifiche(prev => prev.map(n => n.id === id ? { ...n, letto: true } : n));
    await supabase.from('notifiche').update({ letto: true }).eq('id', id);
  }, []);

  const marcaTutteLette = useCallback(async () => {
    if (!utenteNome) return;
    setNotifiche(prev => prev.map(n => ({ ...n, letto: true })));
    await supabase.from('notifiche').update({ letto: true })
      .eq('destinatario', utenteNome)
      .eq('letto', false);
  }, [utenteNome]);

  const nonLette = notifiche.filter(n => !n.letto).length;

  return { notifiche, loading, nonLette, marcaLetta, marcaTutteLette };
}
