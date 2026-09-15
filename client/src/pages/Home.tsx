import { useAuth } from "@/_core/hooks/useAuth";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { startLogin } from "@/const";
import {
  appendAssistantDelta,
  appendPendingExchange,
  failPendingAssistant,
  finishPendingAssistant,
  resetDirectMessages,
} from "@/lib/directMessages";
import { streamGuestChat } from "@/lib/streamingChat";
import { trpc } from "@/lib/trpc";
import {
  BookOpenText,
  Check,
  ChevronRight,
  FileText,
  HeartHandshake,
  Leaf,
  LockKeyhole,
  MessageCircleHeart,
  Plus,
  Quote,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from "lucide-react";
import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";

type WorkspaceTab = "chat" | "review" | "corpus";
type Scenario = "relationship" | "communication" | "decision" | "general";
type CorpusSource = {
  id: number;
  displayName: string;
  originalSha256: string;
  expectedLogicalLineCount: number;
  processedLineCount: number;
  status: string;
};
type ReviewItem = {
  id: number;
  category: string;
  title: string;
  content: string;
  evidenceJson: unknown;
  status: string;
};
type CorpusSection = {
  id: number;
  sourceId: number;
  title: string;
  startLine: number;
  endLine: number;
};
type CorpusOverview = {
  sources: CorpusSource[];
  reviews: ReviewItem[];
  sections: CorpusSection[];
};

const SCENARIOS: Array<{ key: Exclude<Scenario, "general">; eyebrow: string; title: string; prompt: string }> = [
  {
    key: "relationship",
    eyebrow: "亲密关系",
    title: "这段关系，还要不要继续？",
    prompt: "我想认真聊聊这段关系。请先帮我把事实、感受和我真正担心的事分开。",
  },
  {
    key: "communication",
    eyebrow: "沟通困惑",
    title: "话说出口，为什么变了样？",
    prompt: "我有一段沟通卡住了。请先问我一两个关键问题，再帮我梳理怎么表达。",
  },
  {
    key: "decision",
    eyebrow: "情感决策",
    title: "不想仓促地做选择",
    prompt: "我在一个情感选择前犹豫。请不要替我下结论，帮我拆分现实条件、需求和可验证的行动。",
  },
];

function formatNumber(value: number | string | null | undefined) {
  return new Intl.NumberFormat("zh-CN").format(Number(value ?? 0));
}

function reviewStatusText(status: string) {
  const labels: Record<string, string> = {
    approved: "已采纳",
    rejected: "不采用",
    needs_revision: "待调整",
    pending: "待确认",
  };
  return labels[status] ?? "待确认";
}

function parseEvidence(value: unknown) {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Array<Record<string, unknown>>;
    } catch {
      return [];
    }
  }
  return [];
}

function RestrictedPanel({ onLogin }: { onLogin: () => void }) {
  return (
    <Card className="mx-auto max-w-2xl border-border/80 bg-card/85 shadow-sm">
      <CardContent className="flex flex-col items-center px-7 py-14 text-center">
        <LockKeyhole className="size-8 text-primary/60" />
        <h2 className="mt-4 font-display text-2xl">这是审核人的私密工作区。</h2>
        <p className="mt-3 max-w-lg text-sm leading-7 text-muted-foreground">
          语料进度、原文阅读和表达原则审核只向项目管理员开放，以保护授权语料和审核过程。登录后，如果你拥有审核权限，相关内容会自动显示。
        </p>
        <Button className="mt-6 rounded-full px-5" onClick={onLogin}>登录继续</Button>
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [tab, setTab] = useState<WorkspaceTab>("chat");
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [guestConversationTitle, setGuestConversationTitle] = useState("新的对话");
  const [selectedEvidence, setSelectedEvidence] = useState<{ sourceId: number; startLine: number; endLine: number } | null>(null);
  const [directMessages, setDirectMessages] = useState<Message[]>([]);
  const isReviewer = user?.role === "admin";
  const utils = trpc.useUtils();
  const overview = trpc.corpus.overview.useQuery(undefined, { enabled: isAuthenticated && isReviewer });
  const conversationList = trpc.chat.listConversations.useQuery(undefined, { enabled: isAuthenticated });
  const messageInput = useMemo(() => ({ conversationId: selectedConversationId ?? 0 }), [selectedConversationId]);
  const messagesQuery = trpc.chat.messages.useQuery(messageInput, { enabled: isAuthenticated && selectedConversationId !== null });
  const evidenceInput = useMemo(
    () => selectedEvidence ?? { sourceId: 0, startLine: 1, endLine: 1 },
    [selectedEvidence],
  );
  const sourceLines = trpc.corpus.sourceLines.useQuery(evidenceInput, {
    enabled: Boolean(selectedEvidence) && isReviewer,
  });

  const createConversation = trpc.chat.createConversation.useMutation({
    onError: (error) => toast.error(error.message),
  });
  const sendMessage = trpc.chat.send.useMutation();
  const updateReview = trpc.corpus.updateReview.useMutation({
    onSuccess: () => utils.corpus.overview.invalidate(),
    onError: (error) => toast.error(error.message),
  });
  const updateSectionReview = trpc.corpus.updateSectionReview.useMutation({
    onSuccess: () => utils.corpus.overview.invalidate(),
    onError: (error) => toast.error(error.message),
  });

  const startGuestStream = (
    content: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
  ) => {
    const requestId = crypto.randomUUID();
    setDirectMessages((previous) => appendPendingExchange(previous, content, requestId));
    void streamGuestChat({ content, history }, (delta) => {
      setDirectMessages((previous) => appendAssistantDelta(previous, requestId, delta));
    }).then(() => {
      setDirectMessages((previous) => finishPendingAssistant(previous, requestId));
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "回复生成失败，请再发一次。";
      setDirectMessages((previous) => failPendingAssistant(previous, requestId, message));
      toast.error(message);
    });
  };

  const openConversation = (scenario: Scenario, title: string, firstMessage?: string) => {
    if (!isAuthenticated) {
      setDirectMessages(resetDirectMessages());
      setGuestConversationTitle(title);
      setSelectedConversationId(-1);
      setTab("chat");
      if (firstMessage) startGuestStream(firstMessage, []);
      return;
    }
    createConversation.mutate(
      { title, scenario },
      { 
        onSuccess: (conversation) => {
          utils.chat.listConversations.setData(undefined, (previous) => [conversation, ...(previous ?? [])]);
          setDirectMessages(resetDirectMessages());
          setSelectedConversationId(conversation.id);
          setTab("chat");
          if (firstMessage) handleSend(firstMessage, conversation.id);
        },
      },
    );
  };

  const handleSend = (content: string, conversationId = selectedConversationId) => {
    if (!conversationId) return;
    if (!isAuthenticated || conversationId < 1) {
      const history = directMessages
        .filter((message): message is Message & { role: "user" | "assistant" } => (
          message.role !== "system"
          && Boolean(message.content.trim())
          && !message.status
        ))
        .slice(-10)
        .map(({ role, content: messageContent }) => ({ role, content: messageContent }));
      startGuestStream(content, history);
      return;
    }
    const requestId = crypto.randomUUID();
    setDirectMessages((previous) => appendPendingExchange(previous, content, requestId));
    sendMessage.mutate({ conversationId, content }, {
      onSuccess: (result) => {
        setDirectMessages((previous) => finishPendingAssistant(
          appendAssistantDelta(previous, requestId, result.message.content),
          requestId,
        ));
        void utils.chat.listConversations.invalidate();
      },
      onError: (error) => {
        setDirectMessages((previous) => failPendingAssistant(previous, requestId, error.message));
        toast.error(error.message);
      },
    });
  };

  if (loading) {
    return <div className="min-h-screen p-6"><Skeleton className="mx-auto h-160 max-w-7xl rounded-[2rem]" /></div>;
  }

  const chatMessages: Message[] = [
    ...(messagesQuery.data ?? []).map((message) => ({ role: message.role, content: message.content })),
    ...directMessages,
  ];
  const selectedConversation = (conversationList.data ?? []).find((item) => item.id === selectedConversationId);

  return (
    <div className="min-h-screen pb-12">
      <header className="container flex items-center justify-between py-5">
        <button onClick={() => setTab("chat")} className="flex items-center gap-3 text-left" aria-label="返回对话首页">
          <span className="flex size-10 items-center justify-center rounded-full border border-primary/20 bg-primary text-lg text-primary-foreground font-display">Q</span>
          <span>
            <span className="block text-lg font-semibold tracking-[0.16em]">曲曲分身</span>
            <span className="block text-[10px] tracking-[0.22em] text-muted-foreground">RELATIONSHIP JUDGMENT</span>
          </span>
        </button>
        {isAuthenticated ? (
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">你好，{user?.name ?? "朋友"}</span>
            <Button variant="ghost" className="text-xs" onClick={() => logout()}>退出</Button>
          </div>
        ) : (
          <Button className="rounded-full px-5" onClick={() => startLogin()}>
            <LockKeyhole className="mr-2 size-3.5" />登录保存记录
          </Button>
        )}
      </header>

      <main className="container space-y-7">
        <WorkspaceNav tab={tab} setTab={setTab} isReviewer={isReviewer} />
        {tab !== "chat" && <Hero />}

        {tab === "chat" && (
          <ChatWorkspace
            isAuthenticated={isAuthenticated}
            conversations={conversationList.data ?? []}
            conversationsLoading={conversationList.isLoading}
            selectedConversationId={selectedConversationId}
            selectedTitle={selectedConversation?.title ?? guestConversationTitle}
            messages={chatMessages}
            messagesLoading={messagesQuery.isLoading}
            creating={createConversation.isPending}
            onCreate={openConversation}
            onSelect={(conversationId) => {
              setDirectMessages(resetDirectMessages());
              setSelectedConversationId(conversationId);
            }}
            onSend={(content) => handleSend(content)}
          />
        )}

        {tab === "review" && (
          isReviewer ? (
            <ReviewWorkspace
              overview={overview.data}
              loading={overview.isLoading}
              updating={updateReview.isPending || updateSectionReview.isPending}
              onReview={(id, status) => updateReview.mutate({ id, status })}
              onSectionReview={(id, status) => updateSectionReview.mutate({ id, status })}
              onViewEvidence={(sourceId, startLine, endLine) => {
                setSelectedEvidence({ sourceId, startLine, endLine });
                setTab("corpus");
              }}
            />
          ) : <RestrictedPanel onLogin={startLogin} />
        )}

        {tab === "corpus" && (
          isReviewer ? (
            <div className="space-y-6">
              <CorpusNavigator sources={overview.data?.sources ?? []} onSelectEvidence={setSelectedEvidence} />
              <CorpusWorkspace
                overview={overview.data}
                loading={overview.isLoading}
                selectedEvidence={selectedEvidence}
                lines={sourceLines.data ?? []}
                linesLoading={sourceLines.isLoading}
                onSelectEvidence={setSelectedEvidence}
              />
            </div>
          ) : <RestrictedPanel onLogin={startLogin} />
        )}
      </main>
    </div>
  );
}

function Hero() {
  return (
    <section className="paper-grain relative overflow-hidden rounded-[2rem] border border-border/70 px-6 py-9 shadow-[0_18px_55px_-35px_rgba(69,39,26,0.38)] sm:px-10 lg:px-14">
      <div className="absolute -right-20 -top-20 size-64 rounded-full border border-primary/10" />
      <div className="relative grid gap-8 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
        <div>
          <Badge variant="outline" className="mb-5 rounded-full border-primary/25 bg-background/60 px-3 py-1 text-primary">
            <Sparkles className="mr-1.5 size-3.5" />曲曲分身 · 关系判断与行动建议
          </Badge>
          <h1 className="font-display max-w-3xl text-4xl leading-[1.14] tracking-tight sm:text-5xl">
            把情绪放下来，<br /><i className="font-normal text-primary">把关系看清楚。</i>
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
            不在情绪里绕圈，也不拿空话安慰你。这里专门聊亲密关系、沟通困惑和情感决策：先看清问题，再把下一步怎么做说具体。
          </p>
        </div>
        <div className="rounded-2xl border border-primary/15 bg-background/65 p-5 text-sm leading-6 text-muted-foreground backdrop-blur-sm">
          <div className="mb-3 flex items-center gap-2 font-medium text-foreground"><ShieldCheck className="size-4 text-primary" />使用边界</div>
          <p>这里给的是关系判断与行动建议。遇到自伤、他伤、暴力控制或即时危险时，系统会先切换到安全求助指引；医疗和法律问题也会提醒你咨询相应专业人士。</p>
        </div>
      </div>
    </section>
  );
}

function WorkspaceNav({ tab, setTab, isReviewer }: { tab: WorkspaceTab; setTab: (tab: WorkspaceTab) => void; isReviewer: boolean }) {
  const entries = [
    ["chat", "对话", MessageCircleHeart],
    ["review", "审核台", ShieldCheck],
    ["corpus", "语料证据", BookOpenText],
  ] as const;
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border/80" aria-label="工作台导航">
      {entries.map(([key, label, Icon]) => (
        <button key={key} onClick={() => setTab(key)} className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm transition-colors ${tab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          <Icon className="size-4" />{label}{key !== "chat" && !isReviewer && <LockKeyhole className="size-3" />}
        </button>
      ))}
    </nav>
  );
}

function ChatWorkspace({ isAuthenticated, conversations, conversationsLoading, selectedConversationId, selectedTitle, messages, messagesLoading, creating, onCreate, onSelect, onSend }: {
  isAuthenticated: boolean;
  conversations: Array<{ id: number; title: string; scenario: Scenario }>;
  conversationsLoading: boolean;
  selectedConversationId: number | null;
  selectedTitle: string | undefined;
  messages: Message[];
  messagesLoading: boolean;
  creating: boolean;
  onCreate: (scenario: Scenario, title: string, firstMessage?: string) => void;
  onSelect: (id: number) => void;
  onSend: (content: string) => void;
}) {
  return (
    <section className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="order-2 space-y-4 lg:order-1">
        <div className="rounded-2xl border border-border/70 bg-card/75 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between"><span className="text-sm font-semibold">新的话题</span><Plus className="size-4 text-primary" /></div>
          <button disabled={creating} onClick={() => onCreate("general", "新的对话")} className="flex w-full items-center justify-between rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-50"><span>从空白开始</span><ChevronRight className="size-4" /></button>
          <div className="mt-4 space-y-2">
            {SCENARIOS.map((scenario) => <button disabled={creating} key={scenario.key} onClick={() => onCreate(scenario.key, scenario.title, scenario.prompt)} className="w-full rounded-xl border border-border/70 px-3 py-2.5 text-left transition-colors hover:border-primary/35 hover:bg-accent/45 disabled:opacity-50"><span className="block text-[10px] tracking-[0.14em] text-primary">{scenario.eyebrow}</span><span className="mt-1 block text-xs leading-5">{scenario.title}</span></button>)}
          </div>
        </div>
        {isAuthenticated && <div className="rounded-2xl border border-border/70 bg-card/75 p-4 shadow-sm"><div className="mb-3 text-sm font-semibold">我的对话</div><div className="space-y-1">{conversationsLoading ? <Skeleton className="h-12 w-full" /> : conversations.length === 0 ? <p className="py-2 text-xs leading-5 text-muted-foreground">从一个具体场景开始。你的对话仅保存在当前账户下。</p> : conversations.map((item) => <button key={item.id} onClick={() => onSelect(item.id)} className={`w-full rounded-lg px-3 py-2 text-left text-xs transition-colors ${item.id === selectedConversationId ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}><span className="block truncate">{item.title}</span><span className="mt-1 block text-[10px] text-muted-foreground">{item.scenario === "relationship" ? "亲密关系" : item.scenario === "communication" ? "沟通困惑" : item.scenario === "decision" ? "情感决策" : "自由对话"}</span></button>)}</div></div>}
      </aside>
      <div className="order-1 min-w-0 rounded-[1.5rem] border border-border/80 bg-card/80 p-2 shadow-[0_20px_50px_-36px_rgba(61,33,23,0.55)] lg:order-2">
        {selectedConversationId ? <><div className="flex items-center justify-between border-b border-border/70 px-4 py-3"><div><p className="text-sm font-semibold">{selectedTitle ?? "对话中"}</p><p className="mt-0.5 text-[10px] text-muted-foreground">曲曲分身 · 先判断，再行动</p></div><Leaf className="size-5 text-primary/70" /></div><AIChatBox messages={messages} onSendMessage={onSend} isLoading={messagesLoading} height="620px" placeholder="把最卡你的那件事直接说出来…" emptyStateMessage="你直接说，别绕。" suggestedPrompts={SCENARIOS.map((item) => item.prompt)} /></> : <EmptyChat isAuthenticated={isAuthenticated} creating={creating} onCreate={onCreate} />}
      </div>
    </section>
  );
}

function EmptyChat({ isAuthenticated, creating, onCreate }: {
  isAuthenticated: boolean;
  creating: boolean;
  onCreate: (scenario: Scenario, title: string, firstMessage?: string) => void;
}) {
  const [starterMessage, setStarterMessage] = useState("");

  const startConversation = (event: FormEvent) => {
    event.preventDefault();
    const message = starterMessage.trim();
    if (!message || creating) return;
    onCreate("general", "新的对话", message);
  };

  const handleStarterKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) startConversation(event);
  };

  return (
    <div className="flex min-h-[620px] flex-col p-6 sm:p-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <HeartHandshake className="size-5" />
          </span>
          <div>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-primary">从这里开始</p>
            <p className="mt-1 text-xs text-muted-foreground">不用整理好，也不用先选分类。</p>
          </div>
        </div>

        <h1 className="mt-5 font-display text-3xl leading-tight sm:text-4xl">你现在最想解决哪件事？</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">直接把发生了什么告诉我。先说事实，再说你最卡住的地方。</p>

        <form
          onSubmit={startConversation}
          className="mt-6 rounded-2xl border-2 border-primary/40 bg-background p-3 shadow-[0_18px_45px_-30px_rgba(61,33,23,0.7)] transition-colors focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10"
        >
          <label htmlFor="starter-message" className="block px-2 pt-1 text-xs font-semibold text-foreground">
            就在这里输入
          </label>
          <Textarea
            id="starter-message"
            value={starterMessage}
            onChange={(event) => setStarterMessage(event.target.value)}
            onKeyDown={handleStarterKeyDown}
            placeholder="比如：他已经三天没回我，我不知道该继续等，还是直接问清楚……"
            aria-describedby="starter-message-hint"
            className="mt-2 min-h-28 resize-none border-0 bg-transparent px-2 text-base leading-7 shadow-none focus-visible:ring-0"
          />
          <div className="flex flex-col gap-3 border-t border-border/70 px-2 pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p id="starter-message-hint" className="text-[11px] text-muted-foreground">按 Enter 开始聊 · Shift + Enter 换行</p>
            <Button type="submit" disabled={!starterMessage.trim() || creating} className="rounded-full px-5">
              开始聊<ChevronRight className="ml-1 size-4" />
            </Button>
          </div>
        </form>

        {!isAuthenticated && <p className="mt-3 text-center text-[11px] text-muted-foreground">游客模式 · 当前对话只保留在本页，登录后可保存历史记录。</p>}

        <div className="mt-8 border-t border-border/70 pt-6">
          <p className="mb-3 text-xs text-muted-foreground">不想从头说？也可以直接选一个常见问题：</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {SCENARIOS.map((scenario) => (
              <button
                key={scenario.key}
                disabled={creating}
                onClick={() => onCreate(scenario.key, scenario.title, scenario.prompt)}
                className="group rounded-2xl border border-border bg-background p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md disabled:opacity-50"
              >
                <span className="text-[10px] tracking-[0.16em] text-primary">{scenario.eyebrow}</span>
                <span className="mt-2 block text-sm leading-6">{scenario.title}</span>
                <ChevronRight className="mt-3 size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewWorkspace({ overview, loading, updating, onReview, onSectionReview, onViewEvidence }: {
  overview: CorpusOverview | undefined;
  loading: boolean;
  updating: boolean;
  onReview: (id: number, status: "approved" | "needs_revision" | "rejected") => void;
  onSectionReview: (id: number, status: "approved" | "rejected") => void;
  onViewEvidence: (sourceId: number, startLine: number, endLine: number) => void;
}) {
  const reviews = overview?.reviews ?? [];
  const pendingSections = overview?.sections ?? [];
  return <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]"><Card className="border-border/80 bg-card/85 shadow-sm"><CardContent className="p-6"><div className="flex items-start justify-between"><div><p className="text-xs tracking-[0.16em] text-primary">审核优先级</p><h2 className="mt-2 font-display text-2xl">先定义什么可以成为分身。</h2></div><Quote className="size-6 text-primary/45" /></div><p className="mt-4 text-sm leading-7 text-muted-foreground">候选不会自动成为人格规则。只有被采纳的原则，才会在后续对话中作为受约束的参考依据。</p><div className="mt-6 grid grid-cols-3 gap-2">{["待确认", "已采纳", "待调整"].map((label) => <div key={label} className="rounded-xl bg-muted/70 px-3 py-3 text-center"><span className="block text-xl font-semibold text-primary">{reviews.filter((item) => reviewStatusText(item.status) === label).length}</span><span className="mt-1 block text-[10px] text-muted-foreground">{label}</span></div>)}</div><div className="mt-6 border-t border-border/70 pt-5"><p className="mb-3 text-xs font-semibold">自动检测到的章节结构</p><div className="space-y-2">{pendingSections.slice(0, 8).map((section) => <div key={section.id} className="rounded-xl border border-border/70 p-3"><p className="line-clamp-1 text-xs">{section.title}</p><p className="mt-1 text-[10px] text-muted-foreground">第 {section.startLine}–{section.endLine} 行 · 自动识别</p><div className="mt-2 flex gap-2"><Button size="sm" className="h-7 text-[10px]" disabled={updating} onClick={() => onSectionReview(section.id, "approved")}>确认</Button><Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={updating} onClick={() => onSectionReview(section.id, "rejected")}>不作为章节</Button></div></div>)}</div></div></CardContent></Card><div className="space-y-4">{loading ? Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-44 rounded-2xl" />) : reviews.map((item) => { const firstEvidence = parseEvidence(item.evidenceJson)[0]; const sourceId = typeof firstEvidence?.sourceId === "number" ? firstEvidence.sourceId : undefined; const startLine = typeof firstEvidence?.lineStart === "number" ? firstEvidence.lineStart : undefined; const endLine = typeof firstEvidence?.lineEnd === "number" ? firstEvidence.lineEnd : undefined; return <Card key={item.id} className="border-border/80 bg-card/85 shadow-sm"><CardContent className="p-5"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className="rounded-full text-[10px]">{item.category}</Badge><Badge className={`rounded-full text-[10px] ${item.status === "approved" ? "bg-primary" : item.status === "rejected" ? "bg-muted text-muted-foreground" : "bg-accent text-accent-foreground"}`}>{reviewStatusText(item.status)}</Badge></div><h3 className="mt-3 text-base font-semibold">{item.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{item.content}</p><div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3"><button disabled={!sourceId || !startLine || !endLine} onClick={() => sourceId && startLine && endLine && onViewEvidence(sourceId, startLine, endLine)} className="text-xs text-primary disabled:text-muted-foreground">{sourceId ? `查看原文 · 第 ${startLine}–${endLine} 行` : "产品安全约束"}</button><div className="flex gap-2"><Button size="sm" variant="outline" className="h-8 text-xs" disabled={updating} onClick={() => onReview(item.id, "needs_revision")}>待调整</Button><Button size="sm" className="h-8 text-xs" disabled={updating} onClick={() => onReview(item.id, "approved")}><Check className="mr-1 size-3" />采纳</Button><Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" disabled={updating} onClick={() => onReview(item.id, "rejected")}>不采用</Button></div></div></CardContent></Card>; })}</div></section>;
}

function CorpusNavigator({ sources, onSelectEvidence }: { sources: CorpusSource[]; onSelectEvidence: (value: { sourceId: number; startLine: number; endLine: number }) => void }) {
  return <section className="grid gap-4 lg:grid-cols-2">{sources.map((source) => <SourceBranch key={source.id} source={source} onSelectEvidence={onSelectEvidence} />)}</section>;
}

function SourceBranch({ source, onSelectEvidence }: { source: CorpusSource; onSelectEvidence: (value: { sourceId: number; startLine: number; endLine: number }) => void }) {
  const [sectionId, setSectionId] = useState<number | null>(null);
  const sectionList = trpc.corpus.sections.useQuery({ sourceId: source.id });
  const sectionInput = useMemo(() => ({ sectionId: sectionId ?? 0 }), [sectionId]);
  const sectionContent = trpc.corpus.sectionContent.useQuery(sectionInput, { enabled: sectionId !== null });
  const sections = sectionList.data?.filter((section) => section.sectionKind !== "source_root") ?? [];
  return <Card className="border-border/80 bg-card/85 shadow-sm"><CardContent className="p-5"><div className="flex items-center justify-between"><div><p className="text-[10px] tracking-[0.16em] text-primary">章节与段落导航</p><h2 className="mt-1 text-sm font-semibold">{source.displayName}</h2></div><BookOpenText className="size-5 text-primary/65" /></div><div className="mt-4 flex max-h-44 flex-wrap gap-2 overflow-y-auto pr-1">{sectionList.isLoading ? <Skeleton className="h-8 w-32" /> : sections.length ? sections.map((section) => <button key={section.id} onClick={() => { setSectionId(section.id); onSelectEvidence({ sourceId: source.id, startLine: section.startLine, endLine: Math.min(section.endLine, section.startLine + 80) }); }} className={`rounded-full border px-3 py-1.5 text-left text-[11px] transition-colors ${sectionId === section.id ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/40 hover:bg-accent/40"}`}>{section.title}<span className="ml-1.5 opacity-65">{section.startLine}–{section.endLine}</span></button>) : <p className="text-xs text-muted-foreground">尚无独立的自动章节；可从下方按行阅读。</p>}</div>{sectionId && <div className="mt-4 border-t border-border/70 pt-4"><p className="text-xs font-semibold">本章段落</p><div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto pr-1">{sectionContent.isLoading ? <Skeleton className="h-8 w-28" /> : (sectionContent.data?.passages ?? []).map((passage) => <button key={passage.id} onClick={() => onSelectEvidence({ sourceId: source.id, startLine: passage.startLine, endLine: passage.endLine })} className="rounded-lg border border-border/80 bg-background px-2.5 py-1.5 text-left text-[10px] hover:border-primary/35 hover:bg-accent/35">段落 {passage.passageNumber} · {passage.startLine}–{passage.endLine}</button>)}</div></div>}</CardContent></Card>;
}

function CorpusWorkspace({ overview, loading, selectedEvidence, lines, linesLoading, onSelectEvidence }: {
  overview: CorpusOverview | undefined;
  loading: boolean;
  selectedEvidence: { sourceId: number; startLine: number; endLine: number } | null;
  lines: Array<{ id: number; lineNumber: number; lineText: string; isBlank: boolean }>;
  linesLoading: boolean;
  onSelectEvidence: (value: { sourceId: number; startLine: number; endLine: number }) => void;
}) {
  return <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]"><div className="space-y-4">{loading ? <Skeleton className="h-72 rounded-2xl" /> : (overview?.sources ?? []).map((source) => { const complete = Number(source.processedLineCount) === Number(source.expectedLogicalLineCount); return <Card key={source.id} className="overflow-hidden border-border/80 bg-card/85 shadow-sm"><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><FileText className="mt-0.5 size-5 shrink-0 text-primary" /><Badge variant="outline" className="rounded-full text-[10px]">{source.status === "completed" ? "已完成" : "处理中"}</Badge></div><h3 className="mt-3 text-sm font-semibold leading-6">{source.displayName}</h3><p className="mt-1 text-[11px] text-muted-foreground">SHA-256：{source.originalSha256.slice(0, 18)}…</p><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.min(100, (Number(source.processedLineCount) / Number(source.expectedLogicalLineCount)) * 100)}%` }} /></div><div className="mt-3 flex items-center justify-between text-xs"><span><b className="font-semibold text-foreground">{formatNumber(source.processedLineCount)}</b> / {formatNumber(source.expectedLogicalLineCount)} 行</span><span className={complete ? "text-primary" : "text-muted-foreground"}>{complete ? "逐行核验通过" : "处理中"}</span></div><button onClick={() => onSelectEvidence({ sourceId: source.id, startLine: 1, endLine: 36 })} className="mt-4 text-xs text-primary">从第 1 行开始阅读 <ChevronRight className="inline size-3" /></button></CardContent></Card>; })}<Card className="border-primary/15 bg-primary/[0.035]"><CardContent className="p-5"><div className="flex gap-3"><Waypoints className="mt-0.5 size-5 shrink-0 text-primary" /><div><p className="text-sm font-semibold">可核查处理说明</p><p className="mt-2 text-xs leading-6 text-muted-foreground">原文按文件顺序逐行保存，并记录源文件校验值、每行哈希、章节范围、段落与语义单元。自动章节检测保留为待审核状态，不把检测结果当作原始标题。</p></div></div></CardContent></Card></div><Card className="min-w-0 border-border/80 bg-card/85 shadow-sm"><CardContent className="p-0"><div className="flex items-center justify-between border-b border-border/70 px-6 py-5"><div><p className="text-xs tracking-[0.16em] text-primary">原文阅读器</p><h2 className="mt-1 font-display text-2xl">{selectedEvidence ? `第 ${selectedEvidence.startLine}–${selectedEvidence.endLine} 行` : "选择一段原文"}</h2></div><BookOpenText className="size-5 text-primary/65" /></div>{selectedEvidence ? <div className="p-4 sm:p-6">{linesLoading ? <Skeleton className="h-80 w-full" /> : lines.length ? <ol className="max-h-[560px] space-y-0 overflow-y-auto rounded-xl border border-border/70 bg-background/55 py-3">{lines.map((line) => <li key={line.id} className="grid grid-cols-[4rem_1fr] gap-3 px-4 py-1.5 text-sm leading-6"><span className="select-none text-right font-mono text-[10px] leading-6 text-muted-foreground">{line.lineNumber}</span><span className="whitespace-pre-wrap break-words">{line.lineText || "　"}</span></li>)}</ol> : <p className="py-16 text-center text-sm text-muted-foreground">未找到该行范围的原文。</p>}<p className="mt-4 text-xs leading-6 text-muted-foreground">阅读器保留源文件行号；每次查看范围不超过 250 行。审核台中的候选均可回跳到对应证据。</p></div> : <div className="flex min-h-[390px] items-center justify-center p-8 text-center"><div><FileText className="mx-auto size-8 text-primary/35" /><p className="mt-4 text-sm text-muted-foreground">请先从左侧选取一份语料，或从审核候选跳转至对应行号。</p></div></div>}</CardContent></Card></section>;
}
