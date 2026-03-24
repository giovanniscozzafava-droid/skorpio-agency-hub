export type TeamMember = {
  id: string;
  nome: string;
  label: string;
  colore: string;
  ruolo: 'Admin' | 'Team';
  avatar_url: string;
  auth_user_id?: string | null;
  created_at: string;
};

export type Cliente = {
  id: string;
  id_display: string;
  nome: string;
  referente: string;
  email: string;
  telefono: string;
  indirizzo: string;
  p_iva: string;
  codice_fiscale: string;
  settore: string;
  stato: 'Attivo' | 'Sospeso' | 'Chiuso';
  pacchetto: 'Tutto' | '8 Reel' | 'Custom' | 'Nessuno';
  reel_quota: number;
  reel_fatti: number;
  grafiche_quota: number;
  grafiche_fatte: number;
  stories_attivo: boolean;
  andromeda_attivo: boolean;
  sito_web: 'No' | 'In corso' | 'Consegnato';
  adv_attivo: boolean;
  note: string;
  link_drive: string;
  data_inizio: string | null;
  created_at: string;
  updated_at: string;
};

export type Task = {
  id: string;
  id_display: string;
  tipo: string;
  descrizione: string;
  id_contenuto: string;
  cliente_id: string | null;
  cliente_nome: string;
  priorita: '🔴 Alta' | '🟡 Media' | '🟢 Bassa';
  stato: 'Da fare' | 'In lavorazione' | 'In revisione' | 'Completato' | 'Non accettato' | 'Archiviato';
  assegnato_a: string;
  assegnato_da: string;
  scadenza: string | null;
  ora: string | null;
  note: string;
  created_at: string;
  updated_at: string;
};

export type FaseCLP = 'Idea' | 'Script' | 'Girato' | 'Pre montato' | 'Montato' | 'Revisionato' | 'Programmato' | 'Pubblicato' | 'Scartata';

export type Contenuto = {
  id: string;
  id_display: string;
  titolo: string;
  cliente_id: string | null;
  cliente_nome: string;
  tipo: string;
  canale: string;
  fase: FaseCLP;
  durata: string;
  hook: string;
  script: string;
  cta: string;
  hashtag: string;
  musica: string;
  location: string;
  props: string;
  assegnato_riprese: string;
  assegnato_montaggio: string;
  data_ripresa: string | null;
  data_scadenza: string | null;
  data_pubblicazione: string | null;
  ora_pubblicazione: string | null;
  note: string;
  note_revisione: string;
  link_drive: string;
  generato_da_ai: boolean;
  created_at: string;
  updated_at: string;
};

export type LogRipresa = {
  id: string;
  id_clip: string;
  contenuto_id: string | null;
  id_contenuto_display: string;
  cliente_id: string | null;
  cliente_nome: string;
  titolo: string;
  stato: 'Da girare' | 'Grezza' | 'Buona' | 'Scartata' | 'Usata';
  formato: string;
  operatore: string;
  riga: number | null;
  created_at: string;
  updated_at: string;
};

export type CalendarioEvent = {
  id: string;
  tipo: 'pubblicazione' | 'appuntamento' | 'contenuto' | 'slot_pianificato';
  descrizione: string;
  data: string;
  ora: string | null;
  ora_fine: string | null;
  cliente_id: string | null;
  cliente_nome: string;
  contenuto_id: string | null;
  id_contenuto_display: string;
  canale: string;
  tipo_contenuto: string;
  persona: string;
  stato: string;
  created_at: string;
};

export type ChatMessaggio = {
  id: string;
  da: string;
  a: string;
  testo: string;
  tipo: 'messaggio' | 'task-ref';
  rif_task: string;
  letto: boolean;
  created_at: string;
};

export type BrandRule = {
  id: string;
  cliente_id: string | null;
  cliente_nome: string;
  identita: string;
  nome_brand: string;
  toni_voce: string;
  formati_preferiti: string;
  servizi_principali: string;
  pubblico_target: string;
  differenziatori: string;
  competitor: string;
  stile_visivo: string;
  hashtag_fissi: string;
  do_list: string;
  dont_list: string;
  territorio: string;
  personaggi: string;
  note: string;
  updated_at: string;
};

export type MarketingEvent = {
  id: string;
  data: string;
  data_fine: string | null;
  titolo: string;
  categoria: 'fest' | 'gm' | 'mkt' | 'sport' | 'cult';
};

export type ContenutoGenerato = {
  titolo: string;
  formato: string;
  tono: string;
  hook: string;
  script: string;
  cta: string;
  hashtag: string[];
  note_produzione: string;
};
