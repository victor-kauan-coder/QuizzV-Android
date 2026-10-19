-- Banco do multiplayer do QuizzV (Supabase) — versão 2 (QuizzV 1.9.0).
-- Cole no SQL Editor do projeto e clique em Run. Pode rodar de novo sem quebrar nada.
--
-- O QUE MUDOU DA VERSÃO 1, E POR QUÊ
--
-- Antes as tabelas eram abertas para qualquer um com a chave pública do app
-- (que está dentro do APK): dava para apagar a sala dos outros, mudar placar,
-- e o gabarito ia junto com as perguntas para todos os jogadores. Os pontos e
-- o cronômetro eram calculados em cada celular.
--
-- Agora:
--   - o app SÓ LÊ as tabelas; toda escrita passa pelas funções abaixo, que
--     conferem um segredo (do anfitrião ou do jogador) guardado em tabelas que
--     ninguém lê;
--   - o gabarito fica numa dessas tabelas e só é publicado (`revealed`) quando
--     a questão fecha;
--   - o relógio é o do banco: a questão tem hora de início, a resposta
--     atrasada é recusada e os pontos (500 a 1000) são calculados aqui;
--   - a partida não trava sem o anfitrião: tempo esgotado, qualquer jogador
--     fecha a questão; 30 s no ranking, qualquer jogador avança;
--   - o código da sala também é segredo: fica fora das tabelas legíveis (antes
--     dava para listar o código de todas as salas e entrar em qualquer uma);
--   - a resposta não diz na hora se acertou, e os pontos só entram no placar
--     quando a questão fecha (senão um segundo aparelho descobria a certa);
--   - criar sala tem limites de tamanho e de quantidade, e a limpeza das
--     salas velhas roda no próprio banco.
--
-- ATENÇÃO: o QuizzV 1.8.x e anteriores não funcionam com este banco no
-- multiplayer. Rode este SQL junto com a publicação do 1.9.0.

create extension if not exists pgcrypto with schema extensions;

-- 1. Tabelas ---------------------------------------------------------------

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

alter table public.rooms add column if not exists status text not null default 'waiting';
alter table public.rooms add column if not exists current_question_index integer not null default 0;
alter table public.rooms add column if not exists show_results boolean not null default false;
-- relógio do servidor: quando a questão atual começou e quanto tempo ela tem
alter table public.rooms add column if not exists question_started_at timestamptz;
alter table public.rooms add column if not exists question_time integer not null default 20;
-- quando o ranking da questão atual abriu (para seguir sem o anfitrião)
alter table public.rooms add column if not exists results_at timestamptz;
-- gabarito das questões já encerradas, na ordem: ["A", "Verdadeiro", …]
alter table public.rooms add column if not exists revealed jsonb not null default '[]'::jsonb;
alter table public.players add column if not exists last_answered integer not null default -1;

-- Segredos: sem política nenhuma, ninguém de fora lê nem escreve.
create table if not exists public.room_secrets (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  host_hash text not null,
  answers jsonb not null
);
create table if not exists public.player_secrets (
  player_id uuid primary key references public.players (id) on delete cascade,
  secret_hash text not null
);
-- O código de entrada mora com os segredos: quem não o recebeu do anfitrião
-- não tem como descobri-lo lendo as tabelas.
alter table public.room_secrets add column if not exists code text;
-- Quem criou (hash do IP que o Supabase repassa): limite de salas por origem.
alter table public.room_secrets add column if not exists criador text;
alter table public.room_secrets add column if not exists criada_em timestamptz not null default now();
create index if not exists room_secrets_criador on public.room_secrets (criador, criada_em);
-- Respostas da questão aberta: pontos guardados aqui até a questão fechar.
create table if not exists public.player_answers (
  player_id uuid not null references public.players (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  questao integer not null,
  pontos integer not null,
  primary key (player_id, questao)
);

-- 2. Jogadores somem junto com a sala --------------------------------------
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

-- 3. Limpeza: salas da versão 1 (sem segredo) não têm como continuar --------
delete from public.rooms r
where r.status = 'finished'
   or r.created_at < now() - interval '1 day'
   or not exists (select 1 from public.room_secrets s where s.room_id = r.id);

delete from public.players a
using public.players b
where a.room_id = b.room_id
  and lower(a.name) = lower(b.name)
  and (a.created_at, a.id) > (b.created_at, b.id);

-- O código saiu da tabela pública (agora em room_secrets.code).
drop index if exists public.rooms_code_active;
alter table public.rooms alter column code drop not null;
update public.room_secrets s set code = r.code from public.rooms r where s.room_id = r.id and s.code is null;
update public.rooms set code = null where code is not null;
create unique index if not exists room_secrets_code on public.room_secrets (code);
create unique index if not exists players_room_name
  on public.players (room_id, lower(name));
create index if not exists players_room_idx on public.players (room_id);

-- 4. Permissões: o app lê; escrever, só pelas funções -----------------------
alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.room_secrets enable row level security;
alter table public.player_secrets enable row level security;
alter table public.player_answers enable row level security;

drop policy if exists "salas abertas" on public.rooms;
drop policy if exists "jogadores abertos" on public.players;
drop policy if exists "salas visiveis" on public.rooms;
drop policy if exists "jogadores visiveis" on public.players;

-- Ler é necessário para o tempo real (o Supabase entrega o que a política deixa ver).
create policy "salas visiveis" on public.rooms for select to anon, authenticated using (true);
create policy "jogadores visiveis" on public.players for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.rooms, public.players from anon, authenticated;
revoke all on public.room_secrets, public.player_secrets, public.player_answers from anon, authenticated;
grant select on public.rooms, public.players to anon, authenticated;

-- 5. Tempo real nas duas tabelas públicas (os segredos ficam de fora) ------
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

-- 6. Funções ---------------------------------------------------------------
-- As que mexem nas tabelas são `security definer` (rodam com a permissão do
-- dono) e conferem o segredo antes de qualquer coisa.

-- A versão 1 recebia os pontos prontos do celular: sai de cena.
drop function if exists public.registrar_resposta(uuid, integer, integer);

create or replace function public.qv_hash(p_segredo text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(coalesce(p_segredo, ''), 'sha256'), 'hex');
$$;

create or replace function public.qv_eh_anfitriao(p_sala uuid, p_segredo text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select length(coalesce(p_segredo, '')) >= 32 and exists (
    select 1 from public.room_secrets s
    where s.room_id = p_sala and s.host_hash = public.qv_hash(p_segredo)
  );
$$;

create or replace function public.qv_eh_jogador(p_jogador uuid, p_segredo text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select length(coalesce(p_segredo, '')) >= 32 and exists (
    select 1 from public.player_secrets s
    where s.player_id = p_jogador and s.secret_hash = public.qv_hash(p_segredo)
  );
$$;

-- O relógio do banco, para o app acertar o cronômetro (cada celular tem o seu).
create or replace function public.agora()
returns timestamptz
language sql
stable
as $$ select now(); $$;

-- Cria a sala. `p_quiz` já vem SEM gabarito; `p_respostas` é o gabarito, na
-- mesma ordem, e vai para a tabela secreta, junto com o código (sorteado
-- aqui). Devolve a sala com o código, que só quem cria fica sabendo.
-- (A versão anterior devolvia `rooms`; o tipo de retorno mudou.)
drop function if exists public.criar_sala(jsonb, jsonb, text, integer);
create function public.criar_sala(p_quiz jsonb, p_respostas jsonb, p_segredo text, p_tempo integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  n integer;
  codigo text;
  sala public.rooms;
  origem text;
begin
  if length(coalesce(p_segredo, '')) < 32 then raise exception 'segredo inválido'; end if;
  if jsonb_typeof(p_quiz -> 'questions') is distinct from 'array' then raise exception 'quiz inválido'; end if;
  n := jsonb_array_length(p_quiz -> 'questions');
  if n < 1 or n > 200 then raise exception 'o quiz precisa ter de 1 a 200 questões'; end if;
  if jsonb_typeof(p_respostas) is distinct from 'array' or jsonb_array_length(p_respostas) <> n then
    raise exception 'gabarito não confere com as questões';
  end if;
  -- Cada item do gabarito é uma letra ou "Verdadeiro"/"Falso": nada além disso
  -- é guardado (antes um item podia ter qualquer tamanho).
  if exists (
    select 1 from jsonb_array_elements(p_respostas) e
    where jsonb_typeof(e) <> 'string' or length(e #>> '{}') > 16
  ) then
    raise exception 'gabarito inválido';
  end if;
  if pg_column_size(p_quiz) > 400000 then raise exception 'quiz grande demais para o multiplayer'; end if;

  -- A limpeza roda aqui também: não depende de alguém abrir o app.
  perform public.limpar_salas_antigas();
  -- Limite por origem: 10 salas a cada 10 minutos por IP. Um teto só geral
  -- virava alavanca — uma pessoa enchia o teto e ninguém mais criava sala.
  -- O IP vem do cabeçalho que a API do Supabase repassa ao banco; o hash
  -- evita guardar o endereço em si.
  origem := nullif(btrim(split_part(coalesce(
    current_setting('request.headers', true)::json ->> 'cf-connecting-ip',
    current_setting('request.headers', true)::json ->> 'x-forwarded-for',
    current_setting('request.headers', true)::json ->> 'x-real-ip', ''), ',', 1)), '');
  if origem is not null then
    origem := public.qv_hash('ip:' || origem);
    if (select count(*) from public.room_secrets
         where criador = origem and criada_em > now() - interval '10 minutes') >= 10 then
      raise exception 'Você criou muitas salas agora. Tente de novo em alguns minutos.';
    end if;
  end if;
  -- Teto geral, só como última barreira (bem acima do uso normal).
  if (select count(*) from public.rooms where created_at > now() - interval '10 minutes') >= 5000 then
    raise exception 'Muitas salas sendo criadas agora. Tente de novo em alguns minutos.';
  end if;
  if jsonb_path_exists(p_quiz, '$.questions[*].answer') then
    raise exception 'o gabarito não pode ir junto das questões';
  end if;

  insert into public.rooms (host_id, quiz_data, question_time)
  values ('host', p_quiz, least(greatest(coalesce(p_tempo, 20), 5), 120))
  returning * into sala;

  for tentativa in 1..8 loop
    codigo := '';
    for i in 1..5 loop
      codigo := codigo || substr(alfabeto, 1 + floor(random() * length(alfabeto))::integer, 1);
    end loop;
    begin
      insert into public.room_secrets (room_id, host_hash, answers, code, criador)
      values (sala.id, public.qv_hash(p_segredo), p_respostas, codigo, origem);
      return to_jsonb(sala) || jsonb_build_object('code', codigo);
    exception when unique_violation then
      null; -- código já em uso: sorteia outro
    end;
  end loop;
  raise exception 'não foi possível gerar um código de sala';
end;
$$;

-- Jogador entra numa sala que ainda não começou.
create or replace function public.entrar_sala(p_codigo text, p_nome text, p_segredo text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  sala public.rooms;
  jogador public.players;
  nome text := btrim(coalesce(p_nome, ''));
begin
  if length(coalesce(p_segredo, '')) < 32 then raise exception 'segredo inválido'; end if;
  if length(nome) < 1 or length(nome) > 30 then raise exception 'Escolha um apelido de 1 a 30 letras.'; end if;
  select r.* into sala
    from public.room_secrets s join public.rooms r on r.id = s.room_id
   where s.code = upper(btrim(coalesce(p_codigo, ''))) and r.status <> 'finished'
   for update of r;
  if sala.id is null then raise exception 'Sala não encontrada. Confira o código com o anfitrião.'; end if;
  if sala.status = 'playing' then raise exception 'Essa partida já começou. Peça para o anfitrião criar outra sala.'; end if;
  if (select count(*) from public.players where room_id = sala.id) >= 100 then
    raise exception 'A sala está cheia.';
  end if;
  begin
    insert into public.players (room_id, name) values (sala.id, nome) returning * into jogador;
  exception when unique_violation then
    raise exception 'Já tem alguém chamado “%” nesta sala. Escolha outro apelido.', nome;
  end;
  insert into public.player_secrets (player_id, secret_hash) values (jogador.id, public.qv_hash(p_segredo));
  return jsonb_build_object(
    'room', to_jsonb(sala) || jsonb_build_object('code', upper(btrim(p_codigo))),
    'player', to_jsonb(jogador)
  );
end;
$$;

create or replace function public.iniciar_partida(p_sala uuid, p_segredo text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.qv_eh_anfitriao(p_sala, p_segredo) then raise exception 'só o anfitrião começa a partida'; end if;
  update public.rooms
     set status = 'playing', current_question_index = 0, show_results = false,
         question_started_at = now(), results_at = null, revealed = '[]'::jsonb
   where id = p_sala and status = 'waiting';
end;
$$;

-- Fecha a questão `p_questao` e publica o gabarito dela. O anfitrião fecha
-- quando quiser; um jogador só quando o tempo já acabou (anfitrião sumido).
create or replace function public.encerrar_questao(p_sala uuid, p_questao integer, p_segredo text, p_jogador uuid default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  sala public.rooms;
  certa jsonb;
begin
  select * into sala from public.rooms where id = p_sala for update;
  if sala.id is null or sala.status <> 'playing' or sala.show_results or sala.current_question_index <> p_questao then
    return; -- já fechada (dois cliques, ou anfitrião e jogador ao mesmo tempo)
  end if;
  if not public.qv_eh_anfitriao(p_sala, p_segredo) then
    if p_jogador is null or not public.qv_eh_jogador(p_jogador, p_segredo)
       or not exists (select 1 from public.players where id = p_jogador and room_id = p_sala) then
      raise exception 'sem permissão';
    end if;
    if now() < sala.question_started_at + make_interval(secs => sala.question_time + 2) then
      raise exception 'o tempo ainda não acabou';
    end if;
  end if;
  select s.answers -> p_questao into certa from public.room_secrets s where s.room_id = p_sala;
  -- Os pontos desta questão só entram no placar público agora, junto com o gabarito.
  update public.players p
     set score = p.score + a.pontos
    from public.player_answers a
   where a.room_id = p_sala and a.questao = p_questao and a.player_id = p.id;
  update public.rooms
     set show_results = true, results_at = now(),
         revealed = case when jsonb_array_length(revealed) = p_questao then revealed || jsonb_build_array(certa) else revealed end
   where id = p_sala;
end;
$$;

-- Próxima questão. Do anfitrião, a qualquer hora depois do ranking; de um
-- jogador, só 30 s depois (o anfitrião sumiu).
create or replace function public.proxima_questao(p_sala uuid, p_questao integer, p_segredo text, p_jogador uuid default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  sala public.rooms;
  total integer;
begin
  select * into sala from public.rooms where id = p_sala for update;
  if sala.id is null or sala.status <> 'playing' or not sala.show_results or sala.current_question_index <> p_questao - 1 then
    return;
  end if;
  if not public.qv_eh_anfitriao(p_sala, p_segredo) then
    if p_jogador is null or not public.qv_eh_jogador(p_jogador, p_segredo)
       or not exists (select 1 from public.players where id = p_jogador and room_id = p_sala) then
      raise exception 'sem permissão';
    end if;
    if now() < sala.results_at + interval '30 seconds' then raise exception 'espere o anfitrião'; end if;
  end if;
  total := jsonb_array_length(sala.quiz_data -> 'questions');
  if p_questao >= total then
    update public.rooms set status = 'finished' where id = p_sala;
  else
    update public.rooms
       set current_question_index = p_questao, show_results = false,
           question_started_at = now(), results_at = null
     where id = p_sala;
  end if;
end;
$$;

-- Resposta. Confere a questão e o tempo pelo relógio do banco e calcula os
-- pontos aqui (500 a 1000 pelo acerto, conforme a rapidez), mas NÃO conta se
-- acertou: os pontos ficam guardados até a questão fechar. Dizer na hora
-- deixava um segundo aparelho descobrir a resposta certa e passá-la adiante.
-- Devolve só { recebida: true }.
create or replace function public.responder(p_jogador uuid, p_segredo text, p_questao integer, p_resposta text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  jogador public.players;
  sala public.rooms;
  certa text;
  limite double precision;
  passou double precision;
  pontos integer := 0;
  acertou boolean;
begin
  if not public.qv_eh_jogador(p_jogador, p_segredo) then raise exception 'sem permissão'; end if;
  select * into jogador from public.players where id = p_jogador for update;
  select * into sala from public.rooms where id = jogador.room_id;
  if sala.status <> 'playing' or sala.show_results or sala.current_question_index <> p_questao then
    raise exception 'Esta questão já foi encerrada.';
  end if;
  if jogador.last_answered >= p_questao then raise exception 'Você já respondeu esta questão.'; end if;
  limite := greatest(sala.question_time, 1);
  passou := extract(epoch from now() - sala.question_started_at);
  -- 1,5 s de folga para a rede; depois disso, tempo esgotado.
  if passou > limite + 1.5 then raise exception 'O tempo desta questão acabou.'; end if;
  select s.answers ->> p_questao into certa from public.room_secrets s where s.room_id = sala.id;
  acertou := upper(btrim(coalesce(p_resposta, ''))) = upper(btrim(coalesce(certa, '')));
  if acertou then
    pontos := round(500 + 500 * greatest(0, least(1, (limite - passou) / limite)));
  end if;
  insert into public.player_answers (player_id, room_id, questao, pontos)
  values (p_jogador, sala.id, p_questao, pontos);
  -- "Já respondeu" continua público: é o que mostra quantos faltam.
  update public.players set last_answered = p_questao where id = p_jogador;
  return jsonb_build_object('recebida', true);
end;
$$;

-- Sair (o próprio jogador) ou remover (o anfitrião).
create or replace function public.sair_da_sala(p_jogador uuid, p_segredo text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.qv_eh_jogador(p_jogador, p_segredo) then raise exception 'sem permissão'; end if;
  delete from public.players where id = p_jogador;
end;
$$;

create or replace function public.remover_jogador(p_sala uuid, p_jogador uuid, p_segredo text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.qv_eh_anfitriao(p_sala, p_segredo) then raise exception 'só o anfitrião remove jogadores'; end if;
  delete from public.players where id = p_jogador and room_id = p_sala;
end;
$$;

-- Fim da partida (classificação final) e sala apagada.
create or replace function public.finalizar_sala(p_sala uuid, p_segredo text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.qv_eh_anfitriao(p_sala, p_segredo) then raise exception 'sem permissão'; end if;
  update public.rooms set status = 'finished', results_at = now() where id = p_sala;
end;
$$;

create or replace function public.fechar_sala(p_sala uuid, p_segredo text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.qv_eh_anfitriao(p_sala, p_segredo) then raise exception 'sem permissão'; end if;
  delete from public.rooms where id = p_sala;
end;
$$;

-- Limpeza: o app chama ao abrir; apaga salas com mais de um dia e as já
-- encerradas há mais de 10 minutos.
create or replace function public.limpar_salas_antigas()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.rooms
   where created_at < now() - interval '1 day'
      or (status = 'waiting' and created_at < now() - interval '3 hours')
      or (status = 'finished' and coalesce(results_at, created_at) < now() - interval '10 minutes');
$$;

-- Ninguém chama as auxiliares direto; o app só usa as de baixo.
revoke all on function public.qv_hash(text) from public, anon, authenticated;
revoke all on function public.qv_eh_anfitriao(uuid, text) from public, anon, authenticated;
revoke all on function public.qv_eh_jogador(uuid, text) from public, anon, authenticated;

revoke all on function public.criar_sala(jsonb, jsonb, text, integer) from public;
revoke all on function public.entrar_sala(text, text, text) from public;
revoke all on function public.iniciar_partida(uuid, text) from public;
revoke all on function public.encerrar_questao(uuid, integer, text, uuid) from public;
revoke all on function public.proxima_questao(uuid, integer, text, uuid) from public;
revoke all on function public.responder(uuid, text, integer, text) from public;
revoke all on function public.sair_da_sala(uuid, text) from public;
revoke all on function public.remover_jogador(uuid, uuid, text) from public;
revoke all on function public.finalizar_sala(uuid, text) from public;
revoke all on function public.fechar_sala(uuid, text) from public;

grant execute on function public.agora() to anon, authenticated;
grant execute on function public.criar_sala(jsonb, jsonb, text, integer) to anon, authenticated;
grant execute on function public.entrar_sala(text, text, text) to anon, authenticated;
grant execute on function public.iniciar_partida(uuid, text) to anon, authenticated;
grant execute on function public.encerrar_questao(uuid, integer, text, uuid) to anon, authenticated;
grant execute on function public.proxima_questao(uuid, integer, text, uuid) to anon, authenticated;
grant execute on function public.responder(uuid, text, integer, text) to anon, authenticated;
grant execute on function public.sair_da_sala(uuid, text) to anon, authenticated;
grant execute on function public.remover_jogador(uuid, uuid, text) to anon, authenticated;
grant execute on function public.finalizar_sala(uuid, text) to anon, authenticated;
grant execute on function public.fechar_sala(uuid, text) to anon, authenticated;
grant execute on function public.limpar_salas_antigas() to anon, authenticated;
