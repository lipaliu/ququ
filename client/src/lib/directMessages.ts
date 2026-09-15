import type { Message } from "@/components/AIChatBox";

export function appendDirectMessage(messages: Message[], message: Message): Message[] {
  return [...messages, message];
}

export function appendPendingExchange(messages: Message[], content: string, requestId: string): Message[] {
  return [
    ...messages,
    { id: `user-${requestId}`, role: "user", content },
    { id: `assistant-${requestId}`, role: "assistant", content: "", status: "pending" },
  ];
}

export function appendAssistantDelta(messages: Message[], requestId: string, delta: string): Message[] {
  const id = `assistant-${requestId}`;
  return messages.map((message) => message.id === id
    ? { ...message, content: `${message.content}${delta}`, status: "streaming" }
    : message);
}

export function finishPendingAssistant(messages: Message[], requestId: string): Message[] {
  const id = `assistant-${requestId}`;
  return messages.map((message) => message.id === id
    ? { ...message, status: undefined }
    : message);
}

export function failPendingAssistant(messages: Message[], requestId: string, content: string): Message[] {
  const id = `assistant-${requestId}`;
  return messages.map((message) => message.id === id
    ? { ...message, content, status: "error" }
    : message);
}

export function rollbackDirectUserMessage(messages: Message[], content: string): Message[] {
  const index = messages.map((message) => message.role).lastIndexOf("user");
  return index >= 0 && messages[index]?.content === content ? messages.slice(0, index) : messages;
}

export function resetDirectMessages(): Message[] {
  return [];
}
