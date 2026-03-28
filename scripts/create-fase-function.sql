-- ============================================================================
-- Stored procedure: cambio_fase_clp
-- Esegue l'intero cambio fase in una singola transazione DB.
-- Da eseguire nel SQL Editor di Supabase/Lovable Cloud.
-- ============================================================================

CREATE OR REPLACE FUNCTION cambio_fase_clp(
  p_contenuto_id UUID,
  p_nuova_fase TEXT,
  p_source TEXT,
  p_user_id TEXT
) RETURNS JSONB AS $$
DECLARE
  v_old_fase TEXT;
  v_contenuto RECORD;
  v_new_task_id UUID;
  v_task_tipo TEXT;
  v_task_assegnato TEXT;
  v_task_emoji TEXT;
  v_task_desc TEXT;
  v_result JSONB;
BEGIN
  -- ── Step 1: Leggi stato attuale ──────────────────────────────────────────
  SELECT * INTO v_contenuto FROM contenuti WHERE id = p_contenuto_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contenuto non trovato');
  END IF;
  v_old_fase := v_contenuto.fase;

  -- ── Step 2: Se stessa fase, no-op ────────────────────────────────────────
  IF v_old_fase = p_nuova_fase THEN
    RETURN jsonb_build_object('success', true, 'changed', false, 'old_fase', v_old_fase, 'new_fase', p_nuova_fase);
  END IF;

  -- ── Step 3: Scrivi nuova fase ────────────────────────────────────────────
  UPDATE contenuti
  SET fase = p_nuova_fase, updated_at = now()
  WHERE id = p_contenuto_id;

  -- ── Step 3b: Scartata → Idea reset revision_count ────────────────────────
  IF v_old_fase = 'Scartata' AND p_nuova_fase = 'Idea' THEN
    UPDATE contenuti SET revision_count = 0 WHERE id = p_contenuto_id;
  END IF;

  -- ── Step 4: Completa task precedente (aperto per questo contenuto) ───────
  UPDATE task
  SET stato = 'Completato', updated_at = now()
  WHERE id_contenuto = p_contenuto_id::text
    AND stato IN ('Da fare', 'In lavorazione', 'In revisione')
    AND tipo IN (
      SELECT unnest(ARRAY[
        CASE v_old_fase
          WHEN 'Script' THEN 'Scrittura script'
          WHEN 'Girato' THEN 'Premontaggio'
          WHEN 'Pre montato' THEN 'Montaggio'
          WHEN 'Montato' THEN 'Upload esportato'
          WHEN 'Uploadato' THEN 'Revisione montaggio'
          WHEN 'Revisionato' THEN 'Programmazione'
          WHEN 'Programmato' THEN 'Programmazione'
          ELSE '__no_match__'
        END
      ])
    );

  -- ── Step 5: Determina task successivo ────────────────────────────────────
  -- Supervisione Giovanni: se fase=Montato e supervisione_giovanni=true
  IF p_nuova_fase = 'Montato' AND v_contenuto.supervisione_giovanni = true THEN
    v_task_tipo := 'Supervisione';
    v_task_assegnato := 'Giovanni';
    v_task_emoji := '👁️';
  ELSE
    v_task_tipo := CASE p_nuova_fase
      WHEN 'Script' THEN 'Scrittura script'
      WHEN 'Girato' THEN 'Premontaggio'
      WHEN 'Pre montato' THEN 'Montaggio'
      WHEN 'Montato' THEN 'Upload esportato'
      WHEN 'Uploadato' THEN 'Revisione montaggio'
      WHEN 'Revisionato' THEN 'Programmazione'
      ELSE NULL
    END;

    v_task_assegnato := CASE v_task_tipo
      WHEN 'Scrittura script' THEN 'Giovanni'
      WHEN 'Premontaggio' THEN 'Luca'
      WHEN 'Montaggio' THEN 'Alessandro'
      WHEN 'Upload esportato' THEN 'Alessandro'
      WHEN 'Revisione montaggio' THEN 'Elisa'
      WHEN 'Programmazione' THEN 'Elisa'
      ELSE NULL
    END;

    v_task_emoji := CASE v_task_tipo
      WHEN 'Scrittura script' THEN '📝'
      WHEN 'Premontaggio' THEN '🎬'
      WHEN 'Montaggio' THEN '✂️'
      WHEN 'Upload esportato' THEN '📤'
      WHEN 'Revisione montaggio' THEN '👁️'
      WHEN 'Programmazione' THEN '📅'
      ELSE ''
    END;
  END IF;

  -- ── Step 6: Crea task se serve (con anti-duplicato) ──────────────────────
  IF v_task_tipo IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM task
      WHERE id_contenuto = p_contenuto_id::text
        AND tipo = v_task_tipo
        AND stato IN ('Da fare', 'In lavorazione', 'In revisione')
    ) THEN
      v_new_task_id := gen_random_uuid();
      v_task_desc := v_task_emoji || ' ' || v_task_tipo || ' ' || v_contenuto.id_display
                     || ' – ' || v_contenuto.titolo
                     || COALESCE(' (' || v_contenuto.cliente_nome || ')', '');

      INSERT INTO task (
        id, tipo, descrizione, id_contenuto, cliente_id, cliente_nome,
        priorita, stato, assegnato_a, assegnato_da,
        created_at, updated_at, posizione
      ) VALUES (
        v_new_task_id, v_task_tipo, v_task_desc, p_contenuto_id::text,
        v_contenuto.cliente_id, v_contenuto.cliente_nome,
        '🟡 Media', 'Da fare', v_task_assegnato, '⚡ Sistema',
        now(), now(), 0
      );
    END IF;
  END IF;

  -- ── Step 7: Incrementa reel se Pubblicato + Reel ────────────────────────
  IF p_nuova_fase = 'Pubblicato' AND v_contenuto.tipo = 'Reel' AND v_contenuto.cliente_id IS NOT NULL THEN
    UPDATE clienti SET reel_fatti = COALESCE(reel_fatti, 0) + 1
    WHERE id = v_contenuto.cliente_id;
  END IF;

  -- ── Step 8: Incrementa revision_count se torna Pre montato da Revisionato
  IF p_nuova_fase = 'Pre montato' AND v_old_fase = 'Revisionato' THEN
    UPDATE contenuti SET revision_count = COALESCE(revision_count, 0) + 1
    WHERE id = p_contenuto_id;
  END IF;

  -- ── Step 9: Log nel _fase_change_log ─────────────────────────────────────
  INSERT INTO _fase_change_log (
    contenuto_id, old_fase, new_fase, source, user_id,
    task_created_id, drive_folder_created, reel_incremented,
    cleanup_created, calendar_updated, created_at
  ) VALUES (
    p_contenuto_id, v_old_fase, p_nuova_fase, p_source, p_user_id,
    v_new_task_id, false,
    (p_nuova_fase = 'Pubblicato' AND v_contenuto.tipo = 'Reel'),
    false, false, now()
  );

  -- ── Return ───────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'success', true,
    'changed', true,
    'old_fase', v_old_fase,
    'new_fase', p_nuova_fase,
    'task_created', v_task_tipo,
    'task_assigned', v_task_assegnato,
    'task_id', v_new_task_id,
    'contenuto', jsonb_build_object(
      'id', v_contenuto.id,
      'titolo', v_contenuto.titolo,
      'tipo', v_contenuto.tipo,
      'cliente_id', v_contenuto.cliente_id,
      'cliente_nome', v_contenuto.cliente_nome,
      'id_display', v_contenuto.id_display,
      'link_drive', v_contenuto.link_drive,
      'data_pubblicazione', v_contenuto.data_pubblicazione,
      'supervisione_giovanni', v_contenuto.supervisione_giovanni
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Verifica: chiama la funzione con un contenuto di test (dry run)
-- ============================================================================
-- SELECT cambio_fase_clp(
--   'un-uuid-di-test'::uuid,
--   'Girato',
--   'test',
--   'test-user'
-- );
