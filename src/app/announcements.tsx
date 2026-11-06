import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { BackButton, Button, Card, EmptyState, Field, Row, Screen, SectionTitle, Subtitle, Title, usePalette } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useHousehold } from '@/lib/household-context';
import { useCollection } from '@/lib/use-collection';
import { db } from '@/lib/firebase';
import type { Announcement } from '@/lib/models';

interface Comment {
  id: string;
  text: string;
  authorId: string;
  createdAt: number;
}

export default function AnnouncementsScreen() {
  const p = usePalette();
  const { user } = useAuth();
  const { active, members, isAdmin, logActivity } = useHousehold();
  const hid = active?.id ?? '';
  const { items: list } = useCollection<Announcement>(`households/${hid}/announcements`, [], !!hid);

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [openComments, setOpenComments] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [commentError, setCommentError] = useState('');

  async function run(key: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  const { items: comments } = useCollection<Comment>(
    `households/${hid}/announcements/${openComments || 'none'}/comments`,
    [],
    !!openComments,
  );
  const nameOf = (uid: string) => members.find((m) => m.id === uid)?.displayName ?? 'Member';

  if (!active) {
    return (
      <Screen>
        <Title>Announcements</Title>
        <Subtitle>Join or create a household first.</Subtitle>
      </Screen>
    );
  }

  async function publish() {
    if (!user) return;
    if (!title.trim()) {
      setFormError('Give the update a title first.');
      return;
    }
    if (!message.trim()) {
      setFormError('Write the message first.');
      return;
    }
    setFormError('');
    await addDoc(collection(db, 'households', hid, 'announcements'), {
      title: title.trim(),
      message: message.trim(),
      pinned: false,
      commentsEnabled: true,
      ackedBy: [],
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    });
    await logActivity('announcement', `${user.displayName ?? 'Someone'} posted: ${title.trim()}`);
    setTitle('');
    setMessage('');
  }

  async function ack(a: Announcement) {
    if (!user || a.ackedBy.includes(user.uid)) return;
    await updateDoc(doc(db, 'households', hid, 'announcements', a.id), {
      ackedBy: [...a.ackedBy, user.uid],
    });
  }

  async function sendComment() {
    if (!user || !openComments) return;
    if (!comment.trim()) {
      setCommentError('Write a reply first.');
      return;
    }
    setCommentError('');
    await addDoc(collection(db, 'households', hid, 'announcements', openComments, 'comments'), {
      text: comment.trim(),
      authorId: user.uid,
      createdAt: serverTimestamp(),
    });
    setComment('');
  }

  const sorted = [...list].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt - a.createdAt);

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 64 }}>
        <BackButton />
        <Title>Announcements</Title>
        <Subtitle>Important news, pinned where everyone sees it.</Subtitle>
        <Text style={{ height: 12 }} />

        {sorted.length === 0 ? (
          <EmptyState title="Nothing posted" hint="Admins can share news, rule changes and dates here." />
        ) : (
          sorted.map((a) => (
            <Card key={a.id} style={a.pinned ? { borderColor: p.accent } : undefined}>
              <Row>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', color: p.ink, fontSize: 16 }}>{a.title}</Text>
                  <Text style={{ fontSize: 13, color: p.muted }}>
                    {nameOf(a.createdBy)} · {a.ackedBy.length} read this
                  </Text>
                </View>
                {isAdmin ? (
                  <Button
                    label={a.pinned ? 'Unpin' : 'Pin'}
                    onPress={() =>
                      run(`pin-${a.id}`, () => updateDoc(doc(db, 'households', hid, 'announcements', a.id), { pinned: !a.pinned }) as Promise<void>)
                    }
                    variant="ghost"
                    size="sm"
                    loading={busy === `pin-${a.id}`}
                  />
                ) : null}
              </Row>
              <Text style={{ color: p.ink, marginTop: 6 }}>{a.message}</Text>
              <Text style={{ height: 8 }} />
              <Row gap={8}>
                {user && !a.ackedBy.includes(user.uid) ? (
                  <Button label="Mark as read" onPress={() => run(`ack-${a.id}`, () => ack(a))} size="sm" loading={busy === `ack-${a.id}`} />
                ) : null}
                {a.commentsEnabled ? (
                  <Button label={openComments === a.id ? 'Hide' : 'Discuss'} onPress={() => setOpenComments(openComments === a.id ? '' : a.id)} variant="ghost" size="sm" />
                ) : null}
              </Row>
              {openComments === a.id && (
                <View style={{ marginTop: 8 }}>
                  {comments.map((c) => (
                    <Text key={c.id} style={{ fontSize: 13, color: p.ink, marginBottom: 4 }}>
                      <Text style={{ fontWeight: '700' }}>{nameOf(c.authorId)}: </Text>
                      {c.text}
                    </Text>
                  ))}
                  {commentError && openComments === a.id ? (
                    <Text style={{ color: p.danger, fontSize: 13, marginBottom: 8 }}>{commentError}</Text>
                  ) : null}
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label=""
                        value={comment}
                        onChangeText={(v) => {
                          setCommentError('');
                          setComment(v);
                        }}
                        placeholder="Write a reply..."
                      />
                    </View>
                    <View style={{ paddingBottom: 10 }}>
                      <Button label="Send" onPress={() => run('comment', sendComment)} variant="ghost" loading={busy === 'comment'} />
                    </View>
                  </View>
                </View>
              )}
            </Card>
          ))
        )}

        {isAdmin && (
          <>
            <SectionTitle>Post an update</SectionTitle>
            <Card>
              <Field
                label="Title"
                value={title}
                onChangeText={(v) => {
                  setFormError('');
                  setTitle(v);
                }}
                placeholder="Water will be off on Sunday"
              />
              <Field
                label="Message"
                value={message}
                onChangeText={(v) => {
                  setFormError('');
                  setMessage(v);
                }}
                placeholder="Details, timing, what to do..."
                multiline
                numberOfLines={4}
              />
              {formError ? <Text style={{ color: p.danger, fontSize: 13, marginBottom: 8 }}>{formError}</Text> : null}
              <Button label="Publish" onPress={() => run('publish', publish)} loading={busy === 'publish'} />
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
