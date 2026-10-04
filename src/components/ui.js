import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@react-navigation/native";
import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, type } from "../theme";

const LOGO = require("../../assets/images/logo.svg");
const LOGO_DARK = require("../../assets/images/logo-dark.svg");

export function Logo({ size = 32 }) {
  const { dark } = useTheme();
  return (
    <Image
      source={dark ? LOGO_DARK : LOGO}
      style={{ width: size, height: size }}
      contentFit="contain"
      accessibilityLabel="QuizzV"
    />
  );
}

/** Botão Material: filled (ação principal), tonal, outlined ou text. */
export function Button({
  title,
  icon,
  onPress,
  variant = "filled",
  color,
  loading,
  disabled,
  style,
}) {
  const { colors } = useTheme();
  const tint = color ?? colors.primary;
  const v = {
    filled: { bg: colors.accent, fg: colors.onAccent },
    tonal: { bg: colors.accentSoft, fg: colors.primary },
    outlined: { bg: "transparent", fg: tint, border: colors.border },
    text: { bg: "transparent", fg: tint },
  }[variant];
  const off = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      android_ripple={{ color: v.fg + "33" }}
      style={[
        styles.button,
        {
          backgroundColor: v.bg,
          borderColor: v.border ?? "transparent",
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={20} color={v.fg} />}
          <Text style={[type.label, { color: v.fg }]} numberOfLines={1}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, color, label, size = 24 }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ borderless: true, radius: 24 }}
      style={styles.iconButton}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

export function ProgressBar({ value, height = 6 }) {
  const { colors } = useTheme();
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={{
        height,
        borderRadius: height,
        backgroundColor: colors.surfaceAlt,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: height,
          backgroundColor: colors.accent,
        }}
      />
    </View>
  );
}

/** Seletor segmentado (ex.: V ou F / Múltipla escolha). */
export function Segmented({ options, value, onChange }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      style={[styles.segmented, { backgroundColor: colors.surfaceAlt }]}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            style={[
              styles.segment,
              active && { backgroundColor: colors.accent },
            ]}
          >
            {o.icon && (
              <Ionicons
                name={o.icon}
                size={16}
                color={active ? colors.onAccent : colors.textMuted}
              />
            )}
            <Text
              style={[
                type.label,
                { color: active ? colors.onAccent : colors.textMuted },
              ]}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({ label, hint, error, style, ...inputProps }) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={style}>
      <Text style={[type.caption, styles.fieldLabel, { color: colors.textMuted }]}>
        {label}
      </Text>
      <TextInput
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={label}
        {...inputProps}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          type.body,
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor: error
              ? colors.error
              : focused
                ? colors.primary
                : colors.border,
          },
        ]}
      />
      {(error || hint) && (
        <Text
          style={[
            type.caption,
            styles.hint,
            { color: error ? colors.error : colors.textMuted },
          ]}
        >
          {error || hint}
        </Text>
      )}
    </View>
  );
}

/** Bottom sheet Material: desliza ao abrir, toque fora ou Voltar fecha. */
export function Sheet({ visible, onClose, children }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) return;
    slide.setValue(1);
    Animated.timing(slide, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [visible, slide]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.sheetRoot}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
          onPress={onClose}
          accessibilityLabel="Fechar"
        />
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              paddingBottom: 16 + insets.bottom,
              transform: [
                {
                  translateY: slide.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 320],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

/** Linha de lista com ícone, usada nas ações do bottom sheet e nas configurações. */
export function ListItem({ icon, title, subtitle, onPress, color, trailing }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      android_ripple={{ color: colors.border }}
      style={styles.listItem}
    >
      {icon && (
        <Ionicons name={icon} size={22} color={color ?? colors.textMuted} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { color: color ?? colors.text }]}>{title}</Text>
        {subtitle && (
          <Text style={[type.caption, { color: colors.textMuted }]}>
            {subtitle}
          </Text>
        )}
      </View>
      {trailing}
    </Pressable>
  );
}

// --- Snackbar: feedback rápido que não interrompe (sucessos) ---
let showRef = null;
export const showSnackbar = (message) => showRef?.(message);

export function SnackbarHost() {
  const { dark } = useTheme();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef(null);

  useEffect(() => {
    const animate = (toValue, done) =>
      Animated.timing(anim, {
        toValue,
        duration: 180,
        useNativeDriver: true,
      }).start(done);

    showRef = (m) => {
      clearTimeout(timer.current);
      setMessage(m);
      animate(1);
      timer.current = setTimeout(() => animate(0, () => setMessage(null)), 3500);
    };
    return () => {
      showRef = null;
      clearTimeout(timer.current);
    };
  }, [anim]);

  if (!message) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.snackbar,
        {
          bottom: 16 + insets.bottom,
          backgroundColor: dark ? "#E2E8F0" : "#1E293B",
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [16, 0],
              }),
            },
          ],
        },
      ]}
    >
      <Text style={[type.body, { color: dark ? "#0F172A" : "#F8FAFC" }]}>
        {message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    paddingHorizontal: 20,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    overflow: "hidden",
  },
  iconButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  segmented: {
    flexDirection: "row",
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  fieldLabel: { marginBottom: 6 },
  input: {
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  hint: { marginTop: 6 },
  sheetRoot: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  listItem: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 8,
  },
  snackbar: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: radius.sm,
    paddingHorizontal: 16,
    paddingVertical: 14,
    elevation: 6,
  },
});
