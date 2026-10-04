import AsyncStorage from "@react-native-async-storage/async-storage";
import { Buffer } from "buffer";
import { getRandomBytes } from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { decodeQv, encodeQv, QV_MIME } from "./qvCodec";

const LEGACY_QUIZZES_KEY = "@quizzv_quizzes";
const SETTINGS_KEY = "@quizzv_settings";
const LIBRARY_FILE = FileSystem.documentDirectory + "quizzes.json";

// --- CONFIGURAÇÕES (Settings) ---
export const getSettings = async () => {
  try {
    const jsonValue = await AsyncStorage.getItem(SETTINGS_KEY);
    return jsonValue != null ? JSON.parse(jsonValue) : {};
  } catch {
    return {};
  }
};

export const saveSettings = async (newSettings) => {
  try {
    const current = await getSettings();
    const updated = { ...current, ...newSettings };
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error("Erro ao salvar settings:", e);
  }
};

// --- BIBLIOTECA ---
// Os quizzes ficam num arquivo: o AsyncStorage do Android estoura com quizzes
// que têm imagens (limite de ~2MB por chave) e a biblioteca "sumia".
let cache = null;
let queue = Promise.resolve();

const persist = async (list) => {
  const tmp = LIBRARY_FILE + ".tmp";
  await FileSystem.writeAsStringAsync(tmp, JSON.stringify(list));
  await FileSystem.deleteAsync(LIBRARY_FILE, { idempotent: true });
  await FileSystem.moveAsync({ from: tmp, to: LIBRARY_FILE });
};

const readLibrary = async () => {
  if (cache) return cache;
  // uma gravação interrompida deixa só o .tmp: recupera ele
  const tmp = LIBRARY_FILE + ".tmp";
  if (
    !(await FileSystem.getInfoAsync(LIBRARY_FILE)).exists &&
    (await FileSystem.getInfoAsync(tmp)).exists
  ) {
    await FileSystem.moveAsync({ from: tmp, to: LIBRARY_FILE });
  }

  if ((await FileSystem.getInfoAsync(LIBRARY_FILE)).exists) {
    try {
      cache = JSON.parse(await FileSystem.readAsStringAsync(LIBRARY_FILE));
    } catch {
      // guarda o arquivo ilegível em vez de sobrescrever os dados do usuário
      await FileSystem.moveAsync({
        from: LIBRARY_FILE,
        to: `${FileSystem.documentDirectory}quizzes.corrompido-${Date.now()}.json`,
      });
      cache = [];
    }
    return cache;
  }

  // migração única do formato antigo (AsyncStorage)
  const legacy = await AsyncStorage.getItem(LEGACY_QUIZZES_KEY);
  cache = legacy ? JSON.parse(legacy) : [];
  if (legacy) {
    await persist(cache);
    await AsyncStorage.removeItem(LEGACY_QUIZZES_KEY);
  }
  return cache;
};

// Serializa as escritas: progresso e salvamentos chegam em rajadas.
// ponytail: regrava a biblioteca inteira a cada mudança; separar um arquivo
// por quiz se bibliotecas com muitas imagens ficarem lentas.
const mutate = (fn) => {
  const run = queue.then(async () => {
    const next = fn(await readLibrary());
    await persist(next);
    cache = next;
  });
  queue = run.catch(() => {});
  return run;
};

export const getQuizzes = async () => {
  try {
    return [...(await readLibrary())];
  } catch (e) {
    console.error("Erro ao ler a biblioteca:", e);
    return [];
  }
};

const newId = () => `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

export const saveQuiz = (quiz) => mutate((list) => [quiz, ...list]);

export const deleteQuiz = (id) =>
  mutate((list) => list.filter((q) => q.id !== id));

export const updateQuizProgress = (id, lastIndex, answers = {}, score = 0) =>
  mutate((list) =>
    list.map((q) => (q.id === id ? { ...q, lastIndex, answers, score } : q)),
  ).catch((e) => console.error("Erro ao salvar o progresso:", e));

/** Registra uma partida completa (e zera o progresso salvo, se pedido). */
export const recordAttempt = (id, score, total, resetProgress = true) =>
  mutate((list) =>
    list.map((q) => {
      if (q.id !== id) return q;
      const pct = Math.round((score / Math.max(total, 1)) * 100);
      return {
        ...q,
        ...(resetProgress && { lastIndex: 0, answers: {}, score: 0 }),
        attempts: (q.attempts || 0) + 1,
        lastPct: pct,
        bestPct: Math.max(q.bestPct ?? 0, pct),
        lastPlayedAt: new Date().toISOString(),
      };
    }),
  ).catch((e) => console.error("Erro ao salvar a partida:", e));

// --- IMAGENS ---
const downloadAndConvertToBase64 = async (url) => {
  try {
    const fileUri = FileSystem.cacheDirectory + `img_${Date.now()}.png`;
    const downloadRes = await FileSystem.downloadAsync(url, fileUri, {
      headers: { "User-Agent": "QuizzV-App/1.0" }, // Essencial para evitar erro 403
    });
    if (downloadRes.status !== 200) return url;

    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.error("Erro na conversão de importação:", error);
    return url;
  }
};

// Embute imagens da web no quiz para ele funcionar offline
export const processQuizImages = async (quizData) => {
  const questions = await Promise.all(
    quizData.questions.map(async (q) =>
      q.imageUri?.startsWith("http")
        ? { ...q, imageUri: await downloadAndConvertToBase64(q.imageUri) }
        : q,
    ),
  );
  return { ...quizData, questions };
};

// --- VALIDAÇÃO E NORMALIZAÇÃO ---
const TRUE_WORDS = ["verdadeiro", "v", "true", "certo", "c"];

// "B", "b)", "B) Pilha" ou o texto da alternativa -> "B"
const mcLetter = (answer, options = []) => {
  if (/^[A-Ea-e]([).:\s-]|$)/.test(answer)) return answer[0].toUpperCase();
  const i = options.findIndex((o) =>
    String(o).toLowerCase().includes(answer.toLowerCase()),
  );
  return i >= 0 ? String.fromCharCode(65 + i) : answer.charAt(0).toUpperCase();
};

// Aceita quizzes de outras fontes (JSON feito à mão, outras IAs) no formato do app.
export const normalizeQuiz = (data, fallbackTitle = "Quiz importado") => {
  const raw = Array.isArray(data) ? { questions: data } : { ...data };
  const questions = Array.isArray(raw.questions) ? raw.questions : [];
  const isMC = raw.type
    ? raw.type === "mc" || raw.type === "multipla"
    : questions.some((q) => Array.isArray(q.options));

  return {
    title: String(raw.title || fallbackTitle).trim(),
    type: isMC ? "mc" : "vf",
    engine: raw.engine || "importado",
    questions: questions.map((q) => {
      const answer = String(q.answer ?? "").trim();
      return {
        ...q,
        question: String(q.question ?? "").trim(),
        explanation: q.explanation ? String(q.explanation) : "",
        answer: isMC
          ? mcLetter(answer, q.options)
          : TRUE_WORDS.includes(answer.toLowerCase())
            ? "Verdadeiro"
            : "Falso",
      };
    }),
  };
};

export const validateQuizStructure = (quiz) => {
  const errors = [];
  if (!quiz.title) errors.push("Título ausente");
  if (!quiz.questions.length) errors.push("Quiz sem questões");

  quiz.questions.forEach((q, i) => {
    if (!q.question) errors.push(`Questão ${i + 1}: enunciado vazio`);
    if (quiz.type === "mc") {
      if (!Array.isArray(q.options) || q.options.length < 2) {
        errors.push(`Questão ${i + 1}: alternativas ausentes`);
      } else if (!/^[A-Z]$/.test(q.answer)) {
        errors.push(`Questão ${i + 1}: gabarito deve ser uma letra (A–E)`);
      }
    }
  });
  return { valid: errors.length === 0, errors };
};

const assertValid = (quiz) => {
  const { valid, errors } = validateQuizStructure(quiz);
  if (!valid) throw new Error(`Quiz inválido:\n${errors.slice(0, 3).join("\n")}`);
  return quiz;
};

// --- ARQUIVOS ---
const fileBaseName = (name = "") => name.replace(/\.(qv|json|bin)$/i, "");

/** Lê um .qv/.json (file:// ou content://) e devolve o conteúdo decodificado. */
export const readQuizFile = async (uri) => {
  let localUri = uri;
  if (uri.startsWith("content://")) {
    // WhatsApp e gerenciadores entregam content://; copiamos antes de ler
    localUri = `${FileSystem.cacheDirectory}import_${Date.now()}`;
    await FileSystem.copyAsync({ from: uri, to: localUri });
  }
  try {
    const base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return decodeQv(Buffer.from(base64, "base64"));
  } finally {
    if (localUri !== uri) {
      FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
    }
  }
};

/**
 * Importa um quiz ou um backup de biblioteca. Retorna os títulos importados.
 * Lança Error com mensagem pronta para o usuário.
 */
export const importQuizFile = async (uri, fileName) => {
  const data = await readQuizFile(uri);
  const incoming = Array.isArray(data?.quizzes) ? data.quizzes : [data];
  const quizzes = [];
  for (const item of incoming) {
    const quiz = assertValid(normalizeQuiz(item, fileBaseName(fileName)));
    quizzes.push({
      ...(await processQuizImages(quiz)),
      id: newId(),
      imported: true,
      importDate: new Date().toISOString(),
    });
  }
  await mutate((list) => [...quizzes, ...list]);
  return quizzes.map((q) => q.title);
};

const safeFileName = (title) =>
  (title || "quiz")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // Ação -> Acao
    .replace(/[^a-zA-Z0-9\s_-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .substring(0, 50) || "quiz";

const shareQv = async (data, name, dialogTitle) => {
  const bytes = encodeQv(data, getRandomBytes);
  const fileUri = `${FileSystem.cacheDirectory}${safeFileName(name)}.qv`;
  await FileSystem.writeAsStringAsync(
    fileUri,
    Buffer.from(bytes).toString("base64"),
    { encoding: FileSystem.EncodingType.Base64 },
  );
  await Sharing.shareAsync(fileUri, {
    mimeType: QV_MIME,
    dialogTitle,
    UTI: "public.data",
  });
};

// Só o conteúdo viaja: progresso e estatísticas ficam no aparelho
const portable = ({ title, questions, type, engine }) => ({
  title,
  questions,
  type: type || "vf",
  engine: engine || "gemini",
  exportDate: new Date().toISOString(),
});

export const exportQuiz = (quiz) =>
  shareQv(portable(quiz), quiz.title, `Compartilhar: ${quiz.title}`);

/** Converte um .json qualquer em .qv criptografado e abre o compartilhamento. */
export const convertJsonToQv = async (uri, fileName) => {
  const quiz = assertValid(
    normalizeQuiz(await readQuizFile(uri), fileBaseName(fileName)),
  );
  await shareQv(portable(quiz), quiz.title, `Compartilhar: ${quiz.title}`);
  return quiz;
};

/** Backup de toda a biblioteca num único .qv. */
export const exportLibrary = async () => {
  const quizzes = await getQuizzes();
  if (!quizzes.length) throw new Error("Sua biblioteca está vazia.");
  const stamp = new Date().toISOString().slice(0, 10);
  await shareQv(
    { quizzes: quizzes.map(portable) },
    `QuizzV_backup_${stamp}`,
    "Salvar backup da biblioteca",
  );
  return quizzes.length;
};
