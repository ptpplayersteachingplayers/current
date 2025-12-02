import React, { useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import {
  fetchConversationsForUser,
  subscribeToConversations,
} from '../api/chat';
import { Conversation, MessagesStackParamList } from '../types';
import { Card, LoadingScreen, EmptyState } from '../components';
import { colors, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<MessagesStackParamList, 'ChatList'>;

const formatTimestamp = (timestamp?: string) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleDateString();
};

const ChatListScreen: React.FC<Props> = ({ navigation }) => {
  const { user } = useAuth();
  const { setActiveConversationId } = useChat();
  const queryClient = useQueryClient();
  const userId = user ? String(user.id) : null;

  const {
    data: conversations = [],
    isLoading,
  } = useQuery({
    queryKey: ['conversations', userId],
    queryFn: () => fetchConversationsForUser(userId || ''),
    enabled: Boolean(userId),
  });

  useEffect(() => {
    if (!userId) return;
    const channel = subscribeToConversations(userId, (conversation) => {
      queryClient.setQueryData<Conversation[]>(['conversations', userId], (prev) => {
        const existing = prev || [];
        const filtered = existing.filter((c) => c.id !== conversation.id);
        return [conversation, ...filtered];
      });
    });

    return () => {
      channel.unsubscribe();
    };
  }, [queryClient, userId]);

  const handlePressConversation = (conversation: Conversation) => {
    setActiveConversationId(conversation.id);
    navigation.navigate('Chat', {
      conversationId: conversation.id,
      title: conversation.title || 'Conversation',
    });
  };

  if (!userId) {
    return (
      <EmptyState
        title="Sign in to message"
        message="Sign in to reach your trainers and the PTP support team."
        icon="🔒"
      />
    );
  }

  if (isLoading) {
    return <LoadingScreen message="Loading messages..." />;
  }

  if (conversations.length === 0) {
    return (
      <EmptyState
        title="No Messages Yet"
        message="Start a conversation with your trainer or PTP Support to see it here."
        icon="💬"
      />
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => handlePressConversation(item)}>
            <Card style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.title} numberOfLines={1}>
                  {item.title || 'Conversation'}
                </Text>
                <Text style={styles.timestamp}>{formatTimestamp(item.last_message_at)}</Text>
              </View>
              <Text style={styles.preview} numberOfLines={2}>
                {item.last_message_text || 'Tap to open chat'}
              </Text>
            </Card>
          </TouchableOpacity>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.offWhite,
  },
  listContent: {
    padding: spacing.lg,
  },
  separator: {
    height: spacing.md,
  },
  card: {
    padding: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
    flex: 1,
    marginRight: spacing.sm,
  },
  timestamp: {
    fontSize: typography.sizes.xs,
    color: colors.gray,
  },
  preview: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
  },
});

export default ChatListScreen;
