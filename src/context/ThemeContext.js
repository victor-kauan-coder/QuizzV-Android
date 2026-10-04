import { createContext, useEffect, useMemo, useState } from "react";
import { Appearance } from "react-native";
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

  useEffect(() => {
    (async () => {
      const s = await getSettings();
      // Proteção contra undefined usando fallbacks
      if (s.isDarkMode !== undefined) setIsDarkMode(s.isDarkMode);
      setThemeColor(s.themeColor ?? "#F97316");
      setAiModel(s.aiModel ?? "gemini");
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

  return (
    <ThemeContext.Provider
      value={{
        isDarkMode,
        themeColor,
        colors,
        aiModel,
        updateTheme,
        updateAiModel,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};
