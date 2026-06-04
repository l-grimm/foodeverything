import Link from "next/link";

export type AddTab = "recipe" | "ingredient";

// Same segmented-control pattern as the home page's SectionTabs, scoped
// to the Add page. Server-rendered — URL is the state via ?tab=ingredient.
export function AddTabs({
  current,
  sp,
}: {
  current: AddTab;
  sp: Record<string, string | undefined>;
}) {
  return (
    <div className="inline-flex rounded-full border border-border bg-muted p-0.5">
      <TabLink href={urlWith(sp, "tab", "recipe")} active={current === "recipe"}>
        Recipe
      </TabLink>
      <TabLink href={urlWith(sp, "tab", "ingredient")} active={current === "ingredient"}>
        Ingredient
      </TabLink>
    </div>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 font-mono uppercase text-[0.7rem] tracking-wider transition ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}

function urlWith(
  sp: Record<string, string | undefined>,
  key: string,
  value: string,
): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v && k !== key) next.set(k, v);
  }
  next.set(key, value);
  const qs = next.toString();
  return qs ? `/add?${qs}` : "/add";
}
