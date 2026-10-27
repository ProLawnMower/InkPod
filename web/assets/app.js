// 主控制器：模式状态机 + 设置面板 + 装配 iPod
// 无顶栏/底栏：全部功能收进设置面板，安卓返回键打开，桌面用 ⚙ 悬浮点（可关）
import { setDataset, mountIpod } from "./ipod-host.js";
import { applyEinkTheme } from "./eink-theme.js";
import { attachWheelStepper, ipodNavigateBack } from "./wheel-stepper.js";
import { Html5Playback } from "./playback-html5.js";
import * as LocalLib from "./local-library.js";
import * as Search from "./search.js";
import {
  configureMusicKit,
  fetchAppleMusicLibrary,
  buildAppleMusicDataset,
  MusicKitPlayback
} from "./playback-musickit.js";

const $ = (sel) => document.querySelector(sel);
const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

const state = {
  mode: localStorage.getItem("ipod-mode") || "guest",       // guest | local | applemusic
  flavor: localStorage.getItem("ipod-flavor") || "eink",    // eink | original
  guestStorefront: localStorage.getItem("ipod-guest-sf") || "us",
  guestDatasets: {},
  localScan: null,
  localDataset: null,
  localPlayback: null,
  amMusic: null,
  amPlayback: null,
  amDataset: null
};

// ---------- Toast（替代原底栏） ----------

let toastTimer = null;
function toast(text, { sticky = false } = {}) {
  const el = $("#toast");
  if (!text) { el.classList.remove("show"); return; }
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
function hideToast() { $("#toast").classList.remove("show"); }

const fmt = (n) => new Intl.NumberFormat("zh-Hans-CN").format(n);

function modeDescription() {
  const ds = currentDataset();
  if (state.mode === "guest") {
    return ds
      ? `Built-in library (${state.guestStorefront === "cn" ? "CN" : "US"}): ${fmt(ds.songs.length)} songs · ${fmt(ds.artists.length)} artists · ${fmt(ds.playlists.length)} playlists — 30s previews`
      : "Loading library…";
  }
  if (state.mode === "local") {
    return ds
      ? `Local music: ${fmt(ds.songs.length)} songs · ${fmt(ds.artists.length)} artists · ${fmt(ds.playlists.length)} playlists`
      : "Pick a music folder under ‘Local Music’ below first";
  }
  if (state.mode === "applemusic") {
    return ds
      ? `Apple Music snapshot: ${fmt(ds.songs.length)} songs · ${fmt(ds.playlists.length)} playlists`
      : "Experimental: enter a developer token and sign in";
  }
  return "";
}

function currentDataset() {
  if (state.mode === "guest") return state.guestDatasets[state.guestStorefront];
  if (state.mode === "local") return state.localDataset;
  if (state.mode === "applemusic") return state.amDataset;
  return null;
}

// ---------- 装配 ----------

async function mountCurrent() {
  const mount = $("#ipod-mount");
  const flavor = state.flavor;
  let locale = { storefront: "us", language: "en-US" };
  let playback = null;
  const ds = currentDataset();

  if (state.mode === "guest" && ds) {
    setDataset(state.guestStorefront, ds, { makeDefault: true });
    locale = { storefront: state.guestStorefront, language: "en-US" };
  } else if (state.mode === "local" && ds) {
    setDataset("local", ds, { makeDefault: true });
    locale = { storefront: "local", language: "en-US" };
    playback = state.localPlayback;
  } else if (state.mode === "applemusic" && ds) {
    setDataset("applemusic", ds, { makeDefault: true });
    locale = { storefront: "applemusic", language: "en-US" };
    playback = state.amPlayback;
  } else {
    setDataset(state.mode === "local" ? "local" : "applemusic",
      emptyDataset(state.mode === "local" ? "local" : "applemusic"), { makeDefault: true });
  }

  const el = await mountIpod(mount, {
    flavor,
    locale,
    playback,
    backlit: flavor === "eink" ? false : undefined,
    applyTheme: flavor === "eink" ? applyEinkTheme : null
  });
  state.ipodEl = el;
  if (flavor === "eink") attachWheelStepper(el);
  applyBatteryLevel();
  layoutEink();
  syncTabs();
  syncSettingsUI();
}

// ---------- 真实电量 ----------

const battery = { level: null, charging: false };

function applyBatteryLevel() {
  if (!state.ipodEl || battery.level === null) return;
  const lvl = Math.max(0, Math.min(100, Math.round(battery.level * 100)));
  state.ipodEl.style.setProperty("--device-battery", String(lvl));
}

async function initBattery() {
  if (!navigator.getBattery) return;
  try {
    const b = await navigator.getBattery();
    const sync = () => {
      battery.level = b.level;
      battery.charging = b.charging;
      applyBatteryLevel();
    };
    b.addEventListener("levelchange", sync);
    b.addEventListener("chargingchange", sync);
    sync();
  } catch (_) {}
}

function emptyDataset(storefront) {
  return { schemaVersion: 3, storefront, language: "zh-Hans-CN", songs: [], artists: [], playlists: [] };
}

// ---------- 模式切换 ----------

function setMode(mode) {
  state.mode = mode;
  localStorage.setItem("ipod-mode", mode);
  syncTabs();
  if (mode === "local" && !state.localDataset) maybeAutoScanLocal();
  if (mode === "applemusic" && !state.amDataset) syncSettingsUI();
  mountCurrent();
}

function syncTabs() {
  document.querySelectorAll("#mode-tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === state.mode);
  });
  const desc = $("#mode-desc");
  if (desc) desc.textContent = modeDescription();
}

// ---------- 本地模式 ----------

async function scanLocal({ auto = false } = {}) {
  try {
    toast("Scanning folder…", { sticky: true });
    const scan = await LocalLib.scanLocalLibrary({
      onProgress: (p) => {
        if (p.phase === "scan") toast("Scanning folder…", { sticky: true });
        else if (p.phase === "tags") toast(`Reading tags ${p.done}/${p.total}…`, { sticky: true });
      }
    });
    if (!scan.tracks.length) {
      toast(auto ? "No audio files found in that folder" : "No audio files found, try another folder", { sticky: true });
      return;
    }
    state.localScan = scan;
    state.localDataset = LocalLib.buildLocalDataset(scan);
    if (!state.localPlayback) {
      state.localPlayback = new Html5Playback({
        resolveTrackUrl: LocalLib.resolveTrackUrl,
        onEvent: (e) => {
          if (e.type === "error") toast(`Can't play: ${(e.detail && e.detail.message) || "unknown error"}`);
        }
      });
    }
    await mountCurrent();
    toast(`Loaded ${fmt(state.localDataset.songs.length)} local tracks`);
  } catch (err) {
    if (auto) { hideToast(); return; }
    toast(`Scan failed: ${err && err.message || err}`, { sticky: true });
  }
}

async function maybeAutoScanLocal() {
  if (state.localDataset) return;
  if (LocalLib.isAndroidApp() && LocalLib.hasRememberedFolder()) {
    await scanLocal({ auto: true });
  } else if (!LocalLib.isAndroidApp()) {
    const handle = await LocalLib.tryRestoreDesktopFolder();
    if (handle) await scanLocal({ auto: true });
  }
}

// ---------- 游客搜索 ----------

async function runSearch() {
  const term = $("#search-input").value.trim();
  if (!term) return;
  const resultsEl = $("#search-results");
  resultsEl.innerHTML = "<div class='muted'>Searching…</div>";
  try {
    const results = await Search.searchItunes(term, {
      country: state.guestStorefront === "cn" ? "CN" : "US"
    });
    if (!results.length) {
      resultsEl.innerHTML = "<div class='muted'>No results</div>";
      return;
    }
    resultsEl.innerHTML = "";
    for (const r of results.slice(0, 30)) {
      const row = document.createElement("div");
      row.className = "search-row";
      const info = document.createElement("div");
      info.className = "search-info";
      const t = document.createElement("div");
      t.textContent = r.name;
      const a = document.createElement("div");
      a.className = "muted";
      a.textContent = `${r.artistName}${r.albumName ? " · " + r.albumName : ""}`;
      info.append(t, a);
      const btn = document.createElement("button");
      btn.textContent = "加入";
      btn.onclick = async () => {
        const ds = state.guestDatasets[state.guestStorefront];
        const changed = Search.addSongsToGuestDataset(ds, [r]);
        btn.textContent = changed ? "Added" : "Already in library";
        btn.disabled = true;
        if (changed) {
          await mountCurrent();
          toast(`Added「${r.name}」`);
        }
      };
      row.append(info, btn);
      resultsEl.appendChild(row);
    }
  } catch (err) {
    resultsEl.innerHTML = `<div class='muted'>Search failed: ${err && err.message || err}</div>`;
  }
}

// ---------- Apple Music 模式（实验性） ----------

function getSavedToken() {
  return localStorage.getItem("ipod-am-token") || "";
}

async function appleMusicLogin() {
  const token = $("#am-token").value.trim() || getSavedToken();
  if (!token) {
    toast("Enter a MusicKit developer token first", { sticky: true });
    return;
  }
  localStorage.setItem("ipod-am-token", token);
  try {
    toast("Initializing MusicKit…", { sticky: true });
    if (!state.amMusic) state.amMusic = await configureMusicKit(token);
    if (!state.amMusic.isAuthorized) {
      toast("Sign in to Apple Music in the popup…", { sticky: true });
      await state.amMusic.authorize();
    }
    toast("Syncing your library…", { sticky: true });
    const lib = await fetchAppleMusicLibrary(state.amMusic, {
      onProgress: (p) => {
        if (p.phase === "songs") toast(`Fetching library songs ${p.done || ""}…`, { sticky: true });
        else if (p.phase === "playlist-tracks") toast(`Fetching playlist "${p.name || ""}"…`, { sticky: true });
      }
    });
    if (!lib.libSongs.length) {
      toast("Library is empty (or no Apple Music subscription)", { sticky: true });
      return;
    }
    state.amDataset = buildAppleMusicDataset(lib, state.guestStorefront);
    state.amPlayback = new MusicKitPlayback(state.amMusic);
    syncSettingsUI();
    await mountCurrent();
    toast(`Apple Music synced: ${fmt(state.amDataset.songs.length)} songs`);
  } catch (err) {
    toast(`Apple Music failed: ${err && err.message || err}`, { sticky: true });
  }
}

async function appleMusicLogout() {
  try {
    if (state.amMusic) await state.amMusic.unauthorize();
  } catch (_) {}
  state.amMusic = null;
  state.amPlayback = null;
  state.amDataset = null;
  syncSettingsUI();
  toast("Signed out of Apple Music");
}

// ---------- 收藏 ----------

async function toggleFavoriteCurrent() {
  if (!state.localPlayback || !state.localScan) {
    toast("Favorite works in Local mode while playing");
    return;
  }
  const id = state.localPlayback.currentTrackId;
  if (!id) {
    toast("Nothing is playing right now");
    return;
  }
  const added = LocalLib.toggleFavorite(id);
  state.localDataset = LocalLib.buildLocalDataset(state.localScan);
  await mountCurrent(); // 重建后适配器续播，不打断
  toast(added ? "Added收藏" : "Removed from Favorites");
}

// ---------- 原味模式 ----------

function setFlavor(flavor) {
  if (flavor === state.flavor) return;
  localStorage.setItem("ipod-flavor", flavor);
  location.reload();
}

// ---------- 布局 ----------
// 墨水屏模式：组件内部屏幕已 flex 拉伸（点对点原生渲染），
// 这里只按舞台尺寸计算滚轮直径（宽 92% 或高 44% 取小者）并同步标签缩放系数。
// 原味模式：整体 415×692 等比缩放。

function layoutEink() {
  if (state.flavor !== "eink" || !state.ipodEl) return;
  const stage = $("#stage");
  if (!stage) return;
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  const wheelPx = Math.round(Math.max(170, Math.min(W * 0.92, H * 0.44, 380)));
  state.ipodEl.style.setProperty("--eink-wheel-px", wheelPx + "px");
  state.ipodEl.style.setProperty("--eink-label-scale", (wheelPx / 350).toFixed(4));
}

function fitScale() {
  const stage = $("#stage");
  const fit = $("#ipod-fit");
  if (!stage || !fit) return;
  if (state.flavor === "eink") {
    layoutEink();
    return;
  }
  const availW = stage.clientWidth - 8;
  const availH = stage.clientHeight - 8;
  const k = Math.min(availW / 415, availH / 692);
  fit.style.transform = `translate(-50%, -50%) scale(${k})`;
}

// ---------- 面板 ----------

function openSettings() {
  syncSettingsUI();
  $("#overlay-settings").classList.remove("hidden");
}
function closeSettings() { $("#overlay-settings").classList.add("hidden"); }
function isSettingsOpen() { return !$("#overlay-settings").classList.contains("hidden"); }

function openSearch() {
  $("#overlay-search").classList.remove("hidden");
  $("#search-input").focus();
}
function closeSearch() { $("#overlay-search").classList.add("hidden"); }
function isSearchOpen() { return !$("#overlay-search").classList.contains("hidden"); }

function syncSettingsUI() {
  $("#sf-cn").classList.toggle("active", state.guestStorefront === "cn");
  $("#sf-us").classList.toggle("active", state.guestStorefront === "us");
  $("#flavor-eink").checked = state.flavor === "eink";
  $("#flavor-original").checked = state.flavor === "original";
  const tok = getSavedToken();
  if (tok && !$("#am-token").value) $("#am-token").value = tok;
  $("#am-status").textContent = state.amDataset
    ? `Signed in · ${fmt(state.amDataset.songs.length)} songs`
    : (state.amMusic && state.amMusic.isAuthorized ? "Signed in (not synced)" : "Not signed in");
  $("#local-scan-status").textContent = state.localDataset
    ? `${fmt(state.localDataset.songs.length)} loaded`
    : "Not scanned";
  syncTabs();
}

// ---------- UI 绑定 ----------

function bindUI() {
  // iPod Settings 菜单里的 "App Settings" 项（bundle 补丁注入）经此钩子打开设置面板
  window.__ipodOpenAppSettings = openSettings;

  document.querySelectorAll("#mode-tabs button").forEach((b) => {
    on(b, "click", () => setMode(b.dataset.mode));
  });

  on($("#btn-close-settings"), "click", closeSettings);
  on($("#overlay-settings"), "click", (e) => {
    if (e.target.id === "overlay-settings") closeSettings();
  });
  on($("#btn-search"), "click", openSearch);
  on($("#btn-close-search"), "click", closeSearch);
  on($("#overlay-search"), "click", (e) => {
    if (e.target.id === "overlay-search") closeSearch();
  });
  on($("#btn-run-search"), "click", runSearch);
  on($("#search-input"), "keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });

  on($("#sf-cn"), "click", () => switchGuestStorefront("cn"));
  on($("#sf-us"), "click", () => switchGuestStorefront("us"));

  on($("#btn-scan"), "click", () => scanLocal({ auto: false }));
  on($("#btn-forget-folder"), "click", () => {
    LocalLib.forgetFolder();
    toast("Folder forgotten, will ask again next time");
    $("#local-scan-status").textContent = "Not scanned";
  });
  on($("#btn-fav-current"), "click", toggleFavoriteCurrent);

  on($("#am-token"), "change", (e) => localStorage.setItem("ipod-am-token", e.target.value.trim()));
  on($("#btn-am-login"), "click", appleMusicLogin);
  on($("#btn-am-logout"), "click", appleMusicLogout);

  on($("#flavor-eink"), "change", (e) => { if (e.target.checked) setFlavor("eink"); });
  on($("#flavor-original"), "change", (e) => { if (e.target.checked) setFlavor("original"); });

  on($("#btn-exit"), "click", () => {
    const app = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (app && app.exitApp) app.exitApp();
    else window.close();
  });

  window.addEventListener("resize", fitScale);

  // Android 返回键：面板开着→关闭；都关着→打开设置
  const appPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (appPlugin && appPlugin.addListener) {
    appPlugin.addListener("backButton", () => {
      if (isSearchOpen()) closeSearch();
      else if (isSettingsOpen()) closeSettings();
      else if (!ipodNavigateBack(state.ipodEl)) openSettings();
    });
  }

  // 桌面浏览器兜底：Esc 打开/关闭设置
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (isSearchOpen()) closeSearch();
    else if (isSettingsOpen()) closeSettings();
    else openSettings();
  });
}

function switchGuestStorefront(sf) {
  if (sf === state.guestStorefront) return;
  state.guestStorefront = sf;
  localStorage.setItem("ipod-guest-sf", sf);
  syncSettingsUI();
  mountCurrent();
}

// ---------- 启动 ----------

async function init() {
  if (!localStorage.getItem("ipod-en-migrated")) {
    localStorage.removeItem("ipod-guest-sf");
    localStorage.setItem("ipod-en-migrated", "1");
  }
  document.body.classList.toggle("flavor-original", state.flavor === "original");
  bindUI();
  fitScale();
  syncTabs();
  initBattery();

  try {
    const [cn, us] = await Promise.all([
      fetch("data/cn.json").then((r) => r.json()),
      fetch("data/us.json").then((r) => r.json())
    ]);
    state.guestDatasets = { cn, us };
  } catch (err) {
    toast(`Failed to load built-in library: ${err && err.message || err}`, { sticky: true });
  }

  if (state.mode === "local") await maybeAutoScanLocal();
  await mountCurrent();

  // 首次启动提示入口（仅提示一次）
  if (!localStorage.getItem("ipod-hint-shown")) {
    localStorage.setItem("ipod-hint-shown", "1");
    toast("Press Back to open Settings (mode / local music / appearance)");
  }
}

init();
