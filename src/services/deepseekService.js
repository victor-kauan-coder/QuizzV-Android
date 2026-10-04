const GITHUB_ENDPOINT =
  "https://models.inference.ai.azure.com/chat/completions";
// DeepSeek-R1 é o modelo atual e estável no GitHub Models
const MODEL_NAME = "DeepSeek-V3-0324";

const repairJson = (jsonString) => {
  let cleaned = jsonString;
  cleaned = cleaned.replace(/```json\s*/g, "").replace(/```\s*/g, "");
  cleaned = cleaned.replace(
    /[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g,
    "",
  );
  cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");
  return cleaned.trim();
};

const validateQuiz = (quiz, quizMode, numQuestions) => {
  if (!Array.isArray(quiz))
    throw new Error("O formato retornado não é um array");
  quiz.forEach((q, index) => {
    if (!q.question || !q.answer || !q.explanation) {
      throw new Error(`Questão ${index + 1} incompleta.`);
    }
    // Ajustado para 'mc', que é o que vem da sua GeneratorScreen
    if (
      quizMode === "mc" &&
      (!Array.isArray(q.options) || q.options.length < 4)
    ) {
      throw new Error(`Questão ${index + 1}: deve ter opções.`);
    }
  });
  return true;
};

// Nome corrigido para bater com o import do GeneratorScreen
export const generateQuizFromDeepSeek = async (
  topic,
  numQuestions,
  githubToken,
  files = [],
  quizMode = "vf",
  maxRetries = 3,
) => {
  const tokenLimpo = githubToken ? githubToken.trim() : "";

  const promptSistema = `VOCÊ É UM SISTEMA DE GERAÇÃO DE QUIZ ACADÊMICO.
Responda APENAS com um array JSON puro. PROIBIDO texto adicional ou markdown.
Formato:
${
  quizMode === "vf"
    ? '[{"question":"","answer":"Verdadeiro","explanation":""}]'
    : '[{"question":"","options":["A) ","B) ","C) ","D) ","E) "],"answer":"B","explanation":""}]'
}`;

  const promptUsuario = `TEMA: "${topic}"
QUANTIDADE: Gere EXATAMENTE ${numQuestions} questões.
MODO: ${quizMode === "vf" ? "Verdadeiro ou Falso" : "Múltipla Escolha"}.
Explicações: 60-120 caracteres.`;

  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Tentativa ${attempt}/${maxRetries} (${MODEL_NAME})...`);
      const response = await fetch(GITHUB_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenLimpo}`,
        },
        body: JSON.stringify({
          model: MODEL_NAME,
          messages: [
            { role: "system", content: promptSistema },
            { role: "user", content: promptUsuario },
          ],
          temperature: 0.1,
          max_tokens: 4000,
          response_format: { type: "json_object" },
        }),
      });

      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message || "Erro API GitHub");

      let text = data.choices[0].message.content;
      const sanitizedJson = repairJson(text);
      const quiz = JSON.parse(sanitizedJson);
      const finalQuiz = Array.isArray(quiz)
        ? quiz
        : quiz.questoes || quiz.quiz || Object.values(quiz)[0];

      validateQuiz(finalQuiz, quizMode, numQuestions);
      return finalQuiz;
    } catch (error) {
      lastError = error;
      console.warn(`Falha na tentativa ${attempt}:`, error.message);
      if (attempt < maxRetries)
        await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error(`Erro após ${maxRetries} tentativas: ${lastError.message}`);
};
