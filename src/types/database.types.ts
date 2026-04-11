// src/types/database.types.ts
// ---------------------------------------------------------------------------
// Manually maintained database type definitions.
// Replace with CLI-generated types when possible:
//
//   npx supabase gen types typescript \
//     --project-id <YOUR_PROJECT_ID> \
//     --schema public \
//     > src/types/database.types.ts
// ---------------------------------------------------------------------------

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  // NOTE: __InternalSupabase was removed — it is only supported by
  // @supabase/supabase-js >= 2.45.0. The project uses 2.44.4, and this
  // field caused the TypeScript SDK to misidentify the schema, resolving
  // all Insert/Update types as `never`.
  public: {
    Tables: {
      // -----------------------------------------------------------------------
      // zones — top-level geographic regions
      // -----------------------------------------------------------------------
      zones: {
        Row: {
          id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_at?: string;
        };
        Update: {
          name?: string;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // areas — sub-divisions within a zone
      // -----------------------------------------------------------------------
      areas: {
        Row: {
          id: string;
          name: string;
          zone_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          zone_id: string;
          created_at?: string;
        };
        Update: {
          name?: string;
          zone_id?: string;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // ss_networks — maps super-stockists to distributors
      // -----------------------------------------------------------------------
      ss_networks: {
        Row: {
          id: string;
          super_stockist_id: string;
          distributor_id: string;
          assigned_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          super_stockist_id: string;
          distributor_id: string;
          assigned_at?: string;
          created_at?: string;
        };
        Update: {
          super_stockist_id?: string;
          distributor_id?: string;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // profiles — one row per auth.users row
      // -----------------------------------------------------------------------
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          phone: string | null;
          role: "super_admin" | "super_stockist" | "sales_person" | "distributor";
          zone_id: string | null;
          area_id: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          phone?: string | null;
          role: "super_admin" | "super_stockist" | "sales_person" | "distributor";
          zone_id?: string | null;
          area_id?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          phone?: string | null;
          role?: "super_admin" | "super_stockist" | "sales_person" | "distributor";
          zone_id?: string | null;
          area_id?: string | null;
          is_active?: boolean;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // products — SKU master table
      // -----------------------------------------------------------------------
      products: {
        Row: {
          id: string;
          name: string;
          category: "Bread" | "Biscuits" | "Cakes" | "Rusk" | "Other";
          mrp: number;
          base_price: number | null;
          weight_size: string;
          tax_rate: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          category: "Bread" | "Biscuits" | "Cakes" | "Rusk" | "Other";
          mrp: number;
          base_price?: number | null;
          weight_size?: string;
          tax_rate?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          category?: "Bread" | "Biscuits" | "Cakes" | "Rusk" | "Other";
          mrp?: number;
          base_price?: number | null;
          weight_size?: string;
          tax_rate?: number;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // price_overrides — per-distributor or per-retailer price overrides
      // -----------------------------------------------------------------------
      price_overrides: {
        Row: {
          id: string;
          product_id: string;
          tier: "distributor" | "retailer";
          user_id: string;
          price: number;
          effective_from: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          tier: "distributor" | "retailer";
          user_id: string;
          price: number;
          effective_from: string;
          created_at?: string;
        };
        Update: {
          price?: number;
          effective_from?: string;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // discount_slabs — quantity or value-based discount slabs per product
      // -----------------------------------------------------------------------
      discount_slabs: {
        Row: {
          id: string;
          product_id: string;
          slab_type: "quantity" | "value";
          min_value: number;
          max_value: number | null;
          discount_percent: number;
          applicable_tier: "distributor" | "retailer";
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          slab_type: "quantity" | "value";
          min_value: number;
          max_value?: number | null;
          discount_percent: number;
          applicable_tier: "distributor" | "retailer";
          created_at?: string;
        };
        Update: {
          min_value?: number;
          max_value?: number | null;
          discount_percent?: number;
          applicable_tier?: "distributor" | "retailer";
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // category_distributor_mappings
      // -----------------------------------------------------------------------
      category_distributor_mappings: {
        Row: {
          id: string;
          category: "Bread" | "Biscuits" | "Cakes" | "Rusk" | "Other";
          distributor_id: string;
          is_exclusive: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          category: "Bread" | "Biscuits" | "Cakes" | "Rusk" | "Other";
          distributor_id: string;
          is_exclusive?: boolean;
          created_at?: string;
        };
        Update: {
          is_exclusive?: boolean;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // deliveries
      // -----------------------------------------------------------------------
      deliveries: {
        Row: {
          id: string;
          sales_person_id: string | null;
          delivery_date: string;
          status: "pending" | "in_progress" | "completed" | "cancelled";
          created_at: string;
        };
        Insert: {
          id?: string;
          sales_person_id?: string | null;
          delivery_date: string;
          status?: "pending" | "in_progress" | "completed" | "cancelled";
          created_at?: string;
        };
        Update: {
          status?: "pending" | "in_progress" | "completed" | "cancelled";
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // stores — retail outlet master
      // -----------------------------------------------------------------------
      stores: {
        Row: {
          id: string;
          name: string;
          owner_name: string | null;
          phone: string | null;
          address: string | null;
          gps_lat: number | null;
          gps_lng: number | null;
          area_id: string;
          primary_distributor_id: string | null;
          is_active: boolean;
          onboarded_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          owner_name?: string | null;
          phone?: string | null;
          address?: string | null;
          gps_lat?: number | null;
          gps_lng?: number | null;
          area_id: string;
          primary_distributor_id?: string | null;
          is_active?: boolean;
          onboarded_by: string;
          created_at?: string;
        };
        Update: {
          name?: string;
          owner_name?: string | null;
          phone?: string | null;
          address?: string | null;
          gps_lat?: number | null;
          gps_lng?: number | null;
          area_id?: string;
          primary_distributor_id?: string | null;
          is_active?: boolean;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // store_photos
      // -----------------------------------------------------------------------
      store_photos: {
        Row: {
          id: string;
          store_id: string;
          photo_url: string;
          uploaded_by: string;
          uploaded_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          photo_url: string;
          uploaded_by: string;
          uploaded_at?: string;
        };
        Update: {
          photo_url?: string;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // store_approval_requests
      // -----------------------------------------------------------------------
      store_approval_requests: {
        Row: {
          id: string;
          store_id: string;
          submitted_by: string;
          assigned_salesperson_id: string | null;
          status: "pending" | "approved" | "rejected";
          rejection_reason: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          submitted_by: string;
          assigned_salesperson_id?: string | null;
          status?: "pending" | "approved" | "rejected";
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: {
          status?: "pending" | "approved" | "rejected";
          rejection_reason?: string | null;
          reviewed_at?: string | null;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // orders
      // -----------------------------------------------------------------------
      orders: {
        Row: {
          id: string;
          distributor_id: string;
          order_date: string;
          status: "draft" | "confirmed" | "dispatched" | "delivered" | "cancelled" | "billed";
          total_amount: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          distributor_id: string;
          order_date: string;
          status?: "draft" | "confirmed" | "dispatched" | "delivered" | "cancelled" | "billed";
          total_amount: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: "draft" | "confirmed" | "dispatched" | "delivered" | "cancelled" | "billed";
          total_amount?: number;
          updated_at?: string;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // order_items
      // -----------------------------------------------------------------------
      order_items: {
        Row: {
          id: string;
          order_id: string;
          product_id: string;
          quantity: number;
          unit_price: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          product_id: string;
          quantity: number;
          unit_price: number;
          created_at?: string;
        };
        Update: {
          quantity?: number;
          unit_price?: number;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // system_config — key/value settings table
      // -----------------------------------------------------------------------
      system_config: {
        Row: {
          id: string;
          key: string;
          value: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          key: string;
          value: string;
          created_at?: string;
        };
        Update: {
          value?: string;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // bills — generated billing documents
      // -----------------------------------------------------------------------
      bills: {
        Row: {
          id: string;
          order_id: string;
          distributor_id: string;
          bill_number: string;
          bill_date: string;
          total_amount: number;
          status: "generated" | "delivered" | "paid";
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          distributor_id: string;
          bill_number: string;
          bill_date: string;
          total_amount: number;
          status?: "generated" | "delivered" | "paid";
          created_at?: string;
        };
        Update: {
          status?: "generated" | "delivered" | "paid";
          total_amount?: number;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // bill_items — line items on a bill
      // -----------------------------------------------------------------------
      bill_items: {
        Row: {
          id: string;
          bill_id: string;
          product_id: string;
          allocated_qty: number;
          unit_price: number;
          tax_amount: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          bill_id: string;
          product_id: string;
          allocated_qty: number;
          unit_price: number;
          tax_amount: number;
          created_at?: string;
        };
        Update: {
          allocated_qty?: number;
          unit_price?: number;
          tax_amount?: number;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // stock_allocations — delivery tracking per bill line item
      // -----------------------------------------------------------------------
      stock_allocations: {
        Row: {
          id: string;
          bill_id: string;
          distributor_id: string;
          product_id: string;
          allocated_qty: number;
          delivered_qty: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          bill_id: string;
          distributor_id: string;
          product_id: string;
          allocated_qty: number;
          delivered_qty?: number;
          created_at?: string;
        };
        Update: {
          allocated_qty?: number;
          delivered_qty?: number;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // audit_logs — impersonation and sensitive action audit trail
      // -----------------------------------------------------------------------
      audit_logs: {
        Row: {
          id: string;
          actor_id: string;
          action: string;
          target_user_id: string | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id: string;
          action: string;
          target_user_id?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          metadata?: Json | null;
        };
        Relationships: [];
      };
    };

    Views: {
      [_ in never]: never;
    };

    Functions: {
      [_ in never]: never;
    };

    Enums: {
      user_role: "super_admin" | "super_stockist" | "sales_person" | "distributor";
      order_status: "draft" | "confirmed" | "dispatched" | "delivered" | "cancelled" | "billed";
    };
  };
}
