import "./monacoSetup"; // 必须在 App 渲染前 import 一次：注册本地 Monaco worker
// 资源和 roc-dark/roc-light 自定义主题（否则 SqlEditorTabs 请求 roc-dark 时
// Monaco 找不到，会静默回退到内置浅色 vs 主题，见 docs/MULTI_REPO_SPLIT_PROGRESS.md
// 里 roc_desk-editor 那次同类 bug 的记录）。
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
