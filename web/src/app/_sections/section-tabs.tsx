import Link from "next/link";
import type { SectionTab } from "@/lib/queries";

// Segmented-control style pill toggle. Server-rendered — URL is the state.
export function SectionTabs({
  current,
  paramKey,
  sp,
}: {
  current: SectionTab;
  paramKey: string;
  sp: Record<string, string | undefined>;
}) {
  return (
    <div className="inline-flex rounded-full border border-border bg-muted p-0.5">
      <TabLink
        href={urlWith(sp, paramKey, "seasonal")}
        active={current === "seasonal"}
      >
        Seasonal
      </TabLink>
      <TabLink
        href={urlWith(sp, paramKey, "coverage")}
        active={current === "coverage"}
      >
        By coverage
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
  return qs ? `/?${qs}` : "/";
}
