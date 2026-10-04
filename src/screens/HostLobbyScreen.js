import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@react-navigation/native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../components/ui";
import { createRoom } from "../services/roomService";
import { supabase } from "../services/supabase";
import { radius, type } from "../theme";

export default function HostLobbyScreen({ route, navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { quiz } = route.params; // quiz escolhido na Home

  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let subscription;

    const setupRoom = async () => {
      try {
        // 1. Cria a sala no Supabase
        const newRoom = await createRoom(quiz);
        setRoom(newRoom);
        setLoading(false);

        // 2. Escuta novos jogadores entrando nesta sala
        subscription = supabase
          .channel(`room_players_${newRoom.id}`)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "players" },
            (payload) => {
              if (payload.new.room_id === newRoom.id) {
                setPlayers((current) => [...current, payload.new]);
              }
            },
          )
          .subscribe();
      } catch {
        Alert.alert(
          "Não foi possível criar a sala",
          "Verifique sua conexão com a internet e tente de novo.",
        );
        navigation.goBack();
      }
    };

    setupRoom();
    return () => {
      if (subscription) supabase.removeChannel(subscription);
    };
  }, []);

  const invite = () =>
    Share.share({
      message: `Bora jogar “${quiz.title}” no QuizzV! Abra o app, toque em “Entrar em sala” e use o código ${room.code}.`,
    });

  const startGame = async () => {
    setStarting(true);
    try {
      const { error } = await supabase
        .from("rooms")
        .update({ status: "playing" })
        .eq("id", room.id);
      if (error) throw error;
      navigation.navigate("HostGameControl", { room, quiz, players });
    } catch (error) {
      Alert.alert("Não foi possível iniciar", "Tente de novo em alguns segundos.");
      console.error(error);
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[type.body, { color: colors.textMuted, marginTop: 12 }]}>
          Criando sala…
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={[styles.codeCard, { backgroundColor: colors.surface }]}>
          <Text style={[type.caption, { color: colors.textMuted }]}>
            Código da sala
          </Text>
          <Text
            style={[styles.code, { color: colors.primary }]}
            accessibilityLabel={`Código ${room?.code.split("").join(" ")}`}
            selectable
          >
            {room?.code}
          </Text>
          <Text
            style={[type.body, { color: colors.textMuted, textAlign: "center" }]}
            numberOfLines={2}
          >
            {quiz.title || "Sem título"} · {quiz.questions?.length} questões
          </Text>
          <Button
            variant="tonal"
            icon="share-social-outline"
            title="Convidar"
            onPress={invite}
            style={{ alignSelf: "stretch", marginTop: 16 }}
          />
        </View>

        <Text style={[type.label, styles.sectionTitle, { color: colors.textMuted }]}>
          Jogadores · {players.length}
        </Text>
        {players.length === 0 ? (
          <View style={styles.waiting}>
            <ActivityIndicator color={colors.textMuted} />
            <Text style={[type.body, { color: colors.textMuted }]}>
              Esperando a galera entrar…
            </Text>
          </View>
        ) : (
          <View style={styles.chips}>
            {players.map((p) => (
              <View
                key={p.id}
                style={[styles.chip, { backgroundColor: colors.surface }]}
              >
                <Ionicons name="person" size={14} color={colors.primary} />
                <Text style={[type.label, { color: colors.text }]}>{p.name}</Text>
              </View>
            ))}
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
          title={players.length ? "Iniciar jogo" : "Aguardando jogadores"}
          onPress={startGame}
          disabled={players.length === 0}
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
  sectionTitle: { paddingHorizontal: 4, marginTop: 8 },
  waiting: { flexDirection: "row", alignItems: "center", gap: 10, padding: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
