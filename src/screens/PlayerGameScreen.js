import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { Choice, haptic, ProgressBar } from "../components/ui";
import { answerQuestion, removePlayer } from "../services/roomService";
import { leavePresence, useLeaveGuard, useOnline, useRoom } from "../services/roomSync";
import { radius, type } from "../theme";

const QUESTION_TIME = 20;
const LETTERS = "ABCDE";
const stripLetter = (opt) =>
  String(opt).replace(/^\s*\(?[A-Ea-e][).:-]\s*/, "").replace(/\*\*/g, "");

export default function PlayerGameScreen({ route, navigation }) {
  const { colors } = useTheme();
  const { room, player } = route.params;
  const quiz = room.quiz_data;
  const total = quiz?.questions?.length || 0;

  const [currentIdx, setCurrentIdx] = useState(room.current_question_index ?? 0);
  const [selected, setSelected] = useState(null); // true/false (V ou F) ou letra
  const [timeLeft, setTimeLeft] = useState(QUESTION_TIME);
  const done = useRef(false);
  const online = useOnline(room.id);

  const question = quiz?.questions?.[currentIdx];
  const isVF = !quiz?.type || quiz?.type === "vf";
  const hasAnswered = selected !== null;
  const timeUp = timeLeft === 0 && !hasAnswered;
  const hostOnline = !online || online.has("host");

  // Cronômetro local: para quando o jogador responde
  useEffect(() => {
    if (timeLeft <= 0 || hasAnswered) return;
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, hasAnswered]);

  const leave = (title, message) => {
    if (done.current) return;
    done.current = true;
    leavePresence();
    if (title) Alert.alert(title, message);
    navigation.popToTop();
  };

  useRoom(room.id, (current) => {
    if (done.current) return;
    if (!current || current.status === "finished") {
      leave("Partida encerrada", "O anfitrião encerrou a partida.");
      return;
    }
    const idx = current.current_question_index;
    if (current.show_results && idx >= currentIdx) {
      // fim da questão: todos vão para o ranking da mesma questão
      done.current = true;
      navigation.replace("PodiumScreen", {
        room: current,
        quiz,
        currentIdx: idx,
        isHost: false,
        isFinal: idx + 1 >= total,
        player,
      });
    } else if (idx > currentIdx) {
      // o anfitrião já passou para a próxima
      setCurrentIdx(idx);
      setSelected(null);
      setTimeLeft(QUESTION_TIME);
    }
  });

  useLeaveGuard(navigation, {
    enabled: true,
    title: "Sair da partida?",
    message: "Você sai do ranking e não volta para esta sala.",
    toTop: true,
    onConfirm: async () => {
      done.current = true;
      leavePresence();
      await removePlayer(player.id);
    },
  });

  const isCorrect = (choice) =>
    isVF
      ? choice === (question?.answer === "Verdadeiro")
      : choice === String(question?.answer).trim().charAt(0).toUpperCase();

  const handleAnswer = async (choice) => {
    if (hasAnswered || timeLeft === 0) return;
    const correct = isCorrect(choice);
    setSelected(choice);
    haptic(correct ? "success" : "error");
    // resposta rápida vale mais: de 500 a 1000 pontos; errada vale 0 mas conta
    // como respondida (o anfitrião vê quantos já responderam)
    const points = correct ? 500 + (timeLeft / QUESTION_TIME) * 500 : 0;
    try {
      await answerQuestion(player.id, currentIdx, points);
    } catch (error) {
      Alert.alert("Sua resposta não foi enviada", error.message);
      setSelected(null);
    }
  };

  const optionState = (choice) => {
    if (!hasAnswered) return "idle";
    if (isCorrect(choice)) return "correct";
    return choice === selected ? "wrong" : "dim";
  };

  if (!question) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const options = isVF
    ? [
        { label: "Verdadeiro", value: true, icon: "checkmark" },
        { label: "Falso", value: false, icon: "close" },
      ]
    : (question.options || []).map((opt, i) => ({
        label: stripLetter(opt),
        value: LETTERS[i],
        letter: LETTERS[i],
      }));

  const acertou = hasAnswered && isCorrect(selected);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <ProgressBar value={timeLeft / QUESTION_TIME} duration={1000} />
        </View>
        <Text
          style={[type.label, styles.time, { color: timeLeft <= 5 ? colors.error : colors.text }]}
        >
          {timeLeft}s
        </Text>
      </View>

      {!hostOnline && (
        <View style={[styles.banner, { backgroundColor: colors.errorSoft }]}>
          <Ionicons name="cloud-offline-outline" size={18} color={colors.error} />
          <Text style={[type.caption, { color: colors.text, flex: 1 }]}>
            O anfitrião desconectou. A partida continua quando ele voltar.
          </Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[type.caption, { color: colors.textMuted }]}>
          Questão {currentIdx + 1} de {total}
        </Text>
        <Text style={[type.title, { color: colors.text }]}>
          {String(question.question || "").replace(/\*\*/g, "")}
        </Text>

        {(hasAnswered || timeUp) && (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.result,
              { backgroundColor: acertou ? colors.successSoft : colors.errorSoft },
            ]}
          >
            <Ionicons
              name={acertou ? "checkmark-circle" : timeUp ? "time" : "close-circle"}
              size={28}
              color={acertou ? colors.success : colors.error}
            />
            <View style={{ flex: 1 }}>
              <Text style={[type.title, { color: colors.text }]}>
                {acertou ? "Você acertou!" : timeUp ? "Tempo esgotado" : "Não foi dessa vez"}
              </Text>
              <Text style={[type.caption, { color: colors.textMuted }]}>
                Aguardando os outros jogadores…
              </Text>
            </View>
          </View>
        )}

        <View style={styles.options}>
          {options.map((o) => (
            <Choice
              key={String(o.value)}
              state={optionState(o.value)}
              selected={selected === o.value}
              disabled={hasAnswered || timeUp}
              onPress={() => handleAnswer(o.value)}
              style={styles.option}
              leading={(icon, fg) => (
                <View style={[styles.letter, { backgroundColor: colors.surfaceAlt }]}>
                  {icon ||
                    (o.letter ? (
                      <Text style={[type.label, { color: fg }]}>{o.letter}</Text>
                    ) : (
                      <Ionicons name={o.icon} size={20} color={fg} />
                    ))}
                </View>
              )}
            >
              {(fg) => <Text style={[type.title, { flex: 1, color: fg }]}>{o.label}</Text>}
            </Choice>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  time: { minWidth: 32, textAlign: "right", fontVariant: ["tabular-nums"] },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: radius.md,
  },
  body: { padding: 16, gap: 16 },
  result: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: radius.md,
  },
  options: { gap: 12 },
  option: { minHeight: 64, gap: 14, padding: 14 },
  letter: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
