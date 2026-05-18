-- 0002_add_is_favorite.sql
--
-- Adds an is_favorite boolean to recipes. User-controlled flag, orthogonal
-- to my_rating (you can favorite a 3-star recipe; you can rate a 5-star
-- recipe without favoriting it). LLM ingesters do NOT set this — favoriting
-- happens after the fact through whatever review UI we build.

alter table public.recipes
    add column if not exists is_favorite boolean default false;
