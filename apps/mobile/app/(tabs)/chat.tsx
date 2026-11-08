import { View, Text, StyleSheet } from 'react-native';
import { colors, space, type } from '../../src/theme';

/** Placeholder. Built in a later stage — see 10 Screens#Chat. */
export default function ChatScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Chat</Text>
      <Text style={styles.caption}>Coming in a later stage.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: space.sidePadding, paddingTop: space.xl },
  title: { ...type.title, color: colors.textPrimary },
  caption: { ...type.caption, color: colors.textSecondary, marginTop: space.sm },
});
