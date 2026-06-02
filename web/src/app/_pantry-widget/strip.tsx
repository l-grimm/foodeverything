import { listRecentPantryItems } from "@/lib/queries";
import { EditablePantryChip } from "./chip";

export async function RecentPantryStrip() {
  const items = await listRecentPantryItems(30);
  if (items.length === 0) return null;

  return (
    <section className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        Recently added · tap a chip to fix the name or delete
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((i) => (
          <EditablePantryChip key={i.id} id={i.id} name={i.name} />
        ))}
      </div>
    </section>
  );
}
