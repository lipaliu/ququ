type StreamInput = {
  content: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
};

type StreamEvent = {
  type?: "delta" | "done" | "error";
  delta?: string;
  message?: string;
  riskCategory?: string;
};

export async function streamGuestChat(
  input: StreamInput,
  onDelta: (delta: string) => void,
) {
  const response = await fetch("/api/chat/guest-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message ?? "消息没有发送成功。");
  }
  if (!response.body) throw new Error("当前浏览器不支持流式回复。");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let riskCategory = "none";

  while (true) {
    const { value, done } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === "delta" && event.delta) onDelta(event.delta);
      if (event.type === "done") riskCategory = event.riskCategory ?? "none";
      if (event.type === "error") throw new Error(event.message ?? "回复生成失败。");
    }
    if (done) break;
  }

  return { riskCategory };
}
