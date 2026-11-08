import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

/**
 * Pulses once in a member's colour when **they** change something
 * (09 Design System#Motion: "remote changes pulse the changed element once in
 * the actor's colour").
 *
 * Built on React Native's `Animated` rather than Reanimated: a one-shot opacity
 * fade needs nothing more, and it keeps the dependency list to what Expo Go
 * ships (02 Ground Rules #6).
 *
 * Two things it deliberately does *not* do:
 *  - pulse on first render, which would flash the whole screen on load
 *  - pulse for your own edits, which feels like the app arguing with you
 *
 * This is the one piece of motion in Stage 3, because "you *see* it move" is
 * the point of a shared plan — the rest of the motion pass is Stage 8.
 */
export function Pulse({
  /** Changes to this value trigger the pulse. Use a version or a formatted value. */
  watch,
  /** The actor's colour. When undefined, nothing pulses. */
  color,
  children,
  style,
}: {
  watch: string | number;
  color: string | undefined;
  children: ReactNode;
  style?: object;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const previous = useRef(watch);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      previous.current = watch;
      return;
    }
    if (previous.current === watch) return;
    previous.current = watch;
    if (!color) return;

    opacity.setValue(0);
    Animated.sequence([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 520,
        easing: Easing.in(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start();
  }, [watch, color, opacity]);

  return (
    <Animated.View style={style}>
      {children}
      {color ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.overlay,
            { borderColor: color, opacity: opacity.interpolate({ inputRange: [0, 1], outputRange: [0, 0.9] }) },
          ]}
        />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    borderWidth: 2,
    borderRadius: 6,
  },
});
