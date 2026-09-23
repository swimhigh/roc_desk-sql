import React from "react";
import { FilePlus2 } from "lucide-react";
import { useSqlStore } from "../../stores/sqlStore";
import { ObjectExplorer } from "./ObjectExplorer";
import { SqlEditorTabs } from "./SqlEditorTabs";
import { ResultPanel } from "./ResultPanel/ResultPanel";
import { TableDataDialog } from "./TableDataDialog";
import { TransferDialog } from "./TransferDialog";
import type { DataSourceProfile, ObjectRef } from "../../types/bindings";
import { sqlService } from "../../services/sqlService";

interface SqlWorkspaceProps {
  dataSource: DataSourceProfile;
}

/** SQL 工作区两栏布局：对象浏览器 | SQL 标签页编辑器 + 结果区。AI 工具面板
 * （依赖后端未实现的 sql_ai_ 系列/sql_agent_ 系列命令）在这个独立前端里不提供。 */
export const SqlWorkspace: React.FC<SqlWorkspaceProps> = ({ dataSource }) => {
  const activeTabId = useSqlStore((s) => s.activeTabId);
  const runSql = useSqlStore((s) => s.runSql);
  const cancelQuery = useSqlStore((s) => s.cancelQuery);

  const [layout, setLayout] = React.useState(() => {
    // AI 工具面板依赖的 sql_ai_*/sql_agent_* 命令后端未实现（待 core::ai
    // 落地后跟进），这个独立前端不提供 AI 面板，`layout` 里不再有 `ai` 字段。
    const defaults = { tree: true, left: 280, right: 300, result: 40 };
    try { return { ...defaults, ...JSON.parse(localStorage.getItem("sql-layout") ?? "{}") }; } catch { return defaults; }
  });
  const [maxResult, setMaxResult] = React.useState(false);
  React.useEffect(() => { localStorage.setItem("sql-layout", JSON.stringify(layout)); }, [layout]);
  const resize = (key: "left" | "right" | "result") => (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX, startY = event.clientY, initial = layout[key];
    event.currentTarget.onpointermove = (e) => setLayout((l: typeof layout) => ({ ...l, [key]: key === "result" ? Math.max(20, Math.min(80, initial - (e.clientY - startY) / window.innerHeight * 100)) : Math.max(key === "right" ? 320 : 180, Math.min(key === "right" ? 760 : 480, initial + (e.clientX - startX) * (key === "right" ? -1 : 1))) }));
    event.currentTarget.onpointerup = (e) => { const el = e.currentTarget as HTMLDivElement; el.onpointermove = null; el.releasePointerCapture(e.pointerId); };
  };
  const [viewDataObject, setViewDataObject] = React.useState<ObjectRef | null>(null);
  const [transfer, setTransfer] = React.useState<{ mode: "export" | "import"; object: ObjectRef } | null>(null);

  const openSqlInNewTab = async (sql: string, title: string) => {
    const s = useSqlStore.getState();
    await s.createTab(title);
    const id = useSqlStore.getState().activeTabId;
    if (id) s.setTabContent(id, sql);
  };

  const handleInsertSelect = (object: ObjectRef) => {
    void (async () => {
      const snippet = await sqlService.previewTemplate(dataSource.id, object);
      const s = useSqlStore.getState();
      if (s.currentDataSourceId !== dataSource.id) return;
      await s.createTab(object.name);
      const id = useSqlStore.getState().activeTabId;
      if (id) {
        s.setTabContent(id, snippet);
        s.requestSelectAll(id);
      }
    })().catch((e) => useSqlStore.setState({ error: String(e) }));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 4 }}>
        <button className="btn ghost sm" onClick={() => setLayout({ ...layout, tree: !layout.tree })}>对象树</button>
        <button className="btn ghost sm" title="新建一个空白 SQL 查询标签页" onClick={() => void useSqlStore.getState().createTab(`查询 ${useSqlStore.getState().tabs.length + 1}`)}>
          <FilePlus2 size={13} /> 新建 SQL 编辑器
        </button>
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      {layout.tree && <><div style={{ width: layout.left, flexShrink: 0, borderRight: "1px solid var(--border-default)", overflow: "hidden" }}>
        <ObjectExplorer
          dataSourceId={dataSource.id}
          onInsertSelect={handleInsertSelect}
          onViewData={(object) => setViewDataObject(object)}
          onExport={(object) => setTransfer({ mode: "export", object })}
          onImport={(object) => setTransfer({ mode: "import", object })}
        />
      </div><div title="拖动调整对象树宽度" onPointerDown={resize("left")} style={{ width: 5, cursor: "col-resize", touchAction: "none" }} /></>}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ flex: 1, minHeight: 0, display: maxResult ? "none" : undefined }}>
          <SqlEditorTabs
            onRun={(sql) => activeTabId && void runSql(activeTabId, sql, false)}
            onCancel={() => activeTabId && void cancelQuery(activeTabId)}
          />
        </div>
        {!maxResult && <div title="拖动调整结果区高度" onPointerDown={resize("result")} style={{ height: 5, cursor: "row-resize", touchAction: "none" }} />}
        <div style={{ height: maxResult ? "100%" : `${layout.result}%`, minHeight: 100, borderTop: "1px solid var(--border-default)" }}>
          <ResultPanel maximized={maxResult} onToggleMaximized={() => setMaxResult(!maxResult)} />
        </div>
      </div>
      </div>
      {viewDataObject && (
        <TableDataDialog
          dataSourceId={dataSource.id}
          object={viewDataObject}
          readonly={dataSource.readonly}
          onClose={() => setViewDataObject(null)}
          onOpenAlterSql={(sql) => {
            setViewDataObject(null);
            void openSqlInNewTab(sql, `修改 ${viewDataObject.name}`);
          }}
        />
      )}
      {transfer && (
        <TransferDialog
          dataSourceId={dataSource.id}
          mode={transfer.mode}
          object={transfer.object}
          onClose={() => setTransfer(null)}
        />
      )}
    </div>
  );
};
