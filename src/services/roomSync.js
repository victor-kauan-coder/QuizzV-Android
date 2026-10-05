// Sincronização das salas multiplayer.
//
// O tempo real do Supabase sozinho não basta: ele perde eventos nos primeiros
// segundos depois de assinar, quando a rede do celular oscila e quando o app vai
// para segundo plano. Por isso cada tela combina três fontes:
//   1. eventos em tempo real (resposta instantânea);
//   2. uma leitura assim que a assinatura fica pronta (cobre a "janela cega");
//   3. uma conferência periódica e ao voltar para o app (rede de segurança).
import { useEffect, useRef, useState } from "react";
import { Alert, AppState } from "react-native";
import { supabase } from "./supabase";

// supabase.channel() devolve o MESMO canal se o nome já existir; telas que se
// substituem rápido precisam de nomes únicos para não reaproveitar um canal velho.
const uniq = () => Math.random().toString(36).slice(2, 9);

// O jogo só anda para frente: espera -> jogando (questão 0, 1, ...) -> fim.
const STATUS_ORDER = { waiting: 0, playing: 1, finished: 2 };
const progress = (r) =>
  (STATUS_ORDER[r.status] ?? 0) * 1e6 + (r.current_question_index || 0) * 2 + (r.show_results ? 1 : 0);

function useLiveTable({ key, fetchNow, bind, pollMs }) {
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const refresh = () => alive && fetchNow(() => alive);
    const channel = bind(supabase.channel(`${key}:${uniq()}`), () => alive)
      .on("system", {}, (payload) => {
        // "Subscribed to PostgreSQL": a partir daqui os eventos chegam
        if (payload?.extension === "postgres_changes" && payload?.status === "ok") refresh();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });
    refresh();
    const timer = setInterval(refresh, pollMs);
    const appState = AppState.addEventListener("change", (s) => s === "active" && refresh());
    return () => {
      alive = false;
      clearInterval(timer);
      appState.remove();
      supabase.removeChannel(channel);
    };
  }, [key]);
}

/**
 * Acompanha a sala. `onRoom(room)` só é chamado quando o jogo avança
 * (eventos fora de ordem são ignorados); `onRoom(null)` = sala apagada.
 */
export function useRoom(roomId, onRoom) {
  const handler = useRef(onRoom);
  handler.current = onRoom;
  const last = useRef(-1);
  const gone = useRef(false);

  const emit = (room) => {
    if (gone.current) return;
    if (!room) {
      gone.current = true;
      handler.current(null);
      return;
    }
    const p = progress(room);
    if (p <= last.current) return;
    last.current = p;
    handler.current(room);
  };

  useLiveTable({
    key: roomId && `room:${roomId}`,
    pollMs: 2500,
    fetchNow: async (isAlive) => {
      const { data, error } = await supabase.from("rooms").select("*").eq("id", roomId).maybeSingle();
      if (!error && isAlive()) emit(data);
    },
    bind: (channel, isAlive) =>
      channel
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
          (p) => isAlive() && emit(p.new),
        )
        // DELETE não aceita filtro no Supabase: conferimos o id aqui
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "rooms" }, (p) => {
          if (isAlive() && p.old?.id === roomId) emit(null);
        }),
  });
}

const samePlayers = (a, b) =>
  a.length === b.length &&
  a.every((p, i) => p.id === b[i].id && p.score === b[i].score && p.last_answered === b[i].last_answered && p.name === b[i].name);

/** Lista viva de jogadores da sala (entradas, saídas, pontos e respostas). `null` até carregar. */
export function usePlayers(roomId) {
  const [players, setPlayers] = useState(null);
  const update = (fn) =>
    setPlayers((cur) => {
      const next = fn(cur || []);
      return cur && samePlayers(cur, next) ? cur : next;
    });

  useLiveTable({
    key: roomId && `players:${roomId}`,
    pollMs: 3000,
    fetchNow: async (isAlive) => {
      const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true });
      if (!error && isAlive()) update(() => data);
    },
    bind: (channel, isAlive) => {
      const upsert = (row) =>
        update((cur) => {
          const i = cur.findIndex((p) => p.id === row.id);
          if (i === -1) return [...cur, row];
          const next = [...cur];
          next[i] = { ...next[i], ...row };
          return next;
        });
      return channel
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "players", filter: `room_id=eq.${roomId}` },
          (p) => isAlive() && upsert(p.new),
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "players", filter: `room_id=eq.${roomId}` },
          (p) => isAlive() && upsert(p.new),
        )
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "players" }, (p) => {
          if (isAlive()) update((cur) => cur.filter((x) => x.id !== p.old?.id));
        });
    },
  });
  return players;
}

// --- Presença (quem está com o app aberto na sala) ---
// Uma única conexão por aparelho, que atravessa as telas da partida.
let presence = null; // { roomId, key, channel, online: Set, synced, listeners: Set }

export function enterPresence(roomId, key) {
  if (presence?.roomId === roomId && presence.key === key) return;
  leavePresence();
  const channel = supabase.channel(`presence:${roomId}`, { config: { presence: { key } } });
  const state = { roomId, key, channel, online: new Set(), synced: false, listeners: new Set() };
  presence = state;
  channel
    .on("presence", { event: "sync" }, () => {
      state.online = new Set(Object.keys(channel.presenceState()));
      state.synced = true;
      state.listeners.forEach((l) => l(state.online));
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") channel.track({ at: Date.now() }).catch(() => {});
    });
}

export function leavePresence() {
  if (!presence) return;
  const { channel } = presence;
  presence = null;
  channel.untrack().catch(() => {});
  supabase.removeChannel(channel);
}

/** Conjunto de chaves online (ids dos jogadores e "host"); `null` enquanto não sincronizou. */
export function useOnline(roomId) {
  const current = () => (roomId && presence?.roomId === roomId ? presence : null);
  const [online, setOnline] = useState(() => (current()?.synced ? current().online : null));
  useEffect(() => {
    const state = current();
    if (!state) return;
    if (state.synced) setOnline(state.online);
    const listener = (set) => setOnline(set);
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  }, [roomId]);
  return online;
}

/**
 * Pergunta antes de sair pelo botão Voltar. Navegações feitas pelo próprio app
 * (fim de jogo, ir para o pódio) passam direto.
 */
export function useLeaveGuard(navigation, options) {
  const opts = useRef(options);
  opts.current = options;
  const leaving = useRef(false);

  useEffect(
    () =>
      navigation.addListener("beforeRemove", (e) => {
        const type = e.data.action.type;
        if (leaving.current || !opts.current.enabled || (type !== "GO_BACK" && type !== "POP")) return;
        e.preventDefault();
        const { title, message, confirmText = "Sair", onConfirm, toTop } = opts.current;
        Alert.alert(title, message, [
          { text: "Ficar", style: "cancel" },
          {
            text: confirmText,
            style: "destructive",
            onPress: async () => {
              leaving.current = true;
              await onConfirm?.();
              if (toTop) navigation.popToTop();
              else navigation.dispatch(e.data.action);
            },
          },
        ]);
      }),
    [navigation],
  );
}
