import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { Conversation, ConversationType, Message } from '../types';

// TODO: Replace with real project values or use Expo Constants / env variables.
export const SUPABASE_URL = 'https://YOUR-SUPABASE-PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'SUPABASE_ANON_KEY';
export const SUPPORT_USER_ID = 'support';

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
  },
});

export const fetchConversationsForUser = async (
  userId: string
): Promise<Conversation[]> => {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .contains('participant_ids', [userId])
    .order('last_message_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
};

export const subscribeToConversations = (
  userId: string,
  callback: (payload: Conversation) => void
): RealtimeChannel => {
  const channel = supabase
    .channel(`conversations-${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'conversations',
        filter: `participant_ids.cs.{${userId}}`,
      },
      (payload) => {
        if (payload.new) {
          callback(payload.new as Conversation);
        }
      }
    )
    .subscribe();

  return channel;
};

export const fetchMessages = async (conversationId: string): Promise<Message[]> => {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
};

export const subscribeToMessages = (
  conversationId: string,
  callback: (message: Message) => void
): RealtimeChannel => {
  const channel = supabase
    .channel(`messages-${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        if (payload.new) {
          callback(payload.new as Message);
        }
      }
    )
    .subscribe();

  return channel;
};

export const sendMessage = async (
  conversationId: string,
  senderId: string,
  text: string
): Promise<Message> => {
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, text })
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to send message');
  }

  // Update conversation last message metadata for ordering.
  await supabase
    .from('conversations')
    .update({ last_message_text: text, last_message_at: new Date().toISOString() })
    .eq('id', conversationId);

  return data as Message;
};

const upsertConversation = async (
  participantIds: string[],
  type: ConversationType,
  campId?: string | null,
  title?: string
): Promise<Conversation> => {
  const { data, error } = await supabase
    .from('conversations')
    .upsert(
      {
        participant_ids: participantIds,
        type,
        camp_id: campId ?? null,
        title,
      },
      { onConflict: 'participant_ids' }
    )
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Unable to create conversation');
  }

  return data as Conversation;
};

export const ensureSupportConversation = async (
  parentId: string,
  parentName?: string
): Promise<Conversation> => {
  // Try to find an existing support thread first.
  const { data } = await supabase
    .from('conversations')
    .select('*')
    .eq('type', 'parent-support')
    .contains('participant_ids', [parentId, SUPPORT_USER_ID])
    .maybeSingle();

  if (data) {
    return data as Conversation;
  }

  return upsertConversation(
    [parentId, SUPPORT_USER_ID],
    'parent-support',
    null,
    parentName ? `Support · ${parentName}` : 'PTP Support'
  );
};

export const ensureTrainerConversation = async (
  parentId: string,
  trainerId: string,
  campId?: string | null,
  title?: string
): Promise<Conversation> => {
  const { data } = await supabase
    .from('conversations')
    .select('*')
    .eq('type', 'parent-trainer')
    .contains('participant_ids', [parentId, trainerId])
    .maybeSingle();

  if (data) {
    return data as Conversation;
  }

  return upsertConversation(
    [parentId, trainerId],
    'parent-trainer',
    campId,
    title
  );
};
