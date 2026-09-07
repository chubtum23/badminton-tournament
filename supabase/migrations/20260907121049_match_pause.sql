-- A live match's clock can be stopped. paused_at is set while it is stopped; paused_ms
-- accumulates the total time already spent paused, so the countdown ignores stoppages.
alter table public.matches
  add column paused_at timestamptz,
  add column paused_ms bigint not null default 0 check (paused_ms >= 0);
