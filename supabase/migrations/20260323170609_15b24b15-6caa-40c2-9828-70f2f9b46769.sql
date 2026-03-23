
-- =====================================================
-- SKORPIO - Schema completo database
-- =====================================================

-- Sequenze per ID display
CREATE SEQUENCE IF NOT EXISTS task_seq START 1;
CREATE SEQUENCE IF NOT EXISTS clp_seq START 1;
CREATE SEQUENCE IF NOT EXISTS cli_seq START 1;

-- Funzione helper per generare ID display
CREATE OR REPLACE FUNCTION generate_display_id(prefix TEXT, seq_name TEXT)
RETURNS TEXT AS $$
DECLARE next_val INTEGER;
BEGIN
  EXECUTE format('SELECT nextval(%L)', seq_name) INTO next_val;
  RETURN prefix || LPAD(next_val::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Funzione update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- =====================================================
-- TEAM
-- =====================================================
CREATE TABLE IF NOT EXISTS public.team (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT UNIQUE NOT NULL,
  label TEXT DEFAULT '',
  colore TEXT DEFAULT '#6B7280',
  ruolo TEXT CHECK (ruolo IN ('Admin', 'Team')) DEFAULT 'Team',
  avatar_url TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.team ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_team" ON public.team FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- CLIENTI
-- =====================================================
CREATE TABLE IF NOT EXISTS public.clienti (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_display TEXT UNIQUE NOT NULL DEFAULT '',
  nome TEXT NOT NULL,
  referente TEXT DEFAULT '',
  email TEXT DEFAULT '',
  telefono TEXT DEFAULT '',
  indirizzo TEXT DEFAULT '',
  p_iva TEXT DEFAULT '',
  codice_fiscale TEXT DEFAULT '',
  settore TEXT DEFAULT 'Estetica',
  stato TEXT CHECK (stato IN ('Attivo', 'Sospeso', 'Chiuso')) DEFAULT 'Attivo',
  pacchetto TEXT CHECK (pacchetto IN ('Tutto', '8 Reel', 'Custom', 'Nessuno')) DEFAULT 'Nessuno',
  reel_quota INTEGER DEFAULT 0,
  reel_fatti INTEGER DEFAULT 0,
  grafiche_quota INTEGER DEFAULT 0,
  grafiche_fatte INTEGER DEFAULT 0,
  stories_attivo BOOLEAN DEFAULT false,
  andromeda_attivo BOOLEAN DEFAULT false,
  sito_web TEXT CHECK (sito_web IN ('No', 'In corso', 'Consegnato')) DEFAULT 'No',
  adv_attivo BOOLEAN DEFAULT false,
  note TEXT DEFAULT '',
  data_inizio DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.clienti ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_clienti" ON public.clienti FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_clienti_updated_at
  BEFORE UPDATE ON public.clienti
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- TASK
-- =====================================================
CREATE TABLE IF NOT EXISTS public.task (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_display TEXT UNIQUE NOT NULL DEFAULT '',
  tipo TEXT DEFAULT '',
  descrizione TEXT NOT NULL,
  id_contenuto TEXT DEFAULT '',
  cliente_id UUID REFERENCES public.clienti(id) ON DELETE SET NULL,
  cliente_nome TEXT DEFAULT '',
  priorita TEXT CHECK (priorita IN ('🔴 Alta', '🟡 Media', '🟢 Bassa')) DEFAULT '🟡 Media',
  stato TEXT CHECK (stato IN ('Da fare', 'In lavorazione', 'In revisione', 'Completato', 'Non accettato', 'Archiviato')) DEFAULT 'Da fare',
  assegnato_a TEXT NOT NULL,
  assegnato_da TEXT DEFAULT '',
  scadenza DATE,
  ora TIME,
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.task ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_task" ON public.task FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_task_updated_at
  BEFORE UPDATE ON public.task
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- CONTENUTI (CLP)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.contenuti (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_display TEXT UNIQUE NOT NULL DEFAULT '',
  titolo TEXT NOT NULL,
  cliente_id UUID REFERENCES public.clienti(id) ON DELETE SET NULL,
  cliente_nome TEXT DEFAULT '',
  tipo TEXT DEFAULT '',
  canale TEXT DEFAULT '',
  fase TEXT CHECK (fase IN ('Idea', 'Script', 'Girato', 'Pre montato', 'Montato', 'Revisione', 'Programmato', 'Pubblicato', 'Scartata')) DEFAULT 'Idea',
  durata TEXT DEFAULT '',
  hook TEXT DEFAULT '',
  script TEXT DEFAULT '',
  cta TEXT DEFAULT '',
  hashtag TEXT DEFAULT '',
  musica TEXT DEFAULT '',
  location TEXT DEFAULT '',
  props TEXT DEFAULT '',
  assegnato_riprese TEXT DEFAULT '',
  assegnato_montaggio TEXT DEFAULT '',
  data_ripresa DATE,
  data_scadenza DATE,
  data_pubblicazione DATE,
  ora_pubblicazione TIME,
  note TEXT DEFAULT '',
  note_revisione TEXT DEFAULT '',
  link_drive TEXT DEFAULT '',
  generato_da_ai BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.contenuti ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_contenuti" ON public.contenuti FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_contenuti_updated_at
  BEFORE UPDATE ON public.contenuti
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- LOG_RIPRESE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.log_riprese (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_clip TEXT NOT NULL,
  contenuto_id UUID REFERENCES public.contenuti(id) ON DELETE SET NULL,
  id_contenuto_display TEXT DEFAULT '',
  cliente_id UUID REFERENCES public.clienti(id) ON DELETE SET NULL,
  cliente_nome TEXT DEFAULT '',
  titolo TEXT DEFAULT '',
  stato TEXT CHECK (stato IN ('Da girare', 'Grezza', 'Buona', 'Scartata', 'Usata')) DEFAULT 'Grezza',
  formato TEXT DEFAULT '',
  operatore TEXT DEFAULT '',
  riga INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.log_riprese ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_riprese" ON public.log_riprese FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_riprese_updated_at
  BEFORE UPDATE ON public.log_riprese
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- CALENDARIO
-- =====================================================
CREATE TABLE IF NOT EXISTS public.calendario (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT CHECK (tipo IN ('pubblicazione', 'appuntamento', 'contenuto', 'slot_pianificato')) NOT NULL,
  descrizione TEXT NOT NULL,
  data DATE NOT NULL,
  ora TIME,
  ora_fine TIME,
  cliente_id UUID REFERENCES public.clienti(id) ON DELETE SET NULL,
  cliente_nome TEXT DEFAULT '',
  contenuto_id UUID REFERENCES public.contenuti(id) ON DELETE SET NULL,
  id_contenuto_display TEXT DEFAULT '',
  canale TEXT DEFAULT '',
  tipo_contenuto TEXT DEFAULT '',
  persona TEXT DEFAULT '',
  stato TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.calendario ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_calendario" ON public.calendario FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- CHAT_MESSAGGI
-- =====================================================
CREATE TABLE IF NOT EXISTS public.chat_messaggi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  da TEXT NOT NULL,
  a TEXT NOT NULL,
  testo TEXT NOT NULL,
  tipo TEXT DEFAULT 'messaggio',
  rif_task TEXT DEFAULT '',
  letto BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.chat_messaggi ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_chat" ON public.chat_messaggi FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- BRAND_RULES
-- =====================================================
CREATE TABLE IF NOT EXISTS public.brand_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID REFERENCES public.clienti(id) ON DELETE CASCADE,
  cliente_nome TEXT NOT NULL,
  identita TEXT DEFAULT '',
  nome_brand TEXT DEFAULT '',
  toni_voce TEXT DEFAULT '',
  formati_preferiti TEXT DEFAULT '',
  servizi_principali TEXT DEFAULT '',
  pubblico_target TEXT DEFAULT '',
  differenziatori TEXT DEFAULT '',
  competitor TEXT DEFAULT '',
  stile_visivo TEXT DEFAULT '',
  hashtag_fissi TEXT DEFAULT '',
  do_list TEXT DEFAULT '',
  dont_list TEXT DEFAULT '',
  territorio TEXT DEFAULT '',
  personaggi TEXT DEFAULT '',
  note TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.brand_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_brand_rules" ON public.brand_rules FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_brand_rules_updated_at
  BEFORE UPDATE ON public.brand_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- CREATIVE_LOG
-- =====================================================
CREATE TABLE IF NOT EXISTS public.creative_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_nome TEXT NOT NULL,
  parametri JSONB DEFAULT '{}',
  risultati JSONB DEFAULT '[]',
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  costo_euro DECIMAL(10,6) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.creative_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_creative_log" ON public.creative_log FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- MARKETING_CALENDAR
-- =====================================================
CREATE TABLE IF NOT EXISTS public.marketing_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data DATE NOT NULL,
  data_fine DATE,
  titolo TEXT NOT NULL,
  categoria TEXT CHECK (categoria IN ('fest', 'gm', 'mkt', 'sport', 'cult')) NOT NULL
);

ALTER TABLE public.marketing_calendar ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_marketing_calendar" ON public.marketing_calendar FOR ALL USING (true) WITH CHECK (true);
