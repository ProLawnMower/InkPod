// 旧 WebView 兼容层（如本项目的墨水屏设备：Chrome 83）
//
// 组件 CSS 使用了 Chrome 87+ 的 `inset` 简写与 `inset-inline-*` / `margin-inline*` 逻辑属性，
// 在旧 WebView 上会被整体丢弃，导致：四个滚轮象限按钮坍缩为标签尺寸（无法点击）、
// 滚轮分隔线/进度滑块/加载遮罩全尺寸坍缩、电池图标和播放图标定位失效。
// 这里做特性检测：仅当浏览器不支持时注入长属性等效规则；现代浏览器零污染。

export const COMPAT_THEME_CSS = `
/* ---- Chrome < 87 兼容：inset 简写 → 长属性 + 显式尺寸 ----
   旧内核上 abs-pos 元素 width:auto 不随 left+right 拉伸（按钮会缩成标签宽），
   因此统一用 top/left + width/height:100% 显式定尺寸 */
.wheel-button,
.wheel-dividers,
.range-input,
.loading-screen,
.ipod-overlay-screen {
  top: 0 !important;
  left: 0 !important;
  width: 100% !important;
  height: 100% !important;
}
.ipod-container::before,
.ipod-container::after {
  top: 0 !important;
  left: 0 !important;
  width: 100% !important;
  height: 100% !important;
}
.ipod-shadow-inner::after {
  top: -2px !important;
  left: -2px !important;
  width: calc(100% + 4px) !important;
  height: calc(100% + 4px) !important;
}

/* ---- 逻辑属性 → 物理属性（LTR；旧内核本就不支持 RTL 逻辑属性） ---- */
.play-icon { left: 10px !important; }
.battery-indicator { right: 5px !important; }
.chevron { margin-right: 5px !important; }
.marquee-track {
  margin-left: auto !important;
  margin-right: auto !important;
}

/* ---- Chrome < 90 兼容：overflow: clip → hidden ----
   正在播放的进度/音量双面板（内部 200% 宽）与菜单滚动区都靠 clip 裁剪，
   旧内核 clip 无效会导致进度条和音量条同时可见 */
.now-playing,
.screen-body,
.ipod-container::before {
  overflow: hidden !important;
}

/* ---- Chrome < 104 兼容：rotate 独立变换属性不支持 ----
   组件用 rotate:180deg 镜像 Back（◀◀）图标，旧内核上静默失效导致
   左右两个方向键都显示 Forward（▶▶）。用经典 transform 补上，
   并与墨水屏模式的标签缩放系数复合（原味模式下该变量为 1） */
.click-wheel .back-button svg {
  transform: rotate(180deg) scale(var(--eink-label-scale, 1)) !important;
}

/* ---- 中心选择键圆形化（两种风味）----
   元素是 rotate(35deg) 的正方形，边框/焦点框在墨水屏上呈菱形；
   border-radius 50% 后旋转不可见（墨水屏主题里另有同款 !important 规则） */
.select-button {
  border-radius: 50% !important;
}
/* 注意：:focus-visible 是 Chrome 86+ 选择器，不能与 :focus 同组（旧内核连坐丢弃整条规则） */
.click-wheel :focus {
  outline: none !important;
}
.click-wheel :focus-visible {
  outline: none !important;
}
`;

let needsCompat = null;

export function detectCompatNeeded() {
  if (needsCompat === null) {
    try {
      needsCompat = !(
        window.CSS &&
        CSS.supports &&
        CSS.supports("inset", "0") &&
        CSS.supports("inset-inline-end", "5px")
      );
    } catch (_) {
      needsCompat = false;
    }
  }
  return needsCompat;
}

// 注入兼容样式（每次元素重建后调用一次；现代浏览器为空操作）
export function applyCompatTheme(el) {
  if (!detectCompatNeeded() || !el || !el.shadowRoot) return;
  if (el.shadowRoot.getElementById("compat-theme")) return;
  const style = document.createElement("style");
  style.id = "compat-theme";
  style.textContent = COMPAT_THEME_CSS;
  el.shadowRoot.appendChild(style);
}
