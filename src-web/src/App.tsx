import React, { useEffect } from "react";
import { Database } from "lucide-react";
import { useSqlStore } from "./stores/sqlStore";
import { useToastStore, ToastStack } from "./components/shared/Toast";
import { formatError } from "./utils/error";
import { ThemeToggle } from "./components/shared/ThemeToggle";
import { DataSourceManager } from "./components/SqlDesk/DataSourceManager";
import { SqlWorkspace } from "./components/SqlDesk/SqlWorkspace";

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
