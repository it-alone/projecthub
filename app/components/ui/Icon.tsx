// 统一 SVG 图标集（Lucide 风格，24×24 viewBox，stroke 2）
export type IconName =
  | "kanban"
  | "bell"
  | "settings"
  | "plus"
  | "close"
  | "back"
  | "check"
  | "brand"
  | "calendar"
  | "user"
  | "download"
  | "upload"
  | "zap"
  | "home"
  | "trash"
  | "search"
  | "chevronRight"
  | "chevronLeft"
  | "chevronDown"
  | "more"
  | "flag"
  | "filter"
  | "panel"
  | "sun"
  | "moon"
  | "tag"
  | "table"
  | "link"
  | "timeline"
  | "copy"
  | "repeat"
  | "cornerDownRight"
  | "pencil"
  | "workflow"
  | "idcard"
  | "markdown"
  | "fileText"
  | "undo"
  | "redo"
  | "list"
  | "listOrdered"
  | "listTodo"
  | "indent"
  | "outdent"
  | "eraser"
  | "highlighter"
  | "divider"
  | "rowAbove"
  | "rowBelow"
  | "rowRemove"
  | "colLeft"
  | "colRight"
  | "colRemove"
  | "cellMerge"
  | "cellSplit"
  | "headerRow"
  | "headerCol"
  | "valignTop"
  | "valignMiddle"
  | "valignBottom"
  | "cellFill";

const PATHS: Record<IconName, React.ReactNode> = {
  kanban: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M8.5 17.5V7" />
      <path d="M15.5 12.5V7" />
    </>
  ),
  cornerDownRight: (
    <>
      <polyline points="15 10 20 15 15 20" />
      <path d="M4 4v7a4 4 0 0 0 4 4h12" />
    </>
  ),
  pencil: (
    <>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </>
  ),
  workflow: (
    <>
      <rect width="8" height="8" x="3" y="3" rx="2" />
      <path d="M7 11v4a2 2 0 0 0 2 2h4" />
      <rect width="8" height="8" x="13" y="13" rx="2" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>
  ),
  settings: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  plus: (
    <>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </>
  ),
  close: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  back: (
    <>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </>
  ),
  check: (
    <>
      <path d="M20 6 9 17l-5-5" />
    </>
  ),
  brand: (
    <>
      <rect x="9" y="2.5" width="6" height="6" rx="1.5" />
      <rect x="2.5" y="15.5" width="6" height="6" rx="1.5" />
      <rect x="15.5" y="15.5" width="6" height="6" rx="1.5" />
      <path d="M12 8.5v4" />
      <path d="M5.5 15.5v-2a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v2" />
    </>
  ),
  calendar: (
    <>
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 10h18" />
    </>
  ),
  user: (
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </>
  ),
  upload: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5" />
      <path d="M12 3v12" />
    </>
  ),
  zap: (
    <>
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </>
  ),
  home: (
    <>
      <path d="m3 9.5 9-7 9 7V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22v-8h6v8" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  timeline: (
    <>
      <path d="M4 6h9" />
      <path d="M4 12h16" />
      <path d="M4 18h6" />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  flag: (
    <>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <path d="M4 22v-7" />
    </>
  ),
  filter: <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />,
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </>
  ),
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />,
  tag: (
    <>
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M10 4v16" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  repeat: (
    <>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </>
  ),
  idcard: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <circle cx="8" cy="11" r="2" />
      <path d="M5 16.5c.6-1.6 1.7-2.2 3-2.2s2.4.6 3 2.2" />
      <path d="M14.5 10h4.5" />
      <path d="M14.5 14h3.5" />
    </>
  ),
  markdown: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M5.5 15.5V9l3.25 3.25L12 9v6.5" />
      <path d="M16.5 10v4.5" />
      <path d="m14.5 12.5 2 2 2-2" />
    </>
  ),
  fileText: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </>
  ),
  redo: (
    <>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </>
  ),
  listOrdered: (
    <>
      <path d="M10 6h11" />
      <path d="M10 12h11" />
      <path d="M10 18h11" />
      <path d="M4 6h1v4" />
      <path d="M4 10h2" />
      <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
    </>
  ),
  listTodo: (
    <>
      <rect x="3" y="5" width="6" height="6" rx="1" />
      <path d="m3 17 2 2 4-4" />
      <path d="M13 6h8" />
      <path d="M13 12h8" />
      <path d="M13 18h8" />
    </>
  ),
  indent: (
    <>
      <path d="M21 5H11" />
      <path d="M21 12h-7" />
      <path d="M21 19H11" />
      <path d="m3 8 4 4-4 4" />
    </>
  ),
  outdent: (
    <>
      <path d="M21 5H11" />
      <path d="M21 12h-7" />
      <path d="M21 19H11" />
      <path d="m7 8-4 4 4 4" />
    </>
  ),
  eraser: (
    <>
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </>
  ),
  highlighter: (
    <>
      <path d="m9 11-6 6v3h9l3-3" />
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
    </>
  ),
  divider: <path d="M4 12h16" />,
  // 表格操作组：行/列增删用「行/列线 + 加号/减号」隐喻，插入位置由加号相对行/列线的方位表达
  rowAbove: (
    <>
      <path d="M4 14h16" />
      <path d="M4 20h16" />
      <path d="M12 2v8" />
      <path d="M8 6h8" />
    </>
  ),
  rowBelow: (
    <>
      <path d="M4 4h16" />
      <path d="M4 10h16" />
      <path d="M12 14v8" />
      <path d="M8 18h8" />
    </>
  ),
  rowRemove: (
    <>
      <rect x="3" y="9" width="18" height="6" rx="1" />
      <path d="M9.5 12h5" />
    </>
  ),
  colLeft: (
    <>
      <path d="M14 4v16" />
      <path d="M20 4v16" />
      <path d="M2 12h8" />
      <path d="M6 8v8" />
    </>
  ),
  colRight: (
    <>
      <path d="M4 4v16" />
      <path d="M10 4v16" />
      <path d="M14 12h8" />
      <path d="M18 8v8" />
    </>
  ),
  colRemove: (
    <>
      <rect x="9" y="3" width="6" height="18" rx="1" />
      <path d="M12 9.5v5" />
    </>
  ),
  // 合并 = 箭头相向而行；拆分 = 箭头背向而行（镜像字形，语义互斥）
  cellMerge: (
    <>
      <path d="M2 12h20" />
      <path d="m6 8-4 4 4 4" />
      <path d="m18 8 4 4-4 4" />
    </>
  ),
  cellSplit: (
    <>
      <path d="M2 12h20" />
      <path d="m6 16-4-4 4-4" />
      <path d="m18 16 4-4-4-4" />
    </>
  ),
  // 表头切换：面板图形，实心带所在的行/列即表头
  headerRow: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 4h18v5H3z" fill="currentColor" />
    </>
  ),
  headerCol: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 4h5v16H3z" fill="currentColor" />
    </>
  ),
  // 垂直对齐：外框为单元格，横线的位置即内容对齐位置
  valignTop: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8" />
    </>
  ),
  valignMiddle: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 12h8" />
    </>
  ),
  valignBottom: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 17h8" />
    </>
  ),
  // 单元格背景填充：外框空格 + 内部实心方格
  cellFill: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="7.5" y="7.5" width="9" height="9" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
