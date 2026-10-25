import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import Constants from "expo-constants";
import { useKeepAwake } from "expo-keep-awake";
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  Button,
  Choice,
  haptic,
  ListItem,
  ProgressBar,
  Segmented,
  Sheet,
  showSnackbar,
} from "../components/ui";
import { getQuizzes } from "../services/storage";
import { ConexaoVcall, lerPareamento, MOTIVOS, quizParaVcall } from "../services/vcallService";
import { radius, type } from "../theme";

const LETTERS = "ABCDE";
const TEMPOS = [10, 15, 20, 30, 60];
const VERSAO = Constants.expoConfig?.version ?? "";

// Mantém a tela acesa só enquanto houver chamada (componente separado porque
// o hook não pode ser condicional).
function TelaAcesa() {
  useKeepAwake();
  return null;
}

export default function VcallScreen({ route, navigation }) {
  const { colors } = useTheme();
  const [par, setPar] = useState(null); // { origem, token }
  const [estado, setEstado] = useState("parado");
  const [motivo, setMotivo] = useState(null);
  const [ola, setOla] = useState(null);
  const [vista, setVista] = useState(null);
  const [chegou, setChegou] = useState(0); // Date.now() da última vista
  const [aviso, setAviso] = useState(null);
  const [minhaLocal, setMinhaLocal] = useState(null); // resposta otimista { k, e }
  const [lendo, setLendo] = useState(false);
  const [colado, setColado] = useState("");
  const [escolhido, setEscolhido] = useState(route.params?.quiz ?? null);
  const [biblioteca, setBiblioteca] = useState(null); // lista aberta para escolher
  const [, setTique] = useState(0);
  const conn = useRef(null);
  const ultimoAviso = useRef(0);
  const ultimaFase = useRef("");

  /* ---------------- conexão ---------------- */

  const conectar = useCallback((p) => {
    conn.current?.fechar();
    setPar(p);
    setMotivo(null);
    setVista(null);
    setOla(null);
    const c = new ConexaoVcall({ ...p, versaoApp: VERSAO }, (tipo, dados) => {
      if (tipo === "estado") {
        setEstado(dados.estado);
        if (dados.motivo) setMotivo(dados.motivo);
      } else if (tipo === "ola") {
        setOla(dados);
        haptic("success");
      } else if (tipo === "vista") {
        setVista(dados);
        setChegou(Date.now());
      } else if (tipo === "aviso") {
        setAviso(dados.erro);
      }
    });
    conn.current = c;
    c.conectar();
  }, []);

  // Link que abriu o app (quizzv://vcall?...). Ele pode vir de qualquer
  // página ou app: antes de conectar, a pessoa vê para onde vai e confirma.
  useEffect(() => {
    const link = route.params?.link;
    if (!link) return;
    const p = lerPareamento(link);
    if (!p) {
      Alert.alert("Link não reconhecido", "Este link não é de pareamento do Vcall.");
      return;
    }
    const host = p.origem.replace(/^https?:\/\//, "");
    Alert.alert(
      "Conectar a uma chamada?",
      `${conn.current ? "Isto troca a chamada conectada agora. " : ""}Endereço: ${host}\n\nConecte só se o link veio de quem está na chamada com você.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Conectar",
          onPress: () => {
            setEscolhido(route.params?.quiz ?? null); // o quiz escolhido antes não vai sozinho para outra chamada
            conectar(p);
          },
        },
      ],
    );
  }, [route.params?.link, conectar]);

  useEffect(() => {
    if (route.params?.quiz) setEscolhido(route.params.quiz);
  }, [route.params?.quiz]);

  // Celular voltou do segundo plano: reconecta na hora, sem esperar o backoff.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") conn.current?.acordar();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => () => conn.current?.fechar(), []);

  // Relógio da tela: o tempo é contado aqui, a partir do "quanto falta".
  useEffect(() => {
    if (vista?.fase !== "pergunta" && vista?.fase !== "preparar") return;
    const t = setInterval(() => setTique((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [vista?.fase, vista?.k]);

  // A resposta otimista vale só para a pergunta em que foi dada.
  useEffect(() => {
    if (minhaLocal && vista && (vista.k !== minhaLocal.k || vista.fase === "lobby")) setMinhaLocal(null);
  }, [vista, minhaLocal]);

  // Recado do navegador ("já tem um quiz em andamento"…), uma vez cada. Aviso
  // discreto, não janela: o servidor não consegue empilhar alertas na tela.
  useEffect(() => {
    if (vista?.aviso && vista.aviso.n !== ultimoAviso.current) {
      ultimoAviso.current = vista.aviso.n;
      showSnackbar(vista.aviso.texto);
    }
  }, [vista?.aviso]);

  // Vibração na revelação: acertou ou errou.
  useEffect(() => {
    const chave = `${vista?.fase}|${vista?.k}`;
    if (chave === ultimaFase.current) return;
    ultimaFase.current = chave;
    if (vista?.fase === "revelada" && vista.minha) haptic(vista.minha.certo ? "success" : "error");
  }, [vista]);

  const pedir = (a) => {
    if (!conn.current?.pedir(a)) {
      showSnackbar("Sem conexão com a chamada. Tentando de novo…");
      return false;
    }
    return true;
  };

  /* ---------------- pareamento ---------------- */

  const [permissao, pedirPermissao] = useCameraPermissions();
  const lido = useRef(false);

  const abrirLeitor = async () => {
    if (!permissao?.granted) {
      const r = await pedirPermissao();
      if (!r.granted) {
        Alert.alert(
          "Sem acesso à câmera",
          "Libere a câmera para o QuizzV nas configurações do celular, ou cole o link do Vcall logo abaixo.",
        );
        return;
      }
    }
    lido.current = false;
    setLendo(true);
  };

  const aoLerQr = ({ data }) => {
    if (lido.current) return; // a câmera dispara várias vezes por segundo
    const p = lerPareamento(data);
    if (!p) return; // outro QR qualquer: continua procurando
    lido.current = true;
    setLendo(false);
    conectar(p);
  };

  const usarColado = () => {
    const p = lerPareamento(colado);
    if (!p) {
      Alert.alert("Link não reconhecido", "Copie o link em “Sem câmera? Mande o link para o celular”, no Quiz do Vcall.");
      return;
    }
    setColado("");
    conectar(p);
  };

  const desconectar = () => {
    conn.current?.fechar();
    conn.current = null;
    setPar(null);
    setEstado("parado");
    setVista(null);
    setOla(null);
    setMotivo(null);
  };

  /* ---------------- escolher e mandar um quiz ---------------- */

  const abrirBiblioteca = async () => setBiblioteca(await getQuizzes());

  const mandarQuiz = (quiz, cfg) => {
    const { quiz: convertido, puladas } = quizParaVcall(quiz);
    if (!convertido.perguntas.length) {
      Alert.alert("Esse quiz não dá", "Nenhuma pergunta dele tem alternativas que o Vcall consiga mostrar.");
      return;
    }
    if (pedir({ tipo: "carregar", quiz: convertido, ...cfg })) {
      setEscolhido(null);
      showSnackbar(
        puladas
          ? `Enviado. ${puladas} ${puladas === 1 ? "pergunta ficou" : "perguntas ficaram"} de fora (sem alternativas válidas).`
          : "Quiz enviado para a chamada",
      );
    }
  };

  const encerrar = () =>
    Alert.alert("Encerrar o quiz?", "O quiz acaba para todos na chamada.", [
      { text: "Continuar", style: "cancel" },
      { text: "Encerrar", style: "destructive", onPress: () => pedir({ tipo: "encerrar" }) },
    ]);

  /* ---------------- telas ---------------- */

  if (lendo) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={aoLerQr}
        />
        <View style={styles.mira} pointerEvents="none">
          <View style={[styles.miraQuadro, { borderColor: "#FFFFFF" }]} />
          <Text style={[type.title, styles.miraTexto]}>Aponte para o QR do Quiz, na tela do computador</Text>
        </View>
        <View style={styles.miraRodape}>
          <Button title="Cancelar" variant="tonal" onPress={() => setLendo(false)} />
        </View>
      </View>
    );
  }

  if (!par || estado === "encerrado") {
    return (
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        {estado === "encerrado" && motivo && (
          <View style={[styles.banner, { backgroundColor: colors.errorSoft }]}>
            <Ionicons name="unlink-outline" size={20} color={colors.error} />
            <Text style={[type.body, { color: colors.text, flex: 1 }]}>
              {MOTIVOS[motivo] || "A conexão com a chamada foi encerrada."}
            </Text>
          </View>
        )}
        <View style={[styles.hero, { backgroundColor: colors.accentSoft }]}>
          <Ionicons name="qr-code-outline" size={44} color={colors.primary} />
          <Text style={[type.headline, { color: colors.text, textAlign: "center" }]}>
            Jogue seus quizzes numa chamada
          </Text>
          <Text style={[type.body, { color: colors.textMuted, textAlign: "center" }]}>
            No computador, na chamada do Vcall, abra Jogos → Quiz → “Usar um quiz do meu QuizzV”. Depois leia o QR que
            aparecer.
          </Text>
        </View>
        <Button icon="scan-outline" title="Ler o QR do Vcall" onPress={abrirLeitor} />
        <Text style={[type.caption, { color: colors.textMuted, marginTop: 8 }]}>OU COLE O LINK</Text>
        <TextInput
          value={colado}
          onChangeText={setColado}
          placeholder="https://…/quizzv#…"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Link de pareamento do Vcall"
          onSubmitEditing={usarColado}
          style={[type.body, styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
        />
        <Button variant="tonal" icon="link-outline" title="Conectar com o link" onPress={usarColado} disabled={!colado.trim()} />
      </ScrollView>
    );
  }

  const conectado = estado === "conectado";

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {conectado && <TelaAcesa />}
      <View style={[styles.topo, { borderColor: colors.border }]}>
        <View style={[styles.ponto, { backgroundColor: conectado ? colors.success : colors.textMuted }]} />
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: colors.text }]} numberOfLines={1}>
            {conectado
              ? `Na chamada como ${ola?.voce?.nome || "você"}`
              : estado === "reconectando"
                ? "Reconectando à chamada…"
                : "Conectando à chamada…"}
          </Text>
          {!!ola?.sala?.nome && (
            <Text style={[type.caption, { color: colors.textMuted }]} numberOfLines={1}>
              {ola.sala.nome}
            </Text>
          )}
        </View>
        {vista && !["lobby", "fim"].includes(vista.fase) && (
          <Button variant="text" title="Encerrar" color={colors.error} onPress={encerrar} />
        )}
        <Button variant="text" title="Sair" onPress={desconectar} />
      </View>

      {aviso === "chamada-fora" && (
        <View style={[styles.banner, styles.bannerTopo, { backgroundColor: colors.errorSoft }]}>
          <Ionicons name="cloud-offline-outline" size={18} color={colors.error} />
          <Text style={[type.caption, { color: colors.text, flex: 1 }]}>
            A chamada no seu computador está reconectando. Tente de novo em alguns segundos.
          </Text>
        </View>
      )}

      {!vista ? (
        <View style={styles.centro}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <ProtecaoDaVista key={`${vista.fase}|${vista.k}`} colors={colors}>
        <Fase
          vista={vista}
          chegou={chegou}
          colors={colors}
          minhaLocal={minhaLocal}
          responder={(e) => {
            if (pedir({ tipo: "responder", k: vista.k, e })) {
              haptic("tap");
              setMinhaLocal({ k: vista.k, e });
              setAviso(null);
            }
          }}
          proxima={() => pedir({ tipo: "proxima" })}
          comecar={() => pedir({ tipo: "comecar" })}
          escolher={abrirBiblioteca}
        />
        </ProtecaoDaVista>
      )}

      <Biblioteca
        lista={biblioteca}
        onClose={() => setBiblioteca(null)}
        onEscolher={(q) => {
          setBiblioteca(null);
          setEscolhido(q);
        }}
      />
      <Ajustes
        quiz={conectado ? escolhido : null}
        onClose={() => setEscolhido(null)}
        onMandar={(cfg) => mandarQuiz(escolhido, cfg)}
      />
    </View>
  );
}

/* ================================================================== */

/**
 * Se algo na vista sair do esperado, mostra um aviso em vez de derrubar o
 * app. A vista já chega conferida (vcallService.vistaValida); isto é a rede
 * de segurança. Troca de fase ou de pergunta zera o erro.
 */
class ProtecaoDaVista extends Component {
  state = { erro: false };
  static getDerivedStateFromError() {
    return { erro: true };
  }
  componentDidCatch() {}
  render() {
    if (!this.state.erro) return this.props.children;
    const { colors } = this.props;
    return (
      <View style={styles.centro}>
        <Ionicons name="alert-circle-outline" size={36} color={colors.textMuted} />
        <Text style={[type.body, { color: colors.textMuted, textAlign: "center", paddingHorizontal: 32 }]}>
          Não deu para mostrar esta parte. A próxima pergunta aparece normalmente.
        </Text>
      </View>
    );
  }
}

function Fase({ vista: v, chegou, colors, minhaLocal, responder, proxima, comecar, escolher }) {
  const agora = Date.now() - chegou;

  if (v.fase === "lobby") {
    return (
      <ScrollView contentContainerStyle={styles.body}>
        {v.quizzv ? (
          <>
            <View style={[styles.hero, { backgroundColor: colors.accentSoft }]}>
              <Ionicons name="checkmark-circle" size={40} color={colors.success} />
              <Text style={[type.headline, { color: colors.text, textAlign: "center" }]}>{v.quizzv.titulo}</Text>
              <Text style={[type.body, { color: colors.textMuted, textAlign: "center" }]}>
                {v.quizzv.qtd} {v.quizzv.qtd === 1 ? "pergunta" : "perguntas"} · {v.quizzv.tempo} s cada. Já está na tela de
                todos.
              </Text>
            </View>
            <Button icon="play" title="Começar" onPress={comecar} />
            <Button variant="tonal" icon="swap-horizontal" title="Trocar de quiz" onPress={escolher} />
          </>
        ) : (
          <>
            <View style={[styles.hero, { backgroundColor: colors.accentSoft }]}>
              <Ionicons name="link" size={40} color={colors.primary} />
              <Text style={[type.headline, { color: colors.text, textAlign: "center" }]}>Conectado ao Quiz</Text>
              <Text style={[type.body, { color: colors.textMuted, textAlign: "center" }]}>
                Escolha um quiz da sua biblioteca para todos jogarem. Se outra pessoa estiver conduzindo, é só esperar: as
                perguntas aparecem aqui.
              </Text>
            </View>
            <Button icon="library-outline" title="Escolher um quiz" onPress={escolher} />
          </>
        )}
      </ScrollView>
    );
  }

  if (v.fase === "preparar") {
    const n = Math.max(1, Math.ceil((v.contagemMs - agora) / 1000));
    return (
      <View style={styles.centro} accessibilityLiveRegion="polite">
        <Text style={[type.title, { color: colors.textMuted }]}>{v.k === 0 ? "Preparem-se!" : `Pergunta ${v.k + 1}`}</Text>
        <Text style={[styles.contagem, { color: colors.text }]}>{n}</Text>
      </View>
    );
  }

  if (v.fase === "fim") {
    return (
      <ScrollView contentContainerStyle={styles.body}>
        <View style={[styles.hero, { backgroundColor: colors.accentSoft }]}>
          <Ionicons name="trophy" size={44} color={colors.primary} />
          <Text style={[type.headline, { color: colors.text, textAlign: "center" }]}>
            {v.titulo ? `Fim de “${v.titulo}”!` : "Fim do quiz!"}
          </Text>
          {v.eu && (
            <Text style={[type.body, { color: colors.textMuted, textAlign: "center" }]}>
              Você ficou em {v.eu.pos}º, com {v.eu.total} pontos.
            </Text>
          )}
        </View>
        <Placar lista={v.placar} colors={colors} />
        <Button icon="refresh" title="Jogar de novo" onPress={comecar} />
        <Button variant="tonal" icon="library-outline" title="Escolher outro quiz" onPress={escolher} />
      </ScrollView>
    );
  }

  // pergunta / revelada
  const revelada = v.fase === "revelada";
  const restante = Math.max(0, (v.restanteMs - (revelada ? 0 : agora)) / 1000);
  const minha = v.minha?.e ?? (minhaLocal?.k === v.k ? minhaLocal.e : null);
  const respondeu = minha !== null && minha !== undefined;
  const estadoDe = (i) => {
    if (revelada) return i === v.pergunta.certa ? "correct" : i === minha ? "wrong" : "dim";
    return respondeu && i !== minha ? "dim" : "idle";
  };

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <View style={styles.linha}>
        <Text style={[type.caption, { color: colors.textMuted, flex: 1 }]} numberOfLines={1}>
          Pergunta {v.k + 1} de {v.total}
          {v.titulo ? ` · ${v.titulo}` : ""}
        </Text>
        {!revelada && (
          <Text style={[type.title, styles.tempo, { color: restante <= 5 ? colors.error : colors.text }]}>
            {Math.ceil(restante)}s
          </Text>
        )}
      </View>
      {!revelada && <ProgressBar value={restante / (v.limite || 20)} duration={250} />}
      <Text style={[type.title, { color: colors.text }]}>{v.pergunta.texto}</Text>

      {revelada && (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.resultado, { backgroundColor: v.minha?.certo ? colors.successSoft : colors.errorSoft }]}
        >
          <Ionicons
            name={v.minha?.certo ? "checkmark-circle" : v.minha ? "close-circle" : "time"}
            size={28}
            color={v.minha?.certo ? colors.success : colors.error}
          />
          <View style={{ flex: 1 }}>
            <Text style={[type.title, { color: colors.text }]}>
              {v.minha?.certo ? `Certo! +${v.minha.pontos}` : v.minha ? "Não foi dessa vez" : "Tempo esgotado"}
            </Text>
            {v.minha?.seq > 1 && (
              <Text style={[type.caption, { color: colors.textMuted }]}>{v.minha.seq} seguidas!</Text>
            )}
            {v.eu && <Text style={[type.caption, { color: colors.textMuted }]}>Você está em {v.eu.pos}º lugar</Text>}
          </View>
        </View>
      )}

      {/* Com pausa, o ranking vem logo depois do resultado e a partida espera o toque. */}
      {revelada && v.pausa && <ProximaComRanking v={v} colors={colors} proxima={proxima} />}

      <View style={styles.opcoes}>
        {v.pergunta.opcoes.map((texto, i) => (
          <Choice
            key={i}
            state={estadoDe(i)}
            selected={minha === i}
            disabled={revelada || respondeu}
            onPress={() => responder(i)}
            style={styles.opcao}
            leading={(icon, fg) => (
              <View style={[styles.letra, { backgroundColor: colors.surfaceAlt }]}>
                {icon || <Text style={[type.label, { color: fg }]}>{LETTERS[i]}</Text>}
              </View>
            )}
          >
            {(fg) => (
              <>
                <Text style={[type.body, { flex: 1, color: fg, fontWeight: "600" }]}>{texto}</Text>
                {revelada && v.porOpcao && (
                  <Text style={[type.label, { color: colors.textMuted }]}>{v.porOpcao[i] || 0}</Text>
                )}
              </>
            )}
          </Choice>
        ))}
      </View>

      {!revelada && (
        <Text style={[type.caption, { color: colors.textMuted, textAlign: "center" }]}>
          {respondeu ? `Resposta enviada! ${v.responderam} de ${v.pessoas || "?"} responderam` : `${v.responderam} responderam`}
        </Text>
      )}

      {revelada && !!v.pergunta.explicacao && (
        <View style={[styles.explicacao, { backgroundColor: colors.surfaceAlt }]}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
          <Text style={[type.body, { color: colors.textMuted, flex: 1 }]}>{v.pergunta.explicacao}</Text>
        </View>
      )}

      {revelada && !v.pausa && (
        <>
          <Button
            icon="play-skip-forward"
            title={v.k + 1 >= v.total ? "Ver o resultado" : "Próxima pergunta"}
            onPress={proxima}
          />
          <Text style={[type.caption, { color: colors.textMuted, textAlign: "center" }]}>
            Ou espere: a próxima vem sozinha em alguns segundos.
          </Text>
          <Placar lista={v.placar?.slice(0, 5)} colors={colors} />
        </>
      )}
    </ScrollView>
  );
}

function ProximaComRanking({ v, colors, proxima }) {
  return (
    <>
      <Text style={[type.caption, styles.rotulo, { color: colors.textMuted, marginTop: 4 }]}>RANKING</Text>
      {v.placar?.length ? (
        <Placar lista={v.placar} colors={colors} />
      ) : (
        <Text style={[type.body, { color: colors.textMuted }]}>Ninguém pontuou ainda.</Text>
      )}
      <Button
        icon="play-skip-forward"
        title={v.k + 1 >= v.total ? "Ver o resultado" : "Próxima pergunta"}
        onPress={proxima}
      />
      <Text style={[type.caption, { color: colors.textMuted, textAlign: "center" }]}>
        O tempo está parado. A partida só continua quando você tocar.
      </Text>
    </>
  );
}

function Placar({ lista, colors }) {
  if (!lista?.length) return null;
  return (
    <View style={[styles.placar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {lista.map((x, i) => (
        <View key={`${i}-${x.nome}`} style={[styles.placarLinha, x.eu && { backgroundColor: colors.accentSoft }]}>
          <Text style={[type.label, styles.placarPos, { color: colors.textMuted }]}>{i + 1}º</Text>
          <Text style={[type.body, { flex: 1, color: colors.text, fontWeight: x.eu ? "700" : "400" }]} numberOfLines={1}>
            {x.eu ? `${x.nome} (você)` : x.nome}
          </Text>
          <Text style={[type.label, { color: colors.text }]}>{x.total}</Text>
        </View>
      ))}
    </View>
  );
}

/** A biblioteca, para escolher o quiz que vai para a chamada. */
function Biblioteca({ lista, onClose, onEscolher }) {
  const { colors } = useTheme();
  const [busca, setBusca] = useState("");
  const filtrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (lista || []).filter((x) => !q || String(x.title).toLowerCase().includes(q));
  }, [lista, busca]);

  return (
    <Sheet visible={!!lista} onClose={onClose}>
      <Text style={[type.headline, { color: colors.text }]}>Escolha um quiz</Text>
      {(lista?.length || 0) > 6 && (
        <TextInput
          value={busca}
          onChangeText={setBusca}
          placeholder="Buscar na biblioteca"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Buscar na biblioteca"
          style={[type.body, styles.input, { color: colors.text, backgroundColor: colors.surfaceAlt, borderColor: colors.border, marginTop: 12 }]}
        />
      )}
      {lista && !lista.length ? (
        <Text style={[type.body, { color: colors.textMuted, marginTop: 12 }]}>
          Sua biblioteca está vazia. Crie ou importe um quiz primeiro.
        </Text>
      ) : (
        <FlatList
          style={{ maxHeight: 380, marginTop: 8 }}
          data={filtrada}
          keyExtractor={(x) => String(x.id)}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <ListItem
              icon={item.type === "vf" ? "checkmark-done-outline" : "list-outline"}
              title={item.title}
              subtitle={`${item.questions?.length || 0} questões · ${{ mc: "múltipla escolha", misto: "V ou F e alternativas" }[item.type] || "verdadeiro ou falso"}`}
              onPress={() => onEscolher(item)}
            />
          )}
        />
      )}
    </Sheet>
  );
}

/** Tempo, quantas perguntas e a ordem, antes de mandar para a chamada. */
function Ajustes({ quiz, onClose, onMandar }) {
  const { colors } = useTheme();
  const total = quiz?.questions?.length || 0;
  const [tempo, setTempo] = useState(20);
  const [qtd, setQtd] = useState(0);
  const [ordem, setOrdem] = useState("sorteada");
  const [pausa, setPausa] = useState(true);
  const opcoesQtd = [{ value: 0, label: `Todas (${Math.min(total, 100)})` }, ...[10, 20].filter((n) => n < total).map((n) => ({ value: n, label: String(n) }))];

  return (
    <Sheet visible={!!quiz} onClose={onClose}>
      {quiz && (
        <>
          <Text style={[type.headline, { color: colors.text }]} numberOfLines={2}>
            {quiz.title}
          </Text>
          <Text style={[type.caption, { color: colors.textMuted, marginTop: 4 }]}>
            Vai para a tela de todos na chamada. Ninguém vê o gabarito antes da hora.
          </Text>
          <Text style={[type.caption, styles.rotulo, { color: colors.textMuted }]}>TEMPO POR PERGUNTA</Text>
          <Segmented options={TEMPOS.map((n) => ({ value: n, label: `${n}s` }))} value={tempo} onChange={setTempo} />
          <Text style={[type.caption, styles.rotulo, { color: colors.textMuted }]}>PERGUNTAS</Text>
          <Segmented options={opcoesQtd} value={qtd} onChange={setQtd} />
          <Text style={[type.caption, styles.rotulo, { color: colors.textMuted }]}>ORDEM</Text>
          <Segmented
            options={[
              { value: "sorteada", label: "Sorteada", icon: "shuffle" },
              { value: "original", label: "Original", icon: "list" },
            ]}
            value={ordem}
            onChange={setOrdem}
          />
          <Text style={[type.caption, styles.rotulo, { color: colors.textMuted }]}>ENTRE AS PERGUNTAS</Text>
          <Segmented
            options={[
              { value: true, label: "Ranking e eu sigo", icon: "pause" },
              { value: false, label: "Segue sozinho", icon: "play-forward" },
            ]}
            value={pausa}
            onChange={setPausa}
          />
          {total > 100 && (
            <Text style={[type.caption, { color: colors.textMuted, marginTop: 8 }]}>
              A chamada aceita até 100 perguntas por vez.
            </Text>
          )}
          <Button
            icon="send"
            title="Mandar para a chamada"
            style={{ marginTop: 20 }}
            onPress={() => onMandar({ tempo, qtd, embaralhar: ordem === "sorteada", pausa })}
          />
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14, paddingBottom: 40 },
  centro: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  hero: { alignItems: "center", gap: 10, padding: 24, borderRadius: radius.lg },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: Platform.OS === "ios" ? 14 : 10 },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: radius.md },
  bannerTopo: { marginHorizontal: 16, marginTop: 12 },
  topo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ponto: { width: 10, height: 10, borderRadius: 5 },
  contagem: { fontSize: 96, lineHeight: 104, fontWeight: "800" },
  linha: { flexDirection: "row", alignItems: "center", gap: 12 },
  tempo: { minWidth: 40, textAlign: "right", fontVariant: ["tabular-nums"] },
  resultado: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: radius.md },
  opcoes: { gap: 10 },
  opcao: { minHeight: 60, gap: 14, padding: 14 },
  letra: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  explicacao: { flexDirection: "row", gap: 8, padding: 14, borderRadius: radius.md },
  placar: { borderWidth: 1, borderRadius: radius.md, overflow: "hidden" },
  placarLinha: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  placarPos: { width: 28 },
  rotulo: { marginTop: 18, marginBottom: 8 },
  mira: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 24 },
  miraQuadro: { width: 240, height: 240, borderWidth: 3, borderRadius: 24 },
  miraTexto: { color: "#FFFFFF", textAlign: "center", paddingHorizontal: 32 },
  miraRodape: { position: "absolute", left: 16, right: 16, bottom: 40 },
});
