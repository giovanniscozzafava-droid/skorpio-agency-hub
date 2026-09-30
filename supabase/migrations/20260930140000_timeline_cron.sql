-- I cron della timeline del lavoro (30/09/2026). pg_cron gira in UTC: ogni job
-- parte alle due ore UTC che corrispondono all'ora di Roma d'estate e d'inverno,
-- e la funzione esegue solo quello che cade all'ora giusta (campo «alle»).
-- La lista delle 8:30 prende il posto del vecchio invio delle 8:00 (lun-sab)
-- di alberto-invio-giornaliero: stesso job, nuovo comando, solo lun-ven.
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'alberto-whatsapp-giornaliero'),
  schedule := '30 6,7 * * 1-5',
  command := $$SELECT motore.chiama('consegne', '{"azione":"giornata","da":"cron","alle":"08:30"}'::jsonb);$$);
SELECT cron.schedule('consegne-sera', '0 16,17 * * 1-5', $$SELECT motore.chiama('consegne', '{"azione":"sera","da":"cron","alle":"18:00"}'::jsonb);$$);
SELECT cron.schedule('consegne-promemoria-timbra', '15 7,8 * * 1-5', $$SELECT motore.chiama('consegne', '{"azione":"promemoria_timbra","da":"cron","alle":"09:15"}'::jsonb);$$);
SELECT cron.schedule('consegne-timbratura-avvio', '30 6,7 1 10 *', $$SELECT motore.chiama('consegne', '{"azione":"timbratura_avvio","da":"cron","alle":"08:30"}'::jsonb);$$);
