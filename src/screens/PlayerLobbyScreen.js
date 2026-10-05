import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@react-navigation/native";
import { useEffect, useRef } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { haptic } from "../components/ui";
import { removePlayer } from "../services/roomService";
import {
  enterPresence,
  leavePresence,
  useLeaveGuard,
  useOnline,
  usePlayers,
  useRoom,
} from "../services/roomSync";
import { radius, type } from "../theme";

export default function PlayerLobbyScreen({ route, navigation }) {
  const { colors } = useTheme();
  const { room, player } = route.params; // vindos da tela de entrar
  const done = useRef(false); // evita reagir duas vezes (evento + conferência)

  const players = usePlayers(room.id);
  const online = useOnline(room.id);

  useEffect(() => {
    enterPresence(room.id, player.id);
  }, [room.id, player.id]);

  const exit = (title, message) => {
    if (done.current) return;
    done.current = true;
    leavePresence();
    if (title) Alert.alert(title, message);
    navigation.popToTop();
  };

  useRoom(room.id, (current) => {
    if (done.current) return;
    if (!current || current.status === "finished") {
      exit("Sala encerrada", "O anfitrião fechou a sala.");
    } else if (current.status === "playing") {
      done.current = true;
      haptic("success");
      navigation.replace("PlayerGame", { room: current, player });
    }
  });

  // Removido pelo anfitrião: some da lista de jogadores
  useEffect(() => {
    if (players && !players.some((p) => p.id === player.id)) {
      exit("Você saiu da sala", "O anfitrião removeu você desta partida.");
    }
  }, [players]);

  useLeaveGuard(navigation, {
    enabled: true,
    title: "Sair da sala?",
    message: "Você vai precisar do código para entrar de novo.",
    onConfirm: async () => {
      done.current = true;
      leavePresence();
      await removePlayer(player.id);
    },
  });

  const list = players || [];
  const hostOnline = !online || online.has("host");

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
    >
      <View style={[styles.statusCard, { backgroundColor: colors.surface }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[type.headline, styles.center, { color: colors.text }]}>
          Você está na sala {room.code}
        </Text>
        <Text style={[type.body, styles.center, { color: colors.textMuted }]}>
          {hostOnline
            ? "O jogo começa quando o anfitrião der a largada."
            : "O anfitrião está desconectado. Aguarde ele voltar."}
        </Text>
      </View>

      <Text style={[type.label, styles.sectionTitle, { color: colors.textMuted }]}>
        Participantes · {list.length}
      </Text>
      {!players ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <View style={styles.chips}>
          {list.map((item) => {
            const me = item.id === player.id;
            const isOnline = !online || online.has(item.id);
            return (
              <View
                key={item.id}
                style={[
                  styles.chip,
                  {
                    backgroundColor: me ? colors.accentSoft : colors.surface,
                    borderColor: me ? colors.primary : "transparent",
                  },
                ]}
              >
                {me ? (
                  <Ionicons name="person" size={14} color={colors.primary} />
                ) : (
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: isOnline ? colors.success : colors.textMuted },
                    ]}
                  />
                )}
                <Text style={[type.label, { color: me ? colors.primary : colors.text }]}>
                  {item.name}
                  {me ? " (você)" : ""}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16 },
  statusCard: {
    alignItems: "center",
    gap: 8,
    borderRadius: radius.lg,
    padding: 24,
  },
  center: { textAlign: "center" },
  sectionTitle: { paddingHorizontal: 4, marginTop: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
