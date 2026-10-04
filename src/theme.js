// Tokens visuais do QuizzV. O accent é escolhido pelo usuário; aqui garantimos
// que texto e ícones nessa cor continuem legíveis (WCAG AA) nos dois temas.

const INK = "#0F172A";

const LIGHT = {
  background: "#F8FAFC",
  surface: "#FFFFFF",
  surfaceAlt: "#EEF2F7",
  text: INK,
  textMuted: "#475569",
  border: "#E2E8F0",
  success: "#15803D",
  successSoft: "#DCFCE7",
  error: "#B91C1C",
  errorSoft: "#FEE2E2",
  scrim: "rgba(15, 23, 42, 0.45)",
};

const DARK = {
  background: "#0F172A",
  surface: "#1E293B",
  surfaceAlt: "#273449",
  text: "#F8FAFC",
  textMuted: "#94A3B8",
  border: "#334155",
  success: "#4ADE80",
  successSoft: "rgba(74, 222, 128, 0.14)",
  error: "#F87171",
  errorSoft: "rgba(248, 113, 113, 0.14)",
  scrim: "rgba(2, 6, 23, 0.6)",
};

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) =>
  "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const mix = (hex, target, t) => {
  const a = rgb(hex);
  const b = rgb(target);
  return toHex(a.map((v, i) => v + (b[i] - v) * t));
};

// Aproxima a cor do branco (fundos escuros) ou do preto (fundos claros)
// até atingir o contraste mínimo com todos os fundos informados.
const readable = (hex, min, ...bgs) => {
  const target = luminance(bgs[0]) < 0.5 ? "#FFFFFF" : "#000000";
  const worst = (c) => Math.min(...bgs.map((bg) => contrast(c, bg)));
  let out = hex;
  for (let t = 0.05; worst(out) < min && t <= 1; t += 0.05) {
    out = mix(hex, target, t);
  }
  return out;
};

export const buildColors = (dark, accent) => {
  const base = dark ? DARK : LIGHT;
  // no escuro, accents fechados (ex.: marinho) somem no fundo: clareamos até 3:1
  let fill = dark ? readable(accent, 3, base.background) : accent;
  // accents de luminância média (ex.: violeta) não leem bem nem com branco nem
  // com tinta: escurecemos o preenchimento até o texto branco passar
  if (Math.max(contrast("#FFFFFF", fill), contrast(INK, fill)) < 4.5) {
    fill = readable(fill, 4.5, "#FFFFFF");
  }
  return {
    ...base,
    accent: fill, // preenchimentos: FAB, botões, barras de progresso
    onAccent: contrast("#FFFFFF", fill) >= 4.5 ? "#FFFFFF" : INK,
    primary: readable(accent, 4.5, base.background, base.surface), // texto e ícones
    accentSoft: fill + (dark ? "2B" : "1A"),
    // botões e ícones secundários: no escuro o accent translúcido sobre o
    // marinho fica marrom, então usamos a superfície neutra
    tonal: dark ? base.surfaceAlt : fill + "1A",
    // chaves esperadas pelo React Navigation
    card: base.surface,
    notification: fill,
  };
};

export const type = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: "800" },
  headline: { fontSize: 22, lineHeight: 28, fontWeight: "800" },
  title: { fontSize: 17, lineHeight: 22, fontWeight: "700" },
  body: { fontSize: 15, lineHeight: 22 },
  label: { fontSize: 14, lineHeight: 18, fontWeight: "700" },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
};

export const radius = { sm: 10, md: 14, lg: 20, xl: 28 };
