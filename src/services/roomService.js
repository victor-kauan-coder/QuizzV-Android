import { supabase } from "./supabase";

// Função para o Host criar uma sala
export const createRoom = async (quizData) => {
  try {
    const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();

    const { data, error } = await supabase
      .from("rooms")
      .insert([
        {
          code: roomCode,
          host_id: "host_local",
          quiz_data: quizData,
        },
      ])
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Erro ao criar sala:", error.message);
    throw error;
  }
};

// Função para o Jogador entrar na sala
export const joinRoom = async (roomCode, playerName) => {
  try {
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("*")
      .eq("code", roomCode.toUpperCase())
      .single();

    if (roomError || !room)
      throw new Error("Sala não encontrada. Verifique o código.");

    const { data: player, error: playerError } = await supabase
      .from("players")
      .insert([{ room_id: room.id, name: playerName }])
      .select()
      .single();

    if (playerError) throw playerError;

    return { room, player };
  } catch (error) {
    console.error("Erro ao entrar na sala:", error.message);
    throw error;
  }
};

// ✅ NOVO: Limpa a sala e os jogadores ao finalizar a partida.
// A ordem importa: deleta players ANTES da room por causa da foreign key.
// O status "finished" é enviado ANTES da deleção para que os players
// recebam o evento via Realtime e naveguem para Home antes de sumir.
export const cleanupRoom = async (roomId) => {
  try {
    console.log(`[cleanupRoom] Iniciando limpeza da sala ${roomId}...`);

    // 1. Sinaliza "finished" para que todos os subscribers (players) sejam
    //    notificados e naveguem para Home antes de a linha ser deletada.
    await supabase
      .from("rooms")
      .update({ status: "finished" })
      .eq("id", roomId);

    // 2. Aguarda 2 segundos para garantir que o evento Realtime chegou
    //    nos devices dos players antes de deletar os registros.
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 3. Deleta os players (foreign key: players.room_id → rooms.id)
    const { error: playersError } = await supabase
      .from("players")
      .delete()
      .eq("room_id", roomId);

    if (playersError) {
      console.error(
        "[cleanupRoom] Erro ao deletar players:",
        playersError.message,
      );
    } else {
      console.log("[cleanupRoom] Players deletados com sucesso.");
    }

    // 4. Deleta a sala
    const { error: roomError } = await supabase
      .from("rooms")
      .delete()
      .eq("id", roomId);

    if (roomError) {
      console.error("[cleanupRoom] Erro ao deletar sala:", roomError.message);
    } else {
      console.log("[cleanupRoom] Sala deletada com sucesso.");
    }
  } catch (error) {
    // Erro não-crítico: o jogo já terminou, só o cleanup falhou.
    // Não lançamos o erro para não travar a navegação do host.
    console.error("[cleanupRoom] Falha geral no cleanup:", error.message);
  }
};
