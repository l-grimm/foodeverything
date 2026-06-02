"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";

export type ActionResult = { error?: string };

export async function updatePantryItemName(
  id: string,
  name: string,
): Promise<ActionResult> {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return { error: "Name can't be empty." };
  const { error } = await supabaseAdmin
    .from("pantry_items")
    .update({ name: trimmed })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/");
  return {};
}

export async function deletePantryItem(id: string): Promise<ActionResult> {
  const { error } = await supabaseAdmin
    .from("pantry_items")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/");
  return {};
}
