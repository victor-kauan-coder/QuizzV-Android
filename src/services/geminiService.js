import { GoogleGenerativeAI } from "@google/generative-ai";
import * as FileSystem from "expo-file-system/legacy";

const MAX_TPM = 240000;

/**
 * REPARO AVANÇADO: Remove caracteres problemáticos e corrige estruturas JSON
 */
const repairJson = (jsonString) => {
  let cleaned = jsonString;

  // 1. Remove markdown code blocks
  cleaned = cleaned.replace(/```json\s*/g, "");
  cleaned = cleaned.replace(/```\s*/g, "");

  // 2. Remove caracteres de controle (exceto \n e \t que são válidos em JSON)
  cleaned = cleaned.replace(
    /[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g,
    "",
  );

  // 3. Remove vírgulas extras antes de } ou ]
  cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");

  // 4. Normaliza espaços em branco (mas preserva dentro de strings)
  cleaned = cleaned.trim();

  return cleaned;
};

/**
 * VALIDAÇÃO: Verifica se o quiz gerado está no formato correto
 */
const validateQuiz = (quiz, quizMode, numQuestions) => {
  if (!Array.isArray(quiz)) {
    throw new Error("O formato retornado não é um array válido");
  }

  if (quiz.length === 0) {
    throw new Error("Nenhuma questão foi gerada");
  }

  if (quiz.length < numQuestions) {
    console.warn(
      `Esperado ${numQuestions} questões, mas recebeu ${quiz.length}`,
    );
  }

  quiz.forEach((q, index) => {
    if (!q.question || typeof q.question !== "string") {
      throw new Error(`Questão ${index + 1}: campo 'question' inválido`);
    }

    if (!q.answer || typeof q.answer !== "string") {
      throw new Error(`Questão ${index + 1}: campo 'answer' inválido`);
    }

    if (!q.explanation || typeof q.explanation !== "string") {
      throw new Error(`Questão ${index + 1}: campo 'explanation' inválido`);
    }

    if (
      quizMode === "multipla" &&
      (!Array.isArray(q.options) || q.options.length !== 4)
    ) {
      throw new Error(`Questão ${index + 1}: deve ter exatamente 4 opções`);
    }
  });

  return true;
};

/**
 * GERAÇÃO DE QUIZ COM RETRY E VALIDAÇÃO
 */
export const generateQuizFromIA = async (
  topic,
  numQuestions,
  apiKey,
  files = [],
  quizMode = "vf",
  maxRetries = 3,
) => {
  const genAI = new GoogleGenerativeAI(apiKey);

  // Usando gemini-1.5-flash (modelo estável e gratuito)
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.7,
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 16384, // Aumentado para evitar cortes
    },
  });

  // Processa arquivos
  let estimatedTokens = topic.length / 4;
  const fileParts = await Promise.all(
    files.map(async (file) => {
      const base64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: "base64",
      });

      estimatedTokens += file.name.toLowerCase().endsWith(".pdf")
        ? base64.length / 4
        : 258;

      const mime =
        file.mimeType ||
        (file.name.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "image/jpeg");

      return {
        inlineData: { data: base64, mimeType: mime },
      };
    }),
  );

  if (estimatedTokens > MAX_TPM) {
    throw new Error("Volume de dados excede o limite gratuito.");
  }

  // PROMPT OTIMIZADO COM INSTRUÇÕES EXPLÍCITAS
  const exampleVF = `[
  {
    "question": "A linguagem Python é compilada diretamente para código de máquina",
    "answer": "Falso",
    "explanation": "Python é uma linguagem interpretada. O código é convertido para bytecode e executado pela máquina virtual Python, não compilado diretamente para código de máquina como C ou C++."
  }
]`;

  const exampleMultipla = `[
  {
    "question": "Qual estrutura de dados utiliza o princípio LIFO (Last In, First Out)?",
    "options": [
      "A) Fila",
      "B) Pilha",
      "C) Lista encadeada",
      "D) Árvore binária",
      "E) Set"
    ],
    "answer": "B",
    "explanation": "A pilha (stack) segue o princípio LIFO, onde o último elemento inserido é o primeiro a ser removido, similar a uma pilha de pratos."
  }
]`;

  const prompt = `VOCÊ É UM SISTEMA DE GERAÇÃO DE QUIZ ACADÊMICO.

TEMA: "${topic}"
QUANTIDADE: ${numQuestions} questões (GERE EXATAMENTE ${numQuestions})
MODO: ${quizMode === "vf" ? "Verdadeiro ou Falso" : "Múltipla Escolha"}

REGRAS OBRIGATÓRIAS:
1. Retorne APENAS um array JSON válido, SEM texto adicional
2. NÃO use markdown, NÃO use \`\`\`json
3. Todas as questões devem ser sobre "${topic}"
4. Explicações: 60-120 caracteres (seja direto e claro)
5. Escreva tudo em uma única linha (sem quebras de linha reais)
6. Use APENAS aspas duplas (")
7. ${
    quizMode === "vf"
      ? 'Campo "answer": "Verdadeiro" ou "Falso"'
      : 'Campo "answer": "A", "B", "C", "D" ou "E"'
  }
8. ⚠️ CRÍTICO: Complete TODAS as ${numQuestions} questões. Se faltar alguma, o sistema falhará!

FORMATO COMPACTO (economize tokens):
${
  quizMode === "vf"
    ? `[{"question":"Pergunta direta?","answer":"Verdadeiro","explanation":"Explicação objetiva em até 120 chars."}]`
    : `[{"question":"Pergunta?","options":["A) Op1","B) Op2","C) Op3","D) Op4", "E) Op5"],"answer":"B","explanation":"Explicação."}]`
}

INICIE O ARRAY JSON COM AS ${numQuestions} QUESTÕES AGORA:`;

  // SISTEMA DE RETRY
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Tentativa ${attempt}/${maxRetries} de gerar quiz...`);

      const result = await model.generateContent([prompt, ...fileParts]);
      const response = await result.response;
      let text = response.text();

      console.log("📝 Resposta completa tem", text.length, "caracteres");
      console.log("🔍 Primeiros 500 chars:", text.substring(0, 500));
      console.log("🔍 Últimos 200 chars:", text.substring(text.length - 200));

      // Verifica se a resposta foi cortada
      if (!text.trim().endsWith("]")) {
        console.warn("⚠️ Resposta parece incompleta - não termina com ]");
        throw new Error(
          "Resposta da IA foi truncada. Tente reduzir o número de questões.",
        );
      }

      // Extração do JSON
      const firstBracket = text.indexOf("[");
      const lastBracket = text.lastIndexOf("]");

      if (firstBracket === -1 || lastBracket === -1) {
        throw new Error("JSON não encontrado na resposta da IA");
      }

      const rawJson = text.substring(firstBracket, lastBracket + 1);
      console.log("🔧 JSON extraído tem", rawJson.length, "caracteres");

      const sanitizedJson = repairJson(rawJson);

      // Parse e validação
      const quiz = JSON.parse(sanitizedJson);
      validateQuiz(quiz, quizMode, numQuestions);

      console.log(`✅ Quiz gerado com sucesso na tentativa ${attempt}`);
      return quiz;
    } catch (error) {
      lastError = error;
      console.warn(`⚠️ Tentativa ${attempt} falhou:`, error.message);

      if (error instanceof SyntaxError) {
        console.error(
          "🔍 Erro de sintaxe JSON. Verifique os logs acima para ver o JSON problemático.",
        );
      }

      // Se não for a última tentativa, aguarda antes de tentar novamente
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  // Se todas as tentativas falharam
  console.error("❌ Todas as tentativas falharam:", lastError);
  throw new Error(
    `Não foi possível gerar o quiz após ${maxRetries} tentativas. ` +
      `Último erro: ${lastError.message}`,
  );
};

/**
 * VERSÃO SIMPLIFICADA PARA TESTES
 */
export const generateQuizSimple = async (topic, numQuestions, apiKey) => {
  return generateQuizFromIA(topic, numQuestions, apiKey, [], "vf", 2);
};

/**
 * GERAÇÃO EM LOTES (para quando numQuestions > 8)
 * Lotes menores = mais confiável, menos chance de timeout/truncamento
 */
export const generateQuizInBatches = async (
  topic,
  numQuestions,
  apiKey,
  files = [],
  quizMode = "vf",
) => {
  // Define tamanho do lote baseado no modo
  // Múltipla escolha tem mais tokens (4 opções + explicação)
  const batchSize = quizMode === "vf" ? 8 : 5;

  // Se for poucas questões, gera direto
  if (numQuestions <= batchSize) {
    return generateQuizFromIA(topic, numQuestions, apiKey, files, quizMode, 3);
  }

  // Senão, gera em lotes
  const numBatches = Math.ceil(numQuestions / batchSize);
  const allQuestions = [];

  console.log(
    `📦 Gerando ${numQuestions} questões em ${numBatches} lotes de ~${batchSize} questões`,
  );

  for (let i = 0; i < numBatches; i++) {
    const questionsInBatch = Math.min(
      batchSize,
      numQuestions - allQuestions.length,
    );

    console.log(
      `📦 Lote ${i + 1}/${numBatches}: gerando ${questionsInBatch} questões...`,
    );

    try {
      const batch = await generateQuizFromIA(
        topic,
        questionsInBatch,
        apiKey,
        i === 0 ? files : [], // Só envia arquivos no primeiro lote
        quizMode,
        2, // 2 tentativas por lote
      );

      allQuestions.push(...batch);
      console.log(
        `✅ Lote ${i + 1} completo. Total acumulado: ${allQuestions.length}`,
      );

      // Aguarda entre lotes para não sobrecarregar a API
      if (i < numBatches - 1) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    } catch (error) {
      console.error(`❌ Erro no lote ${i + 1}:`, error.message);

      // Se já temos algumas questões, retorna o que conseguimos
      if (allQuestions.length > 0) {
        console.warn(
          `⚠️ Retornando ${allQuestions.length} questões geradas até o momento`,
        );
        return allQuestions;
      }

      // Se não conseguiu nenhuma, propaga o erro
      throw error;
    }
  }

  console.log(
    `🎉 Total de ${allQuestions.length} questões geradas com sucesso!`,
  );
  return allQuestions;
};
