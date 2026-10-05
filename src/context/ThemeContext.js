import { createContext, useEffect, useMemo, useState } from "react";
import { Appearance } from "react-native";
import { DEFAULT_GEMINI_MODEL } from "../services/geminiService";
import { getSettings, saveSettings } from "../services/storage";
import { buildColors } from "../theme";

export const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  // Até o usuário escolher, segue o tema do sistema
  const [isDarkMode, setIsDarkMode] = useState(
    Appearance.getColorScheme() !== "light",
  );
  const [themeColor, setThemeColor] = useState("#F97316"); // Laranja Sunset
  const [aiModel, setAiModel] = useState("gemini");
  const [geminiModel, setGeminiModel] = useState(DEFAULT_GEMINI_MODEL);

  useEffect(() => {
    (async () => {
      const s = await getSettings();
      // Proteção contra undefined usando fallbacks
      if (s.isDarkMode !== undefined) setIsDarkMode(s.isDarkMode);
      setThemeColor(s.themeColor ?? "#F97316");
      setAiModel(s.aiModel ?? "gemini");
      setGeminiModel(s.geminiModel ?? DEFAULT_GEMINI_MODEL);
    })();
  }, []);

  const colors = useMemo(
    () => buildColors(isDarkMode, themeColor),
    [isDarkMode, themeColor],
  );

  const updateTheme = async (dark, color) => {
    setIsDarkMode(dark);
    setThemeColor(color);
    await saveSettings({ isDarkMode: dark, themeColor: color });
  };

  const updateAiModel = async (model) => {
    setAiModel(model);
    await saveSettings({ aiModel: model });
  };

  const updateGeminiModel = async (model) => {
    setGeminiModel(model);
    await saveSettings({ geminiModel: model });
  };

  return (
    <ThemeContext.Provider
      value={{
        isDarkMode,
        themeColor,
        colors,
        aiModel,
        updateTheme,
        updateAiModel,
        geminiModel,
        updateGeminiModel,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};
