import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@react-navigation/native";
import { Buffer } from "buffer"; // Para DOCX
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import mammoth from "mammoth"; // DOCX funciona no Expo
import { useContext, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Field, IconButton, Segmented, showSnackbar } from "../components/ui";
import { ThemeContext } from "../context/ThemeContext";
import { generateQuizFromDeepSeek } from "../services/deepseekService";
import { generateQuizFromIA } from "../services/geminiService";
import { generateQuizFromOllamaUnified } from "../services/ollamaService";
import { getSettings, saveQuiz } from "../services/storage";
import { radius, type } from "../theme";

const ENGINE = { gemini: "Gemini", deepseek: "DeepSeek", ollama: "Ollama" };
const MIN_Q = 1;
const MAX_Q = 50;
const isDocx = (f) => f.name.toLowerCase().endsWith(".docx");
const isPdf = (f) => f.name.toLowerCase().endsWith(".pdf");

export default function GeneratorScreen({ navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { aiModel } = useContext(ThemeContext);
  const [tema, setTema] = useState("");
  const [qtd, setQtd] = useState(10);
  const [quizMode, setQuizMode] = useState("vf"); // 'vf' ou 'mc'
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [temaError, setTemaError] = useState(null);

  const pickFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        "image/*",
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
      multiple: true,
    });
    if (!result.canceled) setFiles([...files, ...result.assets]);
  };

  const extractDocxText = async (fileUri) => {
    try {
      const base64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: "base64",
      });
      const result = await mammoth.extractRawText({
        arrayBuffer: Buffer.from(base64, "base64"),
      });
      return result.value;
    } catch {
      return "";
    }
  };

  const handleGerar = async () => {
    if (!tema.trim()) {
      setTemaError("Informe o assunto do quiz.");
      return;
    }
    if (aiModel === "ollama" && files.some(isPdf)) {
      Alert.alert(
        "PDF não suportado no Ollama",
        "O motor local ainda não lê PDFs. Troque para o Gemini nas configurações ou anexe imagens/DOCX.",
      );
      return;
    }

    setLoading(true);
    try {
      const s = (await getSettings()) || {};
      let allTextContent = "";
      const allImagesBase64 = [];

      for (const file of files) {
        if (file.mimeType?.includes("image") || /\.(jpe?g|png)$/i.test(file.name)) {
          allImagesBase64.push(
            await FileSystem.readAsStringAsync(file.uri, { encoding: "base64" }),
          );
        } else if (isDocx(file)) {
          allTextContent += `\n--- DOCX: ${file.name} ---\n${await extractDocxText(file.uri)}`;
        }
      }

      let questions;
      if (aiModel === "gemini") {
        if (!s.api_key) throw new Error("Cadastre sua chave do Gemini nas configurações.");
        // O Gemini não aceita DOCX como anexo: o texto extraído vai no prompt
        const topic = allTextContent
          ? `${tema}\n\nMaterial de apoio:${allTextContent}`
          : tema;
        questions = await generateQuizFromIA(
          topic,
          qtd,
          s.api_key,
          files.filter((f) => !isDocx(f)),
          quizMode,
        );
      } else if (aiModel === "ollama") {
        if (!s.ollama_url) throw new Error("Configure a URL do servidor Ollama.");
        const resultData = await generateQuizFromOllamaUnified(
          tema,
          qtd,
          s.ollama_url,
          allTextContent,
          allImagesBase64,
          quizMode,
        );
        questions = resultData.questions;
      } else {
        if (!s.deepseek_key) throw new Error("Cadastre sua chave do DeepSeek nas configurações.");
        questions = await generateQuizFromDeepSeek(tema, qtd, s.deepseek_key, [], quizMode);
      }

      await saveQuiz({
        id: Date.now(),
        title: tema.trim(),
        questions,
        engine: aiModel,
        type: quizMode,
      });
      showSnackbar(`“${tema.trim()}” criado com ${questions.length} questões`);
      navigation.navigate("Meus Quizzes");
    } catch (e) {
      Alert.alert("Não foi possível gerar o quiz", e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={() => navigation.navigate("Configurações")}
          accessibilityRole="button"
          accessibilityHint="Abre as configurações para trocar o motor de IA"
          style={[styles.engine, { backgroundColor: colors.accentSoft }]}
        >
          <Ionicons name="hardware-chip-outline" size={16} color={colors.primary} />
          <Text style={[type.caption, { color: colors.primary }]}>
            Motor: {ENGINE[aiModel] || aiModel} · trocar
          </Text>
        </Pressable>

        <Field
          label="Assunto"
          value={tema}
          onChangeText={(t) => {
            setTema(t);
            if (temaError) setTemaError(null);
          }}
          placeholder="Ex.: Complexidade de algoritmos"
          error={temaError}
          hint="Quanto mais específico, melhores as questões."
          returnKeyType="done"
        />

        <View>
          <Text style={[type.caption, styles.label, { color: colors.textMuted }]}>
            Quantidade de questões
          </Text>
          <View
            style={[
              styles.stepper,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <IconButton
              icon="remove"
              label="Menos questões"
              color={qtd > MIN_Q ? colors.primary : colors.textMuted}
              onPress={() => setQtd(Math.max(MIN_Q, qtd - 1))}
            />
            <Text
              style={[type.headline, styles.stepValue, { color: colors.text }]}
              accessibilityLiveRegion="polite"
            >
              {qtd}
            </Text>
            <IconButton
              icon="add"
              label="Mais questões"
              color={qtd < MAX_Q ? colors.primary : colors.textMuted}
              onPress={() => setQtd(Math.min(MAX_Q, qtd + 1))}
            />
          </View>
        </View>

        <View>
          <Text style={[type.caption, styles.label, { color: colors.textMuted }]}>
            Tipo de questão
          </Text>
          <Segmented
            value={quizMode}
            onChange={setQuizMode}
            options={[
              { value: "vf", label: "V ou F" },
              { value: "mc", label: "Múltipla escolha" },
            ]}
          />
        </View>

        <View>
          <Text style={[type.caption, styles.label, { color: colors.textMuted }]}>
            Material de apoio (opcional)
          </Text>
          <Pressable
            onPress={pickFiles}
            accessibilityRole="button"
            android_ripple={{ color: colors.border }}
            style={[styles.uploadArea, { borderColor: colors.border }]}
          >
            <Ionicons name="attach" size={24} color={colors.primary} />
            <Text style={[type.label, { color: colors.text }]}>
              Anexar PDF, DOCX ou fotos
            </Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>
              A IA cria as questões a partir do conteúdo
            </Text>
          </Pressable>

          {files.map((f, i) => (
            <View
              key={`${f.uri}-${i}`}
              style={[styles.fileItem, { backgroundColor: colors.surface }]}
            >
              <Ionicons
                name={f.mimeType?.includes("image") ? "image-outline" : "document-text-outline"}
                size={20}
                color={colors.textMuted}
              />
              <Text style={[type.body, { flex: 1, color: colors.text }]} numberOfLines={1}>
                {f.name}
              </Text>
              <IconButton
                icon="close"
                label={`Remover ${f.name}`}
                color={colors.textMuted}
                size={20}
                onPress={() => setFiles(files.filter((_, idx) => idx !== i))}
              />
            </View>
          ))}
        </View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          { borderTopColor: colors.border, paddingBottom: 12 + insets.bottom },
        ]}
      >
        <Button
          icon="sparkles"
          title={loading ? "Gerando…" : "Gerar quiz"}
          onPress={handleGerar}
          loading={loading}
        />
        {loading && (
          <Text style={[type.caption, styles.wait, { color: colors.textMuted }]}>
            Isso pode levar até um minuto.
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { padding: 16, gap: 24 },
  engine: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
  },
  label: { marginBottom: 6 },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 4,
  },
  stepValue: { fontVariant: ["tabular-nums"] },
  uploadArea: {
    minHeight: 112,
    borderRadius: radius.lg,
    borderStyle: "dashed",
    borderWidth: 1.5,
    justifyContent: "center",
    alignItems: "center",
    gap: 4,
    padding: 16,
    overflow: "hidden",
  },
  fileItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 14,
    borderRadius: radius.md,
    gap: 10,
    marginTop: 8,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  wait: { textAlign: "center", marginTop: 8 },
});
