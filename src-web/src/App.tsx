import React, { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Database } from "lucide-react";
import { useSqlStore } from "./stores/sqlStore";
import { useToastStore, ToastStack } from "./components/shared/Toast";
import { formatError } from "./utils/error";
import { ThemeToggle } from "./components/shared/ThemeToggle";
import { DataSourceManager } from "./components/SqlDesk/DataSourceManager";
import { SqlWorkspace } from "./components/SqlDesk/SqlWorkspace";
import { registerSqlAgentListeners } from "./stores/sqlAgentStore";

/** 把一个 .sql 文件的内容灌进一个新查询标签页——新建标签页需要已经选中/连接
 * 了数据源（`createTab` 内部直接依赖 `currentDataSourceId`，没有就静默跳过），
 * 这里只负责"内容→标签页"这一步，调用方负责确认已经连上数据源。 */
async function openSqlFileAsTab(path: string, content: string) {
  const s = useSqlStore.getState();
  const fileName = path.split(/[\\/]/).pop() || path;
  await s.createTab(fileName);
  const tabId = useSqlStore.getState().activeTabId;
  if (tabId) s.setTabContent(tabId, content);
}

/** SQL 工作台独立窗口顶层壳——没有选中数据源时展示数据源列表/向导，选中后
 * 展示两栏工作区。改自宿主 `SqlDeskShell.tsx`：这是独立 exe 自己的窗口，
 * 没有宿主的"多工具模式切换"概念，去掉了 `useModeStore`/"返回首页"按钮。 */
export const App: React.FC = () => {
  const push = useToastStore((s) => s.push);
  const currentDataSourceId = useSqlStore((s) => s.currentDataSourceId);
  const dataSources = useSqlStore((s) => s.dataSources);
  const loadDataSources = useSqlStore((s) => s.loadDataSources);
  const selectDataSource = useSqlStore((s) => s.selectDataSource);
  const leaveDataSource = useSqlStore((s) => s.leaveDataSource);
  const connectionStatus = useSqlStore((s) => s.connectionStatus);
  const error = useSqlStore((s) => s.error);

  useEffect(() => {
    loadDataSources().catch((e) => push("error", `加载数据源失败：${formatError(e)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    registerSqlAgentListeners().then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  // Windows"打开方式"/双击已关联的 .sql 文件：冷启动带的路径存在后端
  // `PendingOpenPaths` 里，这里挂载时取走一次；已运行实例收到的第二次启动
  // 转发走 `open-file-paths` 事件。新建标签页需要已经连上数据源，还没连上时
  // 先排队，等 `currentDataSourceId` 变化后再补开（见下面那个 effect）。
  const pendingSqlPathsRef = useRef<string[]>([]);

  const queueSqlPaths = (paths: string[]) => {
    const sqlPaths = paths.filter((p) => p.toLowerCase().endsWith(".sql"));
    if (sqlPaths.length === 0) return;
    pendingSqlPathsRef.current.push(...sqlPaths);
    if (!useSqlStore.getState().currentDataSourceId) {
      push("info", "请先选择一个数据源，选定后会自动打开刚才双击的 .sql 文件");
    }
  };

  useEffect(() => {
    void invoke<string[]>("take_pending_open_paths").then(queueSqlPaths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const fn = await listen<string[]>("open-file-paths", (event) => queueSqlPaths(event.payload));
      if (cancelled) fn();
      else unlisten = fn;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (connectionStatus !== "connected" || !currentDataSourceId) return;
    const paths = pendingSqlPathsRef.current;
    if (paths.length === 0) return;
    pendingSqlPathsRef.current = [];
    void (async () => {
      for (const p of paths) {
        try {
          const content = await invoke<string>("sql_read_external_file_text", { path: p });
          await openSqlFileAsTab(p, content);
        } catch (e) {
          push("error", `打开 ${p} 失败：${formatError(e)}`);
        }
      }
    })();
  }, [connectionStatus, currentDataSourceId, push]);

  const currentDataSource = dataSources.find((d) => d.id === currentDataSourceId) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div className="tab-bar">
        <Database className="app-icon" />
        <span className="workspace-name-btn" style={{ cursor: "default" }}>
          {currentDataSource
            ? `${currentDataSource.name} · ${currentDataSource.host}:${currentDataSource.port ?? ""} · ${currentDataSource.environment === "prod" ? "生产" : currentDataSource.environment}${currentDataSource.readonly ? " · 只读" : ""}`
            : "SQL 工作台"}
        </span>
        {currentDataSource && (
          <button className="btn ghost sm" disabled={connectionStatus === "connecting"} onClick={() => void leaveDataSource()}>
            连接管理
          </button>
        )}
        <div className="quick-tools" style={{ marginLeft: "auto" }}>
          <ThemeToggle />
        </div>
      </div>
      {error && connectionStatus !== "failed" && (
        <div role="alert" style={{ padding: 8, color: "var(--danger)", whiteSpace: "pre-wrap" }}>
          {error}
          <button className="btn ghost sm" onClick={() => useSqlStore.setState({ error: null })}>关闭提示</button>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {connectionStatus === "connecting" ? (
          <div className="empty-state">正在连接数据库…</div>
        ) : currentDataSource && connectionStatus === "connected" ? (
          <SqlWorkspace key={currentDataSource.id} dataSource={currentDataSource} />
        ) : (
          <DataSourceManager />
        )}
        {connectionStatus === "failed" && (
          <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "color-mix(in srgb, var(--bg-app) 85%, transparent)", zIndex: 10 }}>
            <div className="dialog" style={{ padding: 20, maxWidth: 440 }}>
              <h3>连接失败</h3>
              <p style={{ whiteSpace: "pre-wrap" }}>{error}</p>
              <div className="dialog-actions">
                <button className="btn ghost sm" onClick={() => void leaveDataSource()}>返回连接管理</button>
                <button className="btn primary sm" onClick={() => currentDataSource && void selectDataSource(currentDataSource.id)}>重试连接</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <ToastStack />
    </div>
  );
};

export default App;
