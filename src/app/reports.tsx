import { useMemo, useState } from 'react';
import { Platform, ScrollView, Text } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { BackButton, Button, Card, Row, ListRow, Screen, SectionTitle, Subtitle, Title, usePalette } from '@/components/ui';
import { useHousehold } from '@/lib/household-context';
import { useCollection } from '@/lib/use-collection';
import { computeBalances, formatMoney } from '@/lib/finance';
import type { Expense, Settlement } from '@/lib/models';

export default function ReportsScreen() {
  const p = usePalette();
  const { active, members, isAdmin } = useHousehold();
  const hid = active?.id ?? '';
  const { items: expenses } = useCollection<Expense>(`households/${hid}/expenses`, [], !!hid);
  const { items: settlements } = useCollection<Settlement>(`households/${hid}/settlements`, [], !!hid);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const nameOf = (uid: string) => members.find((m) => m.id === uid)?.displayName ?? 'Member';

  const { total, byCategory, balances } = useMemo(() => {
    const live = expenses.filter((e) => e.status !== 'voided');
    const t = live.reduce((s, e) => s + e.amount, 0);
    const cats: Record<string, number> = {};
    live.forEach((e) => {
      cats[e.category] = (cats[e.category] ?? 0) + e.amount;
    });
    return {
      total: t,
      byCategory: Object.entries(cats).sort((a, b) => b[1] - a[1]),
      balances: active ? computeBalances(expenses, settlements, active.memberIds) : [],
    };
  }, [expenses, settlements, active]);

  if (!active) {
    return (
      <Screen>
        <Title>Reports</Title>
        <Subtitle>Join or create a household first.</Subtitle>
      </Screen>
    );
  }

  function csv(): string {
    const rows = ['Expense,Category,Date,Payer,Amount,Status'];
    expenses.forEach((e) => {
      rows.push(
        [`"${e.title.replace(/"/g, '""')}"`, e.category, new Date(e.date).toISOString().slice(0, 10), nameOf(e.payerId), String(e.amount), e.status].join(','),
      );
    });
    rows.push('');
    rows.push('Member,Paid,Share,Net');
    balances.forEach((b) => rows.push([nameOf(b.uid), String(b.paid), String(b.share), String(b.net)].join(',')));
    return rows.join('\n');
  }

  async function exportCsv() {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      const text = csv();
      if (Platform.OS === 'web') {
        await Clipboard.setStringAsync(text);
        setNotice('Report copied. Paste it into any spreadsheet.');
        return;
      }
      const file = new File(Paths.cache, 'dwellio-report.csv');
      await (file as unknown as { write: (c: string) => Promise<void> }).write(text);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri);
      } else {
        setNotice('Report saved but sharing is unavailable on this device.');
      }
    } catch {
      setNotice('Export failed on this device. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 64 }}>
        <BackButton />
        <Title>Reports</Title>
        <Subtitle>{active.name} · generated {new Date().toLocaleDateString()}</Subtitle>

        <SectionTitle>Total spending</SectionTitle>
        <Card>
          <Text style={{ fontSize: 28, fontWeight: '800', color: p.ink }}>{formatMoney(total, active.currency)}</Text>
          <Text style={{ color: p.muted, fontSize: 13 }}>{expenses.filter((e) => e.status !== 'voided').length} shared expenses</Text>
        </Card>

        <SectionTitle>By category</SectionTitle>
        <Card>
          {byCategory.length === 0 ? <Text style={{ color: p.muted }}>Nothing to show yet.</Text> : null}
          {byCategory.map(([c, amt]) => (
            <ListRow key={c}>
              <Text style={{ flex: 1, color: p.ink }}>{c}</Text>
              <Text style={{ fontWeight: '700', color: p.ink }}>{formatMoney(amt, active.currency)}</Text>
            </ListRow>
          ))}
        </Card>

        <SectionTitle>Per member</SectionTitle>
        <Card>
          <Row>
            <Text style={{ flex: 1, fontSize: 12, color: p.muted }}>Member</Text>
            <Text style={{ width: 80, textAlign: 'right', fontSize: 12, color: p.muted }}>Paid</Text>
            <Text style={{ width: 80, textAlign: 'right', fontSize: 12, color: p.muted }}>Share</Text>
            <Text style={{ width: 80, textAlign: 'right', fontSize: 12, color: p.muted }}>Net</Text>
          </Row>
          {balances.map((b) => (
            <ListRow key={b.uid}>
              <Text style={{ flex: 1, color: p.ink }}>{nameOf(b.uid)}</Text>
              <Text style={{ width: 80, textAlign: 'right', color: p.ink }}>{b.paid}</Text>
              <Text style={{ width: 80, textAlign: 'right', color: p.ink }}>{b.share}</Text>
              <Text style={{ width: 80, textAlign: 'right', fontWeight: '700', color: b.net >= 0 ? p.primary : p.danger }}>{b.net}</Text>
            </ListRow>
          ))}
        </Card>

        <SectionTitle>Settlement history</SectionTitle>
        {settlements.length === 0 ? (
          <Card>
            <Text style={{ color: p.muted }}>No settlements recorded yet.</Text>
          </Card>
        ) : (
          [...settlements]
            .sort((a, b) => b.date - a.date)
            .slice(0, 20)
            .map((s) => (
              <Card key={s.id}>
                <Row>
                  <Text style={{ flex: 1, color: p.ink }}>
                    {nameOf(s.payerId)} to {nameOf(s.receiverId)} · {s.status}
                  </Text>
                  <Text style={{ fontWeight: '700', color: p.ink }}>{formatMoney(s.amount, active.currency)}</Text>
                </Row>
              </Card>
            ))
        )}

        {isAdmin && (
          <>
            <SectionTitle>Export</SectionTitle>
            <Button label={Platform.OS === 'web' ? 'Copy report as CSV' : 'Export report as CSV'} onPress={exportCsv} variant="ghost" loading={busy} />
            {notice ? <Text style={{ color: p.primary, marginTop: 8 }}>{notice}</Text> : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
