import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { Linking, Platform } from "react-native";

// iPhone não instala APK: a versão nova (.ipa) fica na página de releases
const RELEASES_URL = "https://github.com/victor-kauan-coder/QuizzV-Android/releases/latest";

// URL SEM o hash do commit para pegar sempre o mais recente
const VERSION_URL =
  "https://gist.githubusercontent.com/victor-kauan-coder/4c0d029726628f6e1b11a361f7db82a1/raw/version.json";

// "1.10.0" > "1.9.2": compara número a número, não como texto
const isNewer = (latest, current) => {
  const a = latest.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
};

export const checkForUpdates = async () => {
  try {
    const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      headers: { "Cache-Control": "no-cache" },
    });
    const data = await response.json();

    const currentVersion = (Constants.expoConfig.version || "").trim();
    const latestVersion = (data.latestVersion || "").trim();

    // RETORNO CRÍTICO: Agora a HomeScreen receberá os dados
    return {
      // só oferece versões mais novas (nunca "atualiza" para uma anterior)
      hasUpdate: !!latestVersion && isNewer(latestVersion, currentVersion),
      latestVersion,
      currentVersion,
      updateUrl: data.updateUrl,
    };
  } catch (error) {
    console.error("Erro ao verificar update:", error);
    return { hasUpdate: false, error: true };
  }
};

export const downloadAndInstall = async (url, onProgress) => {
  if (Platform.OS === "ios") return Linking.openURL(RELEASES_URL);
  try {
    const fileUri = `${FileSystem.cacheDirectory}quizzv_update.apk`;

    const downloadResumable = FileSystem.createDownloadResumable(
      url,
      fileUri,
      {},
      (downloadProgress) => {
        const progress =
          downloadProgress.totalBytesWritten /
          downloadProgress.totalBytesExpectedToWrite;
        if (onProgress) onProgress(progress);
      },
    );

    const result = await downloadResumable.downloadAsync();
    if (result.status !== 200) throw new Error("Erro no download");

    // CORREÇÃO DE SEGURANÇA: No Android moderno, precisamos transformar o caminho em URI
    const contentUri = await FileSystem.getContentUriAsync(result.uri);

    await IntentLauncher.startActivityAsync(
      "android.intent.action.INSTALL_PACKAGE",
      {
        data: contentUri,
        flags: 1, // Grant read permission
      },
    );
  } catch (error) {
    console.error("Erro na instalação:", error);
    throw error;
  }
};
