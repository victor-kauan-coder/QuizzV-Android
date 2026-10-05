import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { radius, readable, type } from "../theme";
import { Button, Field, ListItem, Sheet } from "./ui";

export const FOLDER_COLORS = [
  "#F97316", // laranja
  "#3B82F6", // azul
  "#22C55E", // verde
  "#EC4899", // rosa
  "#8B5CF6", // violeta
  "#EAB308", // amarelo
  "#14B8A6", // turquesa
  "#64748B", // grafite
];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Cor da pasta legível (3:1) sobre a superfície do tema atual
export const useFolderTint = (hex) => {
  const { colors } = useTheme();
  return readable(hex || FOLDER_COLORS[0], 3, colors.surface);
};

export function FolderTile({ folder, count, width, onPress, onLongPress }) {
  const { colors } = useTheme();
  const tint = useFolderTint(folder.color);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`Pasta ${folder.name}, ${plural(count, "quiz", "quizzes")}`}
      accessibilityHint="Abre a pasta. Segure para editar."
      android_ripple={{ color: colors.border }}
      style={[styles.tile, { width, backgroundColor: colors.surface }]}
    >
      <View style={[styles.tileIcon, { backgroundColor: (folder.color || FOLDER_COLORS[0]) + "24" }]}>
        <Ionicons name="folder" size={22} color={tint} />
      </View>
      <Text style={[type.title, { color: colors.text }]} numberOfLines={2}>
        {folder.name}
      </Text>
      <Text style={[type.caption, { color: colors.textMuted }]}>
        {count ? plural(count, "quiz", "quizzes") : "Vazia"}
      </Text>
    </Pressable>
  );
}

export function NewFolderTile({ width, onPress }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      android_ripple={{ color: colors.border }}
      style={[styles.tile, styles.newTile, { width, borderColor: colors.border }]}
    >
      <View style={[styles.tileIcon, { backgroundColor: colors.tonal }]}>
        <Ionicons name="add" size={24} color={colors.primary} />
      </View>
      <Text style={[type.title, { color: colors.primary }]}>Nova pasta</Text>
      <Text style={[type.caption, { color: colors.textMuted }]}>Organize por matéria</Text>
    </Pressable>
  );
}

/** Criar ou editar uma pasta: nome + cor (e excluir, ao editar). */
export function FolderEditor({ visible, folder, onClose, onSave, onDelete }) {
  const { colors } = useTheme();
  const [name, setName] = useState("");
  const [color, setColor] = useState(FOLDER_COLORS[0]);

  useEffect(() => {
    if (!visible) return;
    setName(folder?.name ?? "");
    setColor(folder?.color ?? FOLDER_COLORS[0]);
  }, [visible, folder]);

  const valid = name.trim().length > 0;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={[type.headline, { color: colors.text }]}>
        {folder ? "Editar pasta" : "Nova pasta"}
      </Text>
      <Field
        label="Nome"
        value={name}
        onChangeText={setName}
        placeholder="Ex.: Direito Constitucional"
        maxLength={40}
        autoFocus={!folder}
        returnKeyType="done"
        onSubmitEditing={() => valid && onSave({ name: name.trim(), color })}
        style={{ marginTop: 16 }}
      />
      <Text style={[type.caption, styles.colorLabel, { color: colors.textMuted }]}>Cor</Text>
      <View style={styles.colors} accessibilityRole="radiogroup">
        {FOLDER_COLORS.map((c) => {
          const active = c === color;
          return (
            <Pressable
              key={c}
              onPress={() => setColor(c)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Cor ${FOLDER_COLORS.indexOf(c) + 1}`}
              style={[styles.swatchRing, { borderColor: active ? colors.text : "transparent" }]}
            >
              <View style={[styles.swatch, { backgroundColor: c }]}>
                {active && <Ionicons name="checkmark" size={18} color="#FFFFFF" />}
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={{ gap: 8, marginTop: 20 }}>
        <Button
          icon={folder ? "checkmark" : "folder"}
          title={folder ? "Salvar" : "Criar pasta"}
          disabled={!valid}
          onPress={() => onSave({ name: name.trim(), color })}
        />
        {folder && (
          <Button
            variant="text"
            icon="trash-outline"
            color={colors.error}
            title="Excluir pasta"
            onPress={onDelete}
          />
        )}
      </View>
    </Sheet>
  );
}

function FolderRow({ folder, active, onPress }) {
  const { colors } = useTheme();
  const tint = useFolderTint(folder.color);
  return (
    <ListItem
      icon="folder"
      iconColor={tint}
      title={folder.name}
      onPress={onPress}
      trailing={active && <Ionicons name="checkmark" size={20} color={colors.primary} />}
    />
  );
}

/** Escolher a pasta de um quiz. */
export function MoveSheet({ visible, quiz, folders, onClose, onMove, onNewFolder }) {
  const { colors } = useTheme();
  const current = quiz?.folderId ?? null;
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={[type.headline, { color: colors.text }]}>Mover para</Text>
      <Text style={[type.caption, { color: colors.textMuted, marginTop: 4 }]} numberOfLines={1}>
        {quiz?.title}
      </Text>
      <ScrollView style={styles.moveList} contentContainerStyle={{ paddingVertical: 8 }}>
        <ListItem
          icon="library-outline"
          title="Sem pasta"
          subtitle="Fica solto na biblioteca"
          onPress={() => onMove(null)}
          trailing={current === null && <Ionicons name="checkmark" size={20} color={colors.primary} />}
        />
        {folders.map((f) => (
          <FolderRow key={f.id} folder={f} active={current === f.id} onPress={() => onMove(f.id)} />
        ))}
      </ScrollView>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <ListItem icon="add" title="Nova pasta" color={colors.primary} onPress={onNewFolder} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: radius.lg,
    padding: 14,
    gap: 4,
    minHeight: 112,
    overflow: "hidden",
  },
  newTile: { borderWidth: 1.5, borderStyle: "dashed", backgroundColor: "transparent" },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  colorLabel: { marginTop: 16, marginBottom: 8 },
  colors: { flexDirection: "row", flexWrap: "wrap", gap: 2 },
  swatchRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  moveList: { maxHeight: 340, marginTop: 8 },
  divider: { height: StyleSheet.hairlineWidth },
});
