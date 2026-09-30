-- consegne_invii registra anche gli invii della timeline del lavoro (30/09/2026).
-- Prima accettava solo «settimana» e «rossa», una volta per settimana e persona:
-- i nuovi tipi venivano rifiutati in silenzio e il «già mandata» delle 8:30 non
-- avrebbe funzionato. L'unicità resta solo per gli invii periodici; i messaggi
-- per lavoro (nuovo, spostato, da smistare) possono essere più d'uno al giorno.
ALTER TABLE public.consegne_invii DROP CONSTRAINT IF EXISTS consegne_invii_tipo_check;
ALTER TABLE public.consegne_invii ADD CONSTRAINT consegne_invii_tipo_check CHECK (tipo = ANY (ARRAY[
  'settimana', 'rossa', 'giornata', 'sera', 'promemoria_timbra', 'timbratura_avvio',
  'lavoro_nuovo', 'lavoro_spostato', 'smistamento']));
ALTER TABLE public.consegne_invii DROP CONSTRAINT IF EXISTS consegne_invii_settimana_persona_tipo_key;
CREATE UNIQUE INDEX IF NOT EXISTS consegne_invii_periodici_uniq ON public.consegne_invii (settimana, persona, tipo)
  WHERE tipo IN ('settimana', 'rossa', 'giornata', 'sera', 'promemoria_timbra', 'timbratura_avvio');
