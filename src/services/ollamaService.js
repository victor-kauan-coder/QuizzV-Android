/**
 * ollamaService.js
 * Serviço responsável por conectar o App React Native ao Backend Python (RAG)
 */

export const generateQuizFromOllamaUnified = async (
  topic,
  numQuestions = 3,
  customUrl, // Recebe a URL das configurações
  textContent, // (Ignorado pelo Python RAG atual, mas mantido pra compatibilidade)
  images, // (Ignorado pelo Python RAG atual)
  quizMode = "mc", // Recebe o modo (mc ou vf)
) => {
  // Se o usuário não configurou URL, usa uma padrão ou lança erro (opcional)
  if (!customUrl) {
    throw new Error("URL do servidor Ollama não configurada.");
  }

  // Garante que a URL termine com o endpoint correto da API Python
  // Se o usuário digitou "http://...ngrok.app", adicionamos "/api/gerar-quiz"
  const BASE_URL = "https://yeasty-gemmier-amal.ngrok-free.dev";
  const API_URL = `${BASE_URL}/api/gerar-quiz`;

  try {
    console.log(`[OllamaService] Solicitando quiz para: ${API_URL}`);
    console.log(`[OllamaService] Modo: ${quizMode} | Tema: ${topic}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000); // 3 min

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
        "User-Agent": "QuizzV-App",
      },
      body: JSON.stringify({
        tema: topic,
        qtd: numQuestions,
        modo: quizMode, // <--- ENVIA O MODO PARA O PYTHON
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro do Servidor (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    // Validação
    if (!data.questions || !Array.isArray(data.questions)) {
      console.error("JSON Inválido recebido:", data);
      throw new Error("A IA retornou um formato inválido.");
    }

    return data; // Retorna o objeto { title, type, questions }
  } catch (error) {
    console.error("[OllamaService] Erro:", error.message);
    if (error.name === "AbortError") {
      throw new Error("O servidor demorou muito. Verifique sua conexão.");
    }
    throw error;
  }
};
