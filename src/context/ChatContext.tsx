import React, { createContext, useContext, useState, ReactNode } from 'react';

interface ChatContextValue {
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  return (
    <ChatContext.Provider value={{ activeConversationId, setActiveConversationId }}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = (): ChatContextValue => {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return ctx;
};

export default ChatContext;
