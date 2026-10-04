import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import { StatusBar } from "expo-status-bar";
import { useContext } from "react";
import { Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { IconButton, Logo, SnackbarHost } from "./src/components/ui";
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

function RootStack() {
  const { isDarkMode, colors } = useContext(ThemeContext);
  const base = isDarkMode ? DarkTheme : DefaultTheme;
  const theme = { ...base, dark: isDarkMode, colors: { ...base.colors, ...colors } };

  // Telas da partida multiplayer: o jogador não deve sair sem querer
  const locked = (title) => ({ title, headerLeft: () => null, gestureEnabled: false });

  return (
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
          options={locked("Na sala")}
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
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <RootStack />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
