# roc_desk-sql migration

SQL backend, workspace UI, stores, and services are tracked here as the
canonical migration source.

## Status (2026-09-22)

Compiles and is command-tested (`cargo check --workspace`, an integration
test, and a full `cargo build --workspace --release` producing a working
standalone `.exe`):

- Data source CRUD + credential storage, backed by `roc_desk_core::credential`
  (ported from the host into `roc_desk-common` in this pass) and a
  `roc_desk_core::db` SQLite pool + generic migration runner (also newly
  ported). The `sql_data_sources` / `sql_query_history` / `sql_workspace_tabs`
  tables and their repos are tool-owned (`lib/src/db/repo/`), not part of
  `roc_desk_core`, since they're SQL-tool-specific schema.
- Session management, object browsing, SQL execution/poll/cancel, write
  confirmation, table data browsing/editing, query history, workspace tab
  (local `.sql` file cache) CRUD, export/import transfer.
- Three of four database adapters: MySQL/TDSQL, PostgreSQL/openGauss, SQL
  Server. Oracle was already a stub in the host (`registry::create_adapter`
  returns a "not implemented" error) and stays that way unchanged.
- All corresponding Tauri commands are in `roc_desk_sql::cmd` and wired into
  `standalone/src/main.rs`.

**Not ported in this pass** (intentionally left as host-only rather than
stubbed with fake behavior):

- The SQL Agent AI chat loop (host's `sql::agent`, `commands/sql_agent.rs`)
  and the AI assist panel (`sql::ai_assistant`, the `sql_ai_generate` /
  `sql_ai_explain` / `sql_ai_optimize` / `sql_ai_fix_error` commands), plus
  the `sql_accept_change` / `sql_reject_change` / `sql_undo_change` /
  `sql_revert_turn` commands built on the host's `coding::ChangeStore`.
- Reason: these depend on host-only `crate::ai` (`AiProviderManager`,
  `AiChatClient`), `crate::agent_llm`, and `crate::coding` (`ChangeStore`,
  `CommandConfirmRegistry`, `QuestionRegistry`, `ChatAttachment`) types that
  have not yet been extracted into `roc_desk_core`. Per
  `docs/MULTI_REPO_SPLIT_PLAN.md` §九 in the host repository, that AI
  infrastructure belongs in `roc_desk_core` once it's split out (shared with
  the coding workspace tool) -- porting it here first would mean duplicating
  it, which the migration explicitly avoids. `lib/src/sql/mod.rs` documents
  this at the module-declaration site; `agent/` and `ai_assistant.rs` remain
  present as unported source but are not compiled in.
- Follow-up: once `roc_desk_core::ai` exists, port `agent_llm`, the
  `coding` registries/`ChatAttachment`, wire `sql::agent`/`sql::ai_assistant`
  against them, and add the remaining Tauri commands.

The host copy remains until the host itself switches to depending on this
crate (out of scope for this pass; see the host's
`docs/MULTI_REPO_SPLIT_PROGRESS.md`).
