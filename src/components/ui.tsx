import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, useColorScheme } from 'react-native';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const palette = {
  light: {
    bg: '#FFFFFF',
    surface: '#F2F5F1',
    card: '#FFFFFF',
    ink: '#17211B',
    muted: '#5D6C61',
    line: '#E2E8E2',
    primary: '#1C6B47',
    primaryInk: '#FFFFFF',
    accent: '#B7791F',
    danger: '#B3402E',
  },
  dark: {
    bg: '#0D1410',
    surface: '#141E18',
    card: '#16221B',
    ink: '#EDF3EE',
    muted: '#9CAF9F',
    line: '#25362B',
    primary: '#45A377',
    primaryInk: '#08130D',
    accent: '#D9A441',
    danger: '#E0806A',
  },
} as const;

export function usePalette() {
  const scheme = useColorScheme();
  return palette[scheme === 'dark' ? 'dark' : 'light'];
}

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const p = usePalette();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[{ flex: 1, backgroundColor: p.bg, padding: 20 }, style]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {children}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  const p = usePalette();
  return <Text style={{ fontSize: 26, fontWeight: '700', color: p.ink, letterSpacing: -0.3 }}>{children}</Text>;
}

export function Subtitle({ children }: { children: React.ReactNode }) {
  const p = usePalette();
  return <Text style={{ fontSize: 14, color: p.muted, marginTop: 4 }}>{children}</Text>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const p = usePalette();
  return (
    <Text style={{ fontSize: 13, fontWeight: '700', color: p.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 20, marginBottom: 8 }}>
      {children}
    </Text>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const p = usePalette();
  return (
    <View
      style={[
        {
          backgroundColor: p.card,
          borderColor: p.line,
          borderWidth: 1,
          borderRadius: 16,
          padding: 16,
          marginBottom: 12,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

export function Row({ children, gap = 8 }: { children: React.ReactNode; gap?: number }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap }}>{children}</View>;
}

export function ListRow({ children, gap = 8 }: { children: React.ReactNode; gap?: number }) {
  return (
    <View style={{ paddingVertical: 7 }}>
      <Row gap={gap}>{children}</Row>
    </View>
  );
}

export function BackButton({ label = 'Back' }: { label?: string }) {
  const router = useRouter();
  const p = usePalette();
  return (
    <View style={{ alignItems: 'flex-start', marginBottom: 12 }}>
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={8}
        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingRight: 12 }}>
        <Feather name="chevron-left" size={18} color={p.primary} />
        <Text style={{ color: p.primary, fontWeight: '600', fontSize: 15 }}>{label}</Text>
      </Pressable>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  size = 'md',
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  size?: 'md' | 'sm';
}) {
  const p = usePalette();
  const small = size === 'sm';
  const inactive = disabled || loading;
  const styles = StyleSheet.create({
    base: {
      borderRadius: small ? 10 : 12,
      paddingVertical: small ? 8 : 14,
      paddingHorizontal: small ? 12 : 16,
      alignItems: 'center',
      opacity: inactive ? 0.55 : 1,
    },
    label: {
      fontSize: small ? 13 : 15,
    },
  });
  const spinnerColor = variant === 'ghost' ? p.primary : variant === 'danger' ? '#fff' : p.primaryInk;
  const textColor = variant === 'ghost' ? p.ink : variant === 'danger' ? '#fff' : p.primaryInk;
  const weight = variant === 'primary' ? '700' : '600';
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {loading ? <ActivityIndicator size="small" color={spinnerColor} /> : null}
      <Text style={[{ color: textColor, fontWeight: weight }, styles.label]}>{label}</Text>
    </View>
  );
  if (variant === 'ghost') {
    return (
      <Pressable style={[styles.base, { borderWidth: 1, borderColor: p.line }]} onPress={onPress} disabled={inactive}>
        {content}
      </Pressable>
    );
  }
  if (variant === 'danger') {
    return (
      <Pressable style={[styles.base, { backgroundColor: p.danger }]} onPress={onPress} disabled={inactive}>
        {content}
      </Pressable>
    );
  }
  return (
    <Pressable style={[styles.base, { backgroundColor: p.primary }]} onPress={onPress} disabled={inactive}>
      {content}
    </Pressable>
  );
}

export function Field({
  label,
  ...props
}: { label: string } & TextInputProps) {
  const p = usePalette();
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: p.muted, marginBottom: 6 }}>{label}</Text>
      <TextInput
        placeholderTextColor={p.muted}
        style={{
          borderWidth: 1,
          borderColor: p.line,
          borderRadius: 12,
          paddingVertical: 13,
          paddingHorizontal: 14,
          fontSize: 16,
          color: p.ink,
          backgroundColor: p.bg,
        }}
        {...props}
      />
    </View>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  const p = usePalette();
  return (
    <View style={{ padding: 24, alignItems: 'center', borderWidth: 1, borderColor: p.line, borderRadius: 14, borderStyle: 'dashed', marginBottom: 12 }}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: p.ink }}>{title}</Text>
      <Text style={{ fontSize: 13, color: p.muted, marginTop: 4, textAlign: 'center' }}>{hint}</Text>
    </View>
  );
}

export function Loading() {
  const p = usePalette();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: p.bg }}>
      <ActivityIndicator color={p.primary} />
    </View>
  );
}

export function Skeleton({ height = 14, width = '100%' }: { height?: number; width?: number | string }) {
  const p = usePalette();
  return <View style={{ height, width, borderRadius: 7, backgroundColor: p.surface, marginBottom: 8 }} />;
}
