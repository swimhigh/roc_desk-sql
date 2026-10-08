import React, { useMemo } from "react";
import { renderMarkdown } from "../../utils/markdown";
import { highlightShellCommand } from "../../utils/shellHighlight";

const SHELL_LANGS = new Set(["bash", "sh", "shell", "zsh", "console", "powershell", "ps1", "cmd", "batch"]);

interface AgentMarkdownProps {
  content: string;
}

/** Sanitized Markdown rendering for the SQL Agent's timeline. Trimmed from
 * `roc_desk-workspace`'s copy (no `onOpenFile` file-reference decoration --
 * there's no editor pane to open files into here). */
export const AgentMarkdown: React.FC<AgentMarkdownProps> = ({ content }) => {
  const html = useMemo(() => {
    const document = new DOMParser().parseFromString(`<div id="agent-md-root">${renderMarkdown(content)}</div>`, "text/html");
    const root = document.getElementById("agent-md-root");
    if (!root) return renderMarkdown(content);
    root.querySelectorAll("pre > code").forEach((element) => {
      const lang = Array.from(element.classList)
        .find((c) => c.startsWith("language-"))
        ?.slice("language-".length);
      if (lang && SHELL_LANGS.has(lang)) {
        element.innerHTML = highlightShellCommand(element.textContent || "");
        element.classList.add("agent-shell-block");
      }
    });
    return root.innerHTML;
  }, [content]);

  return <div className="agent-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
};
