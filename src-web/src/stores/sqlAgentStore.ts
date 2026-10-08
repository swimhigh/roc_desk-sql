import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { sqlAgentService } from "../services/sqlAgentService";
import { useAiProviderStore } from "./aiProviderStore";
import { formatError } from "../utils/error";
import type {
  CodingAssistantNoteEvent,
  CodingQuestionRequestEvent,
  CodingTodoUpdateEvent,
  CodingTokenUsageEvent,
  CodingToolCallEvent,
  SqlAgentConfirmRequestEvent,
  SqlAgentHistorySummary,
  SqlAgentSessionInfo,
  ChatAttachment,
} from "../types/bindings";

/** `sql::agent` 的前端状态，原样搬自宿主 `stores/sqlAgentStore.ts`——结构上是
 * `roc_desk-workspace`'s `codingStore.ts` 的简化版：这个独立版每个窗口进程
 * 只服务一个数据源，不需要 LRU 常驻缓存；确认请求/工具调用都是顺序 await，
 * 不需要队列。*/
export type SqlAgentTimelineEntry =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "note"; id: string; text: string }
  | { kind: "progress"; id: string; text: string }
  | { kind: "tool"; id: string; tool: string; running: boolean; detail?: string | null; startedAt?: number; output?: string | null; expanded?: boolean }
  | { kind: "usage"; id: string; promptTokens: number; completionTokens: number; totalTokens: number; isTurnTotal: boolean };

export interface SqlAgentConfirmRequest {
  requestId: string;
  sql: string;
}

export interface SqlAgentQuestionRequest {
  requestId: string;
  question: string;
  options: string[];
}

interface SqlAgentState {
  dataSourceId: string | null;
  sessionInfo: SqlAgentSessionInfo | null;
  timeline: SqlAgentTimelineEntry[];
  sending: boolean;
  error: string | null;
  confirmRequest: SqlAgentConfirmRequest | null;
  questionRequest: SqlAgentQuestionRequest | null;
  histories: SqlAgentHistorySummary[];
  viewingHistoryId: string | null;

  restoreOrStart: (dataSourceId: string, providerId: string) => Promise<void>;
  leaveDataSource: () => void;
  setProvider: (providerId: string) => Promise<void>;
  sendMessage: (text: string, attachments?: ChatAttachment[]) => Promise<void>;
  cancelTurn: () => Promise<void>;
  toggleToolOutput: (id: string) => void;
  resolveConfirm: (allow: boolean) => Promise<void>;
  answerQuestion: (answer: string) => Promise<void>;
  loadHistories: (dataSourceId?: string) => Promise<void>;
  saveCurrentHistory: () => Promise<void>;
  openHistory: (id: string) => Promise<void>;
  deleteHistory: (id: string) => Promise<void>;
  renameHistory: (id: string, title: string) => Promise<void>;
  newSession: (providerId: string) => Promise<void>;
}

let seq = 0;
const nextId = () => `sa-${++seq}`;

export const useSqlAgentStore = create<SqlAgentState>((set, get) => ({
  dataSourceId: null,
  sessionInfo: null,
  timeline: [],
  sending: false,
  error: null,
  confirmRequest: null,
  questionRequest: null,
  histories: [],
  viewingHistoryId: null,

  restoreOrStart: async (dataSourceId, providerId) => {
    const prev = get().dataSourceId;
    if (prev === dataSourceId && get().sessionInfo) return;
    if (prev && prev !== dataSourceId) void sqlAgentService.closeSession(prev);
    set({ dataSourceId, sessionInfo: null, timeline: [], histories: [], error: null, viewingHistoryId: null });
    try {
      const info = await sqlAgentService.start(dataSourceId, providerId);
      if (get().dataSourceId !== dataSourceId) return;
      set({ sessionInfo: info });
      await get().loadHistories(dataSourceId);
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  leaveDataSource: () => {
    const { dataSourceId } = get();
    if (dataSourceId) void sqlAgentService.closeSession(dataSourceId);
    set({ dataSourceId: null, sessionInfo: null, timeline: [], histories: [], viewingHistoryId: null, error: null });
  },

  setProvider: async (providerId) => {
    const { dataSourceId, sessionInfo } = get();
    if (!dataSourceId || !sessionInfo) return;
    await sqlAgentService.setProvider(dataSourceId, providerId);
    set({ sessionInfo: { ...sessionInfo, provider_id: providerId } });
    await get().saveCurrentHistory();
  },

  sendMessage: async (text, attachments = []) => {
    const { dataSourceId, sending, viewingHistoryId } = get();
    if (!dataSourceId || !text.trim() || sending || viewingHistoryId) return;
    set((s) => ({
      timeline: [...s.timeline, { kind: "user", id: nextId(), text }],
      sending: true,
      error: null,
    }));
    try {
      const reply = await sqlAgentService.sendMessage(dataSourceId, text, attachments);
      set((s) => ({ timeline: [...s.timeline, { kind: "assistant", id: nextId(), text: reply }], sending: false }));
      await get().saveCurrentHistory();
    } catch (e) {
      const message = formatError(e);
      if (message.includes("已停止：用户取消了当前对话轮次")) {
        set((s) => ({
          sending: false,
          timeline: [
            ...s.timeline.map((t) => (t.kind === "tool" && t.running ? { ...t, running: false } : t)),
            { kind: "note", id: nextId(), text: "已停止" },
          ],
        }));
      } else {
        set({ sending: false, error: message });
      }
    }
  },

  cancelTurn: async () => {
    const { dataSourceId, sending } = get();
    if (!dataSourceId || !sending) return;
    await sqlAgentService.cancelTurn(dataSourceId);
  },

  toggleToolOutput: (id) => {
    set((s) => ({
      timeline: s.timeline.map((entry) => (entry.kind === "tool" && entry.id === id ? { ...entry, expanded: !entry.expanded } : entry)),
    }));
  },

  resolveConfirm: async (allow) => {
    const { confirmRequest } = get();
    if (!confirmRequest) return;
    set({ confirmRequest: null });
    await sqlAgentService.resolveConfirm(confirmRequest.requestId, allow);
  },

  answerQuestion: async (answer) => {
    const { questionRequest } = get();
    if (!questionRequest) return;
    set({ questionRequest: null });
    await sqlAgentService.answerQuestion(questionRequest.requestId, answer);
  },

  loadHistories: async (dataSourceId) => {
    const id = dataSourceId ?? get().dataSourceId;
    if (!id) return;
    try {
      set({ histories: await sqlAgentService.historyList(id) });
    } catch {
      /* history must not block chat */
    }
  },

  saveCurrentHistory: async () => {
    const { dataSourceId, sessionInfo, timeline, viewingHistoryId } = get();
    if (!dataSourceId || !sessionInfo || timeline.length === 0 || viewingHistoryId) return;
    const titleEntry = timeline.find((entry) => entry.kind === "user");
    const title = titleEntry && titleEntry.kind === "user" ? titleEntry.text.slice(0, 80) : "SQL 会话";
    const provider = useAiProviderStore.getState().providers.find((item) => item.id === sessionInfo.provider_id);
    try {
      await sqlAgentService.historySave({
        id: sessionInfo.id,
        data_source_id: dataSourceId,
        title,
        provider_id: sessionInfo.provider_id,
        provider_label: provider?.name ?? "AI Provider",
        model: provider?.model ?? "",
        timeline,
      });
      await get().loadHistories(dataSourceId);
    } catch {
      /* history is best effort */
    }
  },

  openHistory: async (id) => {
    await get().saveCurrentHistory();
    const dataSourceId = get().dataSourceId;
    if (!dataSourceId) return;
    const detail = await sqlAgentService.historyGet(id);
    if (!detail) return;
    try {
      const info = await sqlAgentService.historyResume(dataSourceId, id);
      set({
        sessionInfo: info,
        timeline: (detail.timeline as SqlAgentTimelineEntry[]) ?? [],
        viewingHistoryId: null,
        error: null,
      });
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  deleteHistory: async (id) => {
    const { viewingHistoryId, sessionInfo } = get();
    await sqlAgentService.historyDelete(id);
    set((s) => ({ histories: s.histories.filter((item) => item.id !== id), viewingHistoryId: s.viewingHistoryId === id ? null : s.viewingHistoryId }));
    if (viewingHistoryId === id && sessionInfo) await get().newSession(sessionInfo.provider_id);
  },

  renameHistory: async (id, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    await sqlAgentService.historyRename(id, trimmed);
    await get().loadHistories();
  },

  newSession: async (providerId) => {
    await get().saveCurrentHistory();
    const dataSourceId = get().dataSourceId;
    if (!dataSourceId) return;
    const info = await sqlAgentService.newSession(dataSourceId, providerId);
    set({ sessionInfo: info, timeline: [], viewingHistoryId: null, error: null });
  },
}));

let listenersRegistered = false;

/** 全局注册一次 SQL Agent 事件监听（App.tsx 挂载时调用）。 */
export function registerSqlAgentListeners(): Promise<() => void> {
  if (listenersRegistered) return Promise.resolve(() => {});
  listenersRegistered = true;

  const currentSessionId = () => useSqlAgentStore.getState().sessionInfo?.id;

  const unlistenPromises = [
    listen<CodingToolCallEvent>("sqlagent:tool-call-start", (event) => {
      if (event.payload.sessionId !== currentSessionId()) return;
      useSqlAgentStore.setState((s) => ({
        timeline: [...s.timeline, { kind: "tool", id: nextId(), tool: event.payload.tool, running: true, detail: event.payload.detail, startedAt: Date.now() }],
      }));
    }),
    listen<CodingToolCallEvent>("sqlagent:tool-call-end", (event) => {
      if (event.payload.sessionId !== currentSessionId()) return;
      useSqlAgentStore.setState((s) => {
        const idx = [...s.timeline].reverse().findIndex((t) => t.kind === "tool" && t.tool === event.payload.tool && t.running);
        if (idx === -1) return s;
        const realIdx = s.timeline.length - 1 - idx;
        const timeline = [...s.timeline];
        const entry = timeline[realIdx];
        if (entry.kind === "tool") timeline[realIdx] = { ...entry, running: false, output: event.payload.output };
        return { timeline };
      });
    }),
    listen<CodingAssistantNoteEvent>("sqlagent:assistant-note", (event) => {
      if (event.payload.sessionId !== currentSessionId()) return;
      useSqlAgentStore.setState((s) => ({
        timeline: [
          ...s.timeline,
          event.payload.kind === "status" ? { kind: "progress", id: nextId(), text: event.payload.text } : { kind: "note", id: nextId(), text: event.payload.text },
        ],
      }));
    }),
    listen<CodingTokenUsageEvent>("sqlagent:token-usage-summary", (event) => {
      if (event.payload.sessionId !== currentSessionId()) return;
      useSqlAgentStore.setState((s) => ({
        timeline: [
          ...s.timeline,
          { kind: "usage", id: nextId(), promptTokens: event.payload.promptTokens, completionTokens: event.payload.completionTokens, totalTokens: event.payload.totalTokens, isTurnTotal: true },
        ],
      }));
    }),
    listen<CodingTodoUpdateEvent>("sqlagent:todo-update", (event) => {
      if (event.payload.sessionId !== currentSessionId()) return;
      useSqlAgentStore.setState((s) => (s.sessionInfo ? { sessionInfo: { ...s.sessionInfo, todos: event.payload.todos } } : s));
    }),
    listen<SqlAgentConfirmRequestEvent>("sqlagent:confirm-request", (event) => {
      if (event.payload.sessionId !== currentSessionId()) return;
      useSqlAgentStore.setState({ confirmRequest: { requestId: event.payload.requestId, sql: event.payload.sql } });
    }),
    listen<CodingQuestionRequestEvent>("sqlagent:question-request", (event) => {
      if (event.payload.sessionId !== currentSessionId()) return;
      useSqlAgentStore.setState({ questionRequest: { requestId: event.payload.requestId, question: event.payload.question, options: event.payload.options } });
    }),
  ];

  return Promise.all(unlistenPromises).then((unlistens) => () => {
    listenersRegistered = false;
    unlistens.forEach((u) => u());
  });
}
