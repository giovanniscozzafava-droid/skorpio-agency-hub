
-- Inserimento massivo task workflow mancanti con gestione duplicati id_display
-- Usiamo una CTE per generare gli id in modo sicuro

-- Girato → Premontaggio per Luca
INSERT INTO public.task (
  id_display, descrizione, tipo, stato, assegnato_a, assegnato_da,
  cliente_id, cliente_nome, id_contenuto, priorita, scadenza
)
SELECT
  generate_display_id('TSK', 'task_seq'),
  '🎬 Premontaggia ' || c.id_display || ' – ' || LEFT(c.titolo, 60) || CASE WHEN COALESCE(c.cliente_nome,'') <> '' THEN ' (' || c.cliente_nome || ')' ELSE '' END,
  'Premontaggio', 'Da fare', 'Luca', 'Sistema',
  c.cliente_id, COALESCE(c.cliente_nome, ''), c.id,
  CASE WHEN c.data_pubblicazione IS NOT NULL THEN '🔴 Alta' ELSE '🟡 Media' END,
  c.data_pubblicazione
FROM public.contenuti c
WHERE c.fase = 'Girato'
  AND NOT EXISTS (
    SELECT 1 FROM public.task t
    WHERE t.id_contenuto = c.id::text AND t.tipo = 'Premontaggio'
      AND t.stato NOT IN ('Completato','Archiviato')
  )
ON CONFLICT (id_display) DO NOTHING;

-- Pre montato → Montaggio per Alessandro
INSERT INTO public.task (
  id_display, descrizione, tipo, stato, assegnato_a, assegnato_da,
  cliente_id, cliente_nome, id_contenuto, priorita, scadenza
)
SELECT
  generate_display_id('TSK', 'task_seq'),
  '✂️ Monta ' || c.id_display || ' – ' || LEFT(c.titolo, 60) || CASE WHEN COALESCE(c.cliente_nome,'') <> '' THEN ' (' || c.cliente_nome || ')' ELSE '' END,
  'Montaggio', 'Da fare', 'Alessandro', 'Sistema',
  c.cliente_id, COALESCE(c.cliente_nome, ''), c.id,
  CASE WHEN c.data_pubblicazione IS NOT NULL THEN '🔴 Alta' ELSE '🟡 Media' END,
  c.data_pubblicazione
FROM public.contenuti c
WHERE c.fase = 'Pre montato'
  AND NOT EXISTS (
    SELECT 1 FROM public.task t
    WHERE t.id_contenuto = c.id::text AND t.tipo = 'Montaggio'
      AND t.stato NOT IN ('Completato','Archiviato')
  )
ON CONFLICT (id_display) DO NOTHING;

-- Montato → Revisione montaggio per Elisa
INSERT INTO public.task (
  id_display, descrizione, tipo, stato, assegnato_a, assegnato_da,
  cliente_id, cliente_nome, id_contenuto, priorita, scadenza
)
SELECT
  generate_display_id('TSK', 'task_seq'),
  '🔍 Revisiona ' || c.id_display || ' – ' || LEFT(c.titolo, 60) || CASE WHEN COALESCE(c.cliente_nome,'') <> '' THEN ' (' || c.cliente_nome || ')' ELSE '' END,
  'Revisione montaggio', 'Da fare', 'Elisa', 'Sistema',
  c.cliente_id, COALESCE(c.cliente_nome, ''), c.id,
  CASE WHEN c.data_pubblicazione IS NOT NULL THEN '🔴 Alta' ELSE '🟡 Media' END,
  c.data_pubblicazione
FROM public.contenuti c
WHERE c.fase = 'Montato'
  AND NOT EXISTS (
    SELECT 1 FROM public.task t
    WHERE t.id_contenuto = c.id::text AND t.tipo = 'Revisione montaggio'
      AND t.stato NOT IN ('Completato','Archiviato')
  )
ON CONFLICT (id_display) DO NOTHING;

-- Revisione → Pubblicazione per Elisa
INSERT INTO public.task (
  id_display, descrizione, tipo, stato, assegnato_a, assegnato_da,
  cliente_id, cliente_nome, id_contenuto, priorita, scadenza
)
SELECT
  generate_display_id('TSK', 'task_seq'),
  '📱 Programma/pubblica ' || c.id_display || ' – ' || LEFT(c.titolo, 60) || CASE WHEN COALESCE(c.cliente_nome,'') <> '' THEN ' (' || c.cliente_nome || ')' ELSE '' END,
  'Pubblicazione', 'Da fare', 'Elisa', 'Sistema',
  c.cliente_id, COALESCE(c.cliente_nome, ''), c.id,
  CASE WHEN c.data_pubblicazione IS NOT NULL THEN '🔴 Alta' ELSE '🟡 Media' END,
  c.data_pubblicazione
FROM public.contenuti c
WHERE c.fase = 'Revisione'
  AND NOT EXISTS (
    SELECT 1 FROM public.task t
    WHERE t.id_contenuto = c.id::text AND t.tipo = 'Pubblicazione'
      AND t.stato NOT IN ('Completato','Archiviato')
  )
ON CONFLICT (id_display) DO NOTHING;
