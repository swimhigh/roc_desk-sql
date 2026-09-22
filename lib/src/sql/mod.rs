pub mod adapter;
pub mod adapters;
pub mod data_editor;
pub mod executor;
pub mod model;
pub mod policy;
pub mod registry;
pub mod service;
pub mod transfer;
pub mod workspace_cache;

// `agent` (SQL Agent AI loop) and `ai_assistant` (generate/explain/optimize/
// fix-error) are intentionally not ported in this pass: both depend on
// host-only `crate::ai`, `crate::agent_llm`, and `crate::coding` types
// (AiProviderManager, ChangeStore, CommandConfirmRegistry, ...) that have not
// been extracted into `roc_desk_core` yet. See the repository README for
// details on what's missing and the plan for a follow-up pass.
