import React, { useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import type { SqlAgentHistorySummary } from "../../types/bindings";

interface Props {
  histories: SqlAgentHistorySummary[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onClose: () => void;
}

/** SQL 会话历史弹窗，原样搬自 `roc_desk-workspace` 的 `CodingHistoryDialog`
 * （去掉了 `mode` 这个字段——SQL Agent 没有 Plan/Build 模式）。 */
export const SqlAgentHistoryDialog: React.FC<Props> = ({ histories, onOpen, onDelete, onRename, onClose }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const submit = (id: string) => {
    if (renameText.trim()) onRename(id, renameText.trim());
    setEditingId(null);
  };
  return (
    <div className="coding-history-overlay" onClick={onClose}>
      <div className="coding-history-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="coding-history-title">
          <span>SQL 会话历史</span>
          <button className="btn ghost sm" onClick={onClose}>
            <X />
          </button>
        </div>
        {histories.length === 0 ? (
          <div className="coding-history-empty">还没有已保存的 SQL 会话</div>
        ) : (
          <div className="coding-history-list">
            {histories.map((item) => (
              <div className="coding-history-row" key={item.id}>
                {editingId === item.id ? (
                  <input
                    className="form-input coding-history-rename"
                    autoFocus
                    value={renameText}
                    onChange={(event) => setRenameText(event.target.value)}
                    onBlur={() => submit(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submit(item.id);
                      if (event.key === "Escape") setEditingId(null);
                    }}
                  />
                ) : (
                  <button className="coding-history-open" onClick={() => onOpen(item.id)}>
                    <strong>{item.title}</strong>
                    <span>
                      {item.provider_label} · {item.model || "未知模型"}
                    </span>
                    <time>{new Date(item.updated_at).toLocaleString()}</time>
                  </button>
                )}
                <button
                  className="btn ghost sm"
                  title="重命名"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setEditingId(item.id);
                    setRenameText(item.title);
                  }}
                >
                  <Pencil />
                </button>
                <button className="btn ghost sm" title="删除历史" onClick={() => onDelete(item.id)}>
                  <Trash2 />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
