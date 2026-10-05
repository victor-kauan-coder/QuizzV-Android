import { supabase } from "./supabase";

// Sem O/0 e I/1: o código é lido na tela de outra pessoa
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () =>
  Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

const isNetwork = (error) =>
  /network|fetch|timed? ?out|ENOTFOUND|resolve|aborted/i.test(String(error?.message || error || ""));

// Erros do Supabase/rede em mensagens que o jogador entende
const friendly = (error) =>
  isNetwork(error)
    ? new Error(
        "Não foi possível conectar ao servidor do multiplayer. Verifique sua internet e tente de novo.",
      )
    : new Error(error?.message || "Algo deu errado no multiplayer.");

// Gravações que mexem no andamento da partida: repete se a rede falhar
const run = async (make, tries = 3) => {
  let last;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await make();
    if (!error) return data;
    last = error;
    if (!isNetwork(error)) break;
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  throw friendly(last);
};

// O tempo real reenvia a sala inteira a cada mudança: mandamos só o que os
// jogadores usam, sem imagens nem explicações.
const roomQuiz = (quiz) => ({
  title: quiz.title,
  type: quiz.type || "vf",
  questions: quiz.questions.map(({ question, options, answer }) => ({
    question,
    options,
    answer,
  })),
});

/** Anfitrião cria a sala. Tenta outro código se o sorteado já estiver em uso. */
export const createRoom = async (quiz) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from("rooms")
      .insert([{ code: newCode(), host_id: "host_local", quiz_data: roomQuiz(quiz) }])
      .select()
      .single();
    if (!error) return data;
    if (error.code !== "23505") throw friendly(error); // 23505 = código repetido
  }
  throw new Error("Não foi possível gerar um código de sala. Tente de novo.");
};

/** Jogador entra numa sala que ainda não começou. */
export const joinRoom = async (roomCode, playerName) => {
  const code = roomCode.trim().toUpperCase();
  const name = playerName.trim();
  const { data: room, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("code", code)
    .neq("status", "finished")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw friendly(error);
  if (!room) throw new Error("Sala não encontrada. Confira o código com o anfitrião.");
  if (room.status === "playing") {
    throw new Error("Essa partida já começou. Peça para o anfitrião criar outra sala.");
  }

  const taken = `Já tem alguém chamado “${name}” nesta sala. Escolha outro apelido.`;
  const { data: others } = await supabase.from("players").select("name").eq("room_id", room.id);
  if (others?.some((p) => p.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new Error(taken);
  }

  const { data: player, error: playerError } = await supabase
    .from("players")
    .insert([{ room_id: room.id, name }])
    .select()
    .single();
  if (playerError?.code === "23505") throw new Error(taken); // entrou no mesmo instante
  if (playerError) throw friendly(playerError);

  return { room, player };
};

export const startGame = (roomId) =>
  run(() =>
    supabase
      .from("rooms")
      .update({ status: "playing", current_question_index: 0, show_results: false })
      .eq("id", roomId),
  );

/** Fecha a questão `index` (só se a sala ainda estiver nela). */
export const endQuestion = (roomId, index) =>
  run(() =>
    supabase
      .from("rooms")
      .update({ show_results: true })
      .eq("id", roomId)
      .eq("current_question_index", index),
  );

export const nextQuestion = (roomId, index) =>
  run(() =>
    supabase
      .from("rooms")
      .update({ current_question_index: index, show_results: false })
      .eq("id", roomId),
  );

/**
 * Registra a resposta (certa ou errada) da questão `index`. O banco soma os
 * pontos e ignora uma segunda resposta para a mesma questão.
 */
export const answerQuestion = (playerId, index, points) =>
  run(() =>
    supabase.rpc("registrar_resposta", {
      p_player: playerId,
      p_questao: index,
      p_pontos: Math.max(0, Math.round(points)),
    }),
  );

/** Tira um jogador da sala (ele saiu ou o anfitrião removeu). */
export const removePlayer = (playerId) =>
  run(() => supabase.from("players").delete().eq("id", playerId)).catch((error) =>
    console.error("[removePlayer]", error.message),
  );

/** Anfitrião saiu antes de começar: a sala some (jogadores saem junto). */
export const leaveRoom = (roomId) =>
  run(() => supabase.from("rooms").delete().eq("id", roomId)).catch((error) =>
    console.error("[leaveRoom]", error.message),
  );

/**
 * Fim de jogo: marca "finished" (os jogadores veem a classificação final e
 * podem sair) e apaga a sala um pouco depois; os jogadores saem junto.
 */
export const cleanupRoom = async (roomId) => {
  try {
    await run(() => supabase.from("rooms").update({ status: "finished" }).eq("id", roomId));
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await run(() => supabase.from("rooms").delete().eq("id", roomId));
  } catch (error) {
    // o jogo já terminou; falha na limpeza não pode travar o anfitrião
    console.error("[cleanupRoom]", error.message);
  }
};

/**
 * Chamado quando o app abre: apaga salas abandonadas e, de quebra, conta como
 * atividade no Supabase (projetos gratuitos pausam após uma semana parados).
 */
export const pingServer = () =>
  supabase.rpc("limpar_salas_antigas").then(
    () => {},
    () => {},
  );
