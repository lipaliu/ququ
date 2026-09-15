export type ContextMessage = { role: "user" | "assistant"; content: string };

// Explicit new cases establish a boundary. Short elliptical follow-ups retain
// the current case, including its earlier boundary, rather than all old cases.
function startsNewCase(content: string) {
  return /(?:换个|换一个|另外一个|另一个|新的|下一个)(?:话题|问题|案例)|(?:我[，,\s]*){1,2}(?:现在)?(?:有|还有)(?:一)?个(?:朋友|闺蜜|同事|客户|男朋友|女朋友|大哥)|我的(?:朋友|闺蜜|同事).{0,25}(?:准备|打算|最近)|(?:她|他)现在准备开始/.test(content);
}

export function relevantHistory<T extends ContextMessage>(input: string, history: T[]): T[] {
  if (startsNewCase(input)) return [];
  for (let index = history.length - 1; index >= 0; index--) {
    if (history[index].role === "user" && startsNewCase(history[index].content)) {
      return history.slice(index);
    }
  }
  return history;
}
