// 手写的类型绑定层——对齐 lib/src/sql/model.rs、lib/src/sql/data_editor.rs、
// lib/src/sql/transfer.rs 里实际的 Rust 结构体/枚举形状（不是 ts-rs 自动生成，
// 因为这个仓库还没接 ts-rs），字段名/枚举 tag 命名逐一和宿主
// src-web/src/types/bindings.ts 里对应的 SQL 部分核对过，保持一致。
//
// AI Provider/SQL Agent/ChangeStore 相关类型（见本文件下方）对应的命令
// （ai_provider_*/sql_agent_*/sql_ai_*/sql_accept_change 等）已经在阶段三
// 补齐（roc_desk_common::ai/change_store 落地之后）。`sql_ai_*`（生成/解释/
// 优化/修复 SQL 的面板）后端命令存在，但宿主自己的前端从来没有接过对应
// 界面（真实状况，不是这轮漏做）——所以这里也不补一个宿主自己都没有的
// UI，只留 SQL Agent（多轮对话）这一条宿主确实在用的路径。

export type AppErrorKind =
  | "Connection"
  | "Auth"
  | "HostKeyRejected"
  | "PermissionDenied"
  | "NotFound"
  | "Database"
  | "Conflict"
  | "Internal";

export interface AppError {
  kind: AppErrorKind;
  message: string;
}

export function isAppError(e: unknown): e is AppError {
  return typeof e === "object" && e !== null && "kind" in e && "message" in e;
}

export type DbKind = "mysql" | "tdsql" | "postgres" | "opengauss" | "sql_server" | "oracle";

export interface DataSourceProfile {
  id: string;
  name: string;
  db_kind: DbKind;
  host: string;
  port: number | null;
  database_name: string | null;
  default_schema: string | null;
  username: string | null;
  credential_ref: string | null;
  environment: string;
  group_name: string | null;
  readonly: boolean;
  ssl_required: boolean;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

/** `password` 传空字符串表示"不修改密码"。 */
export interface DataSourceInput {
  name: string;
  db_kind: DbKind;
  host: string;
  port: number | null;
  database_name: string | null;
  default_schema: string | null;
  username: string | null;
  password: string | null;
  environment: string;
  group_name: string | null;
  readonly: boolean;
  ssl_required: boolean;
}

export interface DbInfo {
  version: string;
  latency_ms: number;
}

export type ObjectKind = "table" | "view" | "materialized_view" | "function" | "procedure";

export interface ObjectRef {
  schema: string;
  name: string;
  kind: ObjectKind;
}

export interface ObjectPage {
  objects: ObjectRef[];
}

export interface ColumnDef {
  name: string;
  data_type: string;
  nullable: boolean;
  default_value: string | null;
  is_primary_key: boolean;
  comment: string | null;
}

export interface IndexDef {
  name: string;
  definition: string;
}

export interface ObjectDefinition {
  object: ObjectRef;
  columns: ColumnDef[];
  indexes: IndexDef[];
  ddl: string | null;
  comment: string | null;
}

/** 结果集单元格——统一转成字符串展示，`is_binary` 时 `text` 是十六进制串。 */
export interface Cell {
  text: string;
  is_null: boolean;
  is_binary: boolean;
}

export interface ColumnInfo {
  name: string;
  type_name: string;
}

export interface ExecuteResult {
  columns: ColumnInfo[];
  rows: Cell[][];
  rows_affected: number | null;
  truncated: boolean;
  duration_ms: number;
}

export interface PendingWrite {
  pending_id: string;
  rows_affected: number | null;
  preview: ExecuteResult;
}

export type QueryStatus = "running" | "finished" | "error" | "cancelled";

export interface QueryPoll {
  status: QueryStatus;
  result: ExecuteResult | null;
  error: string | null;
}

/** `sql_execute` 的返回形状（lib/src/lib.rs::ExecuteOutcome，`#[serde(tag = "kind")]`）。*/
export type ExecuteOutcome =
  | { kind: "Started"; query_id: string }
  | { kind: "NeedsConfirmation" }
  | ({ kind: "PendingWrite" } & PendingWrite);

export interface QueryHistoryEntry {
  id: string;
  data_source_id: string;
  title: string | null;
  sql_text: string;
  status: string;
  duration_ms: number | null;
  row_count: number | null;
  error_message: string | null;
  created_at: string;
}

export type ResultViewMode = "table" | "text";

/** 标签页内容的唯一真相是 `file_path` 指向的磁盘文件，这里只是元数据。 */
export interface WorkspaceTab {
  id: string;
  data_source_id: string;
  title: string;
  file_path: string;
  result_view_mode: ResultViewMode;
  cursor_json: string | null;
  sort_order: number;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// 表数据编辑 / 导出导入（lib/src/sql/data_editor.rs、lib/src/sql/transfer.rs）
// ---------------------------------------------------------------------------

export interface CellInput {
  is_null: boolean;
  text: string;
}

export interface NamedCell {
  name: string;
  value: CellInput;
}

export type AlterOp =
  | { op: "add_column"; name: string; data_type: string; nullable: boolean }
  | { op: "drop_column"; name: string }
  | { op: "rename_column"; old_name: string; new_name: string };

export type TransferFormat = "csv" | "json";

export interface TransferProgress {
  rows_done: number;
  done: boolean;
  cancelled: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// AI provider management (roc_desk_sql::cmd::ai_provider_*)
// ---------------------------------------------------------------------------

export interface AiProvider {
  id: string;
  name: string;
  api_base: string;
  api_key_ref: string | null;
  model: string;
  is_local: boolean;
  wire_api: string;
  reasoning_effort: string | null;
  context_window_tokens: number | null;
  created_at: string;
}

export interface AiProviderInput {
  name: string;
  api_base: string;
  api_key: string | null;
  model: string;
  is_local: boolean;
  wire_api: string;
  reasoning_effort: string | null;
  context_window_tokens: number | null;
}

// ---------------------------------------------------------------------------
// SQL Agent (roc_desk_sql::cmd::sql_agent_*) -- a smaller sibling of the AI
// coding agent: no Plan/Build mode, no file Diff/Git/MCP/Skills, tool set is
// just run_query/describe_table/list_objects/todo_write/question. Event
// payload shapes are deliberately named `Coding*Event` here too (not
// `SqlAgent*Event`) because the backend literally reuses `agent_llm`'s
// generic emit helpers which don't know which tool is calling them -- the
// event *names* (`sqlagent:tool-call-start` etc.) differ, the payload
// shapes don't.
// ---------------------------------------------------------------------------

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

export type ChatAttachment =
  | { kind: "image"; name: string; mime: string; data_base64: string }
  | { kind: "file"; name: string; content: string }
  | { kind: "pdf"; name: string; data_base64: string };

export interface SqlAgentSessionInfo {
  id: string;
  provider_id: string;
  todos: TodoItem[];
}

export interface SqlAgentHistorySummary {
  id: string;
  title: string;
  provider_id: string;
  provider_label: string;
  model: string;
  created_at: string;
  updated_at: string;
}

export interface SqlAgentHistoryDetail extends SqlAgentHistorySummary {
  data_source_id: string;
  timeline: unknown;
}

export interface CodingTodoUpdateEvent {
  sessionId: string;
  todos: TodoItem[];
}

export interface CodingQuestionRequestEvent {
  sessionId: string;
  requestId: string;
  question: string;
  options: string[];
}

export interface CodingToolCallEvent {
  sessionId: string;
  tool: string;
  detail?: string | null;
  output?: string | null;
}

export interface CodingAssistantNoteEvent {
  sessionId: string;
  text: string;
  kind?: "model" | "status";
}

export interface CodingTokenUsageEvent {
  sessionId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface SqlAgentConfirmRequestEvent {
  sessionId: string;
  requestId: string;
  sql: string;
}
