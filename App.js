import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import { StatusBar } from "expo-status-bar";
import { useContext } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Platform, Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AlertHost, IconButton, Logo, SnackbarHost } from "./src/components/ui";
import { ThemeContext, ThemeProvider } from "./src/context/ThemeContext";
import GeneratorScreen from "./src/screens/GeneratorScreen";
import HomeScreen from "./src/screens/HomeScreen";
import HostGameControlScreen from "./src/screens/HostGameControlSreen";
import HostLobbyScreen from "./src/screens/HostLobbyScreen";
import JoinRoomScreen from "./src/screens/JoinRoomScreen";
import PlayerGameScreen from "./src/screens/PlayerGameScreen";
import PlayerLobbyScreen from "./src/screens/PlayerLobbyScreen";
import PodiumScreen from "./src/screens/PodiumScreen";
import QuizPlayerScreen from "./src/screens/QuizPlayerScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import VcallScreen from "./src/screens/VcallScreen";
import { type } from "./src/theme";

const Stack = createStackNavigator();

// Cores da marca (logotipo), independentes da cor de destaque escolhida
const WORDMARK = { light: "#293E9A", dark: "#5B80EC", v: "#F86B23" };

function Wordmark() {
  const { isDarkMode } = useContext(ThemeContext);
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
      accessible
      accessibilityRole="header"
      accessibilityLabel="QuizzV"
    >
      <Logo size={32} />
      <Text
        style={{
          fontSize: 21,
          fontWeight: "800",
          letterSpacing: -0.3,
          color: isDarkMode ? WORDMARK.dark : WORDMARK.light,
        }}
      >
        Quizz<Text style={{ color: WORDMARK.v }}>V</Text>
      </Text>
    </View>
  );
}

// Desktop (Tauri): a janela não tem a barra do Windows; esta faz o papel dela
// com as cores do app. Arrastar move a janela e o duplo clique maximiza.
const desktopWindow = Platform.OS === "web" && globalThis.__TAURI__?.window.getCurrentWindow();
const WINDOW_BUTTONS = [
  ["remove", "Minimizar", (w) => w.minimize()],
  ["square-outline", "Maximizar", (w) => w.toggleMaximize()],
  ["close", "Fechar", (w) => w.close()],
];

function TitleBar() {
  const { colors } = useContext(ThemeContext);
  if (!desktopWindow) return null;
  return (
    <View
      dataSet={{ tauriDragRegion: "" }}
      style={{ height: 32, flexDirection: "row", justifyContent: "flex-end", backgroundColor: colors.background }}
    >
      {WINDOW_BUTTONS.map(([icon, label, action]) => (
        <Pressable
          key={icon}
          onPress={() => action(desktopWindow)}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={({ hovered }) => ({
            width: 46,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: hovered ? (icon === "close" ? "#E81123" : colors.border) : "transparent",
          })}
        >
          {({ hovered }) => (
            <Ionicons
              name={icon}
              size={icon === "square-outline" ? 13 : 16}
              color={hovered && icon === "close" ? "#FFFFFF" : colors.textMuted}
            />
          )}
        </Pressable>
      ))}
    </View>
  );
}

function RootStack() {
  const { isDarkMode, colors } = useContext(ThemeContext);
  const base = isDarkMode ? DarkTheme : DefaultTheme;
  const theme = { ...base, dark: isDarkMode, colors: { ...base.colors, ...colors } };

  // Telas da partida multiplayer: o jogador não deve sair sem querer
  const locked = (title) => ({ title, headerLeft: () => null, gestureEnabled: false });

  return (
    <View style={{ flex: 1 }}>
      <TitleBar />
      <NavigationContainer theme={theme}>
        <StatusBar style={isDarkMode ? "light" : "dark"} />
        <Stack.Navigator
          screenOptions={{
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
            headerTitleStyle: type.title,
            cardStyle: { flex: 1, backgroundColor: colors.background }, // flex: rolagem no web
          }}
        >
          <Stack.Screen
            name="Meus Quizzes"
            component={HomeScreen}
            options={({ navigation }) => ({
              title: "",
              headerLeft: () => (
                <View style={{ marginLeft: 16 }}>
                  <Wordmark />
                </View>
              ),
              headerRight: () => (
                <View style={{ marginRight: 4 }}>
                  <IconButton
                    icon="settings-outline"
                    label="Configurações"
                    color={colors.text}
                    onPress={() => navigation.navigate("Configurações")}
                  />
                </View>
              ),
            })}
          />
          <Stack.Screen
            name="Pasta"
            component={HomeScreen}
            options={{ title: "" }}
          />
          <Stack.Screen
            name="Gerador"
            component={GeneratorScreen}
            options={{ title: "Criar quiz" }}
          />
          <Stack.Screen
            name="Quiz"
            component={QuizPlayerScreen}
            options={{ title: "" }}
          />
          <Stack.Screen
            name="Configurações"
            component={SettingsScreen}
            options={{ title: "Configurações" }}
          />
          <Stack.Screen
            name="Vcall"
            component={VcallScreen}
            options={{ title: "Quiz no Vcall" }}
          />
          <Stack.Screen
            name="JoinRoom"
            component={JoinRoomScreen}
            options={{ title: "Jogar com amigos" }}
          />
          <Stack.Screen
            name="HostLobby"
            component={HostLobbyScreen}
            options={{ title: "Sala de espera" }}
          />
          <Stack.Screen
            name="PlayerLobby"
            component={PlayerLobbyScreen}
            options={{ title: "Na sala" }}
          />
          <Stack.Screen
            name="HostGameControl"
            component={HostGameControlScreen}
            options={locked("Controle do jogo")}
          />
          <Stack.Screen
            name="PlayerGame"
            component={PlayerGameScreen}
            options={locked("Valendo!")}
          />
          <Stack.Screen
            name="PodiumScreen"
            component={PodiumScreen}
            options={locked("Ranking")}
          />
        </Stack.Navigator>
        <SnackbarHost />
        <AlertHost />
      </NavigationContainer>
    </View>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <RootStack />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
