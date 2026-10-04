import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@react-navigation/native";
import * as NavigationBar from "expo-navigation-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Confetti from "../components/Confetti";
import { Button, Choice, haptic, ProgressBar, useReduceMotion } from "../components/ui";
import { recordAttempt, updateQuizProgress } from "../services/storage";
import { radius, type } from "../theme";

const LETTERS = "ABCDE";
const stripLetter = (opt) =>
  String(opt).replace(/^\s*\(?[A-Ea-e][).:-]\s*/, "");
const answerLetter = (q) => String(q.answer).trim().charAt(0).toUpperCase();

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// O momento da partida: a porcentagem sobe até o resultado (instantâneo se o
// sistema pede menos movimento)
function CountUp({ value, style }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const anim = new Animated.Value(0);
    const id = anim.addListener(({ value: v }) => setShown(Math.round(v)));
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce) return setShown(value);
      Animated.timing(anim, {
        toValue: value,
        duration: 900,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    });
    return () => {
      anim.stopAnimation();
      anim.removeListener(id);
    };
  }, [value]);
  return (
    <Text style={style} accessibilityLabel={`${value}%`}>
      {shown}%
    </Text>
  );
}

// Entra suavemente (opacidade + leve subida) ao montar
function Reveal({ children, style }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [v]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: v,
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const VF_OPTIONS = [
  { label: "Verdadeiro", value: true, icon: "checkmark" },
  { label: "Falso", value: false, icon: "close" },
];

const shuffled = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export default function QuizPlayerScreen({ route, navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { quiz, resume = false, shuffle = false } = route.params;

  const fullRun = useMemo(
    () => (shuffle ? shuffled(quiz.questions) : quiz.questions),
    [quiz, shuffle],
  );
  const [questions, setQuestions] = useState(fullRun);
  const [idx, setIdx] = useState(resume ? quiz.lastIndex || 0 : 0);
  const [answers, setAnswers] = useState(resume ? quiz.answers || {} : {});
  const [score, setScore] = useState(resume ? quiz.score || 0 : 0);
  const [isFinished, setIsFinished] = useState(false);
  const [isRetry, setIsRetry] = useState(false);
  const [result, setResult] = useState(null); // { pct, isRecord, celebrate, id }
  const best = useRef(quiz.bestPct ?? null); // recorde antes desta sessão
  const reduce = useReduceMotion();

  // Troca de questão desliza no sentido da navegação (1 = vindo da direita)
  const slide = useRef(new Animated.Value(0)).current;
  const lastIdx = useRef(idx);
  const iconPop = useRef(new Animated.Value(1)).current;

  // Progresso salvo só vale para a ordem original e para a rodada completa
  const persist = !shuffle && !isRetry;
  const question = questions[idx];
  const isVF = quiz.type !== "mc";
  const answer = answers[idx];
  const isLast = idx === questions.length - 1;

  useEffect(() => {
    if (persist && !isFinished) updateQuizProgress(quiz.id, idx, answers, score);
  }, [idx]);

  useEffect(() => {
    const dir = idx >= lastIdx.current ? 1 : -1;
    lastIdx.current = idx;
    if (reduce) return;
    slide.setValue(dir);
    Animated.timing(slide, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [idx, questions]);

  // Modo imersivo: esconde a barra de navegação do Android durante o quiz
  useEffect(() => {
    if (Platform.OS !== "android") return;
    NavigationBar.setVisibilityAsync("hidden");
    return () => {
      NavigationBar.setVisibilityAsync("visible");
    };
  }, []);

  useEffect(() => {
    navigation.setOptions({
      title: isFinished ? "Resultado" : isRetry ? "Revisando erros" : "",
    });
  }, [isFinished, isRetry]);

  const renderHighlightedText = (text, baseStyle) => {
    if (!text) return null;
    return (
      <Text style={baseStyle}>
        {String(text)
          .split(/(\*\*.*?\*\*)/g)
          .map((part, i) =>
            part.startsWith("**") && part.endsWith("**") ? (
              <Text
                key={i}
                style={{
                  fontWeight: "800",
                  color: colors.primary,
                  backgroundColor: colors.accentSoft,
                }}
              >
                {part.slice(2, -2)}
              </Text>
            ) : (
              part
            ),
          )}
      </Text>
    );
  };

  const isCorrectChoice = (choice) =>
    isVF
      ? choice === (question.answer === "Verdadeiro")
      : choice === answerLetter(question);

  const handleAnswer = (choice) => {
    if (answer) return;
    const correct = isCorrectChoice(choice);
    const newScore = correct ? score + 1 : score;
    const newAnswers = { ...answers, [idx]: { userVal: choice, correct } };
    setScore(newScore);
    setAnswers(newAnswers);
    haptic(correct ? "success" : "error");
    if (persist) updateQuizProgress(quiz.id, idx, newAnswers, newScore);
  };

  const finish = () => {
    const pct = Math.round((score / Math.max(questions.length, 1)) * 100);
    const isRecord = !isRetry && best.current !== null && pct > best.current;
    const celebrate = pct >= 70 || isRecord;
    if (!isRetry) best.current = Math.max(best.current ?? 0, pct);
    setResult({ pct, isRecord, celebrate, id: Date.now() });
    if (celebrate) haptic("success");
    if (!reduce) {
      iconPop.setValue(0);
      Animated.spring(iconPop, { toValue: 1, friction: 5, useNativeDriver: true }).start();
    }
    setIsFinished(true);
    if (!isRetry) {
      // estatísticas da rodada completa; no modo embaralhado o progresso salvo fica
      recordAttempt(quiz.id, score, questions.length, !shuffle);
    }
  };

  const redoIncorrect = () => {
    setQuestions(questions.filter((_, i) => !answers[i]?.correct));
    setIdx(0);
    setAnswers({});
    setScore(0);
    setIsRetry(true);
    setIsFinished(false);
  };

  const playAgain = () => {
    setQuestions(shuffle ? shuffled(quiz.questions) : quiz.questions);
    setIdx(0);
    setAnswers({});
    setScore(0);
    setIsRetry(false);
    setIsFinished(false);
  };

  // Estado visual de uma alternativa depois de responder
  const optionState = (choice) => {
    if (!answer) return "idle";
    if (isCorrectChoice(choice)) return "correct";
    if (answer.userVal === choice) return "wrong";
    return "dim";
  };

  if (isFinished) {
    const total = questions.length;
    const pct = Math.round((score / Math.max(total, 1)) * 100);
    const wrongCount = total - score;
    const verdict =
      pct === 100
        ? "Perfeito!"
        : pct >= 70
          ? "Mandou bem!"
          : pct >= 40
            ? "Bom trabalho"
            : "Continue praticando";
    const exit = () => navigation.goBack();

    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScrollView
          contentContainerStyle={[styles.result, { paddingBottom: 16 + insets.bottom }]}
        >
        <View style={styles.resultHero}>
          <Animated.View
            style={{
              opacity: iconPop,
              transform: [
                { scale: iconPop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
                {
                  rotate: iconPop.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["-25deg", "0deg"],
                  }),
                },
              ],
            }}
          >
            <Ionicons
              name={pct >= 70 ? "trophy" : pct >= 40 ? "ribbon" : "book"}
              size={56}
              color={colors.primary}
            />
          </Animated.View>
          <Text
            style={[type.caption, styles.center, { color: colors.textMuted, marginTop: 16 }]}
            numberOfLines={2}
          >
            {quiz.title}
            {isRetry ? " · revisão dos erros" : ""}
          </Text>
          <Text style={[type.headline, { color: colors.text, marginTop: 4 }]}>
            {verdict}
          </Text>
          <CountUp value={pct} style={[styles.bigScore, { color: colors.text }]} />
          <Text style={[type.body, { color: colors.textMuted }]}>
            {score} de {plural(total, "questão correta", "questões corretas")}
          </Text>

          <View style={styles.statRow}>
            <View style={[styles.stat, { backgroundColor: colors.successSoft }]}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              <Text style={[type.label, { color: colors.text }]}>
                {plural(score, "acerto", "acertos")}
              </Text>
            </View>
            <View style={[styles.stat, { backgroundColor: colors.errorSoft }]}>
              <Ionicons name="close-circle" size={20} color={colors.error} />
              <Text style={[type.label, { color: colors.text }]}>
                {plural(wrongCount, "erro", "erros")}
              </Text>
            </View>
          </View>
          {result?.isRecord && (
            <View style={[styles.record, { backgroundColor: colors.accentSoft }]}>
              <Ionicons name="sparkles" size={16} color={colors.primary} />
              <Text style={[type.label, { color: colors.primary }]}>Novo recorde!</Text>
            </View>
          )}
        </View>

        {/* Com erros, o próximo passo de quem estuda é revisá-los */}
        <View style={styles.resultActions}>
          {wrongCount > 0 ? (
            <>
              <Button
                icon="refresh"
                title={`Refazer ${wrongCount === 1 ? "a errada" : `as ${wrongCount} erradas`}`}
                onPress={redoIncorrect}
              />
              <Button
                variant="outlined"
                icon={shuffle ? "shuffle" : "play"}
                title="Jogar de novo"
                onPress={playAgain}
              />
              <Button variant="text" title="Voltar à biblioteca" onPress={exit} />
            </>
          ) : (
            <>
              <Button title="Voltar à biblioteca" onPress={exit} />
              <Button
                variant="outlined"
                icon={shuffle ? "shuffle" : "play"}
                title="Jogar de novo"
                onPress={playAgain}
              />
            </>
          )}
        </View>
        </ScrollView>
        {result?.celebrate && !reduce && (
          <Confetti key={result.id} count={pct === 100 ? 140 : 90} />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.progressRow}>
        <View style={{ flex: 1 }}>
          <ProgressBar value={(idx + 1) / questions.length} />
        </View>
        <Text style={[type.caption, { color: colors.textMuted }]}>
          {idx + 1}/{questions.length}
        </Text>
        <View style={[styles.scoreChip, { backgroundColor: colors.successSoft }]}>
          <Ionicons name="checkmark" size={14} color={colors.success} />
          <Text style={[type.caption, { color: colors.text }]}>{score}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={{
            gap: 16,
            opacity: slide.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] }),
            transform: [
              { translateX: slide.interpolate({ inputRange: [-1, 1], outputRange: [-36, 36] }) },
            ],
          }}
        >
          <View style={[styles.qCard, { backgroundColor: colors.surface }]}>
            {question.imageUri && (
              <Image
                source={{
                  uri: question.imageUri,
                  headers: { "User-Agent": "QuizzV-App/1.0 (anam37234@gmail.com)" },
                }}
                style={styles.questionImage}
                resizeMode="contain"
                accessibilityLabel="Imagem da questão"
              />
            )}
            {renderHighlightedText(question.question, [
              styles.questionText,
              { color: colors.text },
            ])}
          </View>

          {isVF ? (
            <View style={styles.vfRow}>
              {VF_OPTIONS.map((o) => (
                <Choice
                  key={o.label}
                  state={optionState(o.value)}
                  selected={answer?.userVal === o.value}
                  onPress={() => handleAnswer(o.value)}
                  disabled={!!answer}
                  style={styles.vfBtn}
                  leading={(icon, fg) => icon || <Ionicons name={o.icon} size={22} color={fg} />}
                >
                  {(fg) => <Text style={[type.title, { color: fg }]}>{o.label}</Text>}
                </Choice>
              ))}
            </View>
          ) : (
            <View style={styles.mcList}>
              {(question.options || []).map((opt, i) => {
                const letter = LETTERS[i] || String(i + 1);
                const state = optionState(letter);
                return (
                  <Choice
                    key={i}
                    state={state}
                    selected={answer?.userVal === letter}
                    onPress={() => handleAnswer(letter)}
                    disabled={!!answer}
                    leading={(icon, fg) => (
                      <View
                        style={[
                          styles.letter,
                          { backgroundColor: state === "idle" ? colors.surfaceAlt : "transparent" },
                        ]}
                      >
                        {icon || <Text style={[type.label, { color: fg }]}>{letter}</Text>}
                      </View>
                    )}
                  >
                    {(fg) => (
                      <View style={{ flex: 1 }}>
                        {renderHighlightedText(stripLetter(opt), [type.body, { color: fg }])}
                      </View>
                    )}
                  </Choice>
                );
              })}
            </View>
          )}

          {answer && (
            <Reveal
              key={idx}
              style={[
                styles.feedback,
                { backgroundColor: answer.correct ? colors.successSoft : colors.errorSoft },
              ]}
            >
              <View accessibilityLiveRegion="polite">
                <View style={styles.feedbackTitle}>
                  <Ionicons
                    name={answer.correct ? "checkmark-circle" : "close-circle"}
                    size={20}
                    color={answer.correct ? colors.success : colors.error}
                  />
                  <Text style={[type.title, { color: colors.text }]}>
                    {answer.correct
                      ? "Correto!"
                      : `Incorreto · resposta: ${isVF ? question.answer : answerLetter(question)}`}
                  </Text>
                </View>
                {renderHighlightedText(question.explanation, [
                  type.body,
                  { color: colors.text, marginTop: 6 },
                ])}
              </View>
            </Reveal>
          )}
        </Animated.View>
      </ScrollView>

      <View
        style={[
          styles.bottomBar,
          { borderTopColor: colors.border, paddingBottom: 12 + insets.bottom },
        ]}
      >
        <Button
          variant="text"
          icon="arrow-back"
          title="Anterior"
          onPress={() => setIdx(idx - 1)}
          disabled={idx === 0}
        />
        <Button
          variant={answer ? "filled" : "tonal"}
          title={isLast ? "Ver resultado" : answer ? "Próxima" : "Pular"}
          onPress={() => (isLast ? finish() : setIdx(idx + 1))}
          style={{ minWidth: 150 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
  },
  scoreChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  scroll: { paddingHorizontal: 16, paddingBottom: 24, gap: 16 },
  qCard: { padding: 20, borderRadius: radius.lg },
  questionText: { fontSize: 18, lineHeight: 27, fontWeight: "500" },
  questionImage: {
    width: "100%",
    height: 220,
    borderRadius: radius.md,
    marginBottom: 16,
  },
  vfRow: { flexDirection: "row", gap: 12 },
  vfBtn: { flex: 1, minHeight: 64, justifyContent: "center", gap: 8 },
  mcList: { gap: 10 },
  letter: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  feedback: { padding: 16, borderRadius: radius.md },
  feedbackTitle: { flexDirection: "row", alignItems: "center", gap: 8 },
  bottomBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  result: { flexGrow: 1, padding: 24 },
  resultHero: { flex: 1, alignItems: "center", justifyContent: "center" },
  center: { textAlign: "center" },
  bigScore: {
    fontSize: 64,
    lineHeight: 72,
    fontWeight: "800",
    letterSpacing: -1.5,
    marginTop: 8,
    fontVariant: ["tabular-nums"],
  },
  statRow: { flexDirection: "row", gap: 12, marginTop: 24 },
  stat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  resultActions: { gap: 10, marginTop: 32 },
  record: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
});
