// <web-music-ipod> 装配器
// 职责：
//  1. 拦截组件内部的 fetch('/includes/ipod/data/{storefront}/{language}.json')，
//     用内存中的当前数据集应答（组件没有 data 注入接口，这是唯一喂数据的通道）
//  2. 按当前"风味"加载组件 bundle（原版 / 墨水屏补丁版，两者定义同一个自定义元素，
//     因此一个页面生命周期只能加载一份，切换风味必须刷新页面）
//  3. 挂载/重建元素：换数据集 = 先 setDataset 再 mountIpod（组件挂载即拉取，locale 变更不触发重拉）

const DATA_PATH_RE = /\/includes\/ipod\/data\/([^/]+)\/([^/?#]+)\.json/;

const datasets = new Map(); // storefront -> dataset object
let defaultStorefront = null;

const realFetch = window.fetch.bind(window);

async function interceptedFetch(input, init) {
  const url = typeof input === "string" ? input : (input && input.url) || String(input);
  try {
    const u = new URL(url, location.href);
    const m = u.pathname.match(DATA_PATH_RE);
    if (m) {
      const ds = datasets.get(m[1]) || (m[1] === "index" ? null : datasets.get(defaultStorefront));
      // Apple 的语言回退链：{lang}.json 失败再请求 index.json —— 我们总能直接应答
      if (ds) {
        return new Response(JSON.stringify(ds), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response("", { status: 404, statusText: "Not Found" });
    }
  } catch (_) {
    /* 非法 URL，走原始 fetch */
  }
  return realFetch(input, init);
}

if (!window.__ipodFetchPatched) {
  window.fetch = interceptedFetch;
  window.__ipodFetchPatched = true;
}

export function setDataset(storefront, dataset, { makeDefault = false } = {}) {
  datasets.set(storefront, dataset);
  if (makeDefault || defaultStorefront === null) defaultStorefront = storefront;
}

export function getDataset(storefront) {
  return datasets.get(storefront);
}

export function clearDatasets() {
  datasets.clear();
  defaultStorefront = null;
}

let loadedFlavor = null;

// flavor: 'eink'（背光项已移除的补丁版） | 'original'（100% 原版）
export async function loadBundle(flavor) {
  if (loadedFlavor) {
    if (loadedFlavor !== flavor) {
      throw new Error(
        `组件 bundle 已按 "${loadedFlavor}" 风味加载；切换风味请刷新页面`
      );
    }
    return;
  }
  const mod =
    flavor === "original"
      ? await import("./vendor/web-music-ipod.esm.js")
      : await import("./vendor/web-music-ipod.eink.esm.js");
  await customElements.whenDefined("web-music-ipod");
  loadedFlavor = flavor;
  return mod;
}

export function currentFlavor() {
  return loadedFlavor;
}

// 挂载 iPod。所有对象/函数属性必须在 appendChild 之前赋值：
// 组件挂载即按 locale 拉取数据，属性必须先于连接就位。
export async function mountIpod(container, opts) {
  const {
    locale,               // { storefront, language }，必须
    i18n = null,          // { t(key, params) }，可选，缺省用组件内置英文
    playback = null,      // 播放适配器（宿主播放模式），null = 组件内置试听播放器
    backlit = null,       // false = 强制关闭背光（墨水屏）；null/undefined = 组件默认行为（原味模式）
    navigateToUrl = null, // (url) => void，正在播放页歌名链接
    applyTheme = null     // (element) => void，挂载后向 shadowRoot 注入主题
  } = opts;

  const { applyCompatTheme } = await import("./compat-theme.js");

  await loadBundle(opts.flavor || "eink");

  const existing = container.querySelector("web-music-ipod");
  if (existing) existing.remove();

  const el = document.createElement("web-music-ipod");
  el.locale = locale;
  if (i18n) el.i18n = i18n;
  if (playback) el.playback = playback;
  if (backlit !== null && backlit !== undefined) el.backlit = !!backlit;
  el.navigateToUrl = navigateToUrl || ((url) => window.open(url, "_blank", "noopener"));
  el.style.setProperty("display", "block");
  el.style.setProperty("width", "100%");
  el.style.setProperty("height", "100%");
  container.appendChild(el);

  applyCompatTheme(el); // 旧 WebView（如 Chrome 83 墨水屏）的 inset/逻辑属性兼容，现代浏览器空操作
  applyDeviceStyle(el); // 设备级增强：电池真实电量显示等
  if (applyTheme) applyTheme(el);
  return el;
}

// 设备级增强样式（两种风味都生效）
const DEVICE_CSS = `
/* 电池图标按真实电量填充（--device-battery 由 app.js 从 navigator.getBattery() 写入，0-100） */
.battery-indicator::after {
  width: calc(var(--device-battery, 100) * 0.84px) !important;
}
`;

export function applyDeviceStyle(el) {
  if (!el || !el.shadowRoot) return;
  if (el.shadowRoot.getElementById("device-style")) return;
  const style = document.createElement("style");
  style.id = "device-style";
  style.textContent = DEVICE_CSS;
  el.shadowRoot.appendChild(style);
}
