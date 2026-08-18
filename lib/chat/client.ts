"use client";

export interface ReplyPreview {
  messageId: string;
  senderId: string;
  senderName: string;
  type: "text" | "image" | "deleted";
  content: string;
}

export interface MessageSendPayload {
  roomId: string;
  text: string;
  imageUrl: string | null;
  imageMode: "normal" | "once";
  clientMessageId: string;
  replyToId?: string | null;
}

async function requestMessage(payload: MessageSendPayload) {
  return fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function sendMessageIdempotently(payload: MessageSendPayload) {
  let response: Response;

  try {
    response = await requestMessage(payload);
  } catch {
    response = await requestMessage(payload);
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || "Gửi tin nhắn thất bại");
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  return data;
}
