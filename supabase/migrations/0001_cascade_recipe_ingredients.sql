-- 0001_cascade_recipe_ingredients.sql
--
-- Adds ON DELETE CASCADE to the recipe_ingredients.recipe_id FK so deleting
-- a recipe also deletes its ingredients. Without this, deleting a recipe
-- either fails (if ingredients exist) or leaves orphan rows.
--
-- Idempotent: drops any existing FK on recipe_ingredients.recipe_id by name
-- lookup before recreating with the desired behavior.

do $$
declare
    fk_name text;
begin
    select tc.constraint_name into fk_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
    where tc.table_schema = 'public'
        and tc.table_name = 'recipe_ingredients'
        and tc.constraint_type = 'FOREIGN KEY'
        and kcu.column_name = 'recipe_id'
    limit 1;

    if fk_name is not null then
        execute format(
            'alter table public.recipe_ingredients drop constraint %I',
            fk_name
        );
    end if;
end $$;

alter table public.recipe_ingredients
    add constraint recipe_ingredients_recipe_id_fkey
    foreign key (recipe_id)
    references public.recipes(id)
    on delete cascade;
