import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@react-navigation/native";
import Constants from "expo-constants";
import * as DocumentPicker from "expo-document-picker";
import { useContext, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Button,
  Field,
  ListItem,
  Logo,
  ProgressBar,
  Segmented,
  showSnackbar,
} from "../components/ui";
import { ThemeContext } from "../context/ThemeContext";
import {
  convertJsonToQv,
  exportLibrary,
  getSettings,
  importQuizFile,
  saveSettings,
} from "../services/storage";
import { checkForUpdates, downloadAndInstall } from "../services/UpdateService";
import { radius, type } from "../theme";

const FIXED_OLLAMA_URL = "https://yeasty-gemmier-amal.ngrok-free.dev";

const THEME_COLORS = [
  { id: "orange", hex: "#F97316", name: "Sunset" },
  { id: "navy", hex: "#1E3A8A", name: "Marinho" },
  { id: "cobalt", hex: "#2563EB", name: "Cobalto" },
  { id: "pink", hex: "#EC4899", name: "Rosa" },
  { id: "emerald", hex: "#10B981", name: "Esmeralda" },
  { id: "violet", hex: "#8B5CF6", name: "Violeta" },
];

const pickFile = async () => {
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    copyToCacheDirectory: true,
  });
  return result.canceled ? null : result.assets[0];
};

// Fora do componente: recriar o tipo a cada render remontaria os campos
// e o teclado fecharia a cada letra digitada.
function Section({ title, children }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[type.label, styles.sectionTitle, { color: colors.primary }]}>
        {title}
      </Text>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        {children}
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { isDarkMode, themeColor, aiModel, updateTheme, updateAiModel } =
    useContext(ThemeContext);

  const [geminiKey, setGeminiKey] = useState("");
  const [deepKey, setDeepKey] = useState("");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(null); // ação de arquivo em andamento

  useEffect(() => {
    getSettings().then((s) => {
      if (s.api_key) setGeminiKey(s.api_key);
      if (s.deepseek_key) setDeepKey(s.deepseek_key);
    });
  }, []);

  const handleUpdateCheck = async () => {
    setCheckingUpdate(true);
    const data = await checkForUpdates();
    setCheckingUpdate(false);

    if (data?.error) {
      Alert.alert("Sem conexão", "Não foi possível verificar atualizações agora.");
    } else if (data?.hasUpdate) {
      Alert.alert(
        "Atualização disponível",
        `A versão ${data.latestVersion} está pronta. Você usa a ${data.currentVersion}.`,
        [
          { text: "Depois", style: "cancel" },
          {
            text: "Atualizar",
            onPress: async () => {
              setIsUpdating(true);
              setProgress(0);
              try {
                await downloadAndInstall(data.updateUrl, setProgress);
              } catch {
                Alert.alert("Falha no download", "Tente de novo em alguns instantes.");
              } finally {
                setIsUpdating(false);
              }
            },
          },
        ],
      );
    } else {
      showSnackbar("Você já está na versão mais recente");
    }
  };

  const saveKeys = async () => {
    await saveSettings({
      api_key: geminiKey.trim(),
      deepseek_key: deepKey.trim(),
      ollama_url: FIXED_OLLAMA_URL,
    });
    showSnackbar("Chaves salvas neste aparelho");
  };

  // Ações de arquivo: erros viram alerta, sucesso vira snackbar
  const runFileAction = async (id, action) => {
    setBusy(id);
    try {
      const message = await action();
      if (message) showSnackbar(message);
    } catch (err) {
      Alert.alert("Não deu certo", err.message);
    } finally {
      setBusy(null);
    }
  };

  const convertJson = () =>
    runFileAction("convert", async () => {
      const file = await pickFile();
      if (!file) return null;
      if (!/\.json$/i.test(file.name)) {
        throw new Error("Escolha um arquivo .json.");
      }
      const quiz = await convertJsonToQv(file.uri, file.name);
      return `“${quiz.title}” convertido para .qv`;
    });

  const backup = () =>
    runFileAction("backup", async () => {
      const count = await exportLibrary();
      return `Backup com ${count} ${count === 1 ? "quiz" : "quizzes"} gerado`;
    });

  const restore = () =>
    runFileAction("restore", async () => {
      const file = await pickFile();
      if (!file) return null;
      const titles = await importQuizFile(file.uri, file.name);
      return `${titles.length} ${titles.length === 1 ? "quiz restaurado" : "quizzes restaurados"}`;
    });

  const busyIndicator = (id) =>
    busy === id ? <ActivityIndicator color={colors.primary} /> : null;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingBottom: 32 + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
    >
      <Section title="Aparência">
        <ListItem
          icon={isDarkMode ? "moon-outline" : "sunny-outline"}
          title="Tema escuro"
          onPress={() => updateTheme(!isDarkMode, themeColor)}
          trailing={
            <Switch
              value={isDarkMode}
              onValueChange={(val) => updateTheme(val, themeColor)}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor="#FFFFFF"
              accessibilityLabel="Tema escuro"
            />
          }
        />
        <Text style={[type.caption, styles.subLabel, { color: colors.textMuted }]}>
          Cor de destaque
        </Text>
        <View style={styles.colorGrid} accessibilityRole="radiogroup">
          {THEME_COLORS.map((c) => {
            const active = themeColor === c.hex;
            return (
              <Pressable
                key={c.id}
                onPress={() => updateTheme(isDarkMode, c.hex)}
                accessibilityRole="radio"
                accessibilityLabel={c.name}
                accessibilityState={{ selected: active }}
                style={[
                  styles.swatchRing,
                  { borderColor: active ? colors.text : "transparent" },
                ]}
              >
                <View style={[styles.swatch, { backgroundColor: c.hex }]}>
                  {active && <Ionicons name="checkmark" size={20} color="#FFFFFF" />}
                </View>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Section title="Inteligência artificial">
        <Text style={[type.caption, styles.subLabel, { color: colors.textMuted, marginTop: 4 }]}>
          Motor usado para gerar quizzes
        </Text>
        <Segmented
          value={aiModel}
          onChange={updateAiModel}
          options={[
            { value: "gemini", label: "Gemini" },
            { value: "deepseek", label: "DeepSeek" },
            { value: "ollama", label: "Ollama" },
          ]}
        />
        <View style={{ gap: 16, marginTop: 20 }}>
          <Field
            label="Chave do Google Gemini"
            value={geminiKey}
            onChangeText={setGeminiKey}
            placeholder="AIza…"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Field
            label="Token do DeepSeek (GitHub Models)"
            value={deepKey}
            onChangeText={setDeepKey}
            placeholder="ghp_… ou github_pat_…"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            hint="As chaves ficam salvas só neste aparelho."
          />
          <Button title="Salvar chaves" onPress={saveKeys} />
        </View>
      </Section>

      <Section title="Arquivos">
        <ListItem
          icon="swap-horizontal-outline"
          title="Converter JSON em .qv"
          subtitle="Gera um arquivo criptografado que só abre no QuizzV"
          onPress={busy ? undefined : convertJson}
          trailing={busyIndicator("convert")}
        />
        <ListItem
          icon="cloud-upload-outline"
          title="Fazer backup da biblioteca"
          subtitle="Todos os quizzes num único arquivo .qv"
          onPress={busy ? undefined : backup}
          trailing={busyIndicator("backup")}
        />
        <ListItem
          icon="cloud-download-outline"
          title="Restaurar backup"
          subtitle="Adiciona os quizzes de um backup .qv"
          onPress={busy ? undefined : restore}
          trailing={busyIndicator("restore")}
        />
      </Section>

      <Section title="Sistema">
        <ListItem
          icon="refresh-circle-outline"
          title="Procurar atualizações"
          subtitle={`Versão ${Constants.expoConfig.version} • VICTRO`}
          onPress={checkingUpdate ? undefined : handleUpdateCheck}
          trailing={
            checkingUpdate ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            )
          }
        />
      </Section>

      <Section title="Desenvolvedor">
        <View style={styles.dev}>
          <Logo size={44} />
          <View style={{ flex: 1 }}>
            <Text style={[type.title, { color: colors.text }]}>Victor Kauan</Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>
              Ciência da Computação • UFPI{"\n"}Desenvolvedor Full-Stack & Mobile
            </Text>
          </View>
        </View>
        <View style={styles.socialRow}>
          <Button
            variant="tonal"
            icon="logo-github"
            title="GitHub"
            style={{ flex: 1 }}
            onPress={() => Linking.openURL("https://github.com/victor-kauan-coder")}
          />
          <Button
            variant="tonal"
            icon="logo-linkedin"
            title="LinkedIn"
            style={{ flex: 1 }}
            onPress={() =>
              Linking.openURL("https://www.linkedin.com/in/victor-miranda-5342a6337")
            }
          />
        </View>
      </Section>

      <Text style={[type.caption, styles.footerText, { color: colors.textMuted }]}>
        QuizzV v{Constants.expoConfig.version} • VICTRO
      </Text>

      <Modal visible={isUpdating} transparent animationType="fade">
        <View
          style={[
            styles.updateModal,
            { backgroundColor: isDarkMode ? "rgba(15, 23, 42, 0.98)" : "rgba(248, 250, 252, 0.98)" },
          ]}
        >
          <Logo size={64} />
          <Text style={[type.headline, { color: colors.text, marginTop: 24 }]}>
            Atualizando o QuizzV
          </Text>
          <Text style={[type.body, { color: colors.textMuted, marginTop: 8, marginBottom: 24 }]}>
            Baixando… {Math.round(progress * 100)}%
          </Text>
          <View style={{ width: "100%" }}>
            <ProgressBar value={progress} height={8} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 24 },
  section: { gap: 8 },
  sectionTitle: { paddingHorizontal: 4 },
  card: { borderRadius: radius.lg, paddingHorizontal: 16, paddingVertical: 8 },
  subLabel: { marginTop: 12, marginBottom: 8 },
  colorGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    paddingBottom: 8,
  },
  swatchRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  dev: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 8 },
  socialRow: { flexDirection: "row", gap: 8, paddingVertical: 8 },
  footerText: { textAlign: "center" },
  updateModal: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
});
