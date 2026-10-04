import { useTheme } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, ProgressBar } from "../components/ui";
import { supabase } from "../services/supabase";
import { radius, type } from "../theme";

const QUESTION_TIME = 20;

export default function HostGameControlScreen({ route, navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { room, quiz } = route.params;

  const [currentIdx] = useState(route.params.currentIdx || 0);
  const [timeLeft, setTimeLeft] = useState(QUESTION_TIME);
  const [ending, setEnding] = useState(false);
  const timerRef = useRef(null);

  // evita que o timer e o botão chamem handleEndQuestion ao mesmo tempo
  const hasEnded = useRef(false);

  const question = quiz?.questions[currentIdx];
  const total = quiz?.questions.length || 0;

  useEffect(() => {
    if (timeLeft > 0) {
      timerRef.current = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    } else {
      handleEndQuestion();
    }
    return () => clearTimeout(timerRef.current);
  }, [timeLeft]);

  const handleEndQuestion = async () => {
    if (hasEnded.current) return;
    hasEnded.current = true;
    setEnding(true);
    clearTimeout(timerRef.current);

    await supabase.from("rooms").update({ show_results: true }).eq("id", room.id);

    // replace() para não empilhar telas nem assinar o mesmo canal duas vezes
    navigation.replace("PodiumScreen", {
      room,
      quiz,
      currentIdx,
      isHost: true,
      isFinal: currentIdx + 1 === total,
    });
  };

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
          style={[
            styles.timer,
            { borderColor: urgent ? colors.error : colors.accent },
          ]}
          accessibilityLabel={`${timeLeft} segundos restantes`}
          accessibilityLiveRegion={urgent ? "assertive" : "none"}
        >
          <Text
            style={[
              styles.timerText,
              { color: urgent ? colors.error : colors.text },
            ]}
          >
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
            <View
              key={i}
              style={[styles.option, { backgroundColor: colors.surface }]}
            >
              <Text style={[type.body, { color: colors.text }]}>
                {String(opt).replace(/\*\*/g, "")}
              </Text>
            </View>
          ))}

        <Text style={[type.body, styles.hint, { color: colors.textMuted }]}>
          Os jogadores estão respondendo no celular…
        </Text>
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
    minHeight: 160,
    justifyContent: "center",
    marginBottom: 6,
  },
  questionText: { fontSize: 20, lineHeight: 28, fontWeight: "700", textAlign: "center" },
  option: { padding: 14, borderRadius: radius.md },
  hint: { textAlign: "center", marginTop: 12 },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
