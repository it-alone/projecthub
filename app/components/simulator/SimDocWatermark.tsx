/**
 * 证面「样本」水印：三枚斜置平铺，预览与导出的 PNG 均携带，
 * 确保示意卡片不会被误认成真实证件照。
 */
export function SimDocWatermark() {
  return (
    <div className="sim-wm" aria-hidden="true">
      <span>样本 SAMPLE · 仅供演示</span>
      <span>样本 SAMPLE · 仅供演示</span>
      <span>样本 SAMPLE · 仅供演示</span>
    </div>
  );
}
