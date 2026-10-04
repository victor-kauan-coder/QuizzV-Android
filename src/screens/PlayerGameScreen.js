import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Choice, haptic, ProgressBar } from "../components/ui";
import { supabase } from "../services/supabase";
import { radius, type } from "../theme";

const QUESTION_TIME = 20;
const LETTERS = "ABCDE";
const stripLetter = (opt) =>
  String(opt).replace(/^\s*\(?[A-Ea-e][).:-]\s*/, "").replace(/\*\*/g, "");

export default function PlayerGameScreen({ route, navigation }) {
  const { colors } = useTheme();
  const { room, player } = route.params;
  const quiz = room.quiz_data;

  const [currentIdx, setCurrentIdx] = useState(room.current_question_index ?? 0);
  const [selected, setSelected] = useState(null); // true/false (V ou F) ou letra
  const [timeLeft, setTimeLeft] = useState(QUESTION_TIME);
  const timerRef = useRef(null);

  const question = quiz?.questions[currentIdx];
  const isVF = !quiz?.type || quiz?.type === "vf";
  const hasAnswered = selected !== null;

  // espelha currentIdx para a subscription sem recriar o canal
  const currentIdxRef = useRef(currentIdx);
  useEffect(() => {
    currentIdxRef.current = currentIdx;
  }, [currentIdx]);

  // Timer local: pausa quando o jogador já respondeu
  useEffect(() => {
    if (timeLeft > 0 && !hasAnswered) {
      timerRef.current = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    }
    return () => clearTimeout(timerRef.current);
  }, [timeLeft, hasAnswered]);

  // Subscription única ([] vazio): evita "cannot add postgres_changes after subscribe()"
  useEffect(() => {
    const channel = supabase
      .channel(`player_game_${room.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${room.id}`,
        },
        (payload) => {
          const updated = payload.new;
          const idx = currentIdxRef.current;

          if (updated.status === "finished") {
            navigation.navigate("Meus Quizzes");
            return;
          }
          if (updated.show_results) {
            navigation.replace("PodiumScreen", {
              room: updated,
              quiz,
              currentIdx: idx,
              isHost: false,
              isFinal: idx + 1 === quiz?.questions?.length,
              player,
            });
            return;
          }
          // anfitrião avançou enquanto o jogador ainda estava aqui (raro)
          if (updated.current_question_index !== idx) {
            setCurrentIdx(updated.current_question_index);
            setSelected(null);
            setTimeLeft(QUESTION_TIME);
          }
        },
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  const isCorrect = (choice) =>
    isVF
      ? choice === (question?.answer === "Verdadeiro")
      : choice === String(question?.answer).trim().charAt(0).toUpperCase();

  const handleAnswer = async (choice) => {
    if (hasAnswered || timeLeft === 0) return;
    setSelected(choice);
    haptic(isCorrect(choice) ? "success" : "error");
    if (!isCorrect(choice)) return;

    // resposta rápida vale mais: de 500 a 1000 pontos
    const points = Math.round(500 + (timeLeft / QUESTION_TIME) * 500);
    try {
      const { data: playerRow, error: fetchErr } = await supabase
        .from("players")
        .select("score")
        .eq("id", player.id)
        .single();
      if (fetchErr) throw fetchErr;

      const { error: updateErr } = await supabase
        .from("players")
        .update({ score: (playerRow?.score ?? 0) + points })
        .eq("id", player.id);
      if (updateErr) throw updateErr;
    } catch (e) {
      console.error("[PlayerGame] Erro ao salvar score:", e.message);
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
  const timeUp = timeLeft === 0 && !hasAnswered;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <ProgressBar value={timeLeft / QUESTION_TIME} duration={1000} />
        </View>
        <Text style={[type.label, styles.time, { color: timeLeft <= 5 ? colors.error : colors.text }]}>
          {timeLeft}s
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[type.caption, { color: colors.textMuted, textAlign: "center" }]}>
          Questão {currentIdx + 1} de {quiz.questions.length}
        </Text>

        {hasAnswered || timeUp ? (
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
                Aguardando o anfitrião mostrar o ranking…
              </Text>
            </View>
          </View>
        ) : (
          <Text style={[type.headline, { color: colors.text, textAlign: "center" }]}>
            Escolha sua resposta
          </Text>
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
  body: { padding: 16, gap: 20, flexGrow: 1, justifyContent: "center" },
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
