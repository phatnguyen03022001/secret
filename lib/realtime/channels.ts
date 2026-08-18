export const conversationChannel = (conversationId: string) => `private-chat-${conversationId}`;
export const conversationPresenceChannel = (conversationId: string) => `presence-chat-${conversationId}`;
export const userChannel = (userId: string) => `private-user-${userId}`;
export const adminGlobalChannel = () => "private-admin-global";
