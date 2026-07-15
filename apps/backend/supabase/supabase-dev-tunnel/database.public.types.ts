export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      card_chat_messages: {
        Row: {
          card_id: string
          content: string
          created_at: string
          id: string
          role: Database['public']['Enums']['card_chat_role']
        }
        Insert: {
          card_id: string
          content: string
          created_at?: string
          id?: string
          role: Database['public']['Enums']['card_chat_role']
        }
        Update: {
          card_id?: string
          content?: string
          created_at?: string
          id?: string
          role?: Database['public']['Enums']['card_chat_role']
        }
        Relationships: [
          {
            foreignKeyName: 'card_chat_messages_card_id_fkey'
            columns: ['card_id']
            isOneToOne: false
            referencedRelation: 'cards'
            referencedColumns: ['id']
          },
        ]
      }
      cards: {
        Row: {
          created_at: string
          highlight_id: string | null
          id: string
          segment_id: string
          status: Database['public']['Enums']['card_status']
          study_session_id: string
          surface_form: string
          updated_at: string
          user_lookup_id: string
        }
        Insert: {
          created_at?: string
          highlight_id?: string | null
          id?: string
          segment_id: string
          status?: Database['public']['Enums']['card_status']
          study_session_id: string
          surface_form: string
          updated_at?: string
          user_lookup_id: string
        }
        Update: {
          created_at?: string
          highlight_id?: string | null
          id?: string
          segment_id?: string
          status?: Database['public']['Enums']['card_status']
          study_session_id?: string
          surface_form?: string
          updated_at?: string
          user_lookup_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'cards_highlight_id_fkey'
            columns: ['highlight_id']
            isOneToOne: false
            referencedRelation: 'highlights'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cards_segment_id_fkey'
            columns: ['segment_id']
            isOneToOne: false
            referencedRelation: 'text_segments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cards_study_session_id_fkey'
            columns: ['study_session_id']
            isOneToOne: false
            referencedRelation: 'study_sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cards_user_lookup_id_fkey'
            columns: ['user_lookup_id']
            isOneToOne: false
            referencedRelation: 'user_lookups'
            referencedColumns: ['id']
          },
        ]
      }
      content_sources: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          id: string
          language: string
          metadata: Json
          title: string
          type: Database['public']['Enums']['content_source_type']
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          language: string
          metadata?: Json
          title: string
          type: Database['public']['Enums']['content_source_type']
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          language?: string
          metadata?: Json
          title?: string
          type?: Database['public']['Enums']['content_source_type']
        }
        Relationships: []
      }
      handled_revenuecat_events: {
        Row: {
          created_at: string
          event_id: string
          id: number
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: number
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: number
        }
        Relationships: []
      }
      handled_stripe_events: {
        Row: {
          created_at: string
          event_id: string
          id: number
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: number
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: number
        }
        Relationships: []
      }
      highlights: {
        Row: {
          created_at: string
          end_offset: number
          end_segment_id: string
          fast_gloss: string | null
          id: string
          note: string | null
          preset_tags: string[]
          selection_text: string
          start_offset: number
          start_segment_id: string
          study_session_id: string
        }
        Insert: {
          created_at?: string
          end_offset: number
          end_segment_id: string
          fast_gloss?: string | null
          id?: string
          note?: string | null
          preset_tags?: string[]
          selection_text: string
          start_offset: number
          start_segment_id: string
          study_session_id: string
        }
        Update: {
          created_at?: string
          end_offset?: number
          end_segment_id?: string
          fast_gloss?: string | null
          id?: string
          note?: string | null
          preset_tags?: string[]
          selection_text?: string
          start_offset?: number
          start_segment_id?: string
          study_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'highlights_end_segment_id_fkey'
            columns: ['end_segment_id']
            isOneToOne: false
            referencedRelation: 'text_segments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'highlights_start_segment_id_fkey'
            columns: ['start_segment_id']
            isOneToOne: false
            referencedRelation: 'text_segments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'highlights_study_session_id_fkey'
            columns: ['study_session_id']
            isOneToOne: false
            referencedRelation: 'study_sessions'
            referencedColumns: ['id']
          },
        ]
      }
      practice_ratings: {
        Row: {
          headword: string
          id: string
          practice_text_id: string
          rated_at: string
          rating: Database['public']['Enums']['practice_rating']
          sense: string
          target_language: string
          user_id: string
          user_lookup_id: string
          was_explicit: boolean
        }
        Insert: {
          headword: string
          id?: string
          practice_text_id: string
          rated_at?: string
          rating: Database['public']['Enums']['practice_rating']
          sense?: string
          target_language: string
          user_id: string
          user_lookup_id: string
          was_explicit?: boolean
        }
        Update: {
          headword?: string
          id?: string
          practice_text_id?: string
          rated_at?: string
          rating?: Database['public']['Enums']['practice_rating']
          sense?: string
          target_language?: string
          user_id?: string
          user_lookup_id?: string
          was_explicit?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'practice_ratings_lookup_fkey'
            columns: ['user_lookup_id']
            isOneToOne: false
            referencedRelation: 'user_lookups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'practice_ratings_text_fkey'
            columns: ['practice_text_id']
            isOneToOne: false
            referencedRelation: 'practice_texts'
            referencedColumns: ['id']
          },
        ]
      }
      practice_session_chunks: {
        Row: {
          abandoned_at: string | null
          eligible_at_start: boolean
          practice_session_id: string
          user_lookup_id: string
        }
        Insert: {
          abandoned_at?: string | null
          eligible_at_start: boolean
          practice_session_id: string
          user_lookup_id: string
        }
        Update: {
          abandoned_at?: string | null
          eligible_at_start?: boolean
          practice_session_id?: string
          user_lookup_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'practice_session_chunks_lookup_fkey'
            columns: ['user_lookup_id']
            isOneToOne: false
            referencedRelation: 'user_lookups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'practice_session_chunks_session_fkey'
            columns: ['practice_session_id']
            isOneToOne: false
            referencedRelation: 'practice_sessions'
            referencedColumns: ['id']
          },
        ]
      }
      practice_sessions: {
        Row: {
          ended_at: string | null
          id: string
          max_new_terms: number
          max_review_terms: number
          started_at: string
          status: Database['public']['Enums']['practice_session_status']
          target_language: string
          user_id: string
        }
        Insert: {
          ended_at?: string | null
          id?: string
          max_new_terms?: number
          max_review_terms?: number
          started_at?: string
          status?: Database['public']['Enums']['practice_session_status']
          target_language: string
          user_id: string
        }
        Update: {
          ended_at?: string | null
          id?: string
          max_new_terms?: number
          max_review_terms?: number
          started_at?: string
          status?: Database['public']['Enums']['practice_session_status']
          target_language?: string
          user_id?: string
        }
        Relationships: []
      }
      practice_texts: {
        Row: {
          annotations: Json
          body: string | null
          created_at: string
          generation_token: string | null
          generation_warning: string | null
          id: string
          ord: number
          practice_session_id: string
          read_at: string | null
          ready_at: string | null
          skipped_chunks: Json
          status: Database['public']['Enums']['practice_text_status']
        }
        Insert: {
          annotations?: Json
          body?: string | null
          created_at?: string
          generation_token?: string | null
          generation_warning?: string | null
          id?: string
          ord: number
          practice_session_id: string
          read_at?: string | null
          ready_at?: string | null
          skipped_chunks?: Json
          status?: Database['public']['Enums']['practice_text_status']
        }
        Update: {
          annotations?: Json
          body?: string | null
          created_at?: string
          generation_token?: string | null
          generation_warning?: string | null
          id?: string
          ord?: number
          practice_session_id?: string
          read_at?: string | null
          ready_at?: string | null
          skipped_chunks?: Json
          status?: Database['public']['Enums']['practice_text_status']
        }
        Relationships: [
          {
            foreignKeyName: 'practice_texts_session_fkey'
            columns: ['practice_session_id']
            isOneToOne: false
            referencedRelation: 'practice_sessions'
            referencedColumns: ['id']
          },
        ]
      }
      processing_telemetry: {
        Row: {
          created_at: string
          duration_ms: number | null
          id: string
          pass_name: string
          payload: Json
          study_session_id: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          id?: string
          pass_name: string
          payload: Json
          study_session_id?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          id?: string
          pass_name?: string
          payload?: Json
          study_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'processing_telemetry_session_fkey'
            columns: ['study_session_id']
            isOneToOne: false
            referencedRelation: 'study_sessions'
            referencedColumns: ['id']
          },
        ]
      }
      removals: {
        Row: {
          created_at: string
          email: string
          id: string
          user_id: string
          was_successful: boolean
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          user_id: string
          was_successful?: boolean
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          user_id?: string
          was_successful?: boolean
        }
        Relationships: []
      }
      revenuecat_subscriptions: {
        Row: {
          auto_renewal_status: Database['public']['Enums']['revenuecat_auto_renewal_status']
          billing_country_code: string | null
          created_at: string
          current_period_ends_at: string | null
          current_period_starts_at: string
          environment: string
          gives_access: boolean
          id: string
          management_url: string | null
          ownership_type: string
          pending_payment: boolean
          presented_offering_id: string | null
          revenuecat_original_customer_id: string
          revenuecat_product_id: string | null
          revenuecat_subscription_id: string
          starts_at: string
          status: Database['public']['Enums']['revenuecat_subscription_status']
          store: Database['public']['Enums']['revenuecat_store']
          store_subscription_identifier: string
          total_revenue_in_usd: number
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_renewal_status: Database['public']['Enums']['revenuecat_auto_renewal_status']
          billing_country_code?: string | null
          created_at?: string
          current_period_ends_at?: string | null
          current_period_starts_at: string
          environment: string
          gives_access: boolean
          id?: string
          management_url?: string | null
          ownership_type: string
          pending_payment: boolean
          presented_offering_id?: string | null
          revenuecat_original_customer_id: string
          revenuecat_product_id?: string | null
          revenuecat_subscription_id: string
          starts_at: string
          status: Database['public']['Enums']['revenuecat_subscription_status']
          store: Database['public']['Enums']['revenuecat_store']
          store_subscription_identifier: string
          total_revenue_in_usd: number
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_renewal_status?: Database['public']['Enums']['revenuecat_auto_renewal_status']
          billing_country_code?: string | null
          created_at?: string
          current_period_ends_at?: string | null
          current_period_starts_at?: string
          environment?: string
          gives_access?: boolean
          id?: string
          management_url?: string | null
          ownership_type?: string
          pending_payment?: boolean
          presented_offering_id?: string | null
          revenuecat_original_customer_id?: string
          revenuecat_product_id?: string | null
          revenuecat_subscription_id?: string
          starts_at?: string
          status?: Database['public']['Enums']['revenuecat_subscription_status']
          store?: Database['public']['Enums']['revenuecat_store']
          store_subscription_identifier?: string
          total_revenue_in_usd?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      stripe_subscriptions: {
        Row: {
          amount: number | null
          cancel_at_period_end: boolean | null
          created_at: string
          currency: string | null
          current_period_end: string | null
          id: string
          interval: Database['public']['Enums']['subscription_interval'] | null
          interval_count: number | null
          status: Database['public']['Enums']['stripe_subscription_status']
          stripe_product_id: string
          stripe_subscription_id: string
          trial_end: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number | null
          cancel_at_period_end?: boolean | null
          created_at?: string
          currency?: string | null
          current_period_end?: string | null
          id?: string
          interval?: Database['public']['Enums']['subscription_interval'] | null
          interval_count?: number | null
          status: Database['public']['Enums']['stripe_subscription_status']
          stripe_product_id: string
          stripe_subscription_id: string
          trial_end?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number | null
          cancel_at_period_end?: boolean | null
          created_at?: string
          currency?: string | null
          current_period_end?: string | null
          id?: string
          interval?: Database['public']['Enums']['subscription_interval'] | null
          interval_count?: number | null
          status?: Database['public']['Enums']['stripe_subscription_status']
          stripe_product_id?: string
          stripe_subscription_id?: string
          trial_end?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      study_sessions: {
        Row: {
          cefr_level: string
          content_source_id: string
          context_blob: string | null
          created_at: string
          deleted_at: string | null
          id: string
          native_language: string
          processing_warnings: string[]
          target_language: string
          text_track_id: string
          user_id: string
        }
        Insert: {
          cefr_level: string
          content_source_id: string
          context_blob?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          native_language: string
          processing_warnings?: string[]
          target_language: string
          text_track_id: string
          user_id: string
        }
        Update: {
          cefr_level?: string
          content_source_id?: string
          context_blob?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          native_language?: string
          processing_warnings?: string[]
          target_language?: string
          text_track_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'study_sessions_content_source_id_fkey'
            columns: ['content_source_id']
            isOneToOne: false
            referencedRelation: 'content_sources'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'study_sessions_content_source_text_track_fkey'
            columns: ['content_source_id', 'text_track_id']
            isOneToOne: false
            referencedRelation: 'text_tracks'
            referencedColumns: ['content_source_id', 'id']
          },
          {
            foreignKeyName: 'study_sessions_text_track_id_fkey'
            columns: ['text_track_id']
            isOneToOne: false
            referencedRelation: 'text_tracks'
            referencedColumns: ['id']
          },
        ]
      }
      text_segments: {
        Row: {
          end_ms: number | null
          id: string
          index: number
          start_ms: number | null
          text: string
          text_track_id: string
          tsv: unknown
        }
        Insert: {
          end_ms?: number | null
          id?: string
          index: number
          start_ms?: number | null
          text: string
          text_track_id: string
          tsv?: unknown
        }
        Update: {
          end_ms?: number | null
          id?: string
          index?: number
          start_ms?: number | null
          text?: string
          text_track_id?: string
          tsv?: unknown
        }
        Relationships: [
          {
            foreignKeyName: 'text_segments_text_track_id_fkey'
            columns: ['text_track_id']
            isOneToOne: false
            referencedRelation: 'text_tracks'
            referencedColumns: ['id']
          },
        ]
      }
      text_tracks: {
        Row: {
          content_source_id: string
          created_at: string
          external_id: string | null
          hash: string
          id: string
          language: string
          source: Database['public']['Enums']['text_track_source']
        }
        Insert: {
          content_source_id: string
          created_at?: string
          external_id?: string | null
          hash: string
          id?: string
          language: string
          source: Database['public']['Enums']['text_track_source']
        }
        Update: {
          content_source_id?: string
          created_at?: string
          external_id?: string | null
          hash?: string
          id?: string
          language?: string
          source?: Database['public']['Enums']['text_track_source']
        }
        Relationships: [
          {
            foreignKeyName: 'text_tracks_content_source_id_fkey'
            columns: ['content_source_id']
            isOneToOne: false
            referencedRelation: 'content_sources'
            referencedColumns: ['id']
          },
        ]
      }
      user_lookups: {
        Row: {
          added_to_practice_at: string | null
          count: number
          created_at: string
          definition: string | null
          deleted_at: string | null
          exploration_extras: Json
          exported_at: string | null
          first_card_id: string | null
          grammar: Json
          grammar_user_edited_at: string | null
          grounded_at: string | null
          headword: string
          id: string
          native_example: string | null
          sense: string
          srs_difficulty: number | null
          srs_due: string | null
          srs_lapses: number
          srs_last_review: string | null
          srs_reps: number
          srs_stability: number | null
          srs_state: Database['public']['Enums']['srs_state'] | null
          target_example: string | null
          target_language: string
          translation: string | null
          user_id: string
        }
        Insert: {
          added_to_practice_at?: string | null
          count?: number
          created_at?: string
          definition?: string | null
          deleted_at?: string | null
          exploration_extras?: Json
          exported_at?: string | null
          first_card_id?: string | null
          grammar?: Json
          grammar_user_edited_at?: string | null
          grounded_at?: string | null
          headword: string
          id?: string
          native_example?: string | null
          sense?: string
          srs_difficulty?: number | null
          srs_due?: string | null
          srs_lapses?: number
          srs_last_review?: string | null
          srs_reps?: number
          srs_stability?: number | null
          srs_state?: Database['public']['Enums']['srs_state'] | null
          target_example?: string | null
          target_language: string
          translation?: string | null
          user_id: string
        }
        Update: {
          added_to_practice_at?: string | null
          count?: number
          created_at?: string
          definition?: string | null
          deleted_at?: string | null
          exploration_extras?: Json
          exported_at?: string | null
          first_card_id?: string | null
          grammar?: Json
          grammar_user_edited_at?: string | null
          grounded_at?: string | null
          headword?: string
          id?: string
          native_example?: string | null
          sense?: string
          srs_difficulty?: number | null
          srs_due?: string | null
          srs_lapses?: number
          srs_last_review?: string | null
          srs_reps?: number
          srs_stability?: number | null
          srs_state?: Database['public']['Enums']['srs_state'] | null
          target_example?: string | null
          target_language?: string
          translation?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_lookups_first_card_id_fkey'
            columns: ['first_card_id']
            isOneToOne: false
            referencedRelation: 'cards'
            referencedColumns: ['id']
          },
        ]
      }
      user_target_language_prefs: {
        Row: {
          cefr_level: string
          created_at: string
          target_language: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cefr_level: string
          created_at?: string
          target_language: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cefr_level?: string
          created_at?: string
          target_language?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          id: string
          llm_highlights_enabled: boolean
          native_language: string | null
          practice_max_new_terms: number
          practice_max_review_terms: number
          referral: string | null
          stripe_customer_id: string | null
          tap_to_translate_enabled: boolean
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          created_at?: string
          id: string
          llm_highlights_enabled?: boolean
          native_language?: string | null
          practice_max_new_terms?: number
          practice_max_review_terms?: number
          referral?: string | null
          stripe_customer_id?: string | null
          tap_to_translate_enabled?: boolean
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          llm_highlights_enabled?: boolean
          native_language?: string | null
          practice_max_new_terms?: number
          practice_max_review_terms?: number
          referral?: string | null
          stripe_customer_id?: string | null
          tap_to_translate_enabled?: boolean
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: []
      }
      wiktionary_entries: {
        Row: {
          data: Json
          headword: string
          id: number
          pos: string
          target_language: string
        }
        Insert: {
          data: Json
          headword: string
          id?: number
          pos: string
          target_language: string
        }
        Update: {
          data?: Json
          headword?: string
          id?: number
          pos?: string
          target_language?: string
        }
        Relationships: []
      }
      wiktionary_forms: {
        Row: {
          entry_id: number
          form: string
          target_language: string
        }
        Insert: {
          entry_id: number
          form: string
          target_language: string
        }
        Update: {
          entry_id?: number
          form?: string
          target_language?: string
        }
        Relationships: [
          {
            foreignKeyName: 'wiktionary_forms_entry_fkey'
            columns: ['entry_id']
            isOneToOne: false
            referencedRelation: 'wiktionary_entries'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      card_chat_role: 'user' | 'assistant'
      card_status: 'pending' | 'kept' | 'rejected' | 'auto_rejected'
      content_source_type: 'movie' | 'book' | 'article' | 'text'
      practice_rating: 'again' | 'hard' | 'good' | 'easy'
      practice_session_status: 'active' | 'completed' | 'abandoned'
      practice_text_status: 'pending' | 'generating' | 'ready' | 'reading' | 'done' | 'failed'
      revenuecat_auto_renewal_status:
        | 'will_renew'
        | 'will_not_renew'
        | 'will_change_product'
        | 'will_pause'
        | 'requires_price_increase_consent'
        | 'has_already_renewed'
      revenuecat_store:
        'amazon' | 'app_store' | 'mac_app_store' | 'play_store' | 'promotional' | 'stripe' | 'rc_billing' | 'test_store'
      revenuecat_subscription_status:
        'trialing' | 'active' | 'expired' | 'in_grace_period' | 'in_billing_retry' | 'paused' | 'unknown' | 'incomplete'
      srs_state: 'new' | 'learning' | 'review' | 'relearning'
      stripe_subscription_status:
        'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete_expired' | 'incomplete' | 'paused'
      subscription_interval: 'month' | 'year'
      text_track_source: 'opensubtitles' | 'upload' | 'paste' | 'url'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          created_at: string | null
          id: string
          name: string
          owner: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id: string
          name: string
          owner?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          owner?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          updated_at: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          updated_at?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'objects_bucketId_fkey'
            columns: ['bucket_id']
            isOneToOne: false
            referencedRelation: 'buckets'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
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

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema['Tables'] & DefaultSchema['Views']) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      card_chat_role: ['user', 'assistant'],
      card_status: ['pending', 'kept', 'rejected', 'auto_rejected'],
      content_source_type: ['movie', 'book', 'article', 'text'],
      practice_rating: ['again', 'hard', 'good', 'easy'],
      practice_session_status: ['active', 'completed', 'abandoned'],
      practice_text_status: ['pending', 'generating', 'ready', 'reading', 'done', 'failed'],
      revenuecat_auto_renewal_status: [
        'will_renew',
        'will_not_renew',
        'will_change_product',
        'will_pause',
        'requires_price_increase_consent',
        'has_already_renewed',
      ],
      revenuecat_store: [
        'amazon',
        'app_store',
        'mac_app_store',
        'play_store',
        'promotional',
        'stripe',
        'rc_billing',
        'test_store',
      ],
      revenuecat_subscription_status: [
        'trialing',
        'active',
        'expired',
        'in_grace_period',
        'in_billing_retry',
        'paused',
        'unknown',
        'incomplete',
      ],
      srs_state: ['new', 'learning', 'review', 'relearning'],
      stripe_subscription_status: [
        'active',
        'trialing',
        'past_due',
        'canceled',
        'unpaid',
        'incomplete_expired',
        'incomplete',
        'paused',
      ],
      subscription_interval: ['month', 'year'],
      text_track_source: ['opensubtitles', 'upload', 'paste', 'url'],
    },
  },
  storage: {
    Enums: {},
  },
} as const
