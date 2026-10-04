import { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";

// Cores da marca + festa
const COLORS = ["#F86B23", "#305CDE", "#FBBF24", "#22C55E", "#EC4899", "#38BDF8", "#FFFFFF"];
const DURATION = 3400;
const STEPS = 24; // amostras da trajetória (interpolação linear entre elas)
const GRAVITY = 900; // px/s²
const DRAG = 1.6; // resistência do ar: o papel cai devagar, balançando

// Posição com arrasto linear (v' = -k·v + g), resolvida analiticamente
const pos = (p0, v0, g, t) =>
  p0 + (g / DRAG) * t + ((v0 - g / DRAG) * (1 - Math.exp(-DRAG * t))) / DRAG;

// Dois "canhões" nos cantos de baixo atirando para dentro e para cima
function makeParticle(i, width, height) {
  const fromLeft = i % 2 === 0;
  const angle = ((58 + Math.random() * 27) * Math.PI) / 180;
  const speed = 1500 + Math.random() * 1000;
  const vx = (fromLeft ? 1 : -1) * speed * Math.cos(angle);
  const vy = -speed * Math.sin(angle);
  const x0 = fromLeft ? -12 : width + 12;
  const y0 = height * 0.9;
  const sway = 8 + Math.random() * 22;
  const swayHz = 0.7 + Math.random() * 1.1;
  const flipHz = 1 + Math.random() * 2.2;
  const phase = Math.random() * Math.PI * 2;
  const delay = Math.random() * 0.1; // fração da duração

  const input = [];
  const xs = [];
  const ys = [];
  const flips = [];
  for (let s = 0; s <= STEPS; s++) {
    const f = s / STEPS;
    const t = (Math.max(0, f - delay) * DURATION) / 1000;
    input.push(f);
    xs.push(pos(x0, vx, 0, t) + sway * Math.sin(phase + t * swayHz * 2 * Math.PI) * Math.min(1, t));
    ys.push(pos(y0, vy, GRAVITY, t));
    // cosseno no scaleX = o papel virando no ar
    flips.push(Math.cos(phase + t * flipHz * 2 * Math.PI));
  }

  const shape = i % 3; // retângulo, fita ou bolinha
  return {
    input,
    xs,
    ys,
    flips,
    spin: (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * 3.5),
    color: COLORS[i % COLORS.length],
    w: shape === 1 ? 5 : shape === 2 ? 9 : 8,
    h: shape === 1 ? 16 : shape === 2 ? 9 : 12,
    round: shape === 2,
  };
}

/**
 * Explosão de confete que toca uma vez ao montar. Para repetir, troque a `key`.
 * Roda no driver nativo: um único Animated.Value move todas as partículas.
 */
export default function Confetti({ count = 90, onDone }) {
  const { width, height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;

  const pieces = useMemo(() => {
    const opacity = progress.interpolate({
      inputRange: [0, 0.78, 1],
      outputRange: [1, 1, 0],
    });
    return Array.from({ length: count }, (_, i) => {
      const p = makeParticle(i, width, height);
      return {
        ...p,
        style: {
          opacity,
          transform: [
            { translateX: progress.interpolate({ inputRange: p.input, outputRange: p.xs }) },
            { translateY: progress.interpolate({ inputRange: p.input, outputRange: p.ys }) },
            {
              rotate: progress.interpolate({
                inputRange: [0, 1],
                outputRange: ["0deg", `${p.spin * 360}deg`],
              }),
            },
            { scaleX: progress.interpolate({ inputRange: p.input, outputRange: p.flips }) },
          ],
        },
      };
    });
  }, [count, width, height, progress]);

  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: DURATION,
      easing: Easing.linear, // a física já está na trajetória
      useNativeDriver: true,
    });
    anim.start(({ finished }) => finished && onDone?.());
    return () => anim.stop();
  }, [progress]);

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      importantForAccessibility="no-hide-descendants"
    >
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={[
            styles.piece,
            {
              width: p.w,
              height: p.h,
              borderRadius: p.round ? p.w / 2 : 1.5,
              backgroundColor: p.color,
            },
            p.style,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: { position: "absolute", left: 0, top: 0 },
});
