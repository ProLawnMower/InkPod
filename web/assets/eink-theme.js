// 1-bit 墨水屏主题：向组件 open shadowRoot 追加 <style>，全部 !important 覆盖。
// 组件自身样式是普通 <style> 元素（非 adoptedStyleSheets），追加即可胜出。
// 选择器清单依据对 web-music-ipod.esm.js 内嵌 CSS 的逆向（见研究记录）。

export const EINK_THEME_CSS = `
/* ============ 1-bit 墨水屏主题 ============ */

/* ---- 重构布局（墨水屏专属）：屏幕自适应吃满可用空间，滚轮按剩余空间取尺寸 ----
   原版为固定 415×692 机身（屏幕 273×223 + 滚轮 350×350），近方形墨水屏上
   整体等比缩放会让屏幕过小；这里屏幕区 flex 拉伸（原生分辨率渲染，点对点），
   滚轮尺寸由宿主按舞台宽高计算（--eink-wheel-px），SVG 标签按比例缩放 */
.ipod, .ipod-shadow, .ipod-shadow-inner {
  width: 100% !important;
  height: 100% !important;
}
.ipod-shadow-inner { --ipod-scale: 1 !important; }
.ipod-container {
  width: 100% !important;
  height: 100% !important;
  box-sizing: border-box !important;
  border-radius: 0 !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  /* 四周缩进留白（底部由滚轮自带边距，略小） */
  padding: 22px 26px 12px !important;
}
.ipod-screen {
  flex: 1 1 auto !important;
  min-height: 0 !important;
  width: 100% !important;
  height: auto !important;
  margin: 0 !important;
  border-width: 3px !important;
  border-radius: 6px !important;
  box-sizing: border-box !important;
}
.menu-layer, .menu {
  height: 100% !important;
}
.menu {
  display: flex !important;
  flex-direction: column !important;
}
.screen-body {
  flex: 1 1 auto !important;
  min-height: 0 !important;
  height: auto !important;
}
.screen {
  height: 100% !important;
}
.now-playing {
  height: 100% !important;
}
.menu-items {
  height: 100% !important;
  max-height: 100% !important;
}
.click-wheel {
  flex: 0 0 auto !important;
  position: relative !important;
  top: 0 !important;
  margin: 6px auto 10px !important;
  width: var(--eink-wheel-px, 350px) !important;
  height: var(--eink-wheel-px, 350px) !important;
  /* 真机可用性：缩小滚动环半径，加宽外圈四键的触摸命中带（原版 ~10px 手指难以命中） */
  --scroll-wheel-pct: 68% !important;
}
/* 滚轮图标/文字随轮径等比缩放（原生 SVG 是固定 136/29/24px 设计尺寸） */
.wheel-button svg {
  transform: scale(var(--eink-label-scale, 1));
}

/* ---- 以下为视觉 1-bit 化 ---- */

/* 固定浅色配色，防系统深色模式注入 */
.ipod { color-scheme: light !important; }

/* ---- 去机身外壳（纯 CSS 机身：渐变/四层阴影/倒影/高光伪元素） ---- */
.ipod-container {
  background: none !important;
  background-image: none !important;
  box-shadow: none !important;
  border-color: transparent !important;
  -webkit-box-reflect: none !important;
}
.ipod-container::before,
.ipod-container::after,
.ipod-shadow-inner::before,
.ipod-shadow-inner::after { display: none !important; }
.ipod-shadow-inner {
  transition: none !important;
  --ipod-scale: 1 !important; /* 缩放交给外层容器，禁用容器查询重缩放 */
}

/* ---- 屏幕：纯白底、纯黑字、无底色/纹理/背光 ---- */
.ipod-screen {
  background: #fff !important;
  background-image: none !important;
  box-shadow: none !important;
  border-color: #000 !important;
  color: #000 !important;
  --ipod-screen-opacity: 1 !important;
  --ipod-bg-scrim: transparent !important;
  --ipod-faux-backlit: #fff !important;
  --screen-ink-inverse: #fff !important;
}
.ipod-screen::before,
.ipod-screen::after { display: none !important; }
.menu-title { border-bottom-color: #000 !important; }
.play-icon { fill: #000 !important; }
.battery-indicator { filter: brightness(0) !important; }

/* 菜单选中态：黑底白字 */
.menu-item.selected:not([data-action=info]) {
  background: #000 !important;
  color: #fff !important;
}
.menu-item.selected:not([data-action=info]) .item-value,
.menu-item.selected:not([data-action=info]) .chevron {
  color: #fff !important;
  border-color: #fff !important;
  fill: #fff !important;
}
.menu-item:not(.selected) .chevron { border-color: #000 !important; }
[data-action=inline-toggle] .item-value { color: #000 !important; }

/* Now Playing / 游戏 */
.now-playing .play-modifier,
.volume-labels { fill: #000 !important; }
.progress-bar { border-color: #000 !important; }
.progress-fill,
.progress-marker { background: #000 !important; }
.brick-game-screen .game-area { color: #000 !important; }

/* 隐藏屏幕内滚动条 */
.menu-items { scrollbar-width: none !important; }
.menu-items::-webkit-scrollbar { width: 0 !important; display: none !important; }

/* ---- 点击轮：白底黑轮廓，去渐变/噪点纹理/立体阴影 ---- */
.click-wheel {
  background: #fff !important;
  box-shadow: 0 0 0 2px #000 !important;
}
.click-wheel::after { display: none !important; }
.wheel-button svg,
.menu-button text { fill: #000 !important; }
.menu-button::after { display: none !important; }
.wheel-dividers::before,
.wheel-dividers::after { border-color: #000 !important; }
.wheel-dividers { outline: none !important; }
.scroll-wheel {
  --wheel-noise-texture: none !important;
  background: #fff !important;
  background-image: none !important;
  border-color: #000 !important;
  box-shadow: none !important;
}
.select-button {
  background: #fff !important;
  background-image: none !important;
  border-color: #000 !important;
  box-shadow: none !important;
  border-radius: 50% !important; /* 元素是旋转 35° 的正方形：圆形化后旋转不可见、边框呈正圆（修复菱形框线） */
}
/* 触屏设备：滚轮控件点按后的焦点外框会呈菱形（跟随旋转后的方框），去掉 */
/* 注意：:focus-visible 是 Chrome 86+ 选择器，不能与 :focus 同组（旧内核连坐丢弃整条规则） */
.click-wheel :focus {
  outline: none !important;
}
.click-wheel :focus-visible {
  outline: none !important;
}

/* ---- 动画全关（墨水屏） ----
   菜单切换动画压到 1ms 而非 display:none：
   Svelte 内部仍按自身时长等待退场节点，直接禁用会导致新旧屏幕重叠 */
.ipod-shadow-inner,
.scroll-wheel,
.select-button,
.now-playing-progress { transition: none !important; }
.screen { animation-duration: .001s !important; animation-delay: 0s !important; }

/* 跑马灯改静态省略号 */
.marquee-track {
  animation: none !important;
  display: block !important;
  width: auto !important;
}
.marquee-copy {
  display: block !important;
  max-width: 100% !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}
.marquee-copy[aria-hidden] { display: none !important; }

/* 按压反馈还原为 1（墨水屏无需缩放动画） */
.wheel-button:active svg,
.menu-button:active svg { scale: 1 !important; opacity: 1 !important; }
.select-button:active {
  transform: translate(-50%, -50%) rotate(35deg) !important;
  box-shadow: none !important;
}
`;

let themeStyleEl = null;

// 向组件 shadowRoot 注入主题（每次元素重建后调用一次）
export function applyEinkTheme(el) {
  if (!el || !el.shadowRoot) return;
  if (!themeStyleEl || themeStyleEl.isConnected === false || themeStyleEl.ownerDocument !== document) {
    themeStyleEl = document.createElement("style");
    themeStyleEl.id = "eink-theme";
    themeStyleEl.textContent = EINK_THEME_CSS;
  }
  // 每个新元素的 shadowRoot 都是新的，需要独立注入
  const existing = el.shadowRoot.getElementById("eink-theme");
  if (existing) existing.remove();
  const style = document.createElement("style");
  style.id = "eink-theme";
  style.textContent = EINK_THEME_CSS;
  el.shadowRoot.appendChild(style);
}
