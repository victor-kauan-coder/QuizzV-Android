import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useTheme } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import * as Linking from "expo-linking";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Button,
  ListItem,
  Logo,
  ProgressBar,
  Sheet,
  showSnackbar,
} from "../components/ui";
import { exportToPdf } from "../services/pdfService";
import { deleteQuiz, exportQuiz, getQuizzes, importQuizFile } from "../services/storage";
import { checkForUpdates, downloadAndInstall } from "../services/UpdateService";
import { radius, type } from "../theme";

const ENGINE_LABEL = {
  gemini: "Gemini",
  deepseek: "DeepSeek",
  ollama: "Ollama",
  importado: "Importado",
};

const typeLabel = (q) => (q.type === "mc" ? "Múltipla escolha" : "V ou F");
const metaLine = (q) =>
  [
    `${q.questions?.length || 0} questões`,
    typeLabel(q),
    ENGINE_LABEL[q.engine] || (q.engine ? q.engine : null),
  ]
    .filter(Boolean)
    .join(" · ");

const importedMessage = (titles) =>
  titles.length === 1
    ? `“${titles[0]}” foi adicionado à biblioteca`
    : `${titles.length} quizzes adicionados à biblioteca`;

export default function HomeScreen({ navigation }) {
  const { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [progress, setProgress] = useState(0);

  const loadQuizzes = async () => {
    setQuizzes(await getQuizzes());
    setLoading(false);
  };

  useFocusEffect(
    useCallback(() => {
      loadQuizzes();
    }, []),
  );

  // Arquivo .qv aberto pelo WhatsApp / gerenciador de arquivos
  const handleDeepLink = async (url) => {
    if (!/^(content|file):\/\//.test(url ?? "")) return; // ignora links do Expo
    try {
      const titles = await importQuizFile(url, "Quiz recebido");
      showSnackbar(importedMessage(titles));
      loadQuizzes();
    } catch (error) {
      Alert.alert("Não foi possível abrir o arquivo", error.message);
    }
  };

  useEffect(() => {
    const runUpdateCheck = async () => {
      const data = await checkForUpdates();
      if (!data?.hasUpdate) return;
      Alert.alert(
        "Nova versão disponível",
        `A versão ${data.latestVersion} está pronta. Você usa a ${data.currentVersion}.`,
        [
          { text: "Depois", style: "cancel" },
          {
            text: "Atualizar agora",
            onPress: async () => {
              setIsUpdating(true);
              setProgress(0);
              try {
                await downloadAndInstall(data.updateUrl, setProgress);
              } catch {
                Alert.alert(
                  "Falha na atualização",
                  "Não foi possível baixar a nova versão. Verifique sua conexão e tente de novo.",
                );
              } finally {
                setIsUpdating(false);
              }
            },
          },
        ],
      );
    };
    runUpdateCheck();

    // 1. App fechado e aberto pelo arquivo; 2. app já aberto em segundo plano
    Linking.getInitialURL().then(handleDeepLink);
    const subscription = Linking.addEventListener("url", (e) =>
      handleDeepLink(e.url),
    );
    return () => subscription.remove();
  }, []);

  const handleImport = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: "*/*", // .qv não tem MIME registrado no Android
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const { uri, name } = result.assets[0];

    if (!/\.(qv|json|bin)$/i.test(name)) {
      Alert.alert(
        "Formato não suportado",
        "Escolha um arquivo .qv (QuizzV) ou .json.",
      );
      return;
    }
    try {
      const titles = await importQuizFile(uri, name);
      showSnackbar(importedMessage(titles));
      loadQuizzes();
    } catch (err) {
      Alert.alert("Não foi possível importar", err.message);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? quizzes.filter((i) => i.title.toLowerCase().includes(q)) : quizzes;
  }, [quizzes, query]);

  // --- Ações do bottom sheet ---
  const close = () => setSelected(null);

  const play = (quiz, params = {}) => {
    close();
    navigation.navigate("Quiz", { quiz, ...params });
  };

  const share = async (quiz, fn) => {
    close();
    try {
      await fn(quiz);
    } catch (err) {
      Alert.alert("Não foi possível exportar", err.message);
    }
  };

  const confirmDelete = (quiz) => {
    close();
    Alert.alert(
      "Excluir quiz?",
      `“${quiz.title}” e o progresso salvo serão apagados deste aparelho.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: async () => {
            await deleteQuiz(quiz.id);
            showSnackbar("Quiz excluído");
            loadQuizzes();
          },
        },
      ],
    );
  };

  const renderItem = ({ item }) => {
    const total = item.questions?.length || 1;
    const inProgress = item.lastIndex > 0;
    return (
      <Pressable
        onPress={() => setSelected(item)}
        accessibilityRole="button"
        accessibilityHint="Abre as opções do quiz"
        android_ripple={{ color: colors.border }}
        style={[styles.card, { backgroundColor: colors.surface }]}
      >
        <View style={styles.cardRow}>
          <View style={[styles.iconBox, { backgroundColor: colors.accentSoft }]}>
            <Ionicons
              name={item.type === "mc" ? "list" : "git-compare-outline"}
              size={22}
              color={colors.primary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={[type.title, { color: colors.text }]}
              numberOfLines={2}
            >
              {item.title}
            </Text>
            <Text
              style={[type.caption, { color: colors.textMuted, marginTop: 2 }]}
              numberOfLines={1}
            >
              {metaLine(item)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </View>

        {inProgress && (
          <View style={styles.cardFooter}>
            <View style={{ flex: 1 }}>
              <ProgressBar value={item.lastIndex / total} />
            </View>
            <Text style={[type.caption, { color: colors.primary }]}>
              Questão {item.lastIndex + 1} de {total}
            </Text>
          </View>
        )}
        {!inProgress && item.attempts > 0 && (
          <View style={styles.cardFooter}>
            <Ionicons name="trophy-outline" size={14} color={colors.textMuted} />
            <Text style={[type.caption, { color: colors.textMuted }]}>
              Melhor resultado {item.bestPct}% · {item.attempts}{" "}
              {item.attempts === 1 ? "partida" : "partidas"}
            </Text>
          </View>
        )}
      </Pressable>
    );
  };

  const header = (
    <View style={styles.header}>
      <View style={styles.actions}>
        <Button
          variant="tonal"
          icon="download-outline"
          title="Importar"
          onPress={handleImport}
          style={{ flex: 1 }}
        />
        <Button
          variant="tonal"
          icon="people-outline"
          title="Entrar em sala"
          onPress={() => navigation.navigate("JoinRoom")}
          style={{ flex: 1 }}
        />
      </View>

      {quizzes.length > 0 && (
        <>
          <View
            style={[
              styles.search,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Ionicons name="search" size={20} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Buscar na biblioteca"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Buscar na biblioteca"
              returnKeyType="search"
              style={[type.body, styles.searchInput, { color: colors.text }]}
            />
            {query.length > 0 && (
              <Pressable
                onPress={() => setQuery("")}
                accessibilityLabel="Limpar busca"
                hitSlop={12}
              >
                <Ionicons name="close-circle" size={20} color={colors.textMuted} />
              </Pressable>
            )}
          </View>
          <Text style={[type.label, styles.sectionTitle, { color: colors.textMuted }]}>
            Biblioteca · {quizzes.length}
          </Text>
        </>
      )}
    </View>
  );

  const empty = loading ? (
    <View style={{ gap: 12 }}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={[styles.card, styles.skeleton, { backgroundColor: colors.surface }]}
        />
      ))}
    </View>
  ) : query ? (
    <Text style={[type.body, styles.noResults, { color: colors.textMuted }]}>
      Nenhum quiz com “{query.trim()}”.
    </Text>
  ) : (
    <View style={styles.emptyContainer}>
      <Logo size={72} />
      <Text style={[type.headline, { color: colors.text, marginTop: 20 }]}>
        Sua biblioteca está vazia
      </Text>
      <Text style={[type.body, styles.emptySub, { color: colors.textMuted }]}>
        Gere um quiz com IA a partir de um tema, PDF ou foto, ou importe um
        arquivo .qv ou .json que alguém te mandou.
      </Text>
    </View>
  );

  const selectedTotal = selected?.questions?.length || 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={loading ? [] : filtered}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.list, { paddingBottom: 112 + insets.bottom }]}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      />

      <Pressable
        onPress={() => navigation.navigate("Gerador")}
        accessibilityRole="button"
        android_ripple={{ color: colors.onAccent + "33" }}
        style={[
          styles.fab,
          { backgroundColor: colors.accent, bottom: 24 + insets.bottom },
        ]}
      >
        <Ionicons name="sparkles" size={22} color={colors.onAccent} />
        <Text style={[type.label, { color: colors.onAccent }]}>Criar com IA</Text>
      </Pressable>

      <Sheet visible={!!selected} onClose={close}>
        {selected && (
          <>
            <Text
              style={[type.headline, { color: colors.text }]}
              numberOfLines={2}
            >
              {selected.title}
            </Text>
            <Text style={[type.caption, { color: colors.textMuted, marginTop: 4 }]}>
              {metaLine(selected)}
            </Text>

            <View style={styles.sheetActions}>
              {selected.lastIndex > 0 ? (
                <>
                  <Button
                    icon="play"
                    title={`Continuar · questão ${selected.lastIndex + 1} de ${selectedTotal}`}
                    onPress={() => play(selected, { resume: true })}
                  />
                  <Button
                    variant="tonal"
                    icon="refresh"
                    title="Recomeçar do início"
                    onPress={() => play(selected)}
                  />
                </>
              ) : (
                <Button icon="play" title="Jogar" onPress={() => play(selected)} />
              )}
              <View style={styles.actions}>
                <Button
                  variant="tonal"
                  icon="shuffle"
                  title="Embaralhado"
                  onPress={() => play(selected, { shuffle: true })}
                  style={{ flex: 1 }}
                />
                <Button
                  variant="tonal"
                  icon="people"
                  title="Multiplayer"
                  onPress={() => {
                    close();
                    navigation.navigate("HostLobby", { quiz: selected });
                  }}
                  style={{ flex: 1 }}
                />
              </View>
            </View>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <ListItem
              icon="share-social-outline"
              title="Compartilhar arquivo .qv"
              subtitle="Criptografado: só abre no QuizzV"
              onPress={() => share(selected, exportQuiz)}
            />
            <ListItem
              icon="document-text-outline"
              title="Exportar PDF"
              subtitle="Caderno de questões com gabarito"
              onPress={() => share(selected, exportToPdf)}
            />
            <ListItem
              icon="trash-outline"
              title="Excluir"
              color={colors.error}
              onPress={() => confirmDelete(selected)}
            />
          </>
        )}
      </Sheet>

      <Modal visible={isUpdating} transparent animationType="fade">
        <View
          style={[
            styles.updateModal,
            { backgroundColor: dark ? "rgba(15, 23, 42, 0.98)" : "rgba(248, 250, 252, 0.98)" },
          ]}
        >
          <Logo size={64} />
          <Text style={[type.headline, { color: colors.text, marginTop: 24 }]}>
            Atualizando o QuizzV
          </Text>
          <Text style={[type.body, { color: colors.textMuted, marginTop: 8, marginBottom: 24 }]}>
            Baixando a nova versão… {Math.round(progress * 100)}%
          </Text>
          <View style={{ width: "100%" }}>
            <ProgressBar value={progress} height={8} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingHorizontal: 16, paddingTop: 4 },
  header: { gap: 16, marginBottom: 12 },
  actions: { flexDirection: "row", gap: 8 },
  search: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInput: { flex: 1, paddingVertical: 10 },
  sectionTitle: { marginTop: 4 },
  card: {
    borderRadius: radius.lg,
    padding: 16,
    overflow: "hidden",
  },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    justifyContent: "center",
    alignItems: "center",
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
  },
  skeleton: { height: 76, opacity: 0.6 },
  noResults: { textAlign: "center", marginTop: 32 },
  emptyContainer: { alignItems: "center", marginTop: 48, paddingHorizontal: 16 },
  emptySub: { textAlign: "center", marginTop: 8, maxWidth: 320 },
  fab: {
    position: "absolute",
    right: 16,
    minHeight: 56,
    paddingHorizontal: 20,
    borderRadius: radius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    overflow: "hidden",
  },
  sheetActions: { gap: 8, marginTop: 20 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  updateModal: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
});
