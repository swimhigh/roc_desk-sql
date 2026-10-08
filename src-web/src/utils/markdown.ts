import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ breaks: true, gfm: true });

/** Markdown rendering for the SQL Agent's timeline -- parsed output must go
 * through `DOMPurify` before `dangerouslySetInnerHTML` (Markdown allows
 * embedded raw HTML, a ready-made XSS vector otherwise). */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html);
}
