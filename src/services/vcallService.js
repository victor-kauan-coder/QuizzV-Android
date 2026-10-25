// Conexão com uma chamada do Vcall: o celular vira o controle do Quiz da
// chamada. O QR (ou o link) traz o endereço da chamada e um token que vale só
// para a pessoa que o mostrou; o celular conversa com o navegador dela pelo
// próprio servidor da chamada (pelo túnel ou pela rede), sem Supabase no meio.
import "react-native-url-polyfill/auto"; // URL com hash e query completos no Hermes

export const VCALL_PROTOCOLO = 1;
const LETTERS = "ABCDE";
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Lê o que veio do QR ou de um link colado. Aceita:
 *   https://algo.trycloudflare.com/quizzv#TOKEN   (o QR do Vcall)
 *   quizzv://vcall?u=https%3A%2F%2F...&p=TOKEN      (o link que abre o app)
 * Devolve { origem, token } ou null.
 */
export function lerPareamento(texto) {
  const bruto = String(texto ?? "").trim();
  if (!bruto) return null;
  try {
    if (/^quizzv:/i.test(bruto)) {
      // URL de esquema próprio: o parser do RN nem sempre lê a query, então à mão.
      const query = bruto.split("?")[1] || "";
      const params = Object.fromEntries(
        query.split("&").map((par) => {
          const [k, v = ""] = par.split("=");
          return [k, decodeURIComponent(v)];
        }),
      );
      const origem = params.u ? new URL(params.u).origin : "";
      const token = params.p || "";
      return origem && TOKEN_RE.test(token) && /^https?:$/.test(new URL(origem).protocol) ? { origem, token } : null;
    }
    const url = new URL(bruto);
    if (!/^https?:$/.test(url.protocol) || !/\/quizzv\/?$/.test(url.pathname)) return null;
    const token = decodeURIComponent(url.hash.slice(1));
    return TOKEN_RE.test(token) ? { origem: `${url.protocol}//${url.host}`, token } : null;
  } catch {
    return null;
  }
}

const stripLetter = (opt) =>
  String(opt ?? "").replace(/^\s*\(?[A-Ea-e][).:-]\s*/, "").replace(/\*\*/g, "").trim();
const clean = (s) => String(s ?? "").replace(/\*\*/g, "").trim();

/**
 * Converte um quiz da biblioteca para o formato do Vcall:
 *   { titulo, perguntas: [{ texto, opcoes, correta, explicacao }] }
 * V ou F vira duas alternativas. Perguntas sem como mostrar (sem alternativas,
 * gabarito fora delas) ficam de fora — e a contagem volta junto, para avisar.
 */
export function quizParaVcall(quiz) {
  const perguntas = [];
  let puladas = 0;
  for (const q of quiz?.questions || []) {
    const texto = clean(q.question).slice(0, 1500);
    let opcoes;
    let correta;
    if (!q.options?.length) {
      opcoes = ["Verdadeiro", "Falso"];
      correta = q.answer === "Verdadeiro" ? 0 : 1;
    } else {
      opcoes = (q.options || []).slice(0, 5).map((o) => stripLetter(o).slice(0, 300));
      correta = LETTERS.indexOf(String(q.answer ?? "").trim().charAt(0).toUpperCase());
    }
    if (!texto || opcoes.length < 2 || opcoes.some((o) => !o) || correta < 0 || correta >= opcoes.length) {
      puladas += 1;
      continue;
    }
    perguntas.push({ texto, opcoes, correta, explicacao: clean(q.explanation).slice(0, 1000) });
    if (perguntas.length >= 100) break;
  }
  return { quiz: { titulo: clean(quiz?.title).slice(0, 80) || "Quiz", perguntas }, puladas };
}

const texto = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const inteiro = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);
const FASES = new Set(["lobby", "preparar", "pergunta", "revelada", "fim"]);

/**
 * Confere e normaliza a "vista" que o navegador da pessoa manda pelo Vcall.
 * Devolve uma cópia só com campos do tipo certo, ou null para descartar.
 */
export function vistaValida(v) {
  if (!v || typeof v !== "object" || !FASES.has(v.fase)) return null;
  const out = { fase: v.fase, fonte: v.fonte === "quizzv" ? "quizzv" : "vcall", pausa: v.pausa === true };
  if (v.quizzv && typeof v.quizzv === "object") {
    out.quizzv = {
      titulo: texto(v.quizzv.titulo, 80) || "Quiz",
      qtd: inteiro(v.quizzv.qtd, 1, 100) ?? 0,
      tempo: inteiro(v.quizzv.tempo, 1, 600) ?? 20,
    };
  }
  if (v.aviso && typeof v.aviso === "object" && typeof v.aviso.texto === "string") {
    out.aviso = { texto: texto(v.aviso.texto, 300), n: inteiro(v.aviso.n, 0, 1e9) ?? 0 };
  }
  if (v.fase === "lobby") return out;

  out.k = inteiro(v.k, 0, 100) ?? 0;
  out.total = inteiro(v.total, 1, 100) ?? 1;
  out.titulo = texto(v.titulo, 80);
  out.pessoas = inteiro(v.pessoas, 0, 100) ?? 0;
  out.placar = (Array.isArray(v.placar) ? v.placar.slice(0, 10) : [])
    .filter((x) => x && typeof x === "object")
    .map((x) => ({ nome: texto(x.nome, 40), total: Number.isFinite(x.total) ? Math.round(x.total) : 0, eu: x.eu === true }));
  if (v.eu && typeof v.eu === "object") {
    out.eu = { pos: inteiro(v.eu.pos, 1, 100) ?? 1, total: Number.isFinite(v.eu.total) ? Math.round(v.eu.total) : 0 };
  }
  if (v.fase === "fim") return out;
  if (v.fase === "preparar") {
    out.contagemMs = Number.isFinite(v.contagemMs) ? Math.min(Math.max(v.contagemMs, 0), 10_000) : 0;
    return out;
  }

  // pergunta / revelada
  const p = v.pergunta;
  if (!p || typeof p !== "object" || typeof p.texto !== "string" || !Array.isArray(p.opcoes)) return null;
  const opcoes = p.opcoes.slice(0, 5).map((o) => texto(o, 300));
  if (opcoes.length < 2 || opcoes.some((o) => !o)) return null;
  out.pergunta = { texto: texto(p.texto, 1500), opcoes };
  out.limite = inteiro(v.limite, 1, 600) ?? 20;
  out.restanteMs = Number.isFinite(v.restanteMs) ? Math.min(Math.max(v.restanteMs, 0), out.limite * 1000) : 0;
  out.responderam = inteiro(v.responderam, 0, 100) ?? 0;
  out.faltam = inteiro(v.faltam, 0, 100) ?? 0;
  if (v.minha && typeof v.minha === "object" && inteiro(v.minha.e, 0, opcoes.length - 1) !== null) {
    out.minha = { e: v.minha.e };
  }
  if (v.fase === "revelada") {
    const certa = inteiro(p.certa, 0, opcoes.length - 1);
    if (certa !== null) out.pergunta.certa = certa;
    out.pergunta.explicacao = texto(p.explicacao, 1000);
    if (Array.isArray(v.porOpcao)) out.porOpcao = opcoes.map((_, i) => inteiro(v.porOpcao[i], 0, 100) ?? 0);
    if (out.minha) {
      out.minha.certo = v.minha.certo === true;
      out.minha.pontos = inteiro(v.minha.pontos, 0, 10_000) ?? 0;
      out.minha.seq = inteiro(v.minha.seq, 0, 100) ?? 0;
    }
  }
  return out;
}

/** O que cada recusa do Vcall quer dizer, para a tela. */
export const MOTIVOS = {
  "pareamento-invalido": "Este QR já não vale: a pessoa saiu da chamada, ou a chamada acabou. Gere outro no Quiz do Vcall.",
  "saiu-da-chamada": "Você saiu da chamada no computador. Entre de novo e leia o QR outra vez.",
  "sala-encerrada": "A chamada terminou.",
  substituido: "Este código foi aberto em outro aparelho, e a conexão passou para lá.",
  versao: "O Vcall desta chamada fala outra versão. Atualize o QuizzV, ou peça a quem hospeda para atualizar o Vcall.",
  "ja-conectado": "Esta conexão já estava em uso. Tente de novo.",
};

/** Recusas em que tentar de novo não adianta. */
const DEFINITIVAS = new Set(["pareamento-invalido", "saiu-da-chamada", "sala-encerrada", "substituido", "versao"]);

const BACKOFF = [500, 1000, 2000, 4000, 8000, 15000];

/**
 * A conexão. `onEvento(tipo, dados)` recebe:
 *   "estado"   { estado: "conectando" | "conectado" | "reconectando" | "encerrado", motivo? }
 *   "ola"      { voce: {id, nome}, sala: {nome} }
 *   "vista"    a vista do Quiz (o que mostrar agora)
 *   "aviso"    { erro, tipo? } — recusa passageira (ex.: a aba da pessoa caiu)
 */
export class ConexaoVcall {
  _ws = null;
  _tentativa = 0;
  _timer = null;
  _ping = null;
  _fechadoPorNos = false;

  constructor({ origem, token, versaoApp = "" }, onEvento) {
    this.origem = origem;
    this.token = token;
    this.versaoApp = versaoApp;
    this.onEvento = onEvento;
    this.estado = "parado";
  }

  conectar() {
    this._fechadoPorNos = false;
    clearTimeout(this._timer);
    this._abrir();
  }

  /** Voltou do segundo plano: não espera o backoff. */
  acordar() {
    if (this._fechadoPorNos || this.estado === "encerrado") return;
    if (this._ws && this._ws.readyState <= 1) return;
    this._tentativa = 0;
    clearTimeout(this._timer);
    this._abrir();
  }

  fechar() {
    this._fechadoPorNos = true;
    clearTimeout(this._timer);
    clearInterval(this._ping);
    try {
      this._ws?.close(1000, "tchau");
    } catch {
      /* já fechado */
    }
    this._ws = null;
  }

  /** Um pedido ao navegador da pessoa (carregar, comecar, responder, proxima, encerrar). */
  pedir(a) {
    if (this._ws?.readyState !== 1) return false;
    this._ws.send(JSON.stringify({ t: "quiz-do-celular", a }));
    return true;
  }

  _mudar(estado, extra = {}) {
    this.estado = estado;
    this.onEvento("estado", { estado, ...extra });
  }

  _abrir() {
    const ws = new WebSocket(this.origem.replace(/^http/, "ws"));
    this._ws = ws;
    this._mudar(this._tentativa ? "reconectando" : "conectando");

    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "quiz-ola", token: this.token, v: VCALL_PROTOCOLO, app: `QuizzV ${this.versaoApp}`.trim() }));
      clearInterval(this._ping);
      // Batimento: túnel e operadora derrubam conexão parada.
      this._ping = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ t: "ping", n: 1 })), 15000);
    };

    ws.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      // O servidor é o do link: tudo o que vem dele é conferido antes de ir
      // para a tela. Um quadro malformado é ignorado, nunca derruba o app.
      if (!m || typeof m !== "object") return;
      if (m.t === "quiz-conectado") {
        this._tentativa = 0;
        this._mudar("conectado");
        this.onEvento("ola", {
          voce: { nome: texto(m.voce?.nome, 40) },
          sala: { nome: texto(m.sala?.nome, 60) },
        });
      } else if (m.t === "quiz-vista") {
        const v = vistaValida(m.v);
        if (v) this.onEvento("vista", v);
      } else if (m.t === "quiz-erro") {
        if (DEFINITIVAS.has(m.erro)) {
          this._fechadoPorNos = true;
          this._mudar("encerrado", { motivo: m.erro });
        } else {
          this.onEvento("aviso", { erro: m.erro, tipo: m.tipo });
        }
      }
    };

    ws.onclose = () => {
      clearInterval(this._ping);
      if (this._ws !== ws) return;
      this._ws = null;
      if (this._fechadoPorNos) return;
      // Queda de rede: tenta de novo. O token vale enquanto a pessoa estiver na chamada.
      const base = BACKOFF[Math.min(this._tentativa, BACKOFF.length - 1)];
      this._tentativa += 1;
      this._mudar("reconectando");
      this._timer = setTimeout(() => this._abrir(), base * (0.6 + Math.random() * 0.4));
    };

    ws.onerror = () => {
      // O onclose vem em seguida e cuida de tentar de novo.
    };
  }
}
