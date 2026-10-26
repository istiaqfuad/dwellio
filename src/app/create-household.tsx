import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { BackButton, Button, Field, Screen, Subtitle, Title, usePalette } from '@/components/ui';
import { CURRENCIES } from '@/lib/finance';
import { useHousehold } from '@/lib/household-context';

export default function CreateHouseholdScreen() {
  const p = usePalette();
  const router = useRouter();
  const { createHousehold } = useHousehold();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('BDT');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTop, setPickerTop] = useState(0);
  const selected = CURRENCIES.find((c) => c.code === currency) ?? CURRENCIES[0]!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onCreate() {
    if (!name.trim()) {
      setError('Give your household a name to continue.');
      return;
    }
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await createHousehold(name, currency || 'BDT');
      router.replace('/');
    } catch {
      setError('Could not create the household. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <BackButton />
        <Text style={{ fontSize: 15, fontWeight: '700', color: p.primary, marginTop: 32 }}>NEW HOUSEHOLD</Text>
        <Title>Set up your home</Title>
        <Subtitle>Just a name and currency. You can invite people and pick modules next.</Subtitle>
        <Text style={{ height: 18 }} />
        <Field label="Household name" value={name} onChangeText={setName} placeholder="Sunset Flat, Room 4B" />
        <Text style={{ fontSize: 13, fontWeight: '600', color: p.muted, marginBottom: 6 }}>Currency</Text>
        <View style={{ position: 'relative', zIndex: 10, marginBottom: 10 }}>
          <Pressable
            onPress={() => setPickerOpen((o) => !o)}
            onLayout={(e) => setPickerTop(e.nativeEvent.layout.height + 6)}
            style={{
              borderWidth: 1,
              borderColor: p.line,
              borderRadius: 12,
              paddingVertical: 13,
              paddingHorizontal: 14,
              backgroundColor: p.bg,
              flexDirection: 'row',
              alignItems: 'center',
            }}>
            <Text style={{ flex: 1, fontSize: 16, color: p.ink }}>
              {selected.symbol} {selected.code} · {selected.label}
            </Text>
            <Text style={{ fontSize: 14, color: p.muted }}>{pickerOpen ? '▴' : '▾'}</Text>
          </Pressable>
          {pickerOpen ? (
            <View
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: pickerTop || 56,
                borderWidth: 1,
                borderColor: p.line,
                borderRadius: 12,
                backgroundColor: p.card,
                overflow: 'hidden',
                elevation: 8,
                shadowColor: '#000',
                shadowOpacity: 0.16,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
              }}>
              {CURRENCIES.map((c) => (
                <Pressable
                  key={c.code}
                  onPress={() => {
                    setCurrency(c.code);
                    setPickerOpen(false);
                  }}
                  style={{ paddingVertical: 11, paddingHorizontal: 14, backgroundColor: c.code === currency ? `${p.primary}1F` : 'transparent' }}>
                  <Text style={{ fontSize: 15, color: c.code === currency ? p.primary : p.ink, fontWeight: c.code === currency ? '700' : '400' }}>
                    {c.symbol} {c.code} · {c.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
        {error ? <Text style={{ color: p.danger, marginBottom: 8 }}>{error}</Text> : null}
        <Button label="Create household" onPress={onCreate} loading={busy} />
      </ScrollView>
    </Screen>
  );
}
