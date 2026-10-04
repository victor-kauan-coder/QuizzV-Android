import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@react-navigation/native";
import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Button, Field, showSnackbar } from "../components/ui";
import { joinRoom } from "../services/roomService";
import { radius, type } from "../theme";

export default function JoinRoomScreen({ navigation }) {
  const { colors } = useTheme();
  const [roomCode, setRoomCode] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [loading, setLoading] = useState(false);

  const ready = roomCode.trim().length >= 4 && playerName.trim().length > 0;

  const handleJoin = async () => {
    setLoading(true);
    try {
      const code = roomCode.trim().toUpperCase();
      const { room, player } = await joinRoom(code, playerName.trim());
      navigation.navigate("PlayerLobby", { room, player });
      showSnackbar(`Você entrou na sala ${code}`);
    } catch (error) {
      Alert.alert(
        "Não foi possível entrar",
        error.message || "Confira o código e tente de novo.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.hero, { backgroundColor: colors.accentSoft }]}>
          <Ionicons name="game-controller" size={40} color={colors.primary} />
        </View>
        <Text style={[type.display, styles.center, { color: colors.text }]}>
          Entrar no jogo
        </Text>
        <Text style={[type.body, styles.center, { color: colors.textMuted }]}>
          Digite o código que aparece na tela de quem criou a sala.
        </Text>

        <View style={styles.form}>
          <Field
            label="Código da sala"
            placeholder="X7B9A"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            value={roomCode}
            onChangeText={(t) => setRoomCode(t.replace(/\s/g, ""))}
          />
          <Field
            label="Seu apelido"
            placeholder="Como os outros vão te ver"
            maxLength={15}
            value={playerName}
            onChangeText={setPlayerName}
            returnKeyType="go"
            onSubmitEditing={ready ? handleJoin : undefined}
          />
          <Button
            icon="enter-outline"
            title="Entrar na sala"
            onPress={handleJoin}
            disabled={!ready}
            loading={loading}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 8 },
  hero: {
    width: 80,
    height: 80,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 16,
  },
  center: { textAlign: "center" },
  form: { gap: 16, marginTop: 24 },
});
