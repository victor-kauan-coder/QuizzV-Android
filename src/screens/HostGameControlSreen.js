import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, haptic, ProgressBar } from "../components/ui";
import { cleanupRoom, endQuestion } from "../services/roomService";
import { leavePresence, useLeaveGuard, useOnline, usePlayers } from "../services/roomSync";
import { radius, type } from "../theme";

const QUESTION_TIME = 20;

export default function HostGameControlScreen({ route, navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { room, quiz } = route.params;
  const currentIdx = route.params.currentIdx || 0;

  const [timeLeft, setTimeLeft] = useState(QUESTION_TIME);
  const [ending, setEnding] = useState(false);
  const hasEnded = useRef(false); // timer, botão e "todos responderam" não disparam duas vezes

  const players = usePlayers(room.id) || [];
  const online = useOnline(room.id);

  const question = quiz?.questions[currentIdx];
  const total = quiz?.questions.length || 0;

  // Quem conta: jogadores conectados (ou que já responderam, mesmo se caíram)
  const answered = players.filter((p) => p.last_answered >= currentIdx).length;
  const expected = players.filter(
    (p) => !online || online.has(p.id) || p.last_answered >= currentIdx,
  ).length;

  const handleEndQuestion = async () => {
    if (hasEnded.current) return;
    hasEnded.current = true;
    setEnding(true);
    try {
      await endQuestion(room.id, currentIdx);
    } catch (error) {
      hasEnded.current = false;
      setEnding(false);
      Alert.alert("Não foi possível encerrar a questão", error.message);
      return;
    }
    // replace: a tela de controle anterior não fica viva por baixo
    navigation.replace("PodiumScreen", {
      room,
      quiz,
      currentIdx,
      isHost: true,
      isFinal: currentIdx + 1 >= total,
    });
  };

  useEffect(() => {
    if (timeLeft <= 0) {
      handleEndQuestion();
      return;
    }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft]);

  // Todo mundo respondeu: não precisa esperar o tempo acabar
  useEffect(() => {
    if (expected > 0 && answered >= expected && !hasEnded.current) {
      haptic("tap");
      const t = setTimeout(handleEndQuestion, 700);
      return () => clearTimeout(t);
    }
  }, [answered, expected]);

  useLeaveGuard(navigation, {
    enabled: true,
    title: "Encerrar a partida?",
    message: "Todos os jogadores serão desconectados.",
    confirmText: "Encerrar",
    toTop: true,
    onConfirm: () => {
      hasEnded.current = true;
      leavePresence();
      cleanupRoom(room.id);
    },
  });

  const urgent = timeLeft <= 5;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <View>
          <Text style={[type.caption, { color: colors.textMuted }]}>Questão</Text>
          <Text style={[type.title, { color: colors.text }]}>
            {currentIdx + 1} de {total}
          </Text>
        </View>
        <View
          style={[styles.timer, { borderColor: urgent ? colors.error : colors.accent }]}
          accessibilityLabel={`${timeLeft} segundos restantes`}
        >
          <Text style={[styles.timerText, { color: urgent ? colors.error : colors.text }]}>
            {timeLeft}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[type.caption, { color: colors.textMuted }]}>Código</Text>
          <Text style={[type.title, { color: colors.primary }]}>{room.code}</Text>
        </View>
      </View>
      <View style={{ paddingHorizontal: 16 }}>
        <ProgressBar value={timeLeft / QUESTION_TIME} duration={1000} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={[styles.questionCard, { backgroundColor: colors.surface }]}>
          <Text style={[styles.questionText, { color: colors.text }]}>
            {question?.question?.replace(/\*\*/g, "")}
          </Text>
        </View>

        {quiz?.type === "mc" &&
          question?.options?.map((opt, i) => (
            <View key={i} style={[styles.option, { backgroundColor: colors.surface }]}>
              <Text style={[type.body, { color: colors.text }]}>
                {String(opt).replace(/\*\*/g, "")}
              </Text>
            </View>
          ))}

        <View
          style={[styles.answered, { backgroundColor: colors.surface }]}
          accessibilityLiveRegion="polite"
        >
          <View style={styles.answeredRow}>
            <Text style={[type.title, { color: colors.text }]}>
              {answered} de {expected} responderam
            </Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>
              {players.length - expected > 0
                ? `${players.length - expected} desconectado${players.length - expected > 1 ? "s" : ""}`
                : ""}
            </Text>
          </View>
          <ProgressBar value={expected ? answered / expected : 0} height={8} />
          <View style={styles.names}>
            {players.map((p) => {
              const did = p.last_answered >= currentIdx;
              return (
                <View
                  key={p.id}
                  style={[
                    styles.name,
                    { backgroundColor: did ? colors.successSoft : colors.surfaceAlt },
                  ]}
                >
                  {did && <Ionicons name="checkmark" size={12} color={colors.success} />}
                  <Text style={[type.caption, { color: did ? colors.text : colors.textMuted }]}>
                    {p.name}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          { borderTopColor: colors.border, paddingBottom: 12 + insets.bottom },
        ]}
      >
        <Button
          icon="podium-outline"
          title="Encerrar e ver ranking"
          onPress={handleEndQuestion}
          loading={ending}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },
  timer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  timerText: { fontSize: 26, fontWeight: "800", fontVariant: ["tabular-nums"] },
  body: { padding: 16, gap: 10 },
  questionCard: {
    padding: 24,
    borderRadius: radius.lg,
    minHeight: 140,
    justifyContent: "center",
    marginBottom: 6,
  },
  questionText: { fontSize: 20, lineHeight: 28, fontWeight: "700", textAlign: "center" },
  option: { padding: 14, borderRadius: radius.md },
  answered: { padding: 16, borderRadius: radius.lg, gap: 12, marginTop: 6 },
  answeredRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  names: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  name: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
