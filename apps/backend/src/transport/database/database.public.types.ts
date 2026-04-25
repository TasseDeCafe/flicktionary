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
      users: {
        Row: {
          created_at: string
          id: string
          referral: string | null
          stripe_customer_id: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          created_at?: string
          id: string
          referral?: string | null
          stripe_customer_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          referral?: string | null
          stripe_customer_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      revenuecat_auto_renewal_status:
        | 'will_renew'
        | 'will_not_renew'
        | 'will_change_product'
        | 'will_pause'
        | 'requires_price_increase_consent'
        | 'has_already_renewed'
      revenuecat_store:
        | 'amazon'
        | 'app_store'
        | 'mac_app_store'
        | 'play_store'
        | 'promotional'
        | 'stripe'
        | 'rc_billing'
        | 'test_store'
      revenuecat_subscription_status:
        | 'trialing'
        | 'active'
        | 'expired'
        | 'in_grace_period'
        | 'in_billing_retry'
        | 'paused'
        | 'unknown'
        | 'incomplete'
      stripe_subscription_status:
        | 'active'
        | 'trialing'
        | 'past_due'
        | 'canceled'
        | 'unpaid'
        | 'incomplete_expired'
        | 'incomplete'
        | 'paused'
      subscription_interval: 'month' | 'year'
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
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
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
    },
  },
  storage: {
    Enums: {},
  },
} as const
