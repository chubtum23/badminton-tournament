-- The organiser's own knockout draw.
--
-- Who meets whom used to be decided entirely by the seeding: pool winners against runners-up, with
-- same-pool meetings avoided. That is still the default, but an organiser can now randomise the
-- draw or arrange it by hand before starting the knockout.
--
-- The draw is the seed order it produces: element i is the team in seed i+1's place, and a null is
-- a bye. It is only a plan for a bracket that does not exist yet, so it touches nothing about the
-- pools; startKnockout uses it if it still matches the teams that qualified, and falls back to the
-- seeded draw if the pool results have moved on since.
alter table public.tournaments add column ko_seed_order uuid[];

-- tournaments is read through an explicit column grant (it hides join_code), so a new column has
-- to be named or nobody — the organiser's own page included — can select it.
grant select (ko_seed_order) on public.tournaments to anon, authenticated;
