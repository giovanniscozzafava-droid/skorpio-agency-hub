export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      brand_rules: {
        Row: {
          cliente_id: string | null
          cliente_nome: string
          competitor: string | null
          differenziatori: string | null
          do_list: string | null
          dont_list: string | null
          formati_preferiti: string | null
          hashtag_fissi: string | null
          id: string
          identita: string | null
          nome_brand: string | null
          note: string | null
          personaggi: string | null
          pubblico_target: string | null
          servizi_principali: string | null
          stile_visivo: string | null
          territorio: string | null
          toni_voce: string | null
          updated_at: string | null
        }
        Insert: {
          cliente_id?: string | null
          cliente_nome: string
          competitor?: string | null
          differenziatori?: string | null
          do_list?: string | null
          dont_list?: string | null
          formati_preferiti?: string | null
          hashtag_fissi?: string | null
          id?: string
          identita?: string | null
          nome_brand?: string | null
          note?: string | null
          personaggi?: string | null
          pubblico_target?: string | null
          servizi_principali?: string | null
          stile_visivo?: string | null
          territorio?: string | null
          toni_voce?: string | null
          updated_at?: string | null
        }
        Update: {
          cliente_id?: string | null
          cliente_nome?: string
          competitor?: string | null
          differenziatori?: string | null
          do_list?: string | null
          dont_list?: string | null
          formati_preferiti?: string | null
          hashtag_fissi?: string | null
          id?: string
          identita?: string | null
          nome_brand?: string | null
          note?: string | null
          personaggi?: string | null
          pubblico_target?: string | null
          servizi_principali?: string | null
          stile_visivo?: string | null
          territorio?: string | null
          toni_voce?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_rules_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clienti"
            referencedColumns: ["id"]
          },
        ]
      }
      calendario: {
        Row: {
          canale: string | null
          cliente_id: string | null
          cliente_nome: string | null
          contenuto_id: string | null
          created_at: string | null
          data: string
          descrizione: string
          id: string
          id_contenuto_display: string | null
          ora: string | null
          ora_fine: string | null
          persona: string | null
          stato: string | null
          tipo: string
          tipo_contenuto: string | null
        }
        Insert: {
          canale?: string | null
          cliente_id?: string | null
          cliente_nome?: string | null
          contenuto_id?: string | null
          created_at?: string | null
          data: string
          descrizione: string
          id?: string
          id_contenuto_display?: string | null
          ora?: string | null
          ora_fine?: string | null
          persona?: string | null
          stato?: string | null
          tipo: string
          tipo_contenuto?: string | null
        }
        Update: {
          canale?: string | null
          cliente_id?: string | null
          cliente_nome?: string | null
          contenuto_id?: string | null
          created_at?: string | null
          data?: string
          descrizione?: string
          id?: string
          id_contenuto_display?: string | null
          ora?: string | null
          ora_fine?: string | null
          persona?: string | null
          stato?: string | null
          tipo?: string
          tipo_contenuto?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendario_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clienti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendario_contenuto_id_fkey"
            columns: ["contenuto_id"]
            isOneToOne: false
            referencedRelation: "contenuti"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messaggi: {
        Row: {
          a: string
          created_at: string | null
          da: string
          id: string
          letto: boolean | null
          rif_task: string | null
          testo: string
          tipo: string | null
        }
        Insert: {
          a: string
          created_at?: string | null
          da: string
          id?: string
          letto?: boolean | null
          rif_task?: string | null
          testo: string
          tipo?: string | null
        }
        Update: {
          a?: string
          created_at?: string | null
          da?: string
          id?: string
          letto?: boolean | null
          rif_task?: string | null
          testo?: string
          tipo?: string | null
        }
        Relationships: []
      }
      chat_reactions: {
        Row: {
          autore: string
          created_at: string | null
          emoji: string
          id: string
          msg_id: string
        }
        Insert: {
          autore: string
          created_at?: string | null
          emoji: string
          id?: string
          msg_id: string
        }
        Update: {
          autore?: string
          created_at?: string | null
          emoji?: string
          id?: string
          msg_id?: string
        }
        Relationships: []
      }
      clienti: {
        Row: {
          adv_attivo: boolean | null
          andromeda_attivo: boolean | null
          codice_fiscale: string | null
          created_at: string | null
          data_inizio: string | null
          email: string | null
          grafiche_fatte: number | null
          grafiche_quota: number | null
          id: string
          id_display: string
          indirizzo: string | null
          link_drive: string | null
          nome: string
          note: string | null
          p_iva: string | null
          pacchetto: string | null
          reel_fatti: number | null
          reel_quota: number | null
          referente: string | null
          settore: string | null
          sito_web: string | null
          stato: string | null
          stories_attivo: boolean | null
          telefono: string | null
          updated_at: string | null
        }
        Insert: {
          adv_attivo?: boolean | null
          andromeda_attivo?: boolean | null
          codice_fiscale?: string | null
          created_at?: string | null
          data_inizio?: string | null
          email?: string | null
          grafiche_fatte?: number | null
          grafiche_quota?: number | null
          id?: string
          id_display?: string
          indirizzo?: string | null
          link_drive?: string | null
          nome: string
          note?: string | null
          p_iva?: string | null
          pacchetto?: string | null
          reel_fatti?: number | null
          reel_quota?: number | null
          referente?: string | null
          settore?: string | null
          sito_web?: string | null
          stato?: string | null
          stories_attivo?: boolean | null
          telefono?: string | null
          updated_at?: string | null
        }
        Update: {
          adv_attivo?: boolean | null
          andromeda_attivo?: boolean | null
          codice_fiscale?: string | null
          created_at?: string | null
          data_inizio?: string | null
          email?: string | null
          grafiche_fatte?: number | null
          grafiche_quota?: number | null
          id?: string
          id_display?: string
          indirizzo?: string | null
          link_drive?: string | null
          nome?: string
          note?: string | null
          p_iva?: string | null
          pacchetto?: string | null
          reel_fatti?: number | null
          reel_quota?: number | null
          referente?: string | null
          settore?: string | null
          sito_web?: string | null
          stato?: string | null
          stories_attivo?: boolean | null
          telefono?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      contenuti: {
        Row: {
          assegnato_montaggio: string | null
          assegnato_riprese: string | null
          canale: string | null
          cliente_id: string | null
          cliente_nome: string | null
          created_at: string | null
          cta: string | null
          data_pubblicazione: string | null
          data_ripresa: string | null
          data_scadenza: string | null
          durata: string | null
          fase: string | null
          generato_da_ai: boolean | null
          hashtag: string | null
          hook: string | null
          id: string
          id_display: string
          link_drive: string | null
          location: string | null
          musica: string | null
          note: string | null
          note_revisione: string | null
          ora_pubblicazione: string | null
          props: string | null
          script: string | null
          tipo: string | null
          titolo: string
          updated_at: string | null
        }
        Insert: {
          assegnato_montaggio?: string | null
          assegnato_riprese?: string | null
          canale?: string | null
          cliente_id?: string | null
          cliente_nome?: string | null
          created_at?: string | null
          cta?: string | null
          data_pubblicazione?: string | null
          data_ripresa?: string | null
          data_scadenza?: string | null
          durata?: string | null
          fase?: string | null
          generato_da_ai?: boolean | null
          hashtag?: string | null
          hook?: string | null
          id?: string
          id_display?: string
          link_drive?: string | null
          location?: string | null
          musica?: string | null
          note?: string | null
          note_revisione?: string | null
          ora_pubblicazione?: string | null
          props?: string | null
          script?: string | null
          tipo?: string | null
          titolo: string
          updated_at?: string | null
        }
        Update: {
          assegnato_montaggio?: string | null
          assegnato_riprese?: string | null
          canale?: string | null
          cliente_id?: string | null
          cliente_nome?: string | null
          created_at?: string | null
          cta?: string | null
          data_pubblicazione?: string | null
          data_ripresa?: string | null
          data_scadenza?: string | null
          durata?: string | null
          fase?: string | null
          generato_da_ai?: boolean | null
          hashtag?: string | null
          hook?: string | null
          id?: string
          id_display?: string
          link_drive?: string | null
          location?: string | null
          musica?: string | null
          note?: string | null
          note_revisione?: string | null
          ora_pubblicazione?: string | null
          props?: string | null
          script?: string | null
          tipo?: string | null
          titolo?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contenuti_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clienti"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_log: {
        Row: {
          cliente_nome: string
          costo_euro: number | null
          created_at: string | null
          id: string
          parametri: Json | null
          risultati: Json | null
          tokens_input: number | null
          tokens_output: number | null
        }
        Insert: {
          cliente_nome: string
          costo_euro?: number | null
          created_at?: string | null
          id?: string
          parametri?: Json | null
          risultati?: Json | null
          tokens_input?: number | null
          tokens_output?: number | null
        }
        Update: {
          cliente_nome?: string
          costo_euro?: number | null
          created_at?: string | null
          id?: string
          parametri?: Json | null
          risultati?: Json | null
          tokens_input?: number | null
          tokens_output?: number | null
        }
        Relationships: []
      }
      log_riprese: {
        Row: {
          cliente_id: string | null
          cliente_nome: string | null
          contenuto_id: string | null
          created_at: string | null
          formato: string | null
          id: string
          id_clip: string
          id_contenuto_display: string | null
          operatore: string | null
          riga: number | null
          stato: string | null
          titolo: string | null
          updated_at: string | null
        }
        Insert: {
          cliente_id?: string | null
          cliente_nome?: string | null
          contenuto_id?: string | null
          created_at?: string | null
          formato?: string | null
          id?: string
          id_clip: string
          id_contenuto_display?: string | null
          operatore?: string | null
          riga?: number | null
          stato?: string | null
          titolo?: string | null
          updated_at?: string | null
        }
        Update: {
          cliente_id?: string | null
          cliente_nome?: string | null
          contenuto_id?: string | null
          created_at?: string | null
          formato?: string | null
          id?: string
          id_clip?: string
          id_contenuto_display?: string | null
          operatore?: string | null
          riga?: number | null
          stato?: string | null
          titolo?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "log_riprese_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clienti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "log_riprese_contenuto_id_fkey"
            columns: ["contenuto_id"]
            isOneToOne: false
            referencedRelation: "contenuti"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_calendar: {
        Row: {
          categoria: string
          data: string
          data_fine: string | null
          id: string
          titolo: string
        }
        Insert: {
          categoria: string
          data: string
          data_fine?: string | null
          id?: string
          titolo: string
        }
        Update: {
          categoria?: string
          data?: string
          data_fine?: string | null
          id?: string
          titolo?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          auth_user_id: string
          created_at: string | null
          id: string
          team_id: string | null
        }
        Insert: {
          auth_user_id: string
          created_at?: string | null
          id?: string
          team_id?: string | null
        }
        Update: {
          auth_user_id?: string
          created_at?: string | null
          id?: string
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team"
            referencedColumns: ["id"]
          },
        ]
      }
      task: {
        Row: {
          assegnato_a: string
          assegnato_da: string | null
          cliente_id: string | null
          cliente_nome: string | null
          created_at: string | null
          descrizione: string
          id: string
          id_contenuto: string | null
          id_display: string
          note: string | null
          ora: string | null
          priorita: string | null
          scadenza: string | null
          stato: string | null
          tipo: string | null
          updated_at: string | null
        }
        Insert: {
          assegnato_a: string
          assegnato_da?: string | null
          cliente_id?: string | null
          cliente_nome?: string | null
          created_at?: string | null
          descrizione: string
          id?: string
          id_contenuto?: string | null
          id_display?: string
          note?: string | null
          ora?: string | null
          priorita?: string | null
          scadenza?: string | null
          stato?: string | null
          tipo?: string | null
          updated_at?: string | null
        }
        Update: {
          assegnato_a?: string
          assegnato_da?: string | null
          cliente_id?: string | null
          cliente_nome?: string | null
          created_at?: string | null
          descrizione?: string
          id?: string
          id_contenuto?: string | null
          id_display?: string
          note?: string | null
          ora?: string | null
          priorita?: string | null
          scadenza?: string | null
          stato?: string | null
          tipo?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clienti"
            referencedColumns: ["id"]
          },
        ]
      }
      team: {
        Row: {
          auth_user_id: string | null
          avatar_url: string | null
          colore: string | null
          created_at: string | null
          google_calendar_access_token: string | null
          google_calendar_connected: boolean | null
          google_calendar_id: string | null
          google_calendar_refresh_token: string | null
          google_calendar_token_expiry: number | null
          id: string
          label: string | null
          nome: string
          ruolo: string | null
        }
        Insert: {
          auth_user_id?: string | null
          avatar_url?: string | null
          colore?: string | null
          created_at?: string | null
          google_calendar_access_token?: string | null
          google_calendar_connected?: boolean | null
          google_calendar_id?: string | null
          google_calendar_refresh_token?: string | null
          google_calendar_token_expiry?: number | null
          id?: string
          label?: string | null
          nome: string
          ruolo?: string | null
        }
        Update: {
          auth_user_id?: string | null
          avatar_url?: string | null
          colore?: string | null
          created_at?: string | null
          google_calendar_access_token?: string | null
          google_calendar_connected?: boolean | null
          google_calendar_id?: string | null
          google_calendar_refresh_token?: string | null
          google_calendar_token_expiry?: number | null
          id?: string
          label?: string | null
          nome?: string
          ruolo?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_display_id: {
        Args: { prefix: string; seq_name: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
