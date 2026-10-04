import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

// Logo vetorial (mesmo arquivo usado no app), embutida como SVG no HTML
const loadLogoSvg = async () => {
  const asset = Asset.fromModule(require("../../assets/images/logo.svg"));
  await asset.downloadAsync();
  return FileSystem.readAsStringAsync(asset.localUri);
};

export const exportToPdf = async (quiz) => {
  // 1. FORMATADOR DE TEXTO
  const formatText = (text) => {
    if (!text) return "";
    let formatted = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

    // Negrito Laranja
    formatted = formatted.replace(
      /\*\*(.*?)\*\*/g,
      '<span class="highlight">$1</span>',
    );
    // Quebras de linha
    formatted = formatted.replace(/\n/g, "<br/>");
    return formatted;
  };

  // 2. LIMPEZA DE ALTERNATIVAS
  const cleanOptionText = (text) => {
    if (!text) return "";
    // Remove "A)", "a.", "A -", etc do início
    return text
      .replace(/^(\([a-zA-Z]\)|[a-zA-Z]\)|[a-zA-Z]\.|[a-zA-Z]\s-)\s*/, "")
      .trim();
  };

  const cleanFileName = quiz.title
    ? quiz.title.replace(/[^a-zA-Z0-9]/g, "_")
    : "simulado";
  const fileName = `${cleanFileName}.pdf`;
  const displayTitle = quiz.title || "SIMULADO GERAL";

  const logoSvg = await loadLogoSvg();

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          /* --- CONFIGURAÇÃO DA PÁGINA E NUMERAÇÃO --- */
          @page {
            size: A4;
            margin: 15mm;
            
            /* AQUI ESTÁ A MÁGICA DA BOLINHA LARANJA NO CANTO DIREITO */
            @bottom-right {
              content: counter(page); /* Apenas o número */
              
              /* Estilo da Bola Laranja */
              background-color: #F97316;
              color: white;
              font-weight: bold;
              font-family: 'Helvetica', sans-serif;
              font-size: 12px;
              
              /* Tamanho e Forma */
              width: 30px;
              height: 30px;
              border-radius: 50%; /* Faz virar bola */
              
              /* Centralização do Texto na Bola */
              text-align: center;
              line-height: 30px;
              
              /* Margem para não colar na borda */
              margin-bottom: 10px;
              margin-right: 10px;
            }
          }

          body {
            font-family: 'Helvetica', 'Arial', sans-serif;
            font-size: 11px;
            color: #000;
            background-color: #fff;
            margin: 0;
            padding: 0;
          }

          /* --- TABELA DE LAYOUT (CABEÇALHO REPETIDO) --- */
          table { width: 100%; border-collapse: collapse; }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
          
          .header-space { height: 100px; }
          /* Espaço no rodapé para não bater no número da página */
          .footer-space { height: 50px; }

          /* --- CABEÇALHO FIXO --- */
          .header-fixed {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            height: 90px;
            background-color: white;
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0 10px;
          }

          .header-line {
            flex: 1;
            height: 4px;
            background-color: #F97316; /* Laranja */
            border-radius: 2px;
          }

          .header-logo { margin: 0 20px; }
          .header-logo svg { display: block; width: 60px; height: 60px; }

          /* --- ESTILOS GERAIS --- */
          .title-block {
            text-align: center;
            margin-bottom: 25px;
            padding-bottom: 10px;
            border-bottom: 1px solid #e5e7eb;
            margin-top: 10px;
          }
          
          .main-title {
            color: #1E3A8A;
            font-size: 18px;
            font-weight: 900;
            text-transform: uppercase;
            margin: 0;
          }

          .sub-title {
            color: #666;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 2px;
            margin-top: 5px;
          }

          .highlight {
            color: #F97316; 
            font-weight: bold;
          }

          .columns-container {
            column-count: 2;
            column-gap: 30px;
            column-rule: 1px solid #d1d5db;
            width: 100%;
            text-align: justify;
          }

          .question-container {
            break-inside: avoid;
            margin-bottom: 20px;
          }

          .question-header {
            font-weight: bold;
            color: #1E3A8A;
            font-size: 12px;
            margin-bottom: 4px;
          }

          .question-text {
            line-height: 1.4;
            margin-bottom: 8px;
          }

          .option {
            margin-bottom: 4px;
            display: flex;
            align-items: flex-start;
          }

          .option-letter {
            font-weight: bold;
            color: #1E3A8A;
            margin-right: 5px;
            min-width: 20px;
          }

          /* --- GABARITO --- */
          .gabarito-section {
             margin-top: 40px; 
             break-inside: avoid;
             border-top: 2px solid #1E3A8A;
             padding-top: 20px;
          }
          
          .gabarito-title {
            background-color: #1E3A8A;
            color: white;
            font-weight: bold;
            text-align: center;
            padding: 8px;
            border-radius: 4px;
            margin-bottom: 15px;
            text-transform: uppercase;
          }

          .gabarito-box {
            background-color: #eff6ff;
            border: 1px solid #bfdbfe;
            border-left: 4px solid #1E3A8A;
            border-radius: 5px;
            padding: 10px;
            margin-bottom: 10px;
            break-inside: avoid;
          }

          .gabarito-top {
            display: flex;
            justify-content: space-between;
            margin-bottom: 5px;
            border-bottom: 1px dashed #cbd5e1;
            padding-bottom: 5px;
          }
          
          .gab-q-num { font-weight: bold; color: #1E3A8A; font-size: 12px; }
          .gab-ans { font-weight: bold; background: #1E3A8A; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px; }
          .gab-text { font-size: 10px; color: #334155; font-style: italic; }

        </style>
      </head>
      <body>

        <div class="header-fixed">
          <div class="header-line"></div>
          <div class="header-logo">${logoSvg}</div>
          <div class="header-line"></div>
        </div>

        <table>
          <thead><tr><td><div class="header-space">&nbsp;</div></td></tr></thead>
          <tbody>
            <tr>
              <td>
                
                <div class="title-block">
                  <h1 class="main-title">${displayTitle}</h1>
                  <div class="sub-title">Caderno de Questões</div>
                </div>

                <div class="columns-container">
                  ${quiz.questions
                    .map((q, index) => {
                      const num = (index + 1).toString().padStart(2, "0");
                      const letters = ["(A)", "(B)", "(C)", "(D)", "(E)"];

                      return `
                      <div class="question-container">
                        <div class="question-header">QUESTÃO ${num}</div>
                        <div class="question-text">${formatText(q.question)}</div>
                        <div style="margin-top: 5px;">
                        ${q.imageUri ? `<img src="${q.imageUri}" alt="Imagem da questão" style="max-width: 100%; margin-bottom: 10px;" />` : ""}              
                          ${
                            q.options
                              ? q.options
                                  .map((opt, i) => {
                                    const finalText = formatText(
                                      cleanOptionText(opt),
                                    );
                                    return `
                            <div class="option">
                              <span class="option-letter">${letters[i] || "-"}</span>
                              <span>${finalText}</span>
                            </div>
                          `;
                                  })
                                  .join("")
                              : '<div class="option">( ) Certo ( ) Errado</div>'
                          }
                        </div>
                      </div>
                     `;
                    })
                    .join("")}
                </div>

                <div class="gabarito-section">
                  <div class="gabarito-title">Gabarito e Comentários</div>
                  
                  <div>
                  ${quiz.questions
                    .map((q, index) => {
                      const num = (index + 1).toString().padStart(2, "0");
                      return `
                      <div class="gabarito-box">
                        <div class="gabarito-top">
                          <span class="gab-q-num">Questão ${num}</span>
                          <span class="gab-ans">Gabarito: ${q.answer}</span>
                        </div>
                        <div class="gab-text">
                          ${q.explanation ? formatText(q.explanation) : "Sem comentário."}
                        </div>
                      </div>
                     `;
                    })
                    .join("")}
                  </div>
                </div>

              </td>
            </tr>
          </tbody>
          <tfoot><tr><td><div class="footer-space">&nbsp;</div></td></tr></tfoot>
        </table>

      </body>
    </html>
  `;

  try {
    const { uri: tempUri } = await Print.printToFileAsync({
      html: htmlContent,
      base64: false,
    });
    const finalUri = `${FileSystem.cacheDirectory}${fileName}`;
    await FileSystem.moveAsync({ from: tempUri, to: finalUri });
    await Sharing.shareAsync(finalUri, {
      mimeType: "application/pdf",
      dialogTitle: `Simulado ${quiz.title}`,
      UTI: "com.adobe.pdf",
    });
  } catch (error) {
    console.error("Erro PDF:", error);
    throw new Error("Não foi possível gerar o PDF.");
  }
};
