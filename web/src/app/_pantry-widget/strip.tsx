import { listRecentPantryItems } from "@/lib/queries";
import { PantryStripClient } from "./strip-client";

export async function RecentPantryStrip() {
  const items = await listRecentPantryItems();
  if (items.length === 0) return null;
  return <PantryStripClient items={items} />;
}
