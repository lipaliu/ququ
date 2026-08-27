import type { Message } from "@/components/AIChatBox";

export function appendDirectMessage(messages: Message[], message: Message): Message[] {
  return [...messages, message];
}

export function rollbackDirectUserMessage(messages: Message[], content: string): Message[] {
  const index = messages.map((message) => message.role).lastIndexOf("user");
  return index >= 0 && messages[index]?.content === content ? messages.slice(0, index) : messages;
}

export function resetDirectMessages(): Message[] {
  return [];
}
