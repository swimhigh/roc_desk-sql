import React, { useEffect, useRef } from "react";
import { Brain, ChevronRight } from "lucide-react";
import { AgentMarkdown } from "./AgentMarkdown";

/** Collapsible "model note" block -- auto-expanded while the current turn
 * is still producing it, collapses once a newer note/turn takes over.
 * Ported from `roc_desk-workspace`'s `CodingAgentPanel.ThinkingBlock`. */
export const ThinkingBlock: React.FC<{ text: string; active: boolean }> = ({ text, active }) => {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (detailsRef.current) detailsRef.current.open = active;
  }, [active]);
  return (
    <details ref={detailsRef} className="agent-thinking">
      <summary>
        <ChevronRight className="agent-thinking-chevron" />
        <Brain />
        <span>{active ? "正在思考" : "思考过程"}</span>
      </summary>
      <div className="agent-thinking-body">
        <AgentMarkdown content={text} />
      </div>
    </details>
  );
};
