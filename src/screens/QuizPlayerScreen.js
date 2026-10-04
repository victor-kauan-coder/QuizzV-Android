import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@react-navigation/native";
import * as NavigationBar from "expo-navigation-bar";
import { useEffect, useMemo, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, ProgressBar } from "../components/ui";
import { recordAttempt, updateQuizProgress } from "../services/storage";
import { radius, type } from "../theme";

const LETTERS = "ABCDE";
const stripLetter = (opt) =>
  String(opt).replace(/^\s*\(?[A-Ea-e][).:-]\s*/, "");
const answerLetter = (q) => String(q.answer).trim().charAt(0).toUpperCase();

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

  // Progresso salvo só vale para a ordem original e para a rodada completa
  const persist = !shuffle && !isRetry;
  const question = questions[idx];
  const isVF = quiz.type !== "mc";
  const answer = answers[idx];
  const isLast = idx === questions.length - 1;

  useEffect(() => {
    if (persist && !isFinished) updateQuizProgress(quiz.id, idx, answers, score);
  }, [idx]);

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
    if (persist) updateQuizProgress(quiz.id, idx, newAnswers, newScore);
  };

  const finish = () => {
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

  const optionColors = (state) =>
    ({
      idle: { bg: colors.surface, border: colors.border, fg: colors.text },
      correct: { bg: colors.successSoft, border: colors.success, fg: colors.text },
      wrong: { bg: colors.errorSoft, border: colors.error, fg: colors.text },
      dim: { bg: colors.surface, border: colors.border, fg: colors.textMuted },
    })[state];

  const stateIcon = (state) =>
    state === "correct" ? (
      <Ionicons name="checkmark-circle" size={22} color={colors.success} />
    ) : state === "wrong" ? (
      <Ionicons name="close-circle" size={22} color={colors.error} />
    ) : null;

  if (isFinished) {
    const total = questions.length;
    const pct = Math.round((score / Math.max(total, 1)) * 100);
    const wrongCount = total - score;
    const verdict =
      pct >= 70 ? "Mandou bem!" : pct >= 40 ? "Bom trabalho" : "Continue praticando";

    return (
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={[styles.result, { paddingBottom: 24 + insets.bottom }]}
      >
        <Ionicons
          name={pct >= 70 ? "trophy" : pct >= 40 ? "ribbon" : "book"}
          size={56}
          color={colors.primary}
        />
        <Text style={[type.headline, { color: colors.text, marginTop: 16 }]}>
          {verdict}
        </Text>
        <Text style={[styles.bigScore, { color: colors.text }]}>{pct}%</Text>
        <Text style={[type.body, { color: colors.textMuted }]}>
          {score} de {total} {total === 1 ? "questão correta" : "questões corretas"}
          {isRetry ? " na revisão" : ""}
        </Text>

        <View style={styles.statRow}>
          <View style={[styles.stat, { backgroundColor: colors.successSoft }]}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={[type.label, { color: colors.text }]}>{score} acertos</Text>
          </View>
          <View style={[styles.stat, { backgroundColor: colors.errorSoft }]}>
            <Ionicons name="close-circle" size={20} color={colors.error} />
            <Text style={[type.label, { color: colors.text }]}>{wrongCount} erros</Text>
          </View>
        </View>

        <View style={styles.resultActions}>
          {wrongCount > 0 && (
            <Button
              variant="tonal"
              icon="refresh"
              title={`Refazer ${wrongCount === 1 ? "a errada" : `as ${wrongCount} erradas`}`}
              onPress={redoIncorrect}
            />
          )}
          <Button
            variant="outlined"
            icon={shuffle ? "shuffle" : "play"}
            title="Jogar de novo"
            onPress={playAgain}
          />
          <Button title="Voltar à biblioteca" onPress={() => navigation.goBack()} />
        </View>
      </ScrollView>
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
            {[
              { label: "Verdadeiro", value: true, icon: "checkmark" },
              { label: "Falso", value: false, icon: "close" },
            ].map((o) => {
              const state = optionState(o.value);
              const c = optionColors(state);
              return (
                <Pressable
                  key={o.label}
                  onPress={() => handleAnswer(o.value)}
                  disabled={!!answer}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !!answer, selected: answer?.userVal === o.value }}
                  android_ripple={{ color: colors.border }}
                  style={[
                    styles.vfBtn,
                    { backgroundColor: c.bg, borderColor: c.border },
                  ]}
                >
                  {stateIcon(state) || (
                    <Ionicons name={o.icon} size={22} color={c.fg} />
                  )}
                  <Text style={[type.title, { color: c.fg }]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={styles.mcList}>
            {(question.options || []).map((opt, i) => {
              const letter = LETTERS[i] || String(i + 1);
              const state = optionState(letter);
              const c = optionColors(state);
              return (
                <Pressable
                  key={i}
                  onPress={() => handleAnswer(letter)}
                  disabled={!!answer}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !!answer, selected: answer?.userVal === letter }}
                  android_ripple={{ color: colors.border }}
                  style={[
                    styles.mcBtn,
                    { backgroundColor: c.bg, borderColor: c.border },
                  ]}
                >
                  <View
                    style={[
                      styles.letter,
                      { backgroundColor: state === "idle" ? colors.surfaceAlt : "transparent" },
                    ]}
                  >
                    {stateIcon(state) || (
                      <Text style={[type.label, { color: c.fg }]}>{letter}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    {renderHighlightedText(stripLetter(opt), [type.body, { color: c.fg }])}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        {answer && (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.feedback,
              { backgroundColor: answer.correct ? colors.successSoft : colors.errorSoft },
            ]}
          >
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
        )}
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
  vfBtn: {
    flex: 1,
    minHeight: 64,
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    overflow: "hidden",
  },
  mcList: { gap: 10 },
  mcBtn: {
    minHeight: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    overflow: "hidden",
  },
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
  result: { alignItems: "center", padding: 24, paddingTop: 40 },
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
  resultActions: { alignSelf: "stretch", gap: 10, marginTop: 32 },
});
