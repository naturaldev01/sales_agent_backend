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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      ai_message_feedback: {
        Row: {
          comment: string | null
          created_at: string | null
          id: string
          message_id: string
          rating: string
          suggested_response: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          id?: string
          message_id: string
          rating: string
          suggested_response?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          id?: string
          message_id?: string
          rating?: string
          suggested_response?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_message_feedback_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_message_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_runs: {
        Row: {
          created_at: string | null
          error: string | null
          extraction: Json | null
          id: string
          input_json: Json | null
          intent: Json | null
          job_type: string
          latency_ms: number | null
          lead_id: string | null
          message_id: string | null
          model: string | null
          outputs_json: Json | null
          prompt_version: string | null
          reply_draft: string | null
          score_result: Json | null
          tokens_used: number | null
        }
        Insert: {
          created_at?: string | null
          error?: string | null
          extraction?: Json | null
          id?: string
          input_json?: Json | null
          intent?: Json | null
          job_type: string
          latency_ms?: number | null
          lead_id?: string | null
          message_id?: string | null
          model?: string | null
          outputs_json?: Json | null
          prompt_version?: string | null
          reply_draft?: string | null
          score_result?: Json | null
          tokens_used?: number | null
        }
        Update: {
          created_at?: string | null
          error?: string | null
          extraction?: Json | null
          id?: string
          input_json?: Json | null
          intent?: Json | null
          job_type?: string
          latency_ms?: number | null
          lead_id?: string | null
          message_id?: string | null
          model?: string | null
          outputs_json?: Json | null
          prompt_version?: string | null
          reply_draft?: string | null
          score_result?: Json | null
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_runs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_runs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string | null
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: string | null
          new_value: Json | null
          old_value: Json | null
          user_agent: string | null
          user_id: string | null
          user_role: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          new_value?: Json | null
          old_value?: Json | null
          user_agent?: string | null
          user_id?: string | null
          user_role?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          new_value?: Json | null
          old_value?: Json | null
          user_agent?: string | null
          user_id?: string | null
          user_role?: string | null
        }
        Relationships: []
      }
      config: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          key: string
          updated_at: string | null
          value_json: Json | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          key: string
          updated_at?: string | null
          value_json?: Json | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          key?: string
          updated_at?: string | null
          value_json?: Json | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          channel: string
          created_at: string | null
          id: string
          is_active: boolean | null
          last_message_at: string | null
          last_user_message_at: string | null
          lead_id: string
          message_count: number | null
          metadata: Json | null
          state: string | null
          updated_at: string | null
        }
        Insert: {
          channel?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_message_at?: string | null
          last_user_message_at?: string | null
          lead_id: string
          message_count?: number | null
          metadata?: Json | null
          state?: string | null
          updated_at?: string | null
        }
        Update: {
          channel?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_message_at?: string | null
          last_user_message_at?: string | null
          lead_id?: string
          message_count?: number | null
          metadata?: Json | null
          state?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_comments: {
        Row: {
          comment: string
          comment_type: string | null
          created_at: string | null
          id: string
          is_pinned: boolean | null
          lead_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          comment: string
          comment_type?: string | null
          created_at?: string | null
          id?: string
          is_pinned?: boolean | null
          lead_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          comment?: string
          comment_type?: string | null
          created_at?: string | null
          id?: string
          is_pinned?: boolean | null
          lead_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_comments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      followups: {
        Row: {
          attempt_number: number
          conversation_id: string | null
          created_at: string | null
          followup_type: string
          id: string
          lead_id: string
          message_id: string | null
          metadata: Json | null
          response_at: string | null
          response_received: boolean | null
          scheduled_at: string
          sent_at: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          attempt_number?: number
          conversation_id?: string | null
          created_at?: string | null
          followup_type?: string
          id?: string
          lead_id: string
          message_id?: string | null
          metadata?: Json | null
          response_at?: string | null
          response_received?: boolean | null
          scheduled_at: string
          sent_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          attempt_number?: number
          conversation_id?: string | null
          created_at?: string | null
          followup_type?: string
          id?: string
          lead_id?: string
          message_id?: string | null
          metadata?: Json | null
          response_at?: string | null
          response_received?: boolean | null
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "followups_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followups_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      handoffs: {
        Row: {
          assigned_to: string | null
          conversation_id: string | null
          created_at: string | null
          id: string
          lead_id: string
          metadata: Json | null
          reason: string
          reason_details: string | null
          resolution_notes: string | null
          resolved_at: string | null
          status: string
          triggered_by: string
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          lead_id: string
          metadata?: Json | null
          reason: string
          reason_details?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: string
          triggered_by?: string
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          lead_id?: string
          metadata?: Json | null
          reason?: string
          reason_details?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: string
          triggered_by?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "handoffs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handoffs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_base: {
        Row: {
          bad_response: string | null
          category: string
          context_notes: string | null
          created_at: string | null
          created_by: string | null
          good_response: string
          id: string
          is_active: boolean | null
          language: string | null
          priority: number | null
          scenario: string | null
          source_feedback_id: string | null
          trigger_keywords: string[] | null
          updated_at: string | null
          usage_count: number | null
        }
        Insert: {
          bad_response?: string | null
          category: string
          context_notes?: string | null
          created_at?: string | null
          created_by?: string | null
          good_response: string
          id?: string
          is_active?: boolean | null
          language?: string | null
          priority?: number | null
          scenario?: string | null
          source_feedback_id?: string | null
          trigger_keywords?: string[] | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Update: {
          bad_response?: string | null
          category?: string
          context_notes?: string | null
          created_at?: string | null
          created_by?: string | null
          good_response?: string
          id?: string
          is_active?: boolean | null
          language?: string | null
          priority?: number | null
          scenario?: string | null
          source_feedback_id?: string | null
          trigger_keywords?: string[] | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_base_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_base_source_feedback_id_fkey"
            columns: ["source_feedback_id"]
            isOneToOne: false
            referencedRelation: "ai_message_feedback"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_profile: {
        Row: {
          age_range: string | null
          agent_name: string | null
          alcohol_use: string | null
          allergies_detail: string | null
          birth_date: string | null
          chronic_disease_detail: string | null
          city: string | null
          complaint: string | null
          consent_at: string | null
          consent_given: boolean | null
          consent_version: string | null
          country: string | null
          created_at: string | null
          email: string | null
          extracted_fields_json: Json | null
          has_allergies: boolean | null
          has_chronic_disease: boolean | null
          has_previous_surgery: boolean | null
          has_previous_treatment: string | null
          height_cm: number | null
          lead_id: string
          name: string | null
          notes: string | null
          phone: string | null
          previous_surgery_detail: string | null
          previous_treatment_details: string | null
          smoking_use: string | null
          updated_at: string | null
          weight_kg: number | null
        }
        Insert: {
          age_range?: string | null
          agent_name?: string | null
          alcohol_use?: string | null
          allergies_detail?: string | null
          birth_date?: string | null
          chronic_disease_detail?: string | null
          city?: string | null
          complaint?: string | null
          consent_at?: string | null
          consent_given?: boolean | null
          consent_version?: string | null
          country?: string | null
          created_at?: string | null
          email?: string | null
          extracted_fields_json?: Json | null
          has_allergies?: boolean | null
          has_chronic_disease?: boolean | null
          has_previous_surgery?: boolean | null
          has_previous_treatment?: string | null
          height_cm?: number | null
          lead_id: string
          name?: string | null
          notes?: string | null
          phone?: string | null
          previous_surgery_detail?: string | null
          previous_treatment_details?: string | null
          smoking_use?: string | null
          updated_at?: string | null
          weight_kg?: number | null
        }
        Update: {
          age_range?: string | null
          agent_name?: string | null
          alcohol_use?: string | null
          allergies_detail?: string | null
          birth_date?: string | null
          chronic_disease_detail?: string | null
          city?: string | null
          complaint?: string | null
          consent_at?: string | null
          consent_given?: boolean | null
          consent_version?: string | null
          country?: string | null
          created_at?: string | null
          email?: string | null
          extracted_fields_json?: Json | null
          has_allergies?: boolean | null
          has_chronic_disease?: boolean | null
          has_previous_surgery?: boolean | null
          has_previous_treatment?: string | null
          height_cm?: number | null
          lead_id?: string
          name?: string | null
          notes?: string | null
          phone?: string | null
          previous_surgery_detail?: string | null
          previous_treatment_details?: string | null
          smoking_use?: string | null
          updated_at?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_profile_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          channel: string
          channel_user_id: string | null
          country: string | null
          created_at: string | null
          desire_band: string | null
          desire_reason_json: Json | null
          desire_score: number | null
          id: string
          language: string | null
          metadata: Json | null
          source: string | null
          status: string
          timezone: string | null
          treatment_category: string | null
          updated_at: string | null
          doctor_approved_by: string | null
          doctor_approved_at: string | null
          treatment_recommendations: string | null
          estimated_price_min: number | null
          estimated_price_max: number | null
          price_currency: string | null
        }
        Insert: {
          channel?: string
          channel_user_id?: string | null
          country?: string | null
          created_at?: string | null
          desire_band?: string | null
          desire_reason_json?: Json | null
          desire_score?: number | null
          id?: string
          language?: string | null
          metadata?: Json | null
          source?: string | null
          status?: string
          timezone?: string | null
          treatment_category?: string | null
          updated_at?: string | null
          doctor_approved_by?: string | null
          doctor_approved_at?: string | null
          treatment_recommendations?: string | null
          estimated_price_min?: number | null
          estimated_price_max?: number | null
          price_currency?: string | null
        }
        Update: {
          channel?: string
          channel_user_id?: string | null
          country?: string | null
          created_at?: string | null
          desire_band?: string | null
          desire_reason_json?: Json | null
          desire_score?: number | null
          id?: string
          language?: string | null
          metadata?: Json | null
          source?: string | null
          status?: string
          timezone?: string | null
          treatment_category?: string | null
          updated_at?: string | null
          doctor_approved_by?: string | null
          doctor_approved_at?: string | null
          treatment_recommendations?: string | null
          estimated_price_min?: number | null
          estimated_price_max?: number | null
          price_currency?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          ai_run_id: string | null
          channel_message_id: string | null
          content: string | null
          conversation_id: string
          created_at: string | null
          direction: string
          id: string
          is_read: boolean | null
          lead_id: string
          media_type: string | null
          media_url: string | null
          metadata: Json | null
          sender_type: string
        }
        Insert: {
          ai_run_id?: string | null
          channel_message_id?: string | null
          content?: string | null
          conversation_id: string
          created_at?: string | null
          direction: string
          id?: string
          is_read?: boolean | null
          lead_id: string
          media_type?: string | null
          media_url?: string | null
          metadata?: Json | null
          sender_type?: string
        }
        Update: {
          ai_run_id?: string | null
          channel_message_id?: string | null
          content?: string | null
          conversation_id?: string
          created_at?: string | null
          direction?: string
          id?: string
          is_read?: boolean | null
          lead_id?: string
          media_type?: string | null
          media_url?: string | null
          metadata?: Json | null
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_messages_ai_run"
            columns: ["ai_run_id"]
            isOneToOne: false
            referencedRelation: "ai_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_assets: {
        Row: {
          checklist_key: string | null
          created_at: string | null
          file_name: string | null
          file_size: number | null
          id: string
          is_verified: boolean | null
          lead_id: string
          metadata: Json | null
          mime_type: string | null
          quality_notes: string | null
          quality_score: number | null
          storage_bucket: string
          storage_path: string
          uploaded_at: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          checklist_key?: string | null
          created_at?: string | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          is_verified?: boolean | null
          lead_id: string
          metadata?: Json | null
          mime_type?: string | null
          quality_notes?: string | null
          quality_score?: number | null
          storage_bucket?: string
          storage_path: string
          uploaded_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          checklist_key?: string | null
          created_at?: string | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          is_verified?: boolean | null
          lead_id?: string
          metadata?: Json | null
          mime_type?: string | null
          quality_notes?: string | null
          quality_score?: number | null
          storage_bucket?: string
          storage_path?: string
          uploaded_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "photo_assets_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_checklists: {
        Row: {
          checklist_key: string
          created_at: string | null
          display_name_ar: string | null
          display_name_en: string | null
          display_name_fr: string | null
          display_name_ru: string | null
          display_name_tr: string | null
          id: string
          instructions_ar: string | null
          instructions_en: string | null
          instructions_fr: string | null
          instructions_ru: string | null
          instructions_tr: string | null
          is_active: boolean | null
          is_required: boolean | null
          sort_order: number | null
          template_image_path: string | null
          template_image_url: string | null
          treatment_category: string
        }
        Insert: {
          checklist_key: string
          created_at?: string | null
          display_name_ar?: string | null
          display_name_en?: string | null
          display_name_fr?: string | null
          display_name_ru?: string | null
          display_name_tr?: string | null
          id?: string
          instructions_ar?: string | null
          instructions_en?: string | null
          instructions_fr?: string | null
          instructions_ru?: string | null
          instructions_tr?: string | null
          is_active?: boolean | null
          is_required?: boolean | null
          sort_order?: number | null
          template_image_path?: string | null
          template_image_url?: string | null
          treatment_category: string
        }
        Update: {
          checklist_key?: string
          created_at?: string | null
          display_name_ar?: string | null
          display_name_en?: string | null
          display_name_fr?: string | null
          display_name_ru?: string | null
          display_name_tr?: string | null
          id?: string
          instructions_ar?: string | null
          instructions_en?: string | null
          instructions_fr?: string | null
          instructions_ru?: string | null
          instructions_tr?: string | null
          is_active?: boolean | null
          is_required?: boolean | null
          sort_order?: number | null
          template_image_path?: string | null
          template_image_url?: string | null
          treatment_category?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          ip_address: string | null
          token_hash: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: string
          ip_address?: string | null
          token_hash: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          ip_address?: string | null
          token_hash?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      system_configs: {
        Row: {
          config_key: string
          config_value: Json
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          updated_at: string | null
        }
        Insert: {
          config_key: string
          config_value: Json
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
        }
        Update: {
          config_key?: string
          config_value?: Json
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      users: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          avatar_url: string | null
          created_at: string | null
          email: string
          id: string
          is_active: boolean | null
          is_approved: boolean | null
          last_login_at: string | null
          name: string
          password_hash: string
          role: string
          specialties: string[] | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          avatar_url?: string | null
          created_at?: string | null
          email: string
          id?: string
          is_active?: boolean | null
          is_approved?: boolean | null
          last_login_at?: string | null
          name: string
          password_hash: string
          role?: string
          specialties?: string[] | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          id?: string
          is_active?: boolean | null
          is_approved?: boolean | null
          last_login_at?: string | null
          name?: string
          password_hash?: string
          role?: string
          specialties?: string[] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
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
