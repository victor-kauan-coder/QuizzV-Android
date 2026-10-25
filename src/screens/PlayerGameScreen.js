import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { Choice, haptic, ProgressBar } from "../components/ui";
import { answerQuestion, endQuestion, removePlayer, syncClock, timeLeft as restante } from "../services/roomService";
import { leavePresence, useLeaveGuard, useOnline, useRoom } from "../services/roomSync";
import { radius, type } from "../theme";

const LETTERS = "ABCDE";
const stripLetter = (opt) =>
  String(opt).replace(/^\s*\(?[A-Ea-e][).:-]\s*/, "").replace(/\*\*/g, "");

export default function PlayerGameScreen({ route, navigation }) {
  const { colors } = useTheme();
  const { room, player } = route.params;
  const quiz = route.params.quiz ?? room.quiz_data; // o quiz não muda durante a partida
  const total = quiz?.questions?.length || 0;

  const [currentIdx, setCurrentIdx] = useState(room.current_question_index ?? 0);
  // A sala com a hora de início da questão: o relógio é o do banco
  const [sala, setSala] = useState(room);
  const [selected, setSelected] = useState(null); // true/false (V ou F) ou letra
  // O banco confirmou a resposta. Se acertou, só se sabe no ranking: dizer
  // na hora deixava um segundo aparelho descobrir a certa.
  const [resultado, setResultado] = useState(null);
  const tempoTotal = sala.question_time || 20;
  const [timeLeft, setTimeLeft] = useState(() => Math.ceil(restante(sala)));
  const done = useRef(false);
  const destravou = useRef(-1);
  const selectedRef = useRef(null);
  selectedRef.current = selected;
  const online = useOnline(room.id);

  const question = quiz?.questions?.[currentIdx];
  const isVF = !question?.options?.length; // cada questão tem seu tipo (quiz misto)
  const hasAnswered = selected !== null;
  const timeUp = timeLeft === 0 && !hasAnswered;
  const hostOnline = !online || online.has("host");

  useEffect(() => {
    syncClock();
  }, []);

  // Cronômetro pelo relógio do banco. Acabou o tempo e o anfitrião não fechou
  // a questão (sumiu, app em segundo plano): o jogador fecha — o banco só
  // aceita depois do tempo, então ninguém fecha antes da hora.
  useEffect(() => {
    const tick = () => {
      const s = restante(sala);
      setTimeLeft(Math.ceil(s));
      if (s <= 0 && sala.question_started_at && destravou.current !== currentIdx) {
        const passou = -s; // segundos além do tempo (aproximado)
        if (passou >= 0) {
          destravou.current = currentIdx;
          setTimeout(() => endQuestion(room.id, currentIdx, player.id).catch(() => {}), 3000);
        }
      }
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [sala, currentIdx]);

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
        // o ranking compara com o gabarito publicado e diz se acertou
        escolha: idx === currentIdx && selectedRef.current !== null ? respostaDe(selectedRef.current) : null,
      });
    } else if (idx > currentIdx) {
      // o anfitrião já passou para a próxima
      setCurrentIdx(idx);
      setSala(current);
      setSelected(null);
      setResultado(null);
    } else if (idx === currentIdx && current.question_started_at !== sala.question_started_at) {
      setSala(current); // chegou a hora de início desta questão
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

  // O gabarito não está mais no celular: quem confere e soma os pontos
  // (500 a 1000, pela rapidez) é o banco, pelo relógio dele.
  const respostaDe = (choice) => (isVF ? (choice ? "Verdadeiro" : "Falso") : choice);

  const handleAnswer = async (choice) => {
    if (hasAnswered || timeLeft === 0) return;
    setSelected(choice);
    haptic("tap");
    try {
      const r = await answerQuestion(player.id, currentIdx, respostaDe(choice));
      setResultado(r);
    } catch (error) {
      Alert.alert("Sua resposta não foi enviada", error.message);
      setSelected(null);
    }
  };

  // Antes do ranking, só a SUA alternativa é marcada (certa ou errada); a
  // certa de verdade aparece no ranking, quando a questão fecha para todos.
  const optionState = (choice) => (!hasAnswered || choice === selected ? "idle" : "dim");

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

  const enviada = !!resultado;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <ProgressBar value={timeLeft / tempoTotal} duration={1000} />
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

        {(resultado || timeUp) && (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.result,
              { backgroundColor: enviada ? colors.surfaceAlt : colors.errorSoft },
            ]}
          >
            <Ionicons
              name={enviada ? "checkmark-done" : "time"}
              size={28}
              color={enviada ? colors.primary : colors.error}
            />
            <View style={{ flex: 1 }}>
              <Text style={[type.title, { color: colors.text }]}>
                {enviada ? "Resposta enviada!" : "Tempo esgotado"}
              </Text>
              <Text style={[type.caption, { color: colors.textMuted }]}>
                {enviada ? "O resultado aparece no ranking, quando todos responderem." : "Aguardando os outros jogadores…"}
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
