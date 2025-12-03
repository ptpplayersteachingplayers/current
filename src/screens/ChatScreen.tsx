import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import {
  fetchMessages,
  subscribeToMessages,
  sendMessage,
} from '../api/chat';
import { Message, MessagesStackParamList } from '../types';
import { colors, spacing, typography, borderRadius } from '../theme';
import { PrimaryButton, LoadingScreen } from '../components';

type Props = NativeStackScreenProps<MessagesStackParamList, 'Chat'>;

const ChatScreen: React.FC<Props> = ({ route, navigation }) => {
  const { conversationId, title } = route.params;
  const { user } = useAuth();
  const { setActiveConversationId } = useChat();
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const [localMessages, setLocalMessages] = useState<Message[]>([]);

  const userId = useMemo(() => (user ? String(user.id) : ''), [user]);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => fetchMessages(conversationId),
  });

  useEffect(() => {
    setLocalMessages(messages);
  }, [messages]);

  useEffect(() => {
    setActiveConversationId(conversationId);
    if (title) {
      navigation.setOptions({ title });
    }
    const channel = subscribeToMessages(conversationId, (message) => {
      queryClient.setQueryData<Message[]>(['messages', conversationId], (prev) => {
        const existing = prev || [];
        return [...existing, message];
      });
    });

    return () => {
      channel.unsubscribe();
      setActiveConversationId(null);
    };
  }, [conversationId, navigation, queryClient, setActiveConversationId, title]);

  const handleSend = async () => {
    if (!input.trim() || !userId) return;
    const optimisticMessage: Message = {
      id: `temp-${Date.now()}`,
      conversation_id: conversationId,
      sender_id: userId,
      text: input,
      created_at: new Date().toISOString(),
      optimistic: true,
    };

    setLocalMessages((prev) => [...prev, optimisticMessage]);
    setInput('');

    try {
      const saved = await sendMessage(conversationId, userId, optimisticMessage.text);
      setLocalMessages((prev) =>
        prev.map((msg) => (msg.id === optimisticMessage.id ? saved : msg))
      );
    } catch (err) {
      setLocalMessages((prev) => prev.filter((msg) => msg.id !== optimisticMessage.id));
      console.error('Failed to send message', err);
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMine = item.sender_id === userId;
    return (
      <View
        style={[
          styles.messageBubble,
          isMine ? styles.messageMine : styles.messageTheirs,
        ]}
      >
        <Text style={isMine ? styles.messageTextMine : styles.messageText}>{item.text}</Text>
        <Text style={styles.messageMeta}>
          {new Date(item.created_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
          {item.optimistic ? ' • sending' : ''}
        </Text>
      </View>
    );
  };

  if (isLoading && localMessages.length === 0) {
    return <LoadingScreen message="Loading chat..." />;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        data={localMessages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          isLoading ? null : (
            <Text style={styles.emptyText}>Start the conversation with a hello</Text>
          )
        }
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Type a message"
          placeholderTextColor={colors.gray}
          value={input}
          onChangeText={setInput}
        />
        <PrimaryButton
          title="Send"
          onPress={handleSend}
          style={styles.sendButton}
          disabled={!input.trim()}
        />
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.offWhite,
  },
  listContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  messageBubble: {
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
    maxWidth: '80%',
  },
  messageMine: {
    backgroundColor: colors.primary,
    alignSelf: 'flex-end',
  },
  messageTheirs: {
    backgroundColor: colors.white,
    alignSelf: 'flex-start',
  },
  messageText: {
    color: colors.ink,
    fontSize: typography.sizes.md,
  },
  messageTextMine: {
    color: colors.ink,
    fontSize: typography.sizes.md,
  },
  messageMeta: {
    marginTop: spacing.xs,
    fontSize: typography.sizes.xs,
    color: colors.gray,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.gray,
    marginTop: spacing.lg,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
  },
  input: {
    flex: 1,
    backgroundColor: colors.offWhite,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.sizes.md,
    marginRight: spacing.sm,
  },
  sendButton: {
    paddingHorizontal: spacing.md,
  },
});

export default ChatScreen;
