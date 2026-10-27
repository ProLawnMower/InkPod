// 本地音乐库：扫描 → ID3 解析 → 专辑分组（多碟/曲序）→ 组装成 iPod 数据集
// 安卓（APK）：LocalMusic 插件固定枚举 /storage/emulated/0/Music（File API，免系统选择器）
// 桌面：File System Access API（Chrome/Edge）
// 音频流：安卓 https://localhost/local-music/<encoded 绝对路径>；桌面 blob URL

const AUDIO_EXT = new Set(["mp3", "m4a", "aac", "flac", "ogg", "oga", "opus", "wav", "wma", "aiff", "alac"]);
const PLAYLIST_EXT = new Set(["m3u", "m3u8"]);
const FAV_KEY = "ipod-local-favorites";
const FAV_PLAYLIST_ID = "pl-favorites";

// ---------- 通用工具 ----------

export function isAndroidApp() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function ext(name) {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

function baseName(name) {
  const i = name.lastIndexOf(".");
  return i < 0 ? name : name.slice(0, i);
}

// "Artist - Title" 文件名兜底解析
function guessFromFilename(name) {
  const base = baseName(name).replace(/^\d+[\s.\-_]+/, "");
  const m = base.split(/\s+-\s+/);
  if (m.length >= 2) {
    return { artistName: m[0].trim(), name: m.slice(1).join(" - ").trim() };
  }
  return { artistName: "Unknown Artist", name: base.trim() || name };
}

// 曲序解析："3"、"3/12" → 3
function parseTrackNo(v) {
  if (v === undefined || v === null) return 0;
  const m = String(v).match(/(\d+)/);
  return m ? parseInt(m[1], 10) || 0 : 0;
}

// 多碟与曲序推断（优先级：标签 > 路径 > 文件名）
// 路径模式：…/CD1/…、…/Disc 2/…；文件名模式："1-03 xxx"（碟-曲）、"03 xxx"（曲）
function detectDiscAndTrack(track, tags) {
  let disc = parseTrackNo(tags && tags.disc);
  let trackNo = parseTrackNo(tags && tags.track);

  const path = track.rel || "";
  const segs = path.split("/");
  const fileName = segs.length ? segs[segs.length - 1] : track.name || "";

  if (!disc) {
    for (const seg of segs.slice(0, -1)) {
      const m = seg.match(/^(?:cd|disc)\s*[-_ ]?\s*(\d+)/i);
      if (m) { disc = parseInt(m[1], 10); break; }
    }
  }
  const dt = baseName(fileName).match(/^(\d{1,2})\s*[-–]\s*(\d{1,3})\b/);
  if (!disc && dt) disc = parseInt(dt[1], 10);
  if (!trackNo) {
    if (dt) trackNo = parseInt(dt[2], 10);
    else {
      const t = baseName(fileName).match(/^(\d{1,3})[\s.\-_]+/);
      if (t) trackNo = parseInt(t[1], 10);
    }
  }
  return { disc: disc || 1, trackNo: trackNo || 0 };
}

// ---------- 极简 IndexedDB（仅存目录句柄） ----------

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("ipod-eink", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readonly");
    const req = tx.objectStore("kv").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------- ID3 解析（jsmediatags，限并发） ----------

function readTags(source) {
  return new Promise((resolve) => {
    if (!window.jsmediatags) return resolve(null);
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    // 超时兜底：部分文件头（如内嵌封面超出切片范围）会让解析器不回调
    setTimeout(() => finish(null), 5000);
    try {
      window.jsmediatags.read(source, {
        onSuccess: (r) => finish(r.tags || null),
        onError: () => finish(null)
      });
    } catch (_) {
      finish(null);
    }
  });
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---------- 桌面扫描 ----------

async function walkDirectory(dirHandle, prefix, audioFiles, playlistFiles) {
  for await (const [name, handle] of dirHandle.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      await walkDirectory(handle, path, audioFiles, playlistFiles);
    } else {
      const e = ext(name);
      if (AUDIO_EXT.has(e)) audioFiles.push({ path, handle });
      else if (PLAYLIST_EXT.has(e)) playlistFiles.push({ path, handle });
    }
  }
}

async function scanDesktop({ onProgress } = {}) {
  const dir = await window.showDirectoryPicker({ mode: "read" });
  await idbSet("music-dir-handle", dir);

  const audioFiles = [];
  const playlistFiles = [];
  await walkDirectory(dir, "", audioFiles, playlistFiles);
  onProgress && onProgress({ phase: "scan", total: audioFiles.length });

  const tracks = [];
  const fileById = new Map();
  await mapLimit(audioFiles, 4, async (f) => {
    const file = await f.handle.getFile();
    const id = "loc-" + hashStr(f.path);
    const tags = await readTags(file);
    const guess = guessFromFilename(f.path.split("/").pop());
    const track = {
      id,
      name: (tags && tags.title) || guess.name,
      artistName: (tags && tags.artist) || guess.artistName,
      albumName: (tags && tags.album) || "",
      rel: f.path
    };
    const dt = detectDiscAndTrack(track, tags);
    track.disc = dt.disc;
    track.trackNo = dt.trackNo;
    tracks.push(track);
    fileById.set(id, file);
    onProgress && onProgress({ phase: "tags", done: tracks.length, total: audioFiles.length });
  });

  // m3u 歌单
  const playlists = [];
  for (const pf of playlistFiles.slice(0, 100)) {
    try {
      const file = await pf.handle.getFile();
      const text = await file.text();
      const entries = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
      playlists.push({ id: "pl-m3u-" + hashStr(pf.path), name: baseName(pf.path), entries });
    } catch (_) {}
  }

  return { tracks, playlists, fileById, source: "desktop", folderName: dir.name };
}

// ---------- 安卓扫描（固定 /storage/emulated/0/Music） ----------

function localMusicPlugin() {
  const p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalMusic;
  if (!p) throw new Error("LocalMusic plugin not found (APK only)");
  return p;
}

async function scanAndroid({ onProgress } = {}) {
  const plugin = localMusicPlugin();
  let rootPath = null;
  try {
    rootPath = localStorage.getItem("ipod-android-folder");
  } catch (_) {}
  if (!rootPath) {
    const picked = await plugin.pickFolder(); // 固定目录 + 存储权限申请
    rootPath = picked.uri;
    localStorage.setItem("ipod-android-folder", rootPath);
  }
  onProgress && onProgress({ phase: "scan" });
  const { files } = await plugin.listFiles({ uri: rootPath });

  const tracks = [];
  const uriById = new Map();
  await mapLimit(files, 4, async (f) => {
    const id = "loc-" + hashStr(f.id);
    const guess = guessFromFilename(f.name);
    const rel = f.id.startsWith(rootPath) ? f.id.slice(rootPath.length + 1) : f.name;
    const track = {
      id,
      name: guess.name,
      artistName: guess.artistName,
      albumName: "",
      rel,
      _rawId: f.id
    };
    tracks.push(track);
    uriById.set(id, f.id);
    onProgress && onProgress({ phase: "tags", done: tracks.length, total: files.length });
  });

  // 先挂上映射表（播放地址解析需要）
  _androidIdMap = uriById;

  // 标签读取：Java 端切片文件头 → base64 → Blob → jsmediatags(BlobFileReader)。
  // 不走 XHR 流地址：该 WebView (Chromium 83) 对拦截响应的 Range 支持残缺。
  const lmPlugin = localMusicPlugin();
  await mapLimit(tracks, 3, async (t) => {
    try {
      const { base64 } = await Promise.race([
        lmPlugin.readHead({ uri: t._rawId, bytes: 131072 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('readHead timeout')), 10000))
      ]);
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes]);
      const tags = await readTags(blob);
      if (tags) {
        if (tags.title) t.name = tags.title;
        if (tags.artist) t.artistName = tags.artist;
        if (tags.album) t.albumName = tags.album;
      }
      const dt = detectDiscAndTrack(t, tags);
      t.disc = dt.disc;
      t.trackNo = dt.trackNo;
    } catch (_) {
      const dt = detectDiscAndTrack(t, null);
      t.disc = dt.disc;
      t.trackNo = dt.trackNo;
    }
  });

  return { tracks, playlists: [], uriById, source: "android", folderName: "/sdcard/Music" };
}

// ---------- 流地址 ----------

const streamUrlCache = new Map();
let _androidIdMap = null; // id -> 绝对路径
let _desktopFiles = null;

export function streamUrlFor(trackId) {
  if (isAndroidApp()) {
    const raw = _androidIdMap && _androidIdMap.get(trackId);
    const key = raw || trackId;
    return `${location.origin}/local-music/${encodeURIComponent(key)}`;
  }
  // 桌面：blob URL（懒创建，缓存）
  if (!streamUrlCache.has(trackId)) {
    const file = _desktopFiles && _desktopFiles.get(trackId);
    if (!file) return "";
    streamUrlCache.set(trackId, URL.createObjectURL(file));
  }
  return streamUrlCache.get(trackId);
}

export function resolveTrackUrl(trackId) {
  return streamUrlFor(trackId);
}

// ---------- 收藏 ----------

export function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
  } catch (_) {
    return [];
  }
}

export function toggleFavorite(trackId) {
  const list = getFavorites();
  const i = list.indexOf(trackId);
  if (i >= 0) list.splice(i, 1);
  else list.push(trackId);
  localStorage.setItem(FAV_KEY, JSON.stringify(list));
  return i < 0; // 返回 true=已收藏
}

// ---------- 专辑分组（多碟 → 曲序 → 名称） ----------

function buildAlbums(tracks) {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const albumMap = new Map();
  for (const t of tracks) {
    const relSegs = (t.rel || "").split("/");
    // 专辑名兜底：标签 > 曲目所在的第一层子目录名（按专辑放文件夹的习惯）
    const fallbackAlbum = relSegs.length > 1 ? relSegs[0].replace(/[_]+/g, " ").trim() : "";
    const albumName = t.albumName || fallbackAlbum || "Unknown Album";
    const key = `${t.artistName}｜${albumName}`;
    if (!albumMap.has(key)) {
      albumMap.set(key, {
        id: "alb-" + hashStr(key),
        name: albumName,
        artist: t.artistName,
        songIds: []
      });
    }
    albumMap.get(key).songIds.push(t.id);
  }
  const collator = new Intl.Collator("en", { numeric: true });
  for (const album of albumMap.values()) {
    album.songIds.sort((a, b) => {
      const ta = byId.get(a) || {};
      const tb = byId.get(b) || {};
      const da = ta.disc || 1, db = tb.disc || 1;
      if (da !== db) return da - db;
      const na = ta.trackNo || 0, nb = tb.trackNo || 0;
      if (na !== nb) return na - nb;
      return collator.compare(ta.name || "", tb.name || "");
    });
  }
  return [...albumMap.values()].sort((a, b) => collator.compare(a.name, b.name));
}

// ---------- 组装 iPod 数据集 ----------

export function buildLocalDataset(scanResult) {
  const { tracks, playlists, fileById, uriById } = scanResult;
  if (fileById) _desktopFiles = fileById;
  if (uriById) _androidIdMap = uriById;

  const collator = new Intl.Collator("en", { numeric: true });
  const sortKey = (t) =>
    `${t.artistName}\u0000${t.albumName || ""}\u0000${String(t.disc || 1).padStart(3, "0")}${String(t.trackNo || 0).padStart(4, "0")}\u0000${t.name}`;
  const sorted = tracks.slice().sort((a, b) => collator.compare(sortKey(a), sortKey(b)));

  const songs = sorted.map((t) => ({
    id: t.id,
    name: t.name,
    artistName: t.artistName || "Unknown Artist",
    albumName: t.albumName || "",
    previewUrl: streamUrlFor(t.id),
    playParams: { id: t.id, kind: "song" },
    url: null
  }));

  // 艺人分组
  const artistMap = new Map();
  for (const s of songs) {
    if (!artistMap.has(s.artistName)) {
      artistMap.set(s.artistName, { id: "ar-" + hashStr(s.artistName), name: s.artistName, songIds: [] });
    }
    artistMap.get(s.artistName).songIds.push(s.id);
  }
  const artists = [...artistMap.values()].sort((a, b) => collator.compare(a.name, b.name));

  // 专辑（"alb-" 前缀 → 组件的 Albums 入口）+ 歌单（收藏 + m3u）
  const albums = buildAlbums(sorted);

  const trackById = new Map(songs.map((s) => [s.id, s]));
  const baseToSong = new Map(songs.map((s) => [s.name.toLowerCase(), s.id]));
  const m3uPlaylists = playlists.map((pl) => {
    const songIds = [];
    for (const entry of pl.entries) {
      const base = baseName(entry.split("/").pop()).toLowerCase();
      const sid = baseToSong.get(base);
      if (sid) songIds.push(sid);
    }
    return { id: pl.id, name: pl.name, songIds };
  }).filter((p) => p.songIds.length);

  const outPlaylists = [
    { id: FAV_PLAYLIST_ID, name: "★ Favorites", songIds: getFavorites().filter((id) => trackById.has(id)) },
    ...albums,
    ...m3uPlaylists
  ];

  return {
    schemaVersion: 3,
    storefront: "local",
    language: "en-US",
    songs,
    artists,
    playlists: outPlaylists
  };
}

// ---------- 对外主入口 ----------

export async function scanLocalLibrary({ onProgress } = {}) {
  if (isAndroidApp()) return scanAndroid({ onProgress });
  if (!window.showDirectoryPicker) {
    throw new Error("This browser can't pick folders (use Chrome/Edge, or the APK)");
  }
  return scanDesktop({ onProgress });
}

// 重置记忆的文件夹（安卓下次进入本地模式重新走权限/目录检查）
export function forgetFolder() {
  localStorage.removeItem("ipod-android-folder");
}

export function hasRememberedFolder() {
  try {
    return !!localStorage.getItem("ipod-android-folder");
  } catch (_) {
    return false;
  }
}

// 桌面端尝试恢复上次文件夹（权限可能需要重新授予）
export async function tryRestoreDesktopFolder() {
  if (isAndroidApp() || !window.showDirectoryPicker) return null;
  const handle = await idbGet("music-dir-handle");
  if (!handle) return null;
  try {
    const perm = await handle.queryPermission({ mode: "read" });
    if (perm === "granted") return handle;
    return null;
  } catch (_) {
    return null;
  }
}
