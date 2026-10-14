import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Icon } from "~/components/ui/Icon";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { useToast } from "~/components/ui/Toast";
import { useI18n } from "~/lib/i18n";
import { FLOW_NODE_MAX, FLOW_NODE_MIN, FLOW_NODE_SIZE, flowService } from "~/services/flow.service";
import { type Flow, type FlowNode, type FlowNodeKind } from "~/models/flow";

export interface FlowViewProps {
  flow: Flow | null;
  flowId: string;
}

/** 画布逻辑尺寸（未缩放坐标）；滚动/缩放都在视口层完成 */
const CANVAS_W = 2400;
const CANVAS_H = 1600;
const ZOOM_STEPS = [0.6, 0.8, 1, 1.25, 1.5];
const ZOOM_MIN = ZOOM_STEPS[0]!;
const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
const SNAP = 8; // 移动吸附网格，避免像素级错位
const PORT_OFFSET = 36; // 连线贝塞尔控制点外推距离

type Side = "top" | "right" | "bottom" | "left";
const SIDES: Side[] = ["top", "right", "bottom", "left"];

/** 四角缩放句柄；圆形形状（连接符/汇总/或门/磁带）缩放时锁定纵横比 */
type Corner = "tl" | "tr" | "bl" | "br";
const CORNERS: Corner[] = ["tl", "tr", "bl", "br"];
const ROUND_KINDS = new Set<FlowNodeKind>(["connector", "summing", "or", "tape"]);

function clampN(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

interface Pt {
  x: number;
  y: number;
}

function anchorOf(n: FlowNode, side: Side): Pt {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  if (side === "top") return { x: cx, y: n.y };
  if (side === "bottom") return { x: cx, y: n.y + n.h };
  if (side === "left") return { x: n.x, y: cy };
  return { x: n.x + n.w, y: cy };
}

function outward(side: Side, d = PORT_OFFSET): Pt {
  if (side === "top") return { x: 0, y: -d };
  if (side === "bottom") return { x: 0, y: d };
  if (side === "left") return { x: -d, y: 0 };
  return { x: d, y: 0 };
}

/** 连线几何：按两端中心的主导方向选出入边/出边侧，贝塞尔过渡（Worktile 风格的顺滑拐角） */
function edgeGeom(a: FlowNode, b: FlowNode) {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const fromSide: Side = horizontal ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "bottom" : "top";
  const toSide: Side = horizontal ? (dx >= 0 ? "left" : "right") : dy >= 0 ? "top" : "bottom";
  const p1 = anchorOf(a, fromSide);
  const p2 = anchorOf(b, toSide);
  const o1 = outward(fromSide);
  const o2 = outward(toSide);
  const d = `M ${p1.x} ${p1.y} C ${p1.x + o1.x} ${p1.y + o1.y}, ${p2.x + o2.x} ${p2.y + o2.y}, ${p2.x} ${p2.y}`;
  return { d, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
}

const KIND_LABEL_KEY: Record<FlowNodeKind, Parameters<ReturnType<typeof useI18n>["t"]>[0]> = {
  start: "flowNodeStart",
  end: "flowNodeEnd",
  process: "flowNodeProcess",
  rounded: "flowNodeRounded",
  decision: "flowNodeDecision",
  io: "flowNodeIO",
  connector: "flowNodeConnector",
  offpage: "flowNodeOffpage",
  manualOperation: "flowNodeManualOperation",
  or: "flowNodeOr",
  note: "flowNodeNote",
  card: "flowNodeCard",
  document: "flowNodeDocument",
  multiDoc: "flowNodeMultiDoc",
  database: "flowNodeDatabase",
  internalStorage: "flowNodeInternalStorage",
  display: "flowNodeDisplay",
  manualInput: "flowNodeManualInput",
  tape: "flowNodeTape",
  directAccess: "flowNodeDirectAccess",
  paperTape: "flowNodePaperTape",
  storedData: "flowNodeStoredData",
  cloud: "flowNodeCloud",
  folder: "flowNodeFolder",
  predefined: "flowNodePredefined",
  preparation: "flowNodePreparation",
  merge: "flowNodeMerge",
  delay: "flowNodeDelay",
  summing: "flowNodeSumming",
  annotation: "flowNodeAnnotation",
  loopLimit: "flowNodeLoopLimit",
  collate: "flowNodeCollate",
  controlTransfer: "flowNodeControlTransfer",
  parallelMode: "flowNodeParallelMode",
  frame: "flowNodeFrame",
  chevron: "flowNodeChevron",
};

/** 形状库分组（对齐 Worktile：基础 / 数据 / 流程控制） */
const PALETTE_GROUPS: { labelKey: Parameters<ReturnType<typeof useI18n>["t"]>[0]; kinds: FlowNodeKind[] }[] = [
  {
    labelKey: "flowGroupBasic",
    kinds: ["start", "end", "process", "rounded", "decision", "io", "connector", "offpage", "manualOperation", "or", "note", "card"],
  },
  {
    labelKey: "flowGroupData",
    kinds: ["document", "multiDoc", "database", "internalStorage", "display", "manualInput", "tape", "directAccess", "paperTape", "storedData", "cloud", "folder"],
  },
  {
    labelKey: "flowGroupFlow",
    kinds: ["predefined", "preparation", "merge", "delay", "summing", "annotation", "loopLimit", "collate", "controlTransfer", "parallelMode", "frame", "chevron"],
  },
];

/**
 * 逻辑流程图画布（Worktile 风格：左侧形状库 + 点阵画布 + 箭头连线）。
 * 节点为绝对定位 HTML（文字编辑/无障碍天然可用），连线为底层 SVG；
 * 拖动过程只写本地草稿坐标，松手才落库，避免高频 IndexedDB 写。
 */
export function FlowView({ flow, flowId }: FlowViewProps) {
  const { t } = useI18n();
  const toast = useToast();
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [sel, setSel] = useState<{ type: "node" | "edge"; id: string } | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [draftPos, setDraftPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const [draftBox, setDraftBox] = useState<{ id: string; x: number; y: number; w: number; h: number } | null>(null);
  const [drawing, setDrawing] = useState<{ from: string; side: Side; x: number; y: number } | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ type: "node" | "edge"; id: string } | null>(null);

  const nodes = flow?.nodes ?? [];
  const edges = flow?.edges ?? [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  function guard(e: unknown) {
    toast.error(e instanceof Error && e.message ? e.message : t("updateFailed"));
  }

  /** 屏幕坐标 → 画布逻辑坐标（除以缩放） */
  const toCanvas = useCallback(
    (clientX: number, clientY: number): Pt | null => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
    },
    [zoom],
  );

  function snap(v: number) {
    return Math.round(v / SNAP) * SNAP;
  }

  /** 视口中心（新节点落点），带级联偏移避免重叠 */
  function centerDrop(): Pt {
    const vp = viewportRef.current;
    const base = vp
      ? { x: vp.scrollLeft + vp.clientWidth / 2, y: vp.scrollTop + vp.clientHeight / 2 }
      : { x: CANVAS_W / 2, y: CANVAS_H / 2 };
    // 对角级联落点：连续快速放置时避免完全叠死（每层错开一截，露出标题）
    const step = nodes.length % 6;
    return { x: snap(base.x / zoom - 72 + step * 44), y: snap(base.y / zoom - 28 + step * 38) };
  }

  async function addNodeAt(kind: FlowNodeKind, at: Pt) {
    const size = FLOW_NODE_SIZE[kind];
    try {
      await flowService.addNode(flowId, {
        kind,
        x: snap(at.x - size.w / 2),
        y: snap(at.y - size.h / 2),
        w: size.w,
        h: size.h,
        text: t(KIND_LABEL_KEY[kind]),
      });
    } catch (e) {
      guard(e);
    }
  }

  /** 形状库：点击在视口中心新建；按住拖到画布指定位置新建 */
  function palettePointerDown(e: ReactPointerEvent<HTMLButtonElement>, kind: FlowNodeKind) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    let dropped = false;
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) ev.preventDefault(); // 拖拽中阻止文本选中
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (dropped) return;
      dropped = true;
      const pt = toCanvas(ev.clientX, ev.clientY);
      const canvasHit =
        pt && pt.x >= 0 && pt.y >= 0 && pt.x <= CANVAS_W && pt.y <= CANVAS_H;
      void addNodeAt(kind, canvasHit ? pt : centerDrop());
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** 节点拖动：本地草稿跟随，松手一次性落库 */
  function nodePointerDown(e: ReactPointerEvent<HTMLDivElement>, node: FlowNode) {
    if (editingNodeId === node.id) return;
    e.preventDefault();
    viewportRef.current?.focus();
    setSel({ type: "node", id: node.id });
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = node.x;
    const origY = node.y;
    let last = { x: node.x, y: node.y };
    let moved = false;
    const move = (ev: PointerEvent) => {
      moved = true;
      last = { x: snap(origX + (ev.clientX - startX) / zoom), y: snap(origY + (ev.clientY - startY) / zoom) };
      setDraftPos({ id: node.id, ...last });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDraftPos(null);
      if (moved) void flowService.moveNode(flowId, node.id, last.x, last.y).catch(guard);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** 四角缩放：对角锚定 + 网格吸附，本地草稿跟随，松手一次性落库 */
  function resizePointerDown(e: ReactPointerEvent<HTMLSpanElement>, node: FlowNode, corner: Corner) {
    e.preventDefault();
    e.stopPropagation();
    viewportRef.current?.focus();
    setSel({ type: "node", id: node.id });
    const startX = e.clientX;
    const startY = e.clientY;
    const lock = ROUND_KINDS.has(node.kind);
    // 圆形形状锁定纵横比：最小边取两者较大值，保证仍是正圆
    const minW = lock ? Math.max(FLOW_NODE_MIN.w, FLOW_NODE_MIN.h) : FLOW_NODE_MIN.w;
    const minH = lock ? minW : FLOW_NODE_MIN.h;
    // 拖左/上角时对角（右下或其镜像）固定不动
    const anchorX = corner === "tl" || corner === "bl" ? node.x + node.w : node.x;
    const anchorY = corner === "tl" || corner === "tr" ? node.y + node.h : node.y;
    let last = { x: node.x, y: node.y, w: node.w, h: node.h };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / zoom;
      const dy = (ev.clientY - startY) / zoom;
      let w = clampN(snap(corner === "tr" || corner === "br" ? node.w + dx : node.w - dx), minW, FLOW_NODE_MAX.w);
      let h = clampN(snap(corner === "bl" || corner === "br" ? node.h + dy : node.h - dy), minH, FLOW_NODE_MAX.h);
      if (lock) {
        const s = Math.max(w, h);
        w = s;
        h = s;
      }
      const x = corner === "tl" || corner === "bl" ? anchorX - w : node.x;
      const y = corner === "tl" || corner === "tr" ? anchorY - h : node.y;
      last = { x, y, w, h };
      setDraftBox({ id: node.id, ...last });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDraftBox(null);
      const changed = last.w !== node.w || last.h !== node.h || last.x !== node.x || last.y !== node.y;
      if (changed) {
        void flowService.resizeNode(flowId, node.id, last.x, last.y, last.w, last.h).catch(guard);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** 端口拖出连线：落到节点上连接；落到空白处自动新建「处理」节点并连接 */
  function portPointerDown(e: ReactPointerEvent<HTMLSpanElement>, node: FlowNode, side: Side) {
    e.preventDefault();
    e.stopPropagation();
    const p0 = anchorOf(node, side);
    setDrawing({ from: node.id, side, x: p0.x, y: p0.y });
    const move = (ev: PointerEvent) => {
      const pt = toCanvas(ev.clientX, ev.clientY);
      if (pt) setDrawing({ from: node.id, side, x: pt.x, y: pt.y });
    };
    // addEventListener 回调须同步返回 void，异步收尾拆到内层（no-misused-promises）
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      void finishPortDraw(ev);
    };
    async function finishPortDraw(ev: PointerEvent) {
      setDrawing(null);
      const pt = toCanvas(ev.clientX, ev.clientY);
      if (!pt) return;
      // 命中取渲染最上层节点（数组倒序 = DOM 层叠顺序）；重叠时避免误命中底下的源节点
      const hit = [...nodes].reverse().find(
        (n) => pt.x >= n.x && pt.x <= n.x + n.w && pt.y >= n.y && pt.y <= n.y + n.h,
      );
      try {
        if (hit && hit.id !== node.id) {
          await flowService.connect(flowId, node.id, hit.id);
        } else if (!hit && pt.x >= 0 && pt.y >= 0 && pt.x <= CANVAS_W && pt.y <= CANVAS_H) {
          const size = FLOW_NODE_SIZE.process;
          const created = await flowService.addNode(flowId, {
            kind: "process",
            x: snap(pt.x - size.w / 2),
            y: snap(pt.y - size.h / 2),
            w: size.w,
            h: size.h,
            text: t("flowNodeProcess"),
          });
          await flowService.connect(flowId, node.id, created.id);
        }
      } catch (err) {
        guard(err);
      }
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onViewportKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (editingNodeId || editingEdgeId) return; // 编辑态交给输入框自身处理
    if (e.key === "Escape") {
      setSel(null);
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && sel) {
      e.preventDefault();
      setConfirmDel(sel);
    }
  }

  async function commitDelete() {
    if (!confirmDel) return;
    const target = confirmDel;
    setConfirmDel(null);
    try {
      if (target.type === "node") await flowService.removeNode(flowId, target.id);
      else await flowService.removeEdge(flowId, target.id);
      setSel(null);
    } catch (e) {
      guard(e);
    }
  }

  const delLabel = confirmDel?.type === "node"
    ? nodeById.get(confirmDel.id)?.text
    : undefined;

  const drawFrom = drawing ? nodeById.get(drawing.from) : null;
  const drawPath = drawFrom && drawing
    ? (() => {
        const p1 = anchorOf(drawFrom, drawing.side);
        const o = outward(drawing.side);
        return `M ${p1.x} ${p1.y} C ${p1.x + o.x} ${p1.y + o.y}, ${drawing.x} ${drawing.y}, ${drawing.x} ${drawing.y}`;
      })()
    : "";

  return (
    <div className="flow">
      <aside className="flow__palette card" aria-label={t("flowPaletteTitle")}>
        <div className="flow__palette-head">
          <h3 className="flow__palette-title">{t("flowPaletteTitle")}</h3>
        </div>
        <div className="flow__palette-scroll">
          {PALETTE_GROUPS.map((group) => (
            <div key={group.labelKey} className="flow__palette-group">
              <p className="flow__palette-group-label">{t(group.labelKey)}</p>
              <div className="flow__palette-list">
                {group.kinds.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="flow-shape"
                    aria-label={t("flowAddNodeAria", { kind: t(KIND_LABEL_KEY[kind]) })}
                    onPointerDown={(e) => palettePointerDown(e, kind)}
                  >
                    <span className={`flow-shape__preview flow-shape__preview--${kind}`} />
                    <span className="flow-shape__name">{t(KIND_LABEL_KEY[kind])}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="flow__tips">{t("flowTips")}</p>
        </div>
      </aside>

      <div className="flow__main">
        <div className="flow__toolbar">
          <span className="flow__count">{t("flowNodeCount", { n: nodes.length })}</span>
          <div className="flow__toolbar-actions">
            <div className="flow__zoom" role="group" aria-label={t("flowZoomReset")}>
              <button
                type="button"
                onClick={() => setZoom((z) => ZOOM_STEPS[Math.max(0, ZOOM_STEPS.indexOf(z) - 1)] ?? z)}
                disabled={zoom <= ZOOM_MIN}
                aria-label={t("flowZoomOut")}
              >
                −
              </button>
              <button type="button" className="flow__zoom-value" onClick={() => setZoom(1)} aria-label={t("flowZoomReset")}>
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS.indexOf(z) + 1)] ?? z)}
                disabled={zoom >= ZOOM_MAX}
                aria-label={t("flowZoomIn")}
              >
                +
              </button>
            </div>
            <button
              type="button"
              className="flow__delete"
              disabled={!sel}
              onClick={() => sel && setConfirmDel(sel)}
              title={!sel ? t("flowSelectToDelete") : undefined}
            >
              <Icon name="trash" size={14} />
              {t("flowDeleteNodeTitle")}
            </button>
          </div>
        </div>

        {/* 画布键盘区：Delete 删除选中、Esc 取消选中；沿用仓库 role="button" 可聚焦 div 先例（TaskCard/TableView） */}
        <div
          ref={viewportRef}
          className="flow__viewport"
          role="button"
          aria-label={t("flowView")}
          tabIndex={0}
          onKeyDown={onViewportKeyDown}
        >
          <div className="flow__scaler" style={{ width: CANVAS_W * zoom, height: CANVAS_H * zoom }}>
            <div
              ref={canvasRef}
              className="flow__canvas"
              style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${zoom})` }}
            >
              <svg className="flow__edges" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} aria-hidden>
                <defs>
                  <marker id="flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0 0 L8 4 L0 8 z" fill="var(--color-border-strong)" />
                  </marker>
                </defs>
                {edges.flatMap((ed) => {
                  const from = nodeById.get(ed.from);
                  const to = nodeById.get(ed.to);
                  if (!from || !to) return [];
                  const g = edgeGeom(from, to);
                  return [
                    <g key={ed.id} className={`flow-edge${sel?.type === "edge" && sel.id === ed.id ? " is-selected" : ""}`}>
                      {/* 加宽透明命中层：细线难以点中 */}
                      <path
                        className="flow-edge__hit"
                        d={g.d}
                        onPointerDown={() => setSel({ type: "edge", id: ed.id })}
                        onDoubleClick={() => setEditingEdgeId(ed.id)}
                      />
                      <path className="flow-edge__line" d={g.d} markerEnd="url(#flow-arrow)" />
                    </g>,
                  ];
                })}
                {drawPath && <path className="flow-edge__line is-draft" d={drawPath} markerEnd="url(#flow-arrow)" />}
              </svg>

              {/* 连线标签 pill：HTML 层渲染（SVG text 难以做圆角底），命中交给下层加宽路径 */}
              {edges.flatMap((ed) => {
                const from = nodeById.get(ed.from);
                const to = nodeById.get(ed.to);
                if (!from || !to || !ed.label) return [];
                const g = edgeGeom(from, to);
                return [
                  <span key={ed.id} className="flow-edge-chip" style={{ left: g.mid.x, top: g.mid.y - 14 }}>
                    {ed.label}
                  </span>,
                ];
              })}

              {nodes.map((node) => {
                const dragging = draftPos?.id === node.id;
                const resizing = draftBox?.id === node.id;
                const x = resizing ? draftBox.x : dragging ? draftPos.x : node.x;
                const y = resizing ? draftBox.y : dragging ? draftPos.y : node.y;
                const w = resizing ? draftBox.w : node.w;
                const h = resizing ? draftBox.h : node.h;
                const selected = sel?.type === "node" && sel.id === node.id;
                return (
                  <div
                    key={node.id}
                    className={`flow-node flow-node--${node.kind}${selected ? " is-selected" : ""}${dragging ? " is-dragging" : ""}`}
                    style={{ left: x, top: y, width: w, height: h }}
                    onPointerDown={(e) => nodePointerDown(e, node)}
                    onDoubleClick={() => setEditingNodeId(node.id)}
                  >
                    {editingNodeId === node.id ? (
                      <input
                        autoFocus
                        className="flow-node__input"
                        defaultValue={node.text}
                        onPointerDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const v = e.currentTarget.value.trim();
                            setEditingNodeId(null);
                            if (v && v !== node.text) {
                              void flowService.renameNode(flowId, node.id, v).catch(guard);
                            }
                          } else if (e.key === "Escape") {
                            setEditingNodeId(null);
                          }
                        }}
                        onBlur={() => setEditingNodeId(null)}
                        maxLength={200}
                      />
                    ) : (
                      <span className="flow-node__text">{node.text}</span>
                    )}
                    {editingNodeId !== node.id &&
                      SIDES.map((side) => (
                        <span
                          key={side}
                          className={`flow-port flow-port--${side}`}
                          onPointerDown={(e) => portPointerDown(e, node, side)}
                        />
                      ))}
                  </div>
                );
              })}

              {/* 选中节点的四角缩放句柄：独立覆盖层渲染，避免被 clip-path 形状（菱形/平行四边形等）裁剪 */}
              {(() => {
                const node = sel?.type === "node" ? nodeById.get(sel.id) : undefined;
                if (!node || editingNodeId === node.id) return null;
                const resizing = draftBox?.id === node.id;
                const x = resizing ? draftBox.x : node.x;
                const y = resizing ? draftBox.y : node.y;
                const w = resizing ? draftBox.w : node.w;
                const h = resizing ? draftBox.h : node.h;
                return (
                  <div className="flow-resize" style={{ left: x, top: y, width: w, height: h }}>
                    {CORNERS.map((corner) => (
                      <span
                        key={corner}
                        role="button"
                        tabIndex={-1}
                        aria-label={t("flowResizeAria")}
                        className={`flow-resize__handle flow-resize__handle--${corner}`}
                        onPointerDown={(e) => resizePointerDown(e, node, corner)}
                      />
                    ))}
                  </div>
                );
              })()}

              {editingEdgeId &&
                (() => {
                  const ed = edges.find((e2) => e2.id === editingEdgeId);
                  const from = ed ? nodeById.get(ed.from) : undefined;
                  const to = ed ? nodeById.get(ed.to) : undefined;
                  if (!ed || !from || !to) return null;
                  const mid = edgeGeom(from, to).mid;
                  return (
                    <input
                      autoFocus
                      className="flow-edge-editor"
                      style={{ left: mid.x, top: mid.y }}
                      placeholder={t("flowEdgeLabelPlaceholder")}
                      defaultValue={ed.label}
                      maxLength={40}
                      onPointerDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const v = e.currentTarget.value;
                          setEditingEdgeId(null);
                          void flowService.setEdgeLabel(flowId, ed.id, v).catch(guard);
                        } else if (e.key === "Escape") {
                          setEditingEdgeId(null);
                        }
                      }}
                      onBlur={() => setEditingEdgeId(null)}
                    />
                  );
                })()}

            </div>
          </div>
          {/* 空态提示挂在视口层：若留在画布内会被 2400×1600 的 flex 居中推到可视区外 */}
          {nodes.length === 0 && (
            <div className="flow__empty">
              <p>{t("flowEmptyHint")}</p>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmDel)}
        title={confirmDel?.type === "node" ? t("flowDeleteNodeTitle") : t("flowDeleteEdgeTitle")}
        message={
          confirmDel?.type === "node"
            ? t("confirmDeleteFlowNode", { text: delLabel ?? "" })
            : t("confirmDeleteFlowEdge")
        }
        danger
        onConfirm={() => void commitDelete()}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}
