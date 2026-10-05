-- Banco do multiplayer do QuizzV (Supabase).
-- Cole no SQL Editor do projeto e clique em Run. Pode rodar de novo sem quebrar nada.

-- 1. Tabelas (criadas só se ainda não existirem)
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  host_id text,
  quiz_data jsonb not null,
  status text not null default 'waiting',
  current_question_index integer not null default 0,
  show_results boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  name text not null,
  score integer not null default 0,
  created_at timestamptz not null default now()
);

-- Colunas novas em bancos antigos
alter table public.rooms add column if not exists status text not null default 'waiting';
alter table public.rooms add column if not exists current_question_index integer not null default 0;
alter table public.rooms add column if not exists show_results boolean not null default false;
-- índice da última questão que o jogador respondeu (-1 = nenhuma)
alter table public.players add column if not exists last_answered integer not null default -1;

-- 2. Jogadores somem junto com a sala
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.players'::regclass and contype = 'f'
  loop
    execute format('alter table public.players drop constraint %I', r.conname);
  end loop;
end $$;

delete from public.players p
where not exists (select 1 from public.rooms r where r.id = p.room_id);

alter table public.players
  add constraint players_room_id_fkey
  foreign key (room_id) references public.rooms (id) on delete cascade;

-- 3. Limpeza antes dos índices únicos: salas encerradas/antigas e nomes repetidos
delete from public.rooms where status = 'finished' or created_at < now() - interval '1 day';

delete from public.players a
using public.players b
where a.room_id = b.room_id
  and lower(a.name) = lower(b.name)
  and (a.created_at, a.id) > (b.created_at, b.id);

-- um código só pode estar em uma sala ativa por vez
create unique index if not exists rooms_code_active
  on public.rooms (code) where status <> 'finished';
-- dois jogadores não podem ter o mesmo apelido na mesma sala
create unique index if not exists players_room_name
  on public.players (room_id, lower(name));
create index if not exists players_room_idx on public.players (room_id);

-- 4. Permissões: o app não tem login, qualquer aparelho com o app joga
alter table public.rooms enable row level security;
alter table public.players enable row level security;

drop policy if exists "salas abertas" on public.rooms;
create policy "salas abertas" on public.rooms
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "jogadores abertos" on public.players;
create policy "jogadores abertos" on public.players
  for all to anon, authenticated using (true) with check (true);

-- 5. Tempo real nas duas tabelas
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table public.rooms;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'players'
  ) then
    alter publication supabase_realtime add table public.players;
  end if;
end $$;

-- 6. Resposta: soma os pontos no banco e marca a questão como respondida.
-- Só conta uma vez por questão; devolve a pontuação nova (null se já tinha respondido).
create or replace function public.registrar_resposta(p_player uuid, p_questao integer, p_pontos integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare novo integer;
begin
  update public.players
     set score = score + greatest(coalesce(p_pontos, 0), 0),
         last_answered = p_questao
   where id = p_player and last_answered < p_questao
  returning score into novo;
  return novo;
end;
$$;

-- 7. Limpeza: o app chama ao abrir; apaga salas com mais de um dia
create or replace function public.limpar_salas_antigas()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.rooms where created_at < now() - interval '1 day';
$$;

grant execute on function public.registrar_resposta(uuid, integer, integer) to anon, authenticated;
grant execute on function public.limpar_salas_antigas() to anon, authenticated;
