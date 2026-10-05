import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Confetti from "../components/Confetti";
import { Button, haptic, useReduceMotion } from "../components/ui";
import { cleanupRoom, nextQuestion, removePlayer } from "../services/roomService";
import {
  leavePresence,
  useLeaveGuard,
  useOnline,
  usePlayers,
  useRoom,
} from "../services/roomSync";
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

  const [advancing, setAdvancing] = useState(false);
  const done = useRef(false);

  const enter = useRef(new Animated.Value(0)).current;
  const reduce = useReduceMotion();

  // Placar ao vivo: quem respondeu no último segundo entra na conta
  const live = usePlayers(room.id);
  const loading = live === null;
  // depois do fim a sala é apagada e os jogadores somem do banco: o ranking
  // final fica congelado na tela de quem ainda está olhando
  // (os jogadores somem um a um; guardamos sempre a lista mais completa)
  const lastBoard = useRef([]);
  if (live && live.length >= lastBoard.current.length) lastBoard.current = live;
  const board = isFinal && live && live.length < lastBoard.current.length ? lastBoard.current : live;
  const allPlayers = (board || [])
    .slice()
    .sort((a, b) => b.score - a.score || a.created_at.localeCompare(b.created_at));
  const online = useOnline(room.id);
  const hostOnline = !online || online.has("host");

  const playerPosition = player ? allPlayers.findIndex((p) => p.id === player.id) + 1 : 0;
  const top5 = allPlayers.slice(0, 5);

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 320,
      useNativeDriver: true,
    }).start();
  }, []);

  const goHome = () => {
    if (done.current) return;
    done.current = true;
    leavePresence();
    navigation.popToTop();
  };

  // Jogador acompanha o anfitrião: próxima questão, fim da partida ou sala apagada
  useRoom(isHost ? null : room.id, (current) => {
    if (done.current) return;
    if (!current || current.status === "finished") {
      // na classificação final o jogador fica para ver o ranking e sai quando quiser
      if (!isFinal) {
        done.current = true;
        leavePresence();
        Alert.alert("Partida encerrada", "O anfitrião encerrou a partida.");
        navigation.popToTop();
      }
      return;
    }
    if (current.current_question_index > currentIdx) {
      done.current = true;
      navigation.replace("PlayerGame", { room: current, quiz, player });
    }
  });

  useLeaveGuard(navigation, {
    enabled: !isFinal,
    title: isHost ? "Encerrar a partida?" : "Sair da partida?",
    message: isHost
      ? "Todos os jogadores serão desconectados."
      : "Você sai do ranking e não volta para esta sala.",
    confirmText: isHost ? "Encerrar" : "Sair",
    toTop: true,
    onConfirm: async () => {
      done.current = true;
      leavePresence();
      if (isHost) cleanupRoom(room.id);
      else await removePlayer(player.id);
    },
  });

  // Fim de jogo: festa para o anfitrião e para quem subiu ao pódio
  const celebrate =
    isFinal && !loading && (isHost || (playerPosition > 0 && playerPosition <= 3));
  useEffect(() => {
    if (celebrate) haptic("success");
  }, [celebrate]);

  const handleNext = async () => {
    setAdvancing(true);
    const nextIdx = currentIdx + 1;
    if (nextIdx < quiz.questions.length) {
      try {
        await nextQuestion(room.id, nextIdx);
        done.current = true;
        navigation.replace("HostGameControl", { room, quiz, currentIdx: nextIdx });
      } catch (error) {
        setAdvancing(false);
        Alert.alert("Não foi possível avançar", error.message);
      }
    } else {
      cleanupRoom(room.id); // jogadores veem a classificação final e saem quando quiserem
      goHome();
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

        {!isHost && !isFinal && !hostOnline && (
          <View style={[styles.banner, { backgroundColor: colors.errorSoft }]}>
            <Ionicons name="cloud-offline-outline" size={18} color={colors.error} />
            <Text style={[type.caption, { color: colors.text, flex: 1 }]}>
              O anfitrião desconectou. A partida continua quando ele voltar.
            </Text>
          </View>
        )}

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
                key={item.id}
                item={item}
                position={index + 1}
                me={!!player && item.id === player.id}
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
        ) : isFinal ? (
          <Button icon="home-outline" title="Voltar à biblioteca" onPress={goHome} />
        ) : (
          <View style={styles.waiting}>
            <ActivityIndicator size="small" color={colors.textMuted} />
            <Text style={[type.body, { color: colors.textMuted }]}>
              Aguardando a próxima pergunta…
            </Text>
          </View>
        )}
      </View>
      {celebrate && !reduce && <Confetti count={playerPosition === 1 ? 140 : 100} />}
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
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: radius.md,
  },
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
