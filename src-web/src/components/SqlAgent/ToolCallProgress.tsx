import React from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";

interface ToolCallProgressProps {
  tool: string;
  elapsedMs: number;
  done?: boolean;
  detail?: string | null;
  output?: string | null;
  expanded?: boolean;
  onToggleOutput?: () => void;
}

/** SQL Agent's tool set is only run_query/describe_table/list_objects/
 * todo_write/question -- a trimmed label map from `roc_desk-workspace`'s
 * copy (no file/git/command/skill tools here). */
export function toolLabel(tool: string): string {
  const labels: Record<string, string> = {
    run_query: "执行 SQL",
    describe_table: "查看表结构",
    list_objects: "列出表/视图",
    todo_write: "更新任务清单",
    question: "向你提问",
  };
  return labels[tool] ?? `执行 ${tool}`;
}

export const ToolCallProgress: React.FC<ToolCallProgressProps> = ({ tool, elapsedMs, done, detail, output, expanded, onToggleOutput }) => {
  const isCommand = tool === "run_query";
  const canExpand = Boolean(done && output && onToggleOutput);
  const visibleOutput = output && output.length > 12000
    ? `${output.slice(0, 12000)}\n…（结果过长，已折叠 ${output.length - 12000} 个字符）`
    : output;
  return (
    <div>
      <div
        className="tool-call-progress"
        style={canExpand ? { cursor: "pointer" } : undefined}
        onClick={canExpand ? onToggleOutput : undefined}
        title={canExpand ? (expanded ? "点击收起执行结果" : "点击查看执行结果") : undefined}
      >
        {done ? <Check style={{ width: 10, height: 10, color: "var(--text-secondary)" }} /> : <span className="spinner" />}
        {done ? `已完成 ${toolLabel(tool)}` : `正在${toolLabel(tool)} · ${(elapsedMs / 1000).toFixed(1)}s`}
        {detail && (isCommand ? <code className="tool-detail-cmd">{detail}</code> : <span style={{ opacity: 0.7 }}>· {detail}</span>)}
        {canExpand && (
          expanded
            ? <ChevronDown style={{ width: 12, height: 12, color: "var(--text-secondary)", marginLeft: "auto", flexShrink: 0 }} />
            : <ChevronRight style={{ width: 12, height: 12, color: "var(--text-secondary)", marginLeft: "auto", flexShrink: 0 }} />
        )}
      </div>
      {expanded && visibleOutput && <pre className="tool-output-pane">{visibleOutput}</pre>}
    </div>
  );
};
