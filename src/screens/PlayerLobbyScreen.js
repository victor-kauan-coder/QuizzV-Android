import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@react-navigation/native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { supabase } from "../services/supabase";
import { radius, type } from "../theme";

export default function PlayerLobbyScreen({ route, navigation }) {
  const { colors } = useTheme();
  // Dados da sala e do jogador vindos da tela de entrada
  const { room, player } = route.params;

  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Quem já está na sala
    supabase
      .from("players")
      .select("*")
      .eq("room_id", room.id)
      .then(({ data }) => {
        if (data) setPlayers(data);
        setLoading(false);
      });

    // 2. Novos jogadores e início do jogo pelo anfitrião
    const lobbySubscription = supabase
      .channel(`player_lobby_${room.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "players" },
        (payload) => {
          if (payload.new.room_id === room.id) {
            setPlayers((current) =>
              current.some((p) => p.id === payload.new.id)
                ? current
                : [...current, payload.new],
            );
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${room.id}`,
        },
        (payload) => {
          if (payload.new.status === "playing") {
            navigation.navigate("PlayerGame", { room, player });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(lobbySubscription);
    };
  }, []);

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
          O jogo começa quando o anfitrião der a largada.
        </Text>
      </View>

      <Text style={[type.label, styles.sectionTitle, { color: colors.textMuted }]}>
        Participantes · {players.length}
      </Text>
      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <View style={styles.chips}>
          {players.map((item) => {
            const me = item.id === player.id;
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
                <Ionicons
                  name={me ? "person" : "person-outline"}
                  size={14}
                  color={me ? colors.primary : colors.textMuted}
                />
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
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
});
