import * as Crypto from "expo-crypto";
import { supabase } from "./supabase";

// Multiplayer v2 (supabase/schema.sql): o app só LÊ as tabelas; toda escrita
// passa por funções do banco que conferem um segredo. O segredo do anfitrião
// (por sala) e o de cada jogador ficam só na memória deste aparelho — quem não
// tem o segredo não começa, não encerra, não apaga e não responde por ninguém.
const segredos = new Map(); // id da sala ou do jogador -> segredo

const novoSegredo = () => (Crypto.randomUUID() + Crypto.randomUUID()).replace(/-/g, "");

const isNetwork = (error) =>
  /network|fetch|timed? ?out|ENOTFOUND|resolve|aborted/i.test(String(error?.message || error || ""));

// Erros do Supabase/rede em mensagens que o jogador entende. As recusas do
// banco (sala cheia, apelido repetido, tempo esgotado) já vêm em português.
const friendly = (error) =>
  isNetwork(error)
    ? new Error(
        "Não foi possível conectar ao servidor do multiplayer. Verifique sua internet e tente de novo.",
      )
    : /function .* does not exist|Could not find the function/i.test(String(error?.message))
      ? new Error("O servidor do multiplayer ainda não foi atualizado para esta versão do QuizzV.")
      : new Error(error?.message || "Algo deu errado no multiplayer.");

// Chamadas que mexem no andamento da partida: repete se a rede falhar
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

const rpc = (fn, args) => run(() => supabase.rpc(fn, args));

// A sala pública leva só o que os jogadores mostram, SEM o gabarito (ele vai
// separado, para a tabela que ninguém lê) e sem imagens nem explicações.
const roomQuiz = (quiz) => ({
  title: quiz.title,
  type: quiz.type || "vf",
  questions: quiz.questions.map(({ question, options }) => (options ? { question, options } : { question })),
});
// Como o jogo sempre comparou: múltipla escolha pela letra ("B) 4" vale "B"),
// V ou F pela palavra. O jogador manda no mesmo formato.
const gabarito = (quiz) =>
  quiz.questions.map((q) => {
    const a = String(q.answer ?? "").trim();
    if (q.options?.length) return a.charAt(0).toUpperCase();
    return a === "Verdadeiro" ? "Verdadeiro" : "Falso";
  });

/** Anfitrião cria a sala. O banco sorteia o código e guarda o gabarito à parte. */
export const createRoom = async (quiz, tempo = 20) => {
  const segredo = novoSegredo();
  const room = await rpc("criar_sala", {
    p_quiz: roomQuiz(quiz),
    p_respostas: gabarito(quiz),
    p_segredo: segredo,
    p_tempo: tempo,
  });
  segredos.set(room.id, segredo);
  return room;
};

/** Jogador entra numa sala que ainda não começou. */
export const joinRoom = async (roomCode, playerName) => {
  const segredo = novoSegredo();
  const { room, player } = await rpc("entrar_sala", {
    p_codigo: roomCode.trim().toUpperCase(),
    p_nome: playerName.trim(),
    p_segredo: segredo,
  });
  segredos.set(player.id, segredo);
  return { room, player };
};

export const startGame = (roomId) =>
  rpc("iniciar_partida", { p_sala: roomId, p_segredo: segredos.get(roomId) || "" });

/**
 * Fecha a questão `index` (se a sala ainda estiver nela). O anfitrião fecha
 * quando quiser; um jogador (`playerId`) só depois que o tempo acabou — é o
 * que destrava a partida quando o anfitrião some.
 */
export const endQuestion = (roomId, index, playerId = null) =>
  rpc("encerrar_questao", {
    p_sala: roomId,
    p_questao: index,
    p_segredo: segredos.get(playerId || roomId) || "",
    p_jogador: playerId,
  });

/** Próxima questão (ou o fim, depois da última). Jogador só 30 s após o ranking abrir. */
export const nextQuestion = (roomId, index, playerId = null) =>
  rpc("proxima_questao", {
    p_sala: roomId,
    p_questao: index,
    p_segredo: segredos.get(playerId || roomId) || "",
    p_jogador: playerId,
  });

/**
 * Responde a questão `index` com `resposta` ("A"…"E", ou "Verdadeiro"/"Falso").
 * O banco confere o tempo e guarda os pontos até a questão fechar; devolve só
 * { recebida: true } (dizer se acertou na hora revelaria a resposta certa).
 */
export const answerQuestion = (playerId, index, resposta) =>
  rpc("responder", {
    p_jogador: playerId,
    p_segredo: segredos.get(playerId) || "",
    p_questao: index,
    p_resposta: String(resposta),
  });

/** O próprio jogador sai da sala. */
export const removePlayer = (playerId) =>
  rpc("sair_da_sala", { p_jogador: playerId, p_segredo: segredos.get(playerId) || "" })
    .then(() => segredos.delete(playerId))
    .catch((error) => console.error("[removePlayer]", error.message));

/** O anfitrião remove um jogador. */
export const kickPlayer = (roomId, playerId) =>
  rpc("remover_jogador", { p_sala: roomId, p_jogador: playerId, p_segredo: segredos.get(roomId) || "" }).catch(
    (error) => console.error("[kickPlayer]", error.message),
  );

/** Anfitrião saiu antes de começar: a sala some (jogadores saem junto). */
export const leaveRoom = (roomId) =>
  rpc("fechar_sala", { p_sala: roomId, p_segredo: segredos.get(roomId) || "" })
    .then(() => segredos.delete(roomId))
    .catch((error) => console.error("[leaveRoom]", error.message));

/**
 * Fim de jogo: marca "finished" (os jogadores veem a classificação final e
 * podem sair) e apaga a sala um pouco depois; os jogadores saem junto.
 */
export const cleanupRoom = async (roomId) => {
  const segredo = segredos.get(roomId) || "";
  try {
    await rpc("finalizar_sala", { p_sala: roomId, p_segredo: segredo });
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await rpc("fechar_sala", { p_sala: roomId, p_segredo: segredo });
    segredos.delete(roomId);
  } catch (error) {
    // o jogo já terminou; falha na limpeza não pode travar o anfitrião
    // (o banco apaga salas encerradas sozinho, em 10 minutos)
    console.error("[cleanupRoom]", error.message);
  }
};

/* ------------------------------------------------------------------ *
 * Relógio: o tempo da questão é o do banco, não o de cada celular
 * ------------------------------------------------------------------ */

let diferenca = 0; // relógio do banco - relógio deste celular, em ms
let acertado = null;

/** Acerta o relógio uma vez (descontando metade da ida e volta). */
export const syncClock = () => {
  if (!acertado) {
    const ida = Date.now();
    acertado = supabase.rpc("agora").then(({ data, error }) => {
      if (error || !data) {
        acertado = null; // tenta de novo na próxima
        return;
      }
      const volta = Date.now();
      diferenca = new Date(data).getTime() - (ida + volta) / 2;
    });
  }
  return acertado;
};

/** Segundos que faltam na questão atual da sala (pelo relógio do banco). */
export const timeLeft = (room) => {
  if (!room?.question_started_at) return room?.question_time || 20;
  const passou = (Date.now() + diferenca - new Date(room.question_started_at).getTime()) / 1000;
  return Math.max(0, (room.question_time || 20) - passou);
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
