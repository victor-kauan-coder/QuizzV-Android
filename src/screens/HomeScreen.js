import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useTheme } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import * as Linking from "expo-linking";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FolderEditor, FolderTile, MoveSheet, NewFolderTile } from "../components/folders";
import {
  Button,
  haptic,
  IconButton,
  ListItem,
  Logo,
  ProgressBar,
  Sheet,
  showSnackbar,
} from "../components/ui";
import { exportToPdf } from "../services/pdfService";
import {
  createFolder,
  deleteFolder,
  deleteQuiz,
  exportQuiz,
  getFolders,
  getQuizzes,
  importQuizFile,
  moveQuiz,
  updateFolder,
} from "../services/storage";
import { checkForUpdates, downloadAndInstall } from "../services/UpdateService";
import { radius, type } from "../theme";

const ENGINE_LABEL = {
  gemini: "Gemini",
  deepseek: "DeepSeek",
  ollama: "Ollama",
  importado: "Importado",
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const typeLabel = (q) => (q.type === "mc" ? "Múltipla escolha" : "V ou F");
const metaLine = (q) =>
  [
    plural(q.questions?.length || 0, "questão", "questões"),
    typeLabel(q),
    ENGINE_LABEL[q.engine] || (q.engine ? q.engine : null),
  ]
    .filter(Boolean)
    .join(" · ");

const importedMessage = (titles, where = "à biblioteca") =>
  titles.length === 1
    ? `“${titles[0]}” foi adicionado ${where}`
    : `${titles.length} quizzes adicionados ${where}`;

// A mesma tela mostra a biblioteca (raiz) ou o conteúdo de uma pasta
export default function HomeScreen({ navigation, route }) {
  const folderId = route.params?.folderId ?? null;
  const { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tileWidth = (width - 32 - 12) / 2;
  const [quizzes, setQuizzes] = useState([]);
  const [folders, setFolders] = useState([]);
  const [editing, setEditing] = useState(null); // null | "new" | pasta
  const [moving, setMoving] = useState(null); // quiz sendo movido
  const [moveAfterCreate, setMoveAfterCreate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [progress, setProgress] = useState(0);

  // O FAB recolhe para só o ícone ao rolar para baixo e volta ao subir
  const fabLabel = useRef(new Animated.Value(1)).current;
  const lastY = useRef(0);
  const fabOpen = useRef(true);
  const onScroll = (e) => {
    const y = e.nativeEvent.contentOffset.y;
    const open = y < 40 || y < lastY.current;
    lastY.current = y;
    if (open === fabOpen.current) return;
    fabOpen.current = open;
    Animated.timing(fabLabel, {
      toValue: open ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // anima largura
    }).start();
  };

  const loadQuizzes = async () => {
    const [list, dirs] = await Promise.all([getQuizzes(), getFolders()]);
    setQuizzes(list);
    setFolders(dirs);
    setLoading(false);
  };

  const folder = folders.find((f) => f.id === folderId);

  useEffect(() => {
    if (!folderId) return;
    navigation.setOptions({
      title: folder?.name ?? "",
      headerRight: () =>
        folder && (
          <View style={{ marginRight: 4 }}>
            <IconButton
              icon="ellipsis-vertical"
              label="Editar pasta"
              color={colors.text}
              onPress={() => setEditing(folder)}
            />
          </View>
        ),
    });
  }, [folderId, folder, colors.text]);

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
    if (folderId) return; // só a biblioteca principal cuida disso
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
      const titles = await importQuizFile(uri, name, folderId);
      showSnackbar(importedMessage(titles, folder ? `a “${folder.name}”` : undefined));
      loadQuizzes();
    } catch (err) {
      Alert.alert("Não foi possível importar", err.message);
    }
  };

  const folderIds = useMemo(() => new Set(folders.map((f) => f.id)), [folders]);
  const counts = useMemo(() => {
    const c = {};
    for (const q of quizzes) if (q.folderId) c[q.folderId] = (c[q.folderId] || 0) + 1;
    return c;
  }, [quizzes]);
  const searching = query.trim().length > 0;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (folderId) {
      return quizzes.filter(
        (i) => i.folderId === folderId && (!q || i.title.toLowerCase().includes(q)),
      );
    }
    // na raiz, a busca procura em todas as pastas
    if (q) return quizzes.filter((i) => i.title.toLowerCase().includes(q));
    return quizzes.filter((i) => !folderIds.has(i.folderId)); // soltos
  }, [quizzes, query, folderId, folderIds]);
  const inScope = folderId ? counts[folderId] || 0 : quizzes.length;

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

  // --- Pastas ---
  const openMove = (quiz) => {
    haptic("tap");
    setMoving(quiz);
  };

  const doMove = async (quiz, targetId) => {
    setMoving(null);
    if ((quiz.folderId ?? null) === targetId) return;
    await moveQuiz(quiz.id, targetId);
    const name = folders.find((f) => f.id === targetId)?.name;
    showSnackbar(name ? `Movido para “${name}”` : "Movido para fora das pastas");
    loadQuizzes();
  };

  const saveFolder = async ({ name, color }) => {
    if (editing && editing !== "new") {
      await updateFolder(editing.id, { name, color });
      showSnackbar("Pasta atualizada");
    } else {
      const created = await createFolder({ name, color });
      if (moveAfterCreate) {
        await moveQuiz(moveAfterCreate.id, created.id);
        showSnackbar(`Movido para “${created.name}”`);
      } else {
        showSnackbar(`Pasta “${created.name}” criada`);
      }
    }
    setEditing(null);
    setMoveAfterCreate(null);
    loadQuizzes();
  };

  const confirmDeleteFolder = () => {
    const target = editing;
    setEditing(null);
    const n = counts[target.id] || 0;
    Alert.alert(
      "Excluir pasta?",
      n === 0
        ? `“${target.name}” está vazia.`
        : `${n === 1 ? "O quiz" : `Os ${n} quizzes`} de “${target.name}” ${n === 1 ? "volta" : "voltam"} para a biblioteca. Nenhum quiz é apagado.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: async () => {
            await deleteFolder(target.id);
            showSnackbar("Pasta excluída");
            if (folderId === target.id) navigation.goBack();
            else loadQuizzes();
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
        onLongPress={() => openMove(item)}
        accessibilityRole="button"
        accessibilityHint="Abre as opções do quiz. Segure para mover de pasta."
        android_ripple={{ color: colors.border }}
        style={[styles.card, { backgroundColor: colors.surface }]}
      >
        <View style={styles.cardRow}>
          <View
            style={[styles.iconBox, { backgroundColor: colors.tonal }]}
            accessibilityLabel={typeLabel(item)}
          >
            <Text style={[styles.typeMark, { color: colors.primary }]}>
              {item.type === "mc" ? "A–E" : "V/F"}
            </Text>
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
              {searching && !folderId && folders.find((f) => f.id === item.folderId)
                ? `${folders.find((f) => f.id === item.folderId).name} · ${metaLine(item)}`
                : metaLine(item)}
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

  const showFolders = !folderId && !searching && (quizzes.length > 0 || folders.length > 0);
  const listTitle = searching
    ? `Resultados · ${filtered.length}`
    : folderId
      ? plural(filtered.length, "quiz", "quizzes")
      : folders.length
        ? `Sem pasta · ${filtered.length}`
        : `Biblioteca · ${quizzes.length}`;

  const header = (
    <View style={styles.header}>
      <View style={styles.actions}>
        <Button
          variant="tonal"
          icon="download-outline"
          title={folderId ? "Importar para esta pasta" : "Importar"}
          onPress={handleImport}
          style={{ flex: 1 }}
        />
        {!folderId && (
          <Button
            variant="tonal"
            icon="people-outline"
            title="Entrar em sala"
            onPress={() => navigation.navigate("JoinRoom")}
            style={{ flex: 1 }}
          />
        )}
      </View>

      {inScope > 0 && (
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
            placeholder={folder ? `Buscar em ${folder.name}` : "Buscar em todas as pastas"}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Buscar quizzes"
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
      )}

      {showFolders && (
        <>
          <Text style={[type.label, styles.sectionTitle, { color: colors.textMuted }]}>
            Pastas{folders.length ? ` · ${folders.length}` : ""}
          </Text>
          <View style={styles.folderGrid}>
            {folders.map((f) => (
              <FolderTile
                key={f.id}
                folder={f}
                count={counts[f.id] || 0}
                width={tileWidth}
                onPress={() => navigation.push("Pasta", { folderId: f.id })}
                onLongPress={() => {
                  haptic("tap");
                  setEditing(f);
                }}
              />
            ))}
            <NewFolderTile width={tileWidth} onPress={() => setEditing("new")} />
          </View>
        </>
      )}

      {(filtered.length > 0 || searching) && (inScope > 0 || folderId) && (
        <Text style={[type.label, styles.sectionTitle, { color: colors.textMuted }]}>
          {listTitle}
        </Text>
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
  ) : folderId ? (
    <View style={styles.emptyContainer}>
      <Ionicons name="folder-open-outline" size={56} color={colors.textMuted} />
      <Text style={[type.headline, { color: colors.text, marginTop: 16 }]}>
        Pasta vazia
      </Text>
      <Text style={[type.body, styles.emptySub, { color: colors.textMuted }]}>
        Crie um quiz com IA aqui, importe um arquivo ou segure um quiz da
        biblioteca para movê-lo para esta pasta.
      </Text>
    </View>
  ) : folders.length > 0 ? null : (
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
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.list, { paddingBottom: 112 + insets.bottom }]}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      />

      <Pressable
        onPress={() => navigation.navigate("Gerador", { folderId })}
        accessibilityRole="button"
        accessibilityLabel="Criar com IA"
        android_ripple={{ color: colors.onAccent + "33" }}
        style={[
          styles.fab,
          { backgroundColor: colors.accent, bottom: 24 + insets.bottom },
        ]}
      >
        <Ionicons name="sparkles" size={22} color={colors.onAccent} />
        <Animated.View
          style={{
            overflow: "hidden",
            opacity: fabLabel,
            maxWidth: fabLabel.interpolate({ inputRange: [0, 1], outputRange: [0, 160] }),
            marginLeft: fabLabel.interpolate({ inputRange: [0, 1], outputRange: [0, 10] }),
          }}
        >
          <Text style={[type.label, { color: colors.onAccent }]} numberOfLines={1}>
            Criar com IA
          </Text>
        </Animated.View>
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
              icon="folder-open-outline"
              title="Mover para pasta"
              subtitle={folders.find((f) => f.id === selected.folderId)?.name ?? "Sem pasta"}
              onPress={() => {
                close();
                setMoving(selected);
              }}
            />
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

      <MoveSheet
        visible={!!moving}
        quiz={moving}
        folders={folders}
        onClose={() => setMoving(null)}
        onMove={(target) => doMove(moving, target)}
        onNewFolder={() => {
          setMoveAfterCreate(moving);
          setMoving(null);
          setEditing("new");
        }}
      />

      <FolderEditor
        visible={!!editing}
        folder={editing === "new" ? null : editing}
        onClose={() => {
          setEditing(null);
          setMoveAfterCreate(null);
        }}
        onSave={saveFolder}
        onDelete={confirmDeleteFolder}
      />

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
  folderGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
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
  typeMark: { fontSize: 13, fontWeight: "800", letterSpacing: 0.3 },
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
    minWidth: 56,
    paddingHorizontal: 17,
    borderRadius: radius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
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
