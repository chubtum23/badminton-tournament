-- Knockout relay matches.
--
-- With ko_relay on, a knockout match is one relay game to a target that depends on the round
-- (quarter-finals, semi-finals, final), the three pairs swapping at each third of it. Earlier rounds
-- than the quarter-finals use the quarter-final target. Targets are multiples of three so the swap
-- points are whole numbers.
--
-- ko_rounds is how many rounds the bracket has, written when the knockout starts, so a match's round
-- alone says whether it is a final, a semi or earlier.
alter table public.tournaments
  add column ko_relay boolean not null default false,
  add column ko_relay_quarter int not null default 45 check (ko_relay_quarter > 0 and ko_relay_quarter % 3 = 0),
  add column ko_relay_semi int not null default 63 check (ko_relay_semi > 0 and ko_relay_semi % 3 = 0),
  add column ko_relay_final int not null default 63 check (ko_relay_final > 0 and ko_relay_final % 3 = 0),
  add column ko_rounds int;

update public.tournaments t set ko_rounds = k.rounds
from (select tournament_id, max(round) as rounds from public.matches where stage = 'knockout' group by tournament_id) k
where k.tournament_id = t.id;

-- tournaments is read through an explicit column grant (it hides join_code).
grant select (ko_relay, ko_relay_quarter, ko_relay_semi, ko_relay_final, ko_rounds) on public.tournaments to anon, authenticated;
