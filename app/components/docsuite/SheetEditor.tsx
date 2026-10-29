import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@remix-run/react";
import { docFileService } from "~/services/docFile.service";
import { downloadTextFile } from "~/lib/download";
import { useI18n } from "~/lib/i18n";
import { Icon, type IconName } from "~/components/ui/Icon";
import { useToast } from "~/components/ui/Toast";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import type { DocFile, SheetPage } from "~/models/docSuite";
import {
  colToName,
  evaluateSheet,
  formatCellWithStyle,
  formatCellValue,
  isFormulaErrorCode,
  parseRefKey,
  refKey,
} from "~/lib/sheetFormula";
import {
  SHEET_MAX_ROWS,
  addRows,
  clearRange,
  clonePage,
  deleteCol,
  deleteRow,
  fillRange,
  insertCol,
  insertRow,
  newPage,
  normRange,
  pagesToCsv,
  parseClipboardTsv,
  rangeStats,
  rangeTsv,
  setAlign,
  setColor,
  setNumfmt,
  sortRange,
  toggleFrozen,
  toggleStyle,
  writeBlock,
  writeCell,
  type GridPos,
  type GridRange,
  type SheetStyleKey,
} from "~/lib/sheetGrid";
import { paletteById, type PaletteEntry } from "~/lib/palette";
import { ColorPalette } from "~/components/docsuite/ColorPalette";

type SaveState = "saved" | "saving" | "error";

/** 右键菜单挂载目标：单元格 / 行头 / 列头 */
type MenuTarget = { kind: "cell"; pos: GridPos } | { kind: "row"; r: number } | { kind: "col"; c: number };
interface MenuState {
  x: number;
  y: number;
  target: MenuTarget;
}

export interface SheetEditorProps {
  file: DocFile;
}

/**
 * 飞书式在线表格编辑器：公式栏 + 选区网格 + 右键菜单 + 多页签。
 * 交互对齐桌面表格惯例：方向键移动、Shift 扩选、Enter/双击进入编辑、
 * Tab 右移、Delete 清空、Ctrl/⌘+Z 撤销；复制粘贴走 TSV（可与 Excel 互通）。
 * 页签数据整体防抖落库；行列增删时由 sheetGrid 同步平移公式引用。
 */
export function SheetEditor({ file }: SheetEditorProps) {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [title, setTitle] = useState(file.title);
  const [pages, setPages] = useState<SheetPage[]>(
    file.sheets.length ? file.sheets : [newPage(t("sheetDefaultPageName"))],
  );
  const [activeId, setActiveId] = useState(() => file.sheets[0]?.id ?? "");
  const [sel, setSel] = useState<{ anchor: GridPos; focus: GridPos }>({
    anchor: { c: 0, r: 0 },
    focus: { c: 0, r: 0 },
  });
  // source 标记编辑入口：cell = 单元格内输入（ autoFocus 抢焦点），fx = 公式栏输入（不能抢走公式栏焦点）
  const [editing, setEditing] = useState<{ pos: GridPos; draft: string; source: "cell" | "fx" } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renamingTab, setRenamingTab] = useState<string | null>(null);
  const [tabDraft, setTabDraft] = useState("");
  const [pendingDeleteTab, setPendingDeleteTab] = useState<SheetPage | null>(null);
  /** 页签右键菜单（复制/重命名/删除） */
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; pageId: string } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  /** 列宽/行高拖拽中（kind 区分轴向；直接落库不入撤销栈：快照过碎） */
  const [resizing, setResizing] =
    useState<{ kind: "col"; c: number; startX: number; startW: number } | { kind: "row"; r: number; startY: number; startH: number } | null>(null);
  const [fill, setFill] = useState<{ src: GridRange; dst: GridRange } | null>(null);
  const [palette, setPalette] = useState<{ mode: "text" | "fill"; x: number; y: number } | null>(null);
  /** 名称框输入态：null = 只读展示选区引用，聚焦后可输入 A1/B3:D5 回车跳转 */
  const [nameBoxInput, setNameBoxInput] = useState<string | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  // 填充柄拖拽中：记录源选区；mouseup 时按最新预览 dst 落盘
  const fillDragRef = useRef<GridRange | null>(null);
  const fillRef = useRef<{ src: GridRange; dst: GridRange } | null>(null);
  fillRef.current = fill;

  // 撤销/重做栈存页签快照（上限 50 步）；所有数据变更都经 applyPages 入栈
  const undoRef = useRef<SheetPage[][]>([]);
  const redoRef = useRef<SheetPage[][]>([]);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const pendingRef = useRef<SheetPage[] | null>(null);

  const page = useMemo(() => pages.find((p) => p.id === activeId) ?? pages[0]!, [pages, activeId]);
  const range = useMemo(() => normRange(sel.anchor, sel.focus), [sel]);
  const display = useMemo(() => evaluateSheet(page.cells), [page.cells]);
  const stats = useMemo(() => rangeStats(page, range), [page, range]);

  const applyPages = useCallback((next: SheetPage[]) => {
    undoRef.current.push(pagesRef.current);
    if (undoRef.current.length > 50) undoRef.current.shift();
    redoRef.current = [];
    setPages(next);
  }, []);

  function undo() {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(pagesRef.current);
    setPages(prev);
  }
  function redo() {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(pagesRef.current);
    setPages(next);
  }

  /* ----- 自动保存（防抖 700ms；序列化快照做基线，避免无关渲染触发保存） ----- */
  const lastSavedRef = useRef<string | null>(null);
  useEffect(() => {
    const snapshot = JSON.stringify(pages);
    if (lastSavedRef.current === null) {
      lastSavedRef.current = snapshot; // 挂载先记基线，不触发首次保存
      return;
    }
    // 变更在防抖窗口内被撤销时快照回到基线：无需落库，但要把 saving 状态归位
    if (snapshot === lastSavedRef.current) {
      setSaveState((prev) => (prev === "saving" ? "saved" : prev));
      return;
    }
    pendingRef.current = pages;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      void docFileService
        .saveSheets(file.id, pages)
        .then(() => {
          lastSavedRef.current = snapshot;
          pendingRef.current = null;
          setSaveState("saved");
        })
        .catch((e: unknown) => {
          setSaveState("error");
          toast.error(e instanceof Error ? e.message : t("updateFailed"));
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [pages, file.id, t, toast]);

  useEffect(() => {
    return () => {
      // 卸载兜底：把尚未过防抖间隔的页签数据立即落库
      if (!pendingRef.current) return;
      void docFileService.saveSheets(file.id, pendingRef.current).catch(() => {
        // 页面已离开无法再向用户反馈，此处兜底失败只能放弃（避免未处理 Promise 拒绝）
      });
    };
  }, [file.id]);

  /* ----- 选区与编辑 ----- */
  const clampTo = useCallback(
    (dims: { cols: number; rows: number }, pos: GridPos): GridPos => ({
      c: Math.max(0, Math.min(pos.c, dims.cols - 1)),
      r: Math.max(0, Math.min(pos.r, dims.rows - 1)),
    }),
    [],
  );
  const clampPos = useCallback((pos: GridPos) => clampTo(page, pos), [clampTo, page]);

  function moveFocus(dc: number, dr: number, extend = false) {
    setSel((prev) => {
      const focus = clampPos({ c: prev.focus.c + dc, r: prev.focus.r + dr });
      return { anchor: extend ? prev.anchor : focus, focus };
    });
  }

  /* 焦点触底自动补行（飞书/Excel 的无限行体验）：规模变化不是数据编辑，不入撤销栈 */
  useEffect(() => {
    if (sel.focus.r < page.rows - 1 || page.rows >= SHEET_MAX_ROWS) return;
    setPages((prev) => prev.map((p) => (p.id === page.id ? addRows(p, 20) : p)));
  }, [sel.focus.r, page.rows, page.id]);

  function startEdit(initial: string, at?: GridPos) {
    setEditing({ pos: at ?? sel.focus, draft: initial, source: "cell" });
  }

  /** 从公式栏进入编辑：不渲染单元格输入框，避免 autoFocus 抢走公式栏焦点 */
  function startFxEdit() {
    if (editing) return;
    setEditing({ pos: sel.focus, draft: focusRaw, source: "fx" });
  }
  function cancelEdit() {
    setEditing(null);
    gridRef.current?.focus();
  }

  function commitEdit(move: "down" | "right" | null) {
    if (!editing) return;
    const pos = editing.pos;
    applyPages(pagesRef.current.map((p) => (p.id === page.id ? writeCell(p, pos, editing.draft) : p)));
    setEditing(null);
    if (move === "down") {
      const to = clampPos({ c: pos.c, r: pos.r + 1 });
      setSel({ anchor: to, focus: to });
    } else if (move === "right") {
      const to = clampPos({ c: pos.c + 1, r: pos.r });
      setSel({ anchor: to, focus: to });
    }
    gridRef.current?.focus();
  }

  const focusKey = refKey(sel.focus.c, sel.focus.r);
  const focusRaw = page.cells[focusKey]?.v ?? "";
  const formulaValue = editing ? editing.draft : focusRaw;

  function onGridKeyDown(e: React.KeyboardEvent) {
    if (editing) return; // 编辑态由单元格输入框的 keydown 接管
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const mod = e.ctrlKey || e.metaKey;
    if (e.key in arrows) {
      e.preventDefault();
      const [dc, dr] = arrows[e.key]!;
      moveFocus(dc, dr, e.shiftKey);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      moveFocus(e.shiftKey ? -1 : 1, 0);
      return;
    }
    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      startEdit(focusRaw);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      applyPages(pagesRef.current.map((p) => (p.id === page.id ? clearRange(p, range) : p)));
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      const to = mod ? { c: 0, r: 0 } : { c: 0, r: sel.focus.r };
      setSel({ anchor: to, focus: to });
      return;
    }
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (!mod && !e.altKey && e.key.length === 1) {
      e.preventDefault();
      startEdit(e.key); // 直接键入 = 替换单元格内容（Excel 惯例）
    }
  }

  function onCopy(e: React.ClipboardEvent) {
    e.clipboardData.setData("text/plain", rangeTsv(page, range));
    e.preventDefault();
  }
  function onCut(e: React.ClipboardEvent) {
    e.clipboardData.setData("text/plain", rangeTsv(page, range));
    e.preventDefault();
    applyPages(pagesRef.current.map((p) => (p.id === page.id ? clearRange(p, range) : p)));
  }
  function onPaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const block = parseClipboardTsv(text);
    const start = sel.focus;
    if (block.length === 1 && block[0]!.length === 1) {
      applyPages(pagesRef.current.map((p) => (p.id === page.id ? writeCell(p, start, block[0]![0]!) : p)));
      return;
    }
    const { page: nextPage, end } = writeBlock(page, start, block);
    applyPages(pagesRef.current.map((p) => (p.id === page.id ? nextPage : p)));
    setSel({ anchor: start, focus: clampTo(nextPage, end) });
  }

  /* ----- 鼠标选区 / 拖选 / 填充柄 ----- */
  useEffect(() => {
    const stop = () => {
      draggingRef.current = false;
      if (fillDragRef.current) {
        const src = fillDragRef.current;
        const dst = fillRef.current?.dst ?? src;
        fillDragRef.current = null;
        setFill(null);
        // 拖出了范围才落盘：dst 比 src 大即执行填充并把选区切到填充结果
        if (dst.c1 !== src.c1 || dst.c2 !== src.c2 || dst.r1 !== src.r1 || dst.r2 !== src.r2) {
          applyPages(pagesRef.current.map((p) => (p.id === page.id ? fillRange(p, src, dst) : p)));
          setSel({ anchor: { c: dst.c1, r: dst.r1 }, focus: { c: dst.c2, r: dst.r2 } });
        }
      }
    };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, [applyPages, page.id]);

  /** 填充目标：源选区沿单轴延伸到指针格（Excel 语义；斜向拖拽取延伸更大的一轴） */
  function fillDst(src: GridRange, pos: GridPos): GridRange {
    const dC = pos.c < src.c1 ? src.c1 - pos.c : pos.c > src.c2 ? pos.c - src.c2 : 0;
    const dR = pos.r < src.r1 ? src.r1 - pos.r : pos.r > src.r2 ? pos.r - src.r2 : 0;
    if (dC === 0 && dR === 0) return src;
    if (dR === 0 || (dC > 0 && dC >= dR)) {
      return { r1: src.r1, r2: src.r2, c1: Math.min(src.c1, pos.c), c2: Math.max(src.c2, pos.c) };
    }
    return { c1: src.c1, c2: src.c2, r1: Math.min(src.r1, pos.r), r2: Math.max(src.r2, pos.r) };
  }

  function startFillDrag(e: React.MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    gridRef.current?.focus();
    const src = range;
    fillDragRef.current = src;
    setFill({ src, dst: src });
  }

  function cellMouseDown(e: React.MouseEvent, c: number, r: number) {
    if (e.button !== 0) return;
    e.preventDefault(); // 阻止文本选中，焦点由网格容器持有
    gridRef.current?.focus();
    // 公式栏编辑中点别处 = 放弃编辑（Excel 语义：不落盘）
    if (editing?.source === "fx") setEditing(null);
    const pos = { c, r };
    setSel((prev) => ({ anchor: e.shiftKey ? prev.anchor : pos, focus: pos }));
    draggingRef.current = true;
  }

  function cellMouseEnter(c: number, r: number) {
    if (fillDragRef.current) {
      setFill((prev) => (prev ? { ...prev, dst: fillDst(prev.src, { c, r }) } : prev));
      return;
    }
    if (!draggingRef.current) return;
    setSel((prev) => ({ ...prev, focus: { c, r } }));
  }

  function openMenu(e: React.MouseEvent, target: MenuTarget) {
    e.preventDefault();
    // 右键落在选区外时，先把选区移到目标格（表格惯例）
    if (target.kind === "cell") {
      const inside =
        target.pos.c >= range.c1 && target.pos.c <= range.c2 && target.pos.r >= range.r1 && target.pos.r <= range.r2;
      if (!inside) setSel({ anchor: target.pos, focus: target.pos });
    }
    setMenu({ x: e.clientX, y: e.clientY, target });
  }

  // 菜单开着时：点击外部 / Esc / 滚动 关闭（菜单自身 mousedown 已 stopPropagation）
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  /* ----- 右键菜单动作 ----- */
  /** 对当前页签应用变换并入撤销栈；返回应用后的全量页签（上限触发时回退并提示） */
  function mapCurrent(fn: (p: SheetPage) => SheetPage | null): SheetPage[] {
    let failed = false;
    const next = pagesRef.current.map((p) => {
      if (p.id !== page.id) return p;
      const applied = fn(p);
      if (applied === null) failed = true;
      return applied ?? p;
    });
    applyPages(next);
    if (failed) toast.error(t("sheetRowsMax"));
    return next;
  }
  function selectSingle(pos: GridPos, dims: { cols: number; rows: number }) {
    const to = clampTo(dims, pos);
    setSel({ anchor: to, focus: to });
  }

  /** 行列/剪贴动作（右键菜单与工具栏共用）：按 action 分发，插删后选区随平移 */
  function runGridAction(action: string) {
    setMenu(null);
    switch (action) {
      case "insertRowAbove": {
        mapCurrent((p) => insertRow(p, range.r1));
        setSel((prev) => ({
          anchor: { c: prev.anchor.c, r: prev.anchor.r >= range.r1 ? prev.anchor.r + 1 : prev.anchor.r },
          focus: { c: prev.focus.c, r: prev.focus.r >= range.r1 ? prev.focus.r + 1 : prev.focus.r },
        }));
        break;
      }
      case "insertRowBelow": {
        const at = range.r2 + 1;
        mapCurrent((p) => insertRow(p, at));
        setSel((prev) => ({
          anchor: { c: prev.anchor.c, r: prev.anchor.r >= at ? prev.anchor.r + 1 : prev.anchor.r },
          focus: { c: prev.focus.c, r: prev.focus.r >= at ? prev.focus.r + 1 : prev.focus.r },
        }));
        break;
      }
      case "insertColLeft": {
        mapCurrent((p) => insertCol(p, range.c1));
        setSel((prev) => ({
          anchor: { c: prev.anchor.c >= range.c1 ? prev.anchor.c + 1 : prev.anchor.c, r: prev.anchor.r },
          focus: { c: prev.focus.c >= range.c1 ? prev.focus.c + 1 : prev.focus.c, r: prev.focus.r },
        }));
        break;
      }
      case "insertColRight": {
        const at = range.c2 + 1;
        mapCurrent((p) => insertCol(p, at));
        setSel((prev) => ({
          anchor: { c: prev.anchor.c >= at ? prev.anchor.c + 1 : prev.anchor.c, r: prev.anchor.r },
          focus: { c: prev.focus.c >= at ? prev.focus.c + 1 : prev.focus.c, r: prev.focus.r },
        }));
        break;
      }
      case "deleteRow": {
        // 多行删除从下往上删，避免索引位移；删后选区收敛到原首行位置
        const next = mapCurrent((p0) => {
          let p = p0;
          for (let r = range.r2; r >= range.r1; r--) p = deleteRow(p, r);
          return p;
        });
        const dims = next.find((p) => p.id === page.id)!;
        selectSingle({ c: sel.focus.c, r: range.r1 }, dims);
        break;
      }
      case "deleteCol": {
        const next = mapCurrent((p0) => {
          let p = p0;
          for (let c = range.c2; c >= range.c1; c--) p = deleteCol(p, c);
          return p;
        });
        const dims = next.find((p) => p.id === page.id)!;
        selectSingle({ c: range.c1, r: sel.focus.r }, dims);
        break;
      }
      case "clear":
        mapCurrent((p) => clearRange(p, range));
        break;
      case "copy":
        void navigator.clipboard
          ?.writeText(rangeTsv(page, range))
          .then(() => toast.success(t("sheetMenuCopy")), () => toast.error(t("updateFailed")));
        break;
      case "cut":
        void navigator.clipboard?.writeText(rangeTsv(page, range)).then(
          () => {
            applyPages(pagesRef.current.map((p) => (p.id === page.id ? clearRange(p, range) : p)));
          },
          () => toast.error(t("updateFailed")),
        );
        break;
    }
  }

  /* ----- 工具栏格式动作 ----- */
  function rangeHas(style: SheetStyleKey): boolean {
    for (let r = range.r1; r <= range.r2; r++) {
      for (let c = range.c1; c <= range.c2; c++) {
        if (!page.cells[refKey(c, r)]?.s?.[style]) return false;
      }
    }
    return true;
  }
  function applyStyleToggle(style: SheetStyleKey) {
    const on = !rangeHas(style);
    applyPages(pagesRef.current.map((p) => (p.id === page.id ? toggleStyle(p, range, style, on) : p)));
  }
  function applyAlign(a: "left" | "center" | "right") {
    const current = page.cells[focusKey]?.s?.a;
    applyPages(pagesRef.current.map((p) => (p.id === page.id ? setAlign(p, range, current === a ? null : a) : p)));
  }
  function applyNumfmt(f: "number" | "percent" | "currency" | null) {
    applyPages(pagesRef.current.map((p) => (p.id === page.id ? setNumfmt(p, range, f) : p)));
  }
  /** 取色浮层回调：选中色板条目写入选区文字/背景色；null = 清除 */
  function applyPalettePick(entry: PaletteEntry | null) {
    const kind = palette?.mode === "text" ? "fg" : "bg";
    const picked = palette;
    setPalette(null);
    if (!picked) return;
    applyPages(pagesRef.current.map((p) => (p.id === page.id ? setColor(p, range, kind, entry ? entry.id : null) : p)));
  }
  function applySort(asc: boolean) {
    const next = sortRange(page, range, { col: range.c1, asc });
    if (!next) {
      toast.error(t("sheetSortNeedRows"));
      return;
    }
    applyPages(pagesRef.current.map((p) => (p.id === page.id ? next : p)));
  }
  /** 冻结窗格是视图设置而非数据编辑：不入撤销栈，直接落页签 */
  function applyFrozen(kind: "row" | "col") {
    setPages((prev) => prev.map((p) => (p.id === page.id ? toggleFrozen(p, kind) : p)));
  }
  function clearStyle() {
    let next = toggleStyle(page, range, "b", false);
    next = toggleStyle(next, range, "i", false);
    next = toggleStyle(next, range, "u", false);
    next = toggleStyle(next, range, "s", false);
    next = setAlign(next, range, null);
    next = setNumfmt(next, range, null);
    next = setColor(next, range, "fg", null);
    next = setColor(next, range, "bg", null);
    const settled = next;
    applyPages(pagesRef.current.map((p) => (p.id === page.id ? settled : p)));
  }

  /* ----- 页签 ----- */
  function switchPage(id: string) {
    setActiveId(id);
    setEditing(null);
    setSel({ anchor: { c: 0, r: 0 }, focus: { c: 0, r: 0 } });
    gridRef.current?.focus();
  }
  function addPage() {
    const base = t("sheetDefaultPageName").replace(/\d+$/, "");
    const p = newPage(`${base}${pages.length + 1}`);
    applyPages([...pagesRef.current, p]);
    setActiveId(p.id);
    setSel({ anchor: { c: 0, r: 0 }, focus: { c: 0, r: 0 } });
  }
  function commitTabRename() {
    if (!renamingTab) return;
    const name = tabDraft.trim().slice(0, 50);
    if (name) {
      applyPages(pagesRef.current.map((p) => (p.id === renamingTab ? { ...p, name } : p)));
    }
    setRenamingTab(null);
  }
  function removeTab() {
    if (!pendingDeleteTab) return;
    if (pagesRef.current.length <= 1) {
      toast.error(t("sheetLastTabKeep"));
      setPendingDeleteTab(null);
      return;
    }
    const removedId = pendingDeleteTab.id;
    const next = pagesRef.current.filter((p) => p.id !== removedId);
    applyPages(next);
    if (activeId === removedId) {
      setActiveId(next[0]!.id);
      setSel({ anchor: { c: 0, r: 0 }, focus: { c: 0, r: 0 } });
    }
    setPendingDeleteTab(null);
  }

  /* ----- 列宽/行高拖拽（直接落库不入撤销栈：快照过碎） ----- */
  useEffect(() => {
    if (!resizing) return;
    const onMove =
      resizing.kind === "col"
        ? (e: MouseEvent) => {
            const w = Math.max(48, Math.min(400, Math.round(resizing.startW + e.clientX - resizing.startX)));
            setPages((prev) =>
              prev.map((p) => (p.id === page.id ? { ...p, colWidths: { ...p.colWidths, [String(resizing.c)]: w } } : p)),
            );
          }
        : (e: MouseEvent) => {
            const h = Math.max(20, Math.min(200, Math.round(resizing.startH + e.clientY - resizing.startY)));
            setPages((prev) =>
              prev.map((p) => (p.id === page.id ? { ...p, rowHeights: { ...p.rowHeights, [String(resizing.r)]: h } } : p)),
            );
          };
    const onUp = () => setResizing(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizing, page.id]);

  /* ----- 页签右键菜单：点击外部 / Esc / 滚动关闭 ----- */
  useEffect(() => {
    if (!tabMenu) return;
    const close = () => setTabMenu(null);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setTabMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [tabMenu]);

  /** 复制工作表：内容样式视图全量拷贝，插到原页签右侧并激活 */
  function duplicateTab(targetId: string) {
    setTabMenu(null);
    const src = pagesRef.current.find((p) => p.id === targetId);
    if (!src) return;
    const copy = clonePage(src, `${src.name.slice(0, 44)}${t("sheetTabCopySuffix")}`);
    const idx = pagesRef.current.findIndex((p) => p.id === targetId);
    const next = [...pagesRef.current.slice(0, idx + 1), copy, ...pagesRef.current.slice(idx + 1)];
    applyPages(next);
    setActiveId(copy.id);
    setSel({ anchor: { c: 0, r: 0 }, focus: { c: 0, r: 0 } });
  }

  /** 名称框回车跳转：支持 A1 与 A1:B3；非法输入直接还原展示 */
  function commitNameBox() {
    const raw = (nameBoxInput ?? "").trim().toUpperCase();
    setNameBoxInput(null);
    const parts = raw.split(":");
    const a = parseRefKey(parts[0] ?? "");
    const b = parts.length === 2 ? parseRefKey(parts[1]!) : a;
    if (!a || !b) return;
    const p1 = clampPos({ c: a.col, r: a.row });
    const p2 = clampPos({ c: b.col, r: b.row });
    setSel({ anchor: p1, focus: p2 });
    gridRef.current?.focus();
  }

  /* ----- 标题与导出 ----- */
  function commitTitle() {
    const trimmed = title.trim();
    if (!trimmed || trimmed === file.title) {
      setTitle(file.title);
      return;
    }
    void docFileService
      .rename(file.id, trimmed)
      .then(() => toast.success(t("saved")))
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : t("updateFailed"));
        setTitle(file.title);
      });
  }
  function exportCsv() {
    downloadTextFile(`${title.trim() || file.title}.csv`, pagesToCsv(pagesRef.current), "text/csv;charset=utf-8");
    toast.success(t("suiteExportDone"));
  }

  const statusText =
    saveState === "saving" ? t("suiteSaveSaving") : saveState === "error" ? t("suiteSaveFailed") : t("suiteSaveSaved");
  const nameBox =
    range.c1 === range.c2 && range.r1 === range.r2
      ? refKey(sel.focus.c, sel.focus.r)
      : `${refKey(range.c1, range.r1)}:${refKey(range.c2, range.r2)}`;
  const focusAlign = page.cells[focusKey]?.s?.a;
  const focusNumfmt = page.cells[focusKey]?.s?.f ?? "";
  const frozenRow = page.frozen === "row" || page.frozen === "both";
  const frozenCol = page.frozen === "col" || page.frozen === "both";

  /** 右键菜单项：[action, 文案, 图标]，三种挂载目标（行头/列头/单元格）各给定向增删集合 */
  const menuItems: readonly (readonly [string, string, IconName])[] =
    menu?.target.kind === "row"
      ? [
          ["insertRowAbove", t("sheetMenuInsertRowAbove"), "rowAbove"],
          ["insertRowBelow", t("sheetMenuInsertRowBelow"), "rowBelow"],
          ["deleteRow", t("sheetMenuDeleteRow"), "rowRemove"],
          ["clear", t("sheetMenuClear"), "eraser"],
        ]
      : menu?.target.kind === "col"
        ? [
            ["insertColLeft", t("sheetMenuInsertColLeft"), "colLeft"],
            ["insertColRight", t("sheetMenuInsertColRight"), "colRight"],
            ["deleteCol", t("sheetMenuDeleteCol"), "colRemove"],
            ["clear", t("sheetMenuClear"), "eraser"],
          ]
        : [
            ["copy", t("sheetMenuCopy"), "copy"],
            ["cut", t("sheetMenuCut"), "scissors"],
            ["insertRowAbove", t("sheetMenuInsertRowAbove"), "rowAbove"],
            ["insertRowBelow", t("sheetMenuInsertRowBelow"), "rowBelow"],
            ["deleteRow", t("sheetMenuDeleteRow"), "rowRemove"],
            ["insertColLeft", t("sheetMenuInsertColLeft"), "colLeft"],
            ["insertColRight", t("sheetMenuInsertColRight"), "colRight"],
            ["deleteCol", t("sheetMenuDeleteCol"), "colRemove"],
            ["clear", t("sheetMenuClear"), "eraser"],
          ];

  return (
    <div className="doc-page">
      <div className="doc-page__head">
        <button type="button" className="doc-page__back" onClick={() => navigate("/docs")} aria-label={t("backToDocs")}>
          <Icon name="back" size={15} />
          {t("docsMenu")}
        </button>
        <input
          className="suite-doc__title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTitle();
              gridRef.current?.focus();
            }
            if (e.key === "Escape") setTitle(file.title);
          }}
          aria-label={t("suiteTitleAria")}
          maxLength={200}
          spellCheck={false}
        />
        <span className={`doc-status${saveState === "error" ? " is-error" : ""}`} data-state={saveState}>
          {statusText}
        </span>
        <button type="button" className="btn" onClick={exportCsv}>
          <Icon name="download" size={14} />
          {t("suiteExportCsv")}
        </button>
      </div>

      {/* 飞书式工具栏：撤销/重做 + 字体样式 + 对齐 + 清格式（与网格选区联动） */}
      <div className="sheet-toolbar" role="toolbar" aria-label={t("sheetToolbarLabel")}>
        <button
          type="button"
          className="suite-toolbar__btn"
          title={t("suiteTbUndo")}
          aria-label={t("suiteTbUndo")}
          onClick={undo}
          disabled={!undoRef.current.length}
        >
          <Icon name="undo" size={15} />
        </button>
        <button
          type="button"
          className="suite-toolbar__btn"
          title={t("suiteTbRedo")}
          aria-label={t("suiteTbRedo")}
          onClick={redo}
          disabled={!redoRef.current.length}
        >
          <Icon name="redo" size={15} />
        </button>
        <span className="sheet-toolbar__divider" aria-hidden />
        {(
          [
            { key: "b", label: "B", labelKey: "suiteTbBold", cls: "is-b" },
            { key: "i", label: "I", labelKey: "suiteTbItalic", cls: "is-i" },
            { key: "u", label: "U", labelKey: "suiteTbUnderline", cls: "is-u" },
            { key: "s", label: "S", labelKey: "suiteTbStrike", cls: "is-s" },
          ] as const
        ).map((it) => (
          <button
            key={it.key}
            type="button"
            className={`suite-toolbar__btn ${it.cls}${rangeHas(it.key) ? " is-active" : ""}`}
            title={t(it.labelKey)}
            aria-label={t(it.labelKey)}
            aria-pressed={rangeHas(it.key)}
            onClick={() => applyStyleToggle(it.key)}
          >
            {it.label}
          </button>
        ))}
        <span className="sheet-toolbar__divider" aria-hidden />
        {(["left", "center", "right"] as const).map((a) => (
          <button
            key={a}
            type="button"
            className={`suite-toolbar__btn${focusAlign === a ? " is-active" : ""}`}
            title={t(a === "left" ? "sheetAlignLeft" : a === "center" ? "sheetAlignCenter" : "sheetAlignRight")}
            aria-label={t(a === "left" ? "sheetAlignLeft" : a === "center" ? "sheetAlignCenter" : "sheetAlignRight")}
            aria-pressed={focusAlign === a}
            onClick={() => applyAlign(a)}
          >
            <Icon name={a === "left" ? "alignLeft" : a === "center" ? "alignCenter" : "alignRight"} size={15} />
          </button>
        ))}
        <span className="sheet-toolbar__divider" aria-hidden />
        {/* 数字格式（常规/数值/百分比/货币），按焦点格显示当前值 */}
        <select
          className="sheet-toolbar__select"
          value={focusNumfmt}
          onChange={(e) => applyNumfmt(e.target.value === "" ? null : (e.target.value as "number" | "percent" | "currency"))}
          title={t("sheetNumfmt")}
          aria-label={t("sheetNumfmt")}
        >
          <option value="">{t("sheetNumfmtGeneral")}</option>
          <option value="number">{t("sheetNumfmtNumber")}</option>
          <option value="percent">{t("sheetNumfmtPercent")}</option>
          <option value="currency">{t("sheetNumfmtCurrency")}</option>
        </select>
        {(["text", "fill"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`suite-toolbar__btn is-color${palette?.mode === mode ? " is-active" : ""}`}
            title={mode === "text" ? t("suiteColorText") : t("suiteColorBg")}
            aria-label={mode === "text" ? t("suiteColorText") : t("suiteColorBg")}
            aria-pressed={palette?.mode === mode}
            aria-haspopup="menu"
            onClick={(e) => {
              if (palette?.mode === mode) {
                setPalette(null);
                return;
              }
              const rect = e.currentTarget.getBoundingClientRect();
              setPalette({ mode, x: rect.left, y: rect.bottom + 6 });
            }}
          >
            <span className="doc-color-glyph" aria-hidden>
              A<span className="doc-color-glyph__bar" data-mode={mode} />
            </span>
          </button>
        ))}
        <span className="sheet-toolbar__divider" aria-hidden />
        {(
          [
            { asc: true, icon: "sortAsc" as const, labelKey: "sheetSortAsc" as const },
            { asc: false, icon: "sortDesc" as const, labelKey: "sheetSortDesc" as const },
          ] as const
        ).map((it) => (
          <button
            key={it.labelKey}
            type="button"
            className="suite-toolbar__btn"
            title={t(it.labelKey)}
            aria-label={t(it.labelKey)}
            onClick={() => applySort(it.asc)}
          >
            <Icon name={it.icon} size={15} />
          </button>
        ))}
        {/* 冻结首行/首列：面板图标实心带即被钉住的行/列（复用表头图标形） */}
        {(
          [
            { kind: "row" as const, icon: "headerRow" as const, labelKey: "sheetFreezeRow" as const, on: frozenRow },
            { kind: "col" as const, icon: "headerCol" as const, labelKey: "sheetFreezeCol" as const, on: frozenCol },
          ] as const
        ).map((it) => (
          <button
            key={it.kind}
            type="button"
            className={`suite-toolbar__btn${it.on ? " is-active" : ""}`}
            title={t(it.labelKey)}
            aria-label={t(it.labelKey)}
            aria-pressed={it.on}
            onClick={() => applyFrozen(it.kind)}
          >
            <Icon name={it.icon} size={15} />
          </button>
        ))}
        <span className="sheet-toolbar__divider" aria-hidden />
        {/* 行列快捷操作：与右键菜单同源命令，作用于当前选区（插删后选区随平移） */}
        {(
          [
            { action: "insertRowAbove", icon: "rowAbove" as const, labelKey: "sheetMenuInsertRowAbove" as const },
            { action: "insertRowBelow", icon: "rowBelow" as const, labelKey: "sheetMenuInsertRowBelow" as const },
            { action: "deleteRow", icon: "rowRemove" as const, labelKey: "sheetMenuDeleteRow" as const },
            { action: "insertColLeft", icon: "colLeft" as const, labelKey: "sheetMenuInsertColLeft" as const },
            { action: "insertColRight", icon: "colRight" as const, labelKey: "sheetMenuInsertColRight" as const },
            { action: "deleteCol", icon: "colRemove" as const, labelKey: "sheetMenuDeleteCol" as const },
          ] as const
        ).map((it) => (
          <button
            key={it.action}
            type="button"
            className="suite-toolbar__btn"
            title={t(it.labelKey)}
            aria-label={t(it.labelKey)}
            onClick={() => runGridAction(it.action)}
          >
            <Icon name={it.icon} size={15} />
          </button>
        ))}
        <button
          type="button"
          className="suite-toolbar__btn"
          title={t("sheetClearStyle")}
          aria-label={t("sheetClearStyle")}
          onClick={clearStyle}
        >
          <Icon name="eraser" size={15} />
        </button>
      </div>

      {/* 名称框（可输入 A1 / A1:B3 回车跳转）+ 公式栏：编辑中给 ✓/✗ 确认取消（飞书交互） */}
      <div className="sheet-bar">
        <input
          className="sheet-bar__name"
          value={nameBoxInput ?? nameBox}
          aria-label={t("sheetNameBoxLabel")}
          title={t("sheetNameBoxJump")}
          onFocus={() => setNameBoxInput(nameBox)}
          onChange={(e) => setNameBoxInput(e.target.value)}
          onBlur={() => setNameBoxInput(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitNameBox();
            }
            if (e.key === "Escape") setNameBoxInput(null);
          }}
          spellCheck={false}
        />
        <span className="sheet-bar__fx" aria-hidden>
          fx
        </span>
        <input
          className="sheet-bar__formula"
          value={formulaValue}
          onFocus={startFxEdit}
          onChange={(e) =>
            setEditing((prev) =>
              prev
                ? { ...prev, draft: e.target.value }
                : { pos: sel.focus, draft: e.target.value, source: "fx" },
            )
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitEdit(null);
            }
            if (e.key === "Tab") {
              e.preventDefault();
              commitEdit("right");
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancelEdit();
            }
          }}
          aria-label={t("sheetFormulaLabel")}
          spellCheck={false}
        />
        {editing && (
          <>
            <button
              type="button"
              className="sheet-bar__btn is-ok"
              title={t("sheetFxOk")}
              aria-label={t("sheetFxOk")}
              onClick={() => commitEdit(null)}
            >
              <Icon name="check" size={14} />
            </button>
            <button
              type="button"
              className="sheet-bar__btn is-cancel"
              title={t("sheetFxCancel")}
              aria-label={t("sheetFxCancel")}
              onClick={cancelEdit}
            >
              <Icon name="close" size={14} />
            </button>
          </>
        )}
      </div>

      <div
        ref={gridRef}
        className="sheet-grid"
        role="grid"
        aria-label={t("sheetGridLabel")}
        aria-rowcount={page.rows}
        aria-colcount={page.cols}
        tabIndex={0}
        onKeyDown={onGridKeyDown}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
      >
        <table className="sheet-table">
          <colgroup>
            <col className="sheet-col-head" />
            {Array.from({ length: page.cols }, (_, c) => (
              <col key={c} style={{ width: `${page.colWidths[String(c)] ?? 100}px` }} />
            ))}
          </colgroup>
          <tbody>
            <tr className="sheet-head-row">
              <th className="sheet-corner" scope="col">
                <button
                  type="button"
                  className="sheet-corner__btn"
                  aria-label={t("sheetGridLabel")}
                  onClick={() => {
                    gridRef.current?.focus();
                    setSel({ anchor: { c: 0, r: 0 }, focus: { c: page.cols - 1, r: page.rows - 1 } });
                  }}
                />
              </th>
              {Array.from({ length: page.cols }, (_, c) => (
                <th
                  key={c}
                  scope="col"
                  className={`sheet-th${c >= range.c1 && c <= range.c2 ? " is-head" : ""}`}
                  onClick={() => {
                    gridRef.current?.focus();
                    setSel({ anchor: { c, r: 0 }, focus: { c, r: page.rows - 1 } });
                  }}
                  onContextMenu={(e) => openMenu(e, { kind: "col", c })}
                >
                  {colToName(c)}
                  {/* 列宽拖拽把手：纯指针交互（双击复位），语义对读屏隐藏，列本身可经表头点击/菜单操作 */}
                  <span
                    className="sheet-resizer"
                    aria-hidden="true"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setResizing({ kind: "col", c, startX: e.clientX, startW: page.colWidths[String(c)] ?? 100 });
                    }}
                    onDoubleClick={(e) => {
                      // 双击列边界：清除该列自定义宽，回到默认
                      e.preventDefault();
                      e.stopPropagation();
                      setPages((prev) => {
                        const widths = { ...page.colWidths };
                        delete widths[String(c)];
                        return prev.map((p) => (p.id === page.id ? { ...p, colWidths: widths } : p));
                      });
                    }}
                  />
                </th>
              ))}
            </tr>
            {Array.from({ length: page.rows }, (_, r) => (
              <tr key={r} aria-rowindex={r + 1} style={{ height: `${page.rowHeights[String(r)] ?? 28}px` }}>
                <th
                  scope="row"
                  className={`sheet-th sheet-th--row${r >= range.r1 && r <= range.r2 ? " is-head" : ""}${r === 0 && frozenRow ? " is-frozen-row" : ""}`}
                  onClick={() => {
                    gridRef.current?.focus();
                    setSel({ anchor: { c: 0, r }, focus: { c: page.cols - 1, r } });
                  }}
                  onContextMenu={(e) => openMenu(e, { kind: "row", r })}
                >
                  {r + 1}
                  {/* 行高拖拽把手：纯指针交互（双击复位），语义对读屏隐藏，行本身可经行头点击/菜单操作 */}
                  <span
                    className="sheet-resizer sheet-resizer--row"
                    aria-hidden="true"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setResizing({ kind: "row", r, startY: e.clientY, startH: page.rowHeights[String(r)] ?? 28 });
                    }}
                    onDoubleClick={(e) => {
                      // 双击行下边界：清除该行自定义高，回到默认
                      e.preventDefault();
                      e.stopPropagation();
                      setPages((prev) => {
                        const heights = { ...page.rowHeights };
                        delete heights[String(r)];
                        return prev.map((p) => (p.id === page.id ? { ...p, rowHeights: heights } : p));
                      });
                    }}
                  />
                </th>
                {Array.from({ length: page.cols }, (_, c) => renderCell(c, r))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sheet-tabs">
        <ul className="sheet-tabs__list">
          {pages.map((p) => (
            <li key={p.id} className="sheet-tabs__item">
              {renamingTab === p.id ? (
                <input
                  className="sheet-tabs__rename"
                  value={tabDraft}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setTabDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitTabRename();
                    }
                    if (e.key === "Escape") setRenamingTab(null);
                  }}
                  onBlur={commitTabRename}
                  maxLength={50}
                  aria-label={t("sheetRenameTabHint")}
                />
              ) : (
                <>
                  <button
                    type="button"
                    className={`sheet-tab${p.id === activeId ? " is-active" : ""}`}
                    onClick={() => switchPage(p.id)}
                    onDoubleClick={() => {
                      setRenamingTab(p.id);
                      setTabDraft(p.name);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setTabMenu({ x: e.clientX, y: e.clientY, pageId: p.id });
                    }}
                    title={t("sheetRenameTabHint")}
                    aria-label={t("sheetPageAria", { name: p.name })}
                    aria-current={p.id === activeId ? "true" : undefined}
                  >
                    {p.name}
                  </button>
                  {p.id === activeId && pages.length > 1 && (
                    <button
                      type="button"
                      className="sheet-tab__close"
                      aria-label={t("sheetDeleteTabAria", { name: p.name })}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDeleteTab(p);
                      }}
                    >
                      <Icon name="close" size={11} />
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
          <li className="sheet-tabs__item">
            <button
              type="button"
              className="sheet-tabs__add"
              onClick={addPage}
              aria-label={t("sheetNewTabAria")}
              title={t("sheetNewTabAria")}
            >
              <Icon name="plus" size={13} />
            </button>
          </li>
        </ul>
        {stats && (
          <div className="sheet-stats" aria-live="polite">
            <span>
              {t("sheetStatusSum")} {formatCellValue(stats.sum)}
            </span>
            <span>
              {t("sheetStatusAvg")} {formatCellValue(stats.avg)}
            </span>
            <span>
              {t("sheetStatusCount")} {stats.count}
            </span>
          </div>
        )}
      </div>

      {/* 文字/背景取色浮层（工具栏触发），选中写入选区样式 */}
      {palette && (
        <ColorPalette
          mode={palette.mode}
          x={palette.x}
          y={palette.y}
          onPick={applyPalettePick}
          onClose={() => setPalette(null)}
        />
      )}

      {menu && (
        <div
          className="sheet-menu"
          style={{
            left: `${Math.min(menu.x, window.innerWidth - 200)}px`,
            top: `${Math.max(8, Math.min(menu.y, window.innerHeight - (menuItems.length * 32 + 24)))}px`,
          }}
          role="menu"
          tabIndex={-1}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {menuItems.map(([action, label, icon]) => (
            <button
              key={action}
              type="button"
              className="sheet-menu__item"
              role="menuitem"
              onClick={() => runGridAction(action)}
            >
              <Icon name={icon} size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}

      {/* 页签右键菜单：重命名 / 复制 / 删除（仅剩一页时删除禁用） */}
      {tabMenu && (
        <div
          className="sheet-menu"
          style={{
            left: `${Math.min(tabMenu.x, window.innerWidth - 180)}px`,
            top: `${Math.max(8, Math.min(tabMenu.y, window.innerHeight - 130))}px`,
          }}
          role="menu"
          tabIndex={-1}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="sheet-menu__item"
            role="menuitem"
            onClick={() => {
              setTabMenu(null);
              setRenamingTab(tabMenu.pageId);
              setTabDraft(pagesRef.current.find((p) => p.id === tabMenu.pageId)?.name ?? "");
            }}
          >
            {t("sheetTabMenuRename")}
          </button>
          <button type="button" className="sheet-menu__item" role="menuitem" onClick={() => duplicateTab(tabMenu.pageId)}>
            {t("sheetTabMenuCopy")}
          </button>
          <button
            type="button"
            className="sheet-menu__item is-danger"
            role="menuitem"
            disabled={pagesRef.current.length <= 1}
            onClick={() => {
              const target = pagesRef.current.find((p) => p.id === tabMenu.pageId) ?? null;
              setTabMenu(null);
              if (target) setPendingDeleteTab(target);
            }}
          >
            {t("sheetTabMenuDelete")}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDeleteTab)}
        title={t("sheetDeleteTabAria", { name: pendingDeleteTab?.name ?? "" })}
        message={t("sheetConfirmDeleteTab", { name: pendingDeleteTab?.name ?? "" })}
        danger
        onConfirm={() => void removeTab()}
        onCancel={() => setPendingDeleteTab(null)}
      />
    </div>
  );

  /** 单元格渲染（选中态边框、编辑态输入框、填充柄、公式结果展示都在这里） */
  function renderCell(c: number, r: number) {
    const key = refKey(c, r);
    const cell = page.cells[key];
    const value = display.get(key);
    const inRange = c >= range.c1 && c <= range.c2 && r >= range.r1 && r <= range.r2;
    const isFocus = sel.focus.c === c && sel.focus.r === r;
    const isEditingHere = editing !== null && editing.pos.c === c && editing.pos.r === r;
    const inFillSrc =
      fill !== null && c >= fill.src.c1 && c <= fill.src.c2 && r >= fill.src.r1 && r <= fill.src.r2;
    const inFillDst =
      fill !== null && c >= fill.dst.c1 && c <= fill.dst.c2 && r >= fill.dst.r1 && r <= fill.dst.r2;
    const cls = ["sheet-td"];
    if (inRange) cls.push("is-in-range");
    if (inRange && r === range.r1) cls.push("is-r-top");
    if (inRange && r === range.r2) cls.push("is-r-bottom");
    if (inRange && c === range.c1) cls.push("is-r-left");
    if (inRange && c === range.c2) cls.push("is-r-right");
    if (isFocus) cls.push("is-focus");
    if (inFillDst && !inFillSrc) cls.push("is-fill-preview");
    if (isEditingHere) cls.push("is-editing");
    if (cell?.s?.b) cls.push("is-b");
    if (cell?.s?.i) cls.push("is-i");
    if (cell?.s?.u) cls.push("is-u");
    if (cell?.s?.s) cls.push("is-s");
    if (cell?.s?.a === "center") cls.push("is-center");
    else if (cell?.s?.a === "right") cls.push("is-right");
    else if (typeof value === "number") cls.push("is-num"); // 数字默认右对齐（Excel 惯例）
    if (value !== undefined && isFormulaErrorCode(value)) cls.push("is-err");
    // 冻结窗格：首行钉在表头下方、首列钉在行头右侧（角格双钉）
    if (r === 0 && frozenRow) cls.push("is-frozen-row");
    if (c === 0 && frozenCol) cls.push("is-frozen-col");
    const fgEntry = paletteById(cell?.s?.fg);
    const bgEntry = paletteById(cell?.s?.bg);
    const style: React.CSSProperties = {
      // 浅底背景上的文字固定恒定墨色（无显式文字色时），双主题下都可读
      ...(bgEntry ? { background: bgEntry.value } : null),
      ...(fgEntry ? { color: fgEntry.value } : bgEntry ? { color: "var(--color-on-tint)" } : null),
    };
    return (
      <td
        key={c}
        role="gridcell"
        aria-selected={inRange}
        aria-colindex={c + 1}
        className={cls.join(" ")}
        style={style}
        onMouseDown={(e) => cellMouseDown(e, c, r)}
        onMouseEnter={() => cellMouseEnter(c, r)}
        onDoubleClick={() => startEdit(cell?.v ?? "")}
        onContextMenu={(e) => openMenu(e, { kind: "cell", pos: { c, r } })}
      >
        {/* 编辑中 fx 来源不渲染输入框（否则 autoFocus 会抢走公式栏焦点） */}
        {editing !== null && isEditingHere && editing.source === "cell" ? (
          <input
            className="sheet-cell-input"
            value={editing.draft}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setEditing({ ...editing, draft: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitEdit("down");
              }
              if (e.key === "Tab") {
                e.preventDefault();
                commitEdit("right");
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setEditing(null);
                gridRef.current?.focus();
              }
            }}
            onBlur={() => commitEdit(null)}
            spellCheck={false}
          />
        ) : value === undefined ? (
          ""
        ) : cell?.s?.f ? (
          formatCellWithStyle(value, cell.s.f)
        ) : (
          formatCellValue(value)
        )}
        {/* 填充柄：选区右下角小方块，纯指针交互，对读屏隐藏（键盘用户可复制粘贴达成同样效果） */}
        {editing === null && c === range.c2 && r === range.r2 && (
          <span className="sheet-fill-handle" aria-hidden="true" onMouseDown={startFillDrag} />
        )}
      </td>
    );
  }
}
