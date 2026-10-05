import { useTheme } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, haptic, showSnackbar } from "../components/ui";
import { createRoom, leaveRoom, removePlayer, startGame } from "../services/roomService";
import {
  enterPresence,
  leavePresence,
  useLeaveGuard,
  useOnline,
  usePlayers,
} from "../services/roomSync";
import { radius, type } from "../theme";

export default function HostLobbyScreen({ route, navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { quiz } = route.params; // quiz escolhido na biblioteca

  const [room, setRoom] = useState(null);
  const [starting, setStarting] = useState(false);
  const roomRef = useRef(null);
  const started = useRef(false);

  const players = usePlayers(room?.id);
  const online = useOnline(room?.id);
  const count = players?.length ?? 0;

  useEffect(() => {
    let cancelled = false;
    createRoom(quiz)
      .then((newRoom) => {
        if (cancelled) return leaveRoom(newRoom.id);
        roomRef.current = newRoom;
        enterPresence(newRoom.id, "host");
        setRoom(newRoom);
      })
      .catch((error) => {
        Alert.alert("Não foi possível criar a sala", error.message);
        navigation.goBack();
      });

    return () => {
      cancelled = true;
      // saiu da sala de espera sem começar: a sala some e os jogadores são avisados
      if (roomRef.current && !started.current) {
        leaveRoom(roomRef.current.id);
        leavePresence();
      }
    };
  }, []);

  useLeaveGuard(navigation, {
    enabled: count > 0,
    title: "Fechar a sala?",
    message: `${count === 1 ? "O jogador que entrou vai" : `Os ${count} jogadores vão`} ser desconectados.`,
    confirmText: "Fechar sala",
  });

  const invite = () =>
    Share.share({
      message: `Bora jogar “${quiz.title}” no QuizzV! Abra o app, toque em “Entrar em sala” e use o código ${room.code}.`,
    });

  const kick = (player) =>
    Alert.alert("Remover jogador?", `${player.name} vai sair da sala.`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Remover",
        style: "destructive",
        onPress: async () => {
          await removePlayer(player.id);
          showSnackbar(`${player.name} foi removido`);
        },
      },
    ]);

  const handleStart = async () => {
    setStarting(true);
    try {
      await startGame(room.id);
      started.current = true;
      haptic("success");
      navigation.replace("HostGameControl", { room, quiz, currentIdx: 0 });
    } catch (error) {
      Alert.alert("Não foi possível iniciar", error.message);
      setStarting(false);
    }
  };

  if (!room) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[type.body, { color: colors.textMuted, marginTop: 12 }]}>
          Criando sala…
        </Text>
      </View>
    );
  }

  const onlineCount = online ? (players || []).filter((p) => online.has(p.id)).length : count;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={[styles.codeCard, { backgroundColor: colors.surface }]}>
          <Text style={[type.caption, { color: colors.textMuted }]}>Código da sala</Text>
          <Text
            style={[styles.code, { color: colors.primary }]}
            accessibilityLabel={`Código ${room.code.split("").join(" ")}`}
            selectable
          >
            {room.code}
          </Text>
          <Text
            style={[type.body, { color: colors.textMuted, textAlign: "center" }]}
            numberOfLines={2}
          >
            {quiz.title || "Sem título"} · {quiz.questions?.length}{" "}
            {quiz.questions?.length === 1 ? "questão" : "questões"}
          </Text>
          <Button
            variant="tonal"
            icon="share-social-outline"
            title="Convidar"
            onPress={invite}
            style={{ alignSelf: "stretch", marginTop: 16 }}
          />
        </View>

        <View style={styles.sectionRow}>
          <Text style={[type.label, { color: colors.textMuted }]}>
            Jogadores · {count}
            {online && count > 0 ? ` (${onlineCount} online)` : ""}
          </Text>
          {count > 0 && (
            <Text style={[type.caption, { color: colors.textMuted }]}>Toque para remover</Text>
          )}
        </View>

        {count === 0 ? (
          <View style={styles.waiting}>
            <ActivityIndicator color={colors.textMuted} />
            <Text style={[type.body, { color: colors.textMuted }]}>
              Esperando a galera entrar…
            </Text>
          </View>
        ) : (
          <View style={styles.chips}>
            {players.map((p) => {
              const isOnline = !online || online.has(p.id);
              return (
                <Pressable
                  key={p.id}
                  onPress={() => kick(p)}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.name}, ${isOnline ? "online" : "desconectado"}. Toque para remover.`}
                  android_ripple={{ color: colors.border }}
                  style={[styles.chip, { backgroundColor: colors.surface }]}
                >
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: isOnline ? colors.success : colors.textMuted },
                    ]}
                  />
                  <Text
                    style={[type.label, { color: isOnline ? colors.text : colors.textMuted }]}
                  >
                    {p.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View
        style={[
          styles.footer,
          { borderTopColor: colors.border, paddingBottom: 12 + insets.bottom },
        ]}
      >
        <Button
          icon="play"
          title={
            count
              ? `Iniciar com ${count} ${count === 1 ? "jogador" : "jogadores"}`
              : "Aguardando jogadores"
          }
          onPress={handleStart}
          disabled={count === 0}
          loading={starting}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { padding: 16, gap: 16 },
  codeCard: {
    alignItems: "center",
    borderRadius: radius.lg,
    padding: 24,
  },
  code: {
    fontSize: 52,
    lineHeight: 60,
    fontWeight: "800",
    letterSpacing: 8,
    marginVertical: 8,
    fontVariant: ["tabular-nums"],
  },
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 4,
    marginTop: 8,
  },
  waiting: { flexDirection: "row", alignItems: "center", gap: 10, padding: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
    overflow: "hidden",
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
