// src/app/(dashboard)/products/actions.ts
// ---------------------------------------------------------------------------
// Server Actions for the Product Master & Pricing Engine.
//
// ALL mutations go through these server-side functions — they validate input,
// enforce business rules, and interact with Supabase.
//
// Business rules enforced here:
//   • SKUs cannot be deleted — only deactivated (deactivateProduct).
//   • Tax-rate changes are allowed but the UI must show a warning toast first.
//   • Price override hierarchy is: retailer > distributor > base price.
//   • Category-distributor mappings support exclusive or shared assignment.
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProductCategory =
  | "Bread"
  | "Biscuits"
  | "Cakes"
  | "Rusk"
  | "Other";

export type PricingTier = "distributor" | "retailer";

export type SlabType = "quantity" | "value";

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  mrp: number;
  base_price?: number | null;
  weight_size: string;
  tax_rate: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PriceOverride {
  id: string;
  product_id: string;
  tier: PricingTier;
  user_id: string;
  user_name?: string;
  price: number;
  effective_from: string;
  created_at: string;
}

export interface DiscountSlab {
  id: string;
  product_id: string;
  slab_type: SlabType;
  min_value: number;
  max_value: number | null;
  discount_percent: number;
  applicable_tier: PricingTier;
  created_at: string;
}

export interface CategoryDistributorMapping {
  id: string;
  category: ProductCategory;
  distributor_id: string;
  distributor_name?: string;
  is_exclusive: boolean;
  created_at: string;
}

export interface Distributor {
  id: string;
  full_name: string | null;
}

// ─── Action result helpers ────────────────────────────────────────────────────

interface ActionResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Product CRUD ─────────────────────────────────────────────────────────────

export async function getProducts(): Promise<Product[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    console.error("[getProducts]", error.message);
    return [];
  }
  return (data ?? []) as Product[];
}

export async function getProduct(id: string): Promise<Product | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("[getProduct]", error.message);
    return null;
  }
  return data as Product;
}

export async function createProduct(
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  const supabase = createClient();

  const name = formData.get("name") as string;
  const category = formData.get("category") as ProductCategory;
  const mrp = parseFloat(formData.get("mrp") as string);
  const weight_size = formData.get("weight_size") as string;
  const tax_rate = parseFloat(formData.get("tax_rate") as string);
  const is_active = formData.get("is_active") !== "off";

  if (!name?.trim()) return { success: false, error: "Product name is required." };
  if (!category) return { success: false, error: "Category is required." };
  if (isNaN(mrp) || mrp < 0) return { success: false, error: "MRP must be a non-negative number." };
  if (isNaN(tax_rate) || tax_rate < 0 || tax_rate > 100)
    return { success: false, error: "Tax rate must be between 0 and 100." };

  const { data, error } = await supabase
    .from("products")
    .insert({
      name: name.trim(),
      category,
      mrp,
      weight_size: weight_size?.trim() ?? "",
      tax_rate,
      is_active,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[createProduct]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/products");
  return { success: true, data: { id: (data as any).id } };
}

export async function updateProduct(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  const supabase = createClient();

  const name = formData.get("name") as string;
  const category = formData.get("category") as ProductCategory;
  const mrp = parseFloat(formData.get("mrp") as string);
  const weight_size = formData.get("weight_size") as string;
  const tax_rate = parseFloat(formData.get("tax_rate") as string);
  const is_active = formData.get("is_active") !== "off";

  if (!name?.trim()) return { success: false, error: "Product name is required." };
  if (!category) return { success: false, error: "Category is required." };
  if (isNaN(mrp) || mrp < 0) return { success: false, error: "MRP must be a non-negative number." };
  if (isNaN(tax_rate) || tax_rate < 0 || tax_rate > 100)
    return { success: false, error: "Tax rate must be between 0 and 100." };

  const { error } = await supabase
    .from("products")
    .update({
      name: name.trim(),
      category,
      mrp,
      weight_size: weight_size?.trim() ?? "",
      tax_rate,
      is_active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("[updateProduct]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/products");
  revalidatePath(`/dashboard/products/${id}`);
  return { success: true };
}

/**
 * Business rule: SKUs cannot be hard-deleted — only deactivated.
 */
export async function deactivateProduct(id: string): Promise<ActionResult> {
  const supabase = createClient();

  const { error } = await supabase
    .from("products")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("[deactivateProduct]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/products");
  revalidatePath(`/dashboard/products/${id}`);
  return { success: true };
}

// ─── Pricing Engine ───────────────────────────────────────────────────────────

export async function getPriceOverrides(
  productId: string
): Promise<PriceOverride[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("price_overrides")
    .select("*, profiles(full_name)")
    .eq("product_id", productId)
    .order("effective_from", { ascending: false });

  if (error) {
    console.error("[getPriceOverrides]", error.message);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    product_id: row.product_id,
    tier: row.tier,
    user_id: row.user_id,
    price: row.price,
    effective_from: row.effective_from,
    created_at: row.created_at,
    user_name: row.profiles?.full_name ?? null,
  }));
}

/**
 * Upsert a price override. Conflicts on (product_id, tier, user_id).
 */
export async function upsertPriceOverride(
  productId: string,
  tier: PricingTier,
  userId: string,
  price: number,
  effectiveFrom: string
): Promise<ActionResult> {
  const supabase = createClient();

  if (price < 0) return { success: false, error: "Price must be non-negative." };
  if (!effectiveFrom) return { success: false, error: "Effective date is required." };

  const { error } = await supabase
    .from("price_overrides")
    .upsert(
      {
        product_id: productId,
        tier,
        user_id: userId,
        price,
        effective_from: effectiveFrom,
      },
      { onConflict: "product_id,tier,user_id" }
    );

  if (error) {
    console.error("[upsertPriceOverride]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath(`/dashboard/products/${productId}`);
  return { success: true };
}

export async function deletePriceOverride(
  overrideId: string,
  productId: string
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from("price_overrides")
    .delete()
    .eq("id", overrideId);

  if (error) return { success: false, error: error.message };
  revalidatePath(`/dashboard/products/${productId}`);
  return { success: true };
}

export async function updateBasePrice(
  productId: string,
  basePrice: number
): Promise<ActionResult> {
  const supabase = createClient();

  if (isNaN(basePrice) || basePrice < 0)
    return { success: false, error: "Base price must be non-negative." };

  const { error } = await supabase
    .from("products")
    .update({ base_price: basePrice, updated_at: new Date().toISOString() })
    .eq("id", productId);

  if (error) {
    console.error("[updateBasePrice]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath(`/dashboard/products/${productId}`);
  return { success: true };
}

// ─── Discount Slabs ───────────────────────────────────────────────────────────

export async function getDiscountSlabs(
  productId: string
): Promise<DiscountSlab[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("discount_slabs")
    .select("*")
    .eq("product_id", productId)
    .order("slab_type", { ascending: true })
    .order("min_value", { ascending: true });

  if (error) {
    console.error("[getDiscountSlabs]", error.message);
    return [];
  }
  return (data ?? []) as DiscountSlab[];
}

export async function upsertDiscountSlab(
  productId: string,
  slabData: {
    id?: string;
    slab_type: SlabType;
    min_value: number;
    max_value: number | null;
    discount_percent: number;
    applicable_tier: PricingTier;
  }
): Promise<ActionResult> {
  const supabase = createClient();

  const { discount_percent, min_value } = slabData;
  if (discount_percent < 0 || discount_percent > 100)
    return { success: false, error: "Discount % must be between 0 and 100." };
  if (min_value < 0)
    return { success: false, error: "Min value must be non-negative." };
  if (slabData.max_value !== null && slabData.max_value < min_value)
    return { success: false, error: "Max value must be greater than min value." };

  const payload = {
    product_id: productId,
    slab_type: slabData.slab_type,
    min_value: slabData.min_value,
    max_value: slabData.max_value,
    discount_percent: slabData.discount_percent,
    applicable_tier: slabData.applicable_tier,
  };

  let error;
  if (slabData.id) {
    ({ error } = await supabase
      .from("discount_slabs")
      .update(payload)
      .eq("id", slabData.id));
  } else {
    ({ error } = await supabase.from("discount_slabs").insert(payload));
  }

  if (error) {
    console.error("[upsertDiscountSlab]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath(`/dashboard/products/${productId}`);
  return { success: true };
}

export async function deleteDiscountSlab(
  slabId: string,
  productId: string
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from("discount_slabs")
    .delete()
    .eq("id", slabId);

  if (error) return { success: false, error: error.message };
  revalidatePath(`/dashboard/products/${productId}`);
  return { success: true };
}

// ─── Category-Distributor Mapping ─────────────────────────────────────────────

export async function getCategoryMappings(): Promise<CategoryDistributorMapping[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("category_distributor_mappings")
    .select("*, profiles(full_name)")
    .order("category", { ascending: true });

  if (error) {
    console.error("[getCategoryMappings]", error.message);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    category: row.category,
    distributor_id: row.distributor_id,
    is_exclusive: row.is_exclusive,
    created_at: row.created_at,
    distributor_name: row.profiles?.full_name ?? null,
  }));
}

export async function assignCategoryDistributor(
  category: ProductCategory,
  distributorId: string,
  isExclusive: boolean
): Promise<ActionResult> {
  const supabase = createClient();

  const { error } = await supabase
    .from("category_distributor_mappings")
    .upsert(
      {
        category,
        distributor_id: distributorId,
        is_exclusive: isExclusive,
      },
      { onConflict: "category,distributor_id" }
    );

  if (error) {
    console.error("[assignCategoryDistributor]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/master/category-mapping");
  revalidatePath("/dashboard/products");
  return { success: true };
}

export async function removeCategoryDistributor(
  category: ProductCategory,
  distributorId: string
): Promise<ActionResult> {
  const supabase = createClient();

  const { error } = await supabase
    .from("category_distributor_mappings")
    .delete()
    .eq("category", category)
    .eq("distributor_id", distributorId);

  if (error) {
    console.error("[removeCategoryDistributor]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/master/category-mapping");
  revalidatePath("/dashboard/products");
  return { success: true };
}

export async function getActiveDistributors(): Promise<Distributor[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("role", "distributor")
    .order("full_name", { ascending: true });

  if (error) {
    console.error("[getActiveDistributors]", error.message);
    return [];
  }
  return (data ?? []) as Distributor[];
}
