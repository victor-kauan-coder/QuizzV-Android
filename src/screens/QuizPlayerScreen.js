import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@react-navigation/native";
import * as NavigationBar from "expo-navigation-bar";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Confetti from "../components/Confetti";
import {
  Button,
  Choice,
  haptic,
  ProgressBar,
  Sheet,
  showSnackbar,
  useReduceMotion,
} from "../components/ui";
import { ThemeContext } from "../context/ThemeContext";
import { generateQuestions } from "../services/ai";
import {
  isVF as isVFQuestion,
  recordAttempt,
  saveQuiz,
  updateQuizProgress,
} from "../services/storage";
import { radius, type } from "../theme";

const LETTERS = "ABCDE";
const stripLetter = (opt) =>
  String(opt).replace(/^\s*\(?[A-Ea-e][).:-]\s*/, "");
const answerLetter = (q) => String(q.answer).trim().charAt(0).toUpperCase();

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Assuntos com erro, do que mais errou para o que menos errou
const weakTopics = (questions, answers) => {
  const byTopic = {};
  questions.forEach((q, i) => {
    if (!q.topic) return;
    const t = (byTopic[q.topic] = byTopic[q.topic] || { topic: q.topic, wrong: 0, total: 0 });
    t.total += 1;
    if (!answers[i]?.correct) t.wrong += 1;
  });
  return Object.values(byTopic)
    .filter((t) => t.wrong)
    .sort((a, b) => b.wrong - a.wrong || b.wrong / b.total - a.wrong / a.total);
};

const correctText = (q) =>
  q.options
    ? stripLetter(q.options[LETTERS.indexOf(answerLetter(q))] ?? q.answer)
    : q.answer;

// O que a IA precisa saber para atacar os erros sem repetir as mesmas questões
const reinforceContext = (title, wrong, topics) =>
  `O aluno acabou de errar as questões abaixo do quiz "${title}". Crie questões NOVAS (não repita estas) que trabalhem os mesmos conceitos por outros ângulos` +
  (topics.length
    ? `, com mais questões para os assuntos com mais erros, nesta ordem: ${topics.join(", ")}. No campo "topic", use esses mesmos nomes de assunto.`
    : ".") +
  `\nQuestões erradas:\n` +
  wrong
    .map(
      (q, i) =>
        `${i + 1}. ${q.topic ? `[${q.topic}] ` : ""}${String(q.question).replace(/\*\*/g, "")} (resposta correta: ${correctText(q)})`,
    )
    .join("\n");

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
  const { aiModel } = useContext(ThemeContext);
  // prova: marca e troca à vontade; certo/errado e explicações só depois de entregar
  const { quiz, resume = false, shuffle = false, prova = false } = route.params;

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
  const [reinforcing, setReinforcing] = useState(false);
  const [reviewing, setReviewing] = useState(false); // prova entregue, conferindo questão a questão
  const [showMap, setShowMap] = useState(false);
  const best = useRef(quiz.bestPct ?? null); // recorde antes desta sessão
  const reduce = useReduceMotion();

  // Troca de questão desliza no sentido da navegação (1 = vindo da direita)
  const slide = useRef(new Animated.Value(0)).current;
  const lastIdx = useRef(idx);
  const iconPop = useRef(new Animated.Value(1)).current;

  // Progresso salvo só vale para a ordem original e para a rodada completa
  const persist = !shuffle && !isRetry;
  const question = questions[idx];
  const isVF = isVFQuestion(question);
  const answer = answers[idx];
  const isLast = idx === questions.length - 1;
  const reveal = !prova || reviewing; // mostra certo/errado e a explicação
  const answeredCount = Object.keys(answers).length;

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
      title: isFinished ? "Resultado" : reviewing ? "Conferindo" : isRetry ? "Revisando erros" : "",
    });
  }, [isFinished, isRetry, reviewing]);

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
    if (reveal && answer) return; // na hora, a primeira resposta vale
    const correct = isCorrectChoice(choice);
    const newAnswers = { ...answers };
    // na prova, tocar de novo na marcada deixa a questão em branco
    if (prova && answer?.userVal === choice) delete newAnswers[idx];
    else newAnswers[idx] = { userVal: choice, correct };
    const newScore = Object.values(newAnswers).filter((a) => a.correct).length;
    setScore(newScore);
    setAnswers(newAnswers);
    haptic(prova ? "tap" : correct ? "success" : "error");
    if (persist) updateQuizProgress(quiz.id, idx, newAnswers, newScore);
  };

  const submit = () => {
    const blank = questions.length - answeredCount;
    if (!blank) return finish();
    Alert.alert(
      "Entregar a prova?",
      `${plural(blank, "questão ficou", "questões ficaram")} em branco e ${blank === 1 ? "conta" : "contam"} como erro.`,
      [
        { text: "Continuar respondendo", style: "cancel" },
        { text: "Entregar", onPress: finish },
      ],
    );
  };

  const goTo = (i) => {
    setShowMap(false);
    setIdx(i);
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

  const review = () => {
    setReviewing(true);
    setIdx(0);
    setIsFinished(false);
  };

  // da conferência de volta ao resultado, sem contar outra tentativa nem soltar confete de novo
  const backToResult = () => {
    setResult((r) => r && { ...r, celebrate: false });
    setIsFinished(true);
  };

  const redoIncorrect = () => {
    setReviewing(false);
    setQuestions(questions.filter((_, i) => !answers[i]?.correct));
    setIdx(0);
    setAnswers({});
    setScore(0);
    setIsRetry(true);
    setIsFinished(false);
  };

  // Novo quiz feito pela IA com foco nos assuntos que a pessoa mais errou
  const reinforce = async (weak, qtd) => {
    setReinforcing(true);
    try {
      const wrong = questions.filter((_, i) => !answers[i]?.correct);
      const topics = weak.map((t) => t.topic);
      const baseTitle = quiz.title.replace(/^Reforço · /, "");
      const generated = await generateQuestions(aiModel, {
        tema: topics.length ? `${baseTitle}: ${topics.slice(0, 5).join(", ")}` : baseTitle,
        qtd,
        mode: quiz.type === "vf" ? "vf" : "mc",
        context: reinforceContext(baseTitle, wrong, topics),
      });
      const reforco = {
        id: Date.now(),
        title: `Reforço · ${baseTitle}`,
        questions: generated,
        engine: aiModel,
        type: quiz.type === "vf" ? "vf" : "mc",
        folderId: quiz.folderId ?? null,
      };
      await saveQuiz(reforco);
      showSnackbar(`Reforço criado com ${plural(generated.length, "questão", "questões")}`);
      navigation.replace("Quiz", { quiz: reforco });
    } catch (e) {
      Alert.alert("Não foi possível gerar o reforço", e.message);
      setReinforcing(false);
    }
  };

  const playAgain = () => {
    setReviewing(false);
    setQuestions(shuffle ? shuffled(quiz.questions) : quiz.questions);
    setIdx(0);
    setAnswers({});
    setScore(0);
    setIsRetry(false);
    setIsFinished(false);
  };

  // Estado visual de uma alternativa depois de responder
  const optionState = (choice) => {
    if (reviewing && !answer) return isCorrectChoice(choice) ? "correct" : "dim"; // ficou em branco
    if (!answer) return "idle";
    if (!reveal) return answer.userVal === choice ? "marked" : "idle";
    if (isCorrectChoice(choice)) return "correct";
    if (answer.userVal === choice) return "wrong";
    return "dim";
  };

  if (isFinished) {
    const total = questions.length;
    const pct = Math.round((score / Math.max(total, 1)) * 100);
    const wrongCount = total - score;
    const weak = weakTopics(questions, answers);
    const reinforceQtd = Math.min(15, Math.max(5, wrongCount * 2));
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

        {wrongCount > 0 && (
          <View style={[styles.weakCard, { backgroundColor: colors.surface }]}>
            <Text style={[type.title, { color: colors.text }]}>
              {weak.length ? "Onde você mais errou" : "Reforce o que você errou"}
            </Text>
            {weak.slice(0, 5).map((t) => (
              <View
                key={t.topic}
                accessible
                accessibilityLabel={`${t.topic}: ${t.wrong} de ${t.total} erradas`}
                style={styles.weakRow}
              >
                <View style={styles.weakHead}>
                  <Text style={[type.body, { flex: 1, color: colors.text }]} numberOfLines={1}>
                    {t.topic}
                  </Text>
                  <Text style={[type.caption, styles.tabular, { color: colors.textMuted }]}>
                    {t.wrong} de {t.total}
                  </Text>
                </View>
                <View style={[styles.weakTrack, { backgroundColor: colors.errorSoft }]}>
                  <View
                    style={[
                      styles.weakFill,
                      { backgroundColor: colors.error, width: `${(t.wrong / t.total) * 100}%` },
                    ]}
                  />
                </View>
              </View>
            ))}
            <Text style={[type.caption, { color: colors.textMuted }]}>
              A IA cria {plural(reinforceQtd, "questão nova", "questões novas")}{" "}
              {weak.length ? "focadas nesses assuntos" : "sobre o que você errou"}.
            </Text>
            <Button
              variant="tonal"
              icon="sparkles"
              title={reinforcing ? "Gerando reforço…" : "Gerar questões de reforço"}
              loading={reinforcing}
              onPress={() => reinforce(weak, reinforceQtd)}
            />
          </View>
        )}

        {/* Com erros, o próximo passo de quem estuda é revisá-los */}
        <View style={styles.resultActions}>
          {prova && (
            <Button variant="tonal" icon="list" title="Conferir as respostas" onPress={review} />
          )}
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
        {prova ? (
          <Pressable
            onPress={() => setShowMap(true)}
            accessibilityRole="button"
            accessibilityLabel={`Mapa das questões: ${answeredCount} de ${questions.length} respondidas`}
            style={[styles.scoreChip, { backgroundColor: colors.accentSoft }]}
          >
            <Ionicons name="grid" size={14} color={colors.primary} />
            <Text style={[type.caption, { color: colors.text }]}>
              {reviewing ? plural(score, "certa", "certas") : plural(answeredCount, "respondida", "respondidas")}
            </Text>
          </Pressable>
        ) : (
          <View style={[styles.scoreChip, { backgroundColor: colors.successSoft }]}>
            <Ionicons name="checkmark" size={14} color={colors.success} />
            <Text style={[type.caption, { color: colors.text }]}>{score}</Text>
          </View>
        )}
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
            {question.topic ? (
              <Text
                style={[type.caption, styles.topic, { color: colors.primary }]}
                numberOfLines={1}
              >
                {question.topic}
              </Text>
            ) : null}
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
                  disabled={reveal && (!!answer || reviewing)}
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
                    disabled={reveal && (!!answer || reviewing)}
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

          {reveal && (answer || reviewing) && (
            <Reveal
              key={idx}
              style={[
                styles.feedback,
                { backgroundColor: answer?.correct ? colors.successSoft : colors.errorSoft },
              ]}
            >
              <View accessibilityLiveRegion="polite">
                <View style={styles.feedbackTitle}>
                  <Ionicons
                    name={answer?.correct ? "checkmark-circle" : "close-circle"}
                    size={20}
                    color={answer?.correct ? colors.success : colors.error}
                  />
                  <Text style={[type.title, { color: colors.text }]}>
                    {answer?.correct
                      ? "Correto!"
                      : `${answer ? "Incorreto" : "Em branco"} · resposta: ${isVF ? question.answer : answerLetter(question)}`}
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
        {prova ? (
          <Button
            variant={isLast || answer ? "filled" : "tonal"}
            icon={isLast && !reviewing ? "checkmark-done" : undefined}
            title={isLast ? (reviewing ? "Ver resultado" : "Entregar") : "Próxima"}
            onPress={() => (!isLast ? setIdx(idx + 1) : reviewing ? backToResult() : submit())}
            style={{ minWidth: 150 }}
          />
        ) : (
          <Button
            variant={answer ? "filled" : "tonal"}
            title={isLast ? "Ver resultado" : answer ? "Próxima" : "Pular"}
            onPress={() => (isLast ? finish() : setIdx(idx + 1))}
            style={{ minWidth: 150 }}
          />
        )}
      </View>

      <Sheet visible={showMap} onClose={() => setShowMap(false)}>
        <Text style={[type.headline, { color: colors.text }]}>Questões</Text>
        <Text style={[type.caption, { color: colors.textMuted, marginTop: 4 }]}>
          {reviewing
            ? `${plural(score, "certa", "certas")} de ${questions.length}. Toque numa questão para conferir.`
            : `${answeredCount} de ${questions.length} respondidas. Toque numa questão para ir até ela.`}
        </Text>
        <ScrollView style={{ maxHeight: 360, marginTop: 16 }} contentContainerStyle={styles.mapGrid}>
          {questions.map((_, i) => {
            const a = answers[i];
            const bg = reviewing
              ? a?.correct
                ? colors.successSoft
                : colors.errorSoft
              : a
                ? colors.accentSoft
                : colors.surfaceAlt;
            const border = i === idx ? colors.text : !reviewing && a ? colors.primary : "transparent";
            const status = reviewing ? (a?.correct ? "certa" : a ? "errada" : "em branco") : a ? "respondida" : "em branco";
            return (
              <Pressable
                key={i}
                onPress={() => goTo(i)}
                accessibilityRole="button"
                accessibilityLabel={`Questão ${i + 1}: ${status}`}
                style={[styles.mapCell, { backgroundColor: bg, borderColor: border }]}
              >
                <Text style={[type.label, styles.tabular, { color: colors.text }]}>{i + 1}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {!reviewing && (
          <Button
            icon="checkmark-done"
            title="Entregar a prova"
            style={{ marginTop: 16 }}
            onPress={() => {
              setShowMap(false);
              submit();
            }}
          />
        )}
      </Sheet>
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
  topic: { textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
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
  mapGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  mapCell: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
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
  resultActions: { gap: 10, marginTop: 24 },
  weakCard: { marginTop: 32, padding: 16, borderRadius: radius.lg, gap: 12 },
  weakRow: { gap: 6 },
  weakHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  tabular: { fontVariant: ["tabular-nums"] },
  weakTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  weakFill: { height: "100%", borderRadius: 3 },
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
