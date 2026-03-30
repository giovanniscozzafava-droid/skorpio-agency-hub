-- FIX: Il trigger sync_task_to_calendario deve ignorare i task archiviati.
-- Prima il trigger scattava su OGNI update, anche sui task archiviati,
-- causando aggiornamenti in calendario che triggeravano eventi realtime
-- e facevano riapparire i task archiviati nella Kanban.

CREATE OR REPLACE FUNCTION public.sync_task_to_calendario()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _tipi_appuntamento TEXT[] := ARRAY['Call','Briefing','Sopralluogo','Riprese','Shooting'];
BEGIN
  -- DELETE: rimuovi evento calendario se esiste
  IF (TG_OP = 'DELETE') THEN
    DELETE FROM public.calendario WHERE contenuto_id IS NULL AND descrizione LIKE '%[TASK:' || OLD.id || ']%';
    RETURN OLD;
  END IF;

  -- ── FIX: se il task è Archiviato, rimuovi l'evento calendario e non fare nulla ──
  IF NEW.stato = 'Archiviato' THEN
    DELETE FROM public.calendario WHERE descrizione LIKE '%[TASK:' || NEW.id || ']%';
    RETURN NEW;
  END IF;

  -- Se non ha scadenza, non creare evento
  IF NEW.scadenza IS NULL THEN
    -- Elimina eventuali precedenti se la scadenza è stata rimossa
    DELETE FROM public.calendario WHERE descrizione LIKE '%[TASK:' || NEW.id || ']%';
    RETURN NEW;
  END IF;

  -- UPSERT: se esiste già un evento per questo task, aggiornalo; altrimenti inseriscilo
  IF EXISTS (SELECT 1 FROM public.calendario WHERE descrizione LIKE '%[TASK:' || NEW.id || ']%') THEN
    UPDATE public.calendario
    SET
      data         = NEW.scadenza,
      ora          = NEW.ora,
      descrizione  = NEW.descrizione || ' [TASK:' || NEW.id || ']',
      cliente_id   = NEW.cliente_id,
      cliente_nome = COALESCE(NEW.cliente_nome, ''),
      persona      = NEW.assegnato_a,
      stato        = CASE WHEN NEW.stato = 'Completato' THEN 'Completato' ELSE 'Pianificato' END,
      tipo_contenuto = COALESCE(NEW.tipo, '')
    WHERE descrizione LIKE '%[TASK:' || NEW.id || ']%';
  ELSE
    INSERT INTO public.calendario (
      tipo, data, ora, descrizione,
      cliente_id, cliente_nome,
      id_contenuto_display, persona, stato, tipo_contenuto
    ) VALUES (
      'appuntamento',
      NEW.scadenza,
      NEW.ora,
      NEW.descrizione || ' [TASK:' || NEW.id || ']',
      NEW.cliente_id,
      COALESCE(NEW.cliente_nome, ''),
      COALESCE(NEW.id_display, ''),
      NEW.assegnato_a,
      CASE WHEN NEW.stato = 'Completato' THEN 'Completato' ELSE 'Pianificato' END,
      COALESCE(NEW.tipo, '')
    );
  END IF;

  RETURN NEW;
END;
$$;
