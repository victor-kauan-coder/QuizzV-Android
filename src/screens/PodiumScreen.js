import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../components/ui";
import { cleanupRoom } from "../services/roomService";
import { supabase } from "../services/supabase";
import { radius, type } from "../theme";

const MEDALS = [
  { icon: "trophy", color: "#D4A017" },
  { icon: "medal", color: "#9CA3AF" },
  { icon: "medal", color: "#B87333" },
];

const getRankMessage = (position, total) => {
  if (position === 1) return "Você está na liderança!";
  if (position === 2) return "Vice-líder, continue assim!";
  if (position === 3) return "Pódio garantido!";
  if (position <= Math.ceil(total / 2)) return "Na metade de cima!";
  return "Dá pra virar, não desiste!";
};

function Row({ item, position, me }) {
  const { colors } = useTheme();
  const medal = MEDALS[position - 1];
  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: me ? colors.accentSoft : colors.surface,
          borderColor: me ? colors.primary : "transparent",
        },
      ]}
    >
      <View style={[styles.rank, { backgroundColor: colors.surfaceAlt }]}>
        {medal ? (
          <Ionicons name={medal.icon} size={18} color={medal.color} />
        ) : (
          <Text style={[type.label, { color: colors.textMuted }]}>{position}</Text>
        )}
      </View>
      <Text
        style={[type.title, styles.name, { color: me ? colors.primary : colors.text }]}
        numberOfLines={1}
      >
        {item.name}
        {me ? " (você)" : ""}
      </Text>
      <Text style={[type.title, styles.score, { color: colors.text }]}>
        {item.score}
        <Text style={[type.caption, { color: colors.textMuted }]}> pts</Text>
      </Text>
    </View>
  );
}

export default function PodiumScreen({ route, navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { room, quiz, currentIdx, isFinal, isHost, player } = route.params;

  const [allPlayers, setAllPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);

  const enter = useRef(new Animated.Value(0)).current;

  const playerPosition = player
    ? allPlayers.findIndex((p) => p.name === player.name) + 1
    : 0;
  const top5 = allPlayers.slice(0, 5);

  useEffect(() => {
    fetchScores();

    const podiumSub = supabase
      .channel(`podium_${room.id}_q${currentIdx}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${room.id}`,
        },
        (payload) => {
          if (payload.new.status === "finished" && !isFinal) {
            navigation.navigate("Meus Quizzes");
          }
          if (!isHost && payload.new.current_question_index !== currentIdx) {
            navigation.replace("PlayerGame", { room: payload.new, player });
          }
        },
      )
      .subscribe();

    Animated.timing(enter, {
      toValue: 1,
      duration: 320,
      useNativeDriver: true,
    }).start();

    return () => supabase.removeChannel(podiumSub);
  }, []);

  const fetchScores = async () => {
    const { data } = await supabase
      .from("players")
      .select("name, score")
      .eq("room_id", room.id)
      .order("score", { ascending: false });
    if (data) setAllPlayers(data);
    setLoading(false);
  };

  const handleNext = async () => {
    setAdvancing(true);
    const nextIdx = currentIdx + 1;
    if (nextIdx < quiz.questions.length) {
      await supabase
        .from("rooms")
        .update({ current_question_index: nextIdx, show_results: false })
        .eq("id", room.id);
      navigation.replace("HostGameControl", { room, quiz, currentIdx: nextIdx });
    } else {
      navigation.navigate("Meus Quizzes");
      cleanupRoom(room.id);
    }
  };

  const rise = {
    opacity: enter,
    transform: [
      { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
    ],
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Ionicons
            name={isFinal ? "ribbon" : "stats-chart"}
            size={40}
            color={colors.primary}
          />
          <Text style={[type.display, { color: colors.text, marginTop: 8 }]}>
            {isFinal ? "Classificação final" : "Ranking parcial"}
          </Text>
          <Text style={[type.body, { color: colors.textMuted }]}>
            Questão {currentIdx + 1} de {quiz?.questions?.length}
          </Text>
        </View>

        {!isHost && playerPosition > 0 && (
          <Animated.View style={[styles.myCard, { backgroundColor: colors.accent }, rise]}>
            <Text style={[styles.myPosition, { color: colors.onAccent }]}>
              {playerPosition}º
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={[type.title, { color: colors.onAccent }]} numberOfLines={1}>
                {allPlayers[playerPosition - 1]?.name}
              </Text>
              <Text style={[type.caption, { color: colors.onAccent, opacity: 0.85 }]}>
                {getRankMessage(playerPosition, allPlayers.length)}
              </Text>
            </View>
            <Text style={[type.headline, { color: colors.onAccent }]}>
              {allPlayers[playerPosition - 1]?.score ?? 0}
            </Text>
          </Animated.View>
        )}

        <Text style={[type.label, styles.sectionTitle, { color: colors.textMuted }]}>
          Top 5
        </Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Animated.View style={[{ gap: 8 }, rise]}>
            {top5.map((item, index) => (
              <Row
                key={`${item.name}-${index}`}
                item={item}
                position={index + 1}
                me={!!player && item.name === player.name}
              />
            ))}
            {!isHost && player && playerPosition > 5 && (
              <>
                <Text style={[type.caption, styles.gap, { color: colors.textMuted }]}>
                  …
                </Text>
                <Row
                  item={allPlayers[playerPosition - 1]}
                  position={playerPosition}
                  me
                />
              </>
            )}
          </Animated.View>
        )}
      </ScrollView>

      <View
        style={[
          styles.footer,
          { borderTopColor: colors.border, paddingBottom: 12 + insets.bottom },
        ]}
      >
        {isHost ? (
          <Button
            icon={currentIdx + 1 < quiz.questions.length ? "arrow-forward" : "flag"}
            title={
              currentIdx + 1 < quiz.questions.length
                ? "Próxima pergunta"
                : "Finalizar quiz"
            }
            onPress={handleNext}
            loading={advancing}
          />
        ) : (
          <View style={styles.waiting}>
            <ActivityIndicator size="small" color={colors.textMuted} />
            <Text style={[type.body, { color: colors.textMuted }]}>
              Aguardando o anfitrião…
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  header: { alignItems: "center", marginBottom: 8 },
  myCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: radius.lg,
    padding: 18,
  },
  myPosition: { fontSize: 30, fontWeight: "800", fontVariant: ["tabular-nums"] },
  sectionTitle: { paddingHorizontal: 4, marginTop: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  rank: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { flex: 1 },
  score: { fontVariant: ["tabular-nums"] },
  gap: { textAlign: "center" },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  waiting: {
    minHeight: 52,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
});
