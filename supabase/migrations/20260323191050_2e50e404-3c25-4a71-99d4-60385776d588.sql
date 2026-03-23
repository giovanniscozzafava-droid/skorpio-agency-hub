
-- ============================================================
-- 1. TASK → CALENDARIO SYNC
-- Trigger che crea/aggiorna/elimina un evento "appuntamento"
-- nel calendario ogni volta che un task con scadenza cambia.
-- ============================================================

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

DROP TRIGGER IF EXISTS trg_task_to_calendario ON public.task;

CREATE TRIGGER trg_task_to_calendario
AFTER INSERT OR UPDATE OR DELETE ON public.task
FOR EACH ROW
EXECUTE FUNCTION public.sync_task_to_calendario();


-- ============================================================
-- 2. AUTH: collega team a Supabase Auth
-- Aggiunge auth_user_id al team e crea tabella profiles
-- ============================================================

ALTER TABLE public.team
  ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE;

-- Tabella profiles: bridge tra auth.users e team
CREATE TABLE IF NOT EXISTS public.profiles (
  id           uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_user_id uuid NOT NULL UNIQUE,
  team_id      uuid REFERENCES public.team(id) ON DELETE SET NULL,
  created_at   timestamp with time zone DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY "Users insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth_user_id = auth.uid());

-- Funzione per creare profile automaticamente dopo signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (auth_user_id)
  VALUES (NEW.id)
  ON CONFLICT (auth_user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();
