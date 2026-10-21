-- DRAFT: apply only with explicit owner approval. App remains browser-persistent
-- until COOKING_VARIANTS_ENABLED=true is configured on the Python backend.
-- Single-user, service-role-only access, matching migration 0033.
create table public.cooking_recipe_variants (
    recipe_id uuid not null references public.recipes(id) on delete cascade,
    recipe_version text not null,
    modifications jsonb not null default '[]'::jsonb
        check (jsonb_typeof(modifications) = 'array'),
    updated_at timestamptz not null default now(),
    primary key (recipe_id, recipe_version)
);
alter table public.cooking_recipe_variants enable row level security;
