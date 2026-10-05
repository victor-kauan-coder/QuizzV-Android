import { generateQuizFromDeepSeek } from "./deepseekService";
import { generateQuizFromIA } from "./geminiService";
import { generateQuizFromOllamaUnified } from "./ollamaService";
import { getSettings } from "./storage";

/**
 * Gera questões com o motor escolhido nas configurações.
 * context: material de apoio ou os erros do aluno, que guiam as questões.
 */
export const generateQuestions = async (
  engine,
  { tema, qtd, mode, context = "", files = [], images = [] },
) => {
  const s = (await getSettings()) || {};
  if (engine === "gemini") {
    if (!s.api_key) throw new Error("Cadastre sua chave do Gemini nas configurações.");
    return generateQuizFromIA(tema, qtd, s.api_key, files, mode, 3, {
      model: s.geminiModel,
      context,
    });
  }
  if (engine === "ollama") {
    if (!s.ollama_url) throw new Error("Configure a URL do servidor Ollama.");
    const data = await generateQuizFromOllamaUnified(tema, qtd, s.ollama_url, context, images, mode);
    return data.questions;
  }
  if (!s.deepseek_key) throw new Error("Cadastre sua chave do DeepSeek nas configurações.");
  return generateQuizFromDeepSeek(
    context ? `${tema}\n\n${context}` : tema,
    qtd,
    s.deepseek_key,
    [],
    mode,
  );
};
