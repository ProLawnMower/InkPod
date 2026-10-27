// Apple Music 模式（实验性）：MusicKit JS v3 播放适配器 + 个人曲库拉取/映射
// 依赖：https://js-cdn.music.apple.com/musickit/v3/musickit.js（按需动态加载，禁止自托管）
// 限制：完整播放需要 developer token + Apple Music 订阅；DRM 在 WebView/墨水屏 ROM 上未验证，
//       失败时 MusicKit 自动回退 30 秒试听。

import { writable } from "./playback-html5.js";

const MUSICKIT_SRC = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
let musicKitLoading = null;

export function loadMusicKitScript() {
  if (window.MusicKit) return Promise.resolve();
  if (musicKitLoading) return musicKitLoading;
  musicKitLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = MUSICKIT_SRC;
    s.async = true;
    s.onload = () => {
      if (window.MusicKit && typeof window.MusicKit.addEventListener === "function") {
        // 新版构建：脚本自身触发 musickitloaded；旧路径直接可用
        resolve();
      } else {
        document.addEventListener("musickitloaded", () => resolve(), { once: true });
      }
    };
    s.onerror = () => reject(new Error("MusicKit 脚本加载失败"));
    document.head.appendChild(s);
  });
  return musicKitLoading;
}

export async function configureMusicKit(developerToken) {
  await loadMusicKitScript();
  const music = await window.MusicKit.configure({
    developerToken,
    app: { name: "iPod 墨水屏版", build: "1.0.0" }
  });
  return music;
}

// ---------- 个人曲库 → iPod 数据集 ----------

export async function fetchAppleMusicLibrary(music, { onProgress, maxSongs = 3000, maxPlaylists = 50 } = {}) {
  async function pageAll(path, max, onPage) {
    const items = [];
    let p = path;
    while (p && items.length < max) {
      const { data } = await music.api.music(p, { limit: 100 });
      const batch = (data && data.data) || [];
      items.push(...batch);
      onPage && onPage(items.length);
      p = data && data.next;
    }
    return items.slice(0, max);
  }

  onProgress && onProgress({ phase: "songs" });
  const libSongs = await pageAll("/v1/me/library/songs", maxSongs,
    (n) => onProgress && onProgress({ phase: "songs", done: n }));

  onProgress && onProgress({ phase: "playlists" });
  const libPlaylists = await pageAll("/v1/me/library/playlists", maxPlaylists);

  const playlists = [];
  for (const pl of libPlaylists) {
    onProgress && onProgress({ phase: "playlist-tracks", name: pl.attributes && pl.attributes.name });
    const tracks = await pageAll(`/v1/me/library/playlists/${pl.id}/tracks`, 500);
    playlists.push({
      id: "am-pl-" + pl.id,
      name: (pl.attributes && pl.attributes.name) || "歌单",
      trackLibIds: tracks.map((t) => t.id)
    });
  }

  return { libSongs, playlists };
}

export function buildAppleMusicDataset({ libSongs, playlists }, storefront = "cn") {
  const collator = new Intl.Collator("zh-Hans-CN", { numeric: true });
  const songs = libSongs
    .map((s) => {
      const a = s.attributes || {};
      const pp = a.playParams || {};
      return {
        id: "lib-" + s.id,
        name: a.name || "未知歌曲",
        artistName: a.artistName || "未知艺人",
        albumName: a.albumName || "",
        playParams: { id: pp.id || s.id, kind: "song" },
        previewUrl: null,
        url: pp.catalogId ? `https://music.apple.com/${storefront}/song/${pp.catalogId}` : null
      };
    })
    .sort((a, b) => collator.compare(a.name, b.name));

  const songLibIdToId = new Map(libSongs.map((s, i) => [s.id, songs[i].id]));

  const artistMap = new Map();
  for (const s of songs) {
    if (!artistMap.has(s.artistName)) {
      artistMap.set(s.artistName, { id: "am-ar-" + s.artistName, name: s.artistName, songIds: [] });
    }
    artistMap.get(s.artistName).songIds.push(s.id);
  }
  const artists = [...artistMap.values()].sort((a, b) => collator.compare(a.name, b.name));

  const outPlaylists = playlists
    .map((pl) => ({
      id: pl.id,
      name: pl.name,
      songIds: pl.trackLibIds.map((lid) => songLibIdToId.get(lid)).filter(Boolean)
    }))
    .filter((p) => p.songIds.length > 0);

  return {
    schemaVersion: 3,
    storefront: "applemusic",
    language: "zh-Hans-CN",
    songs,
    artists,
    playlists: outPlaylists
  };
}

// ---------- 播放适配器（同一契约） ----------

export class MusicKitPlayback {
  constructor(music) {
    this.music = music;
    this.ids = [];

    this.isPlaying = writable(false);
    this.currentPlaybackTime = writable(0);
    this.currentPlaybackDuration = writable(0);
    this.hasLoadedItem = writable(false);
    this.shuffleMode = writable(false);
    this.repeatMode = writable("none");
    this.volume = writable(1);
    this.currentItemIndex = writable(0);
    this.queuePosition = this.currentItemIndex;

    this._syncTimer = null;
    this._wire();
    this._resumeSync();
  }

  _wire() {
    const m = this.music;
    m.addEventListener("playbackStateDidChange", (e) => {
      const s = e.state;
      this.isPlaying.set(s === window.MusicKit.PlaybackStates.playing);
      this.hasLoadedItem.set(s !== window.MusicKit.PlaybackStates.none && s !== window.MusicKit.PlaybackStates.completed);
    });
    m.addEventListener("nowPlayingItemDidChange", () => {
      this._syncPosition();
      const dur = this.music.player && this.music.player.currentPlaybackDuration;
      if (Number.isFinite(dur)) this.currentPlaybackDuration.set(dur || 0);
    });
    m.addEventListener("playbackTimeDidChange", () => this._syncTime());
    m.addEventListener("queueItemsDidChange", () => this._syncPosition());
  }

  _resumeSync() {
    if (this._syncTimer) clearInterval(this._syncTimer);
    this._syncTimer = setInterval(() => this._syncTime(), 1000);
  }

  _syncTime() {
    try {
      const p = this.music.player;
      this.currentPlaybackTime.set(p.currentPlaybackTime || 0);
      if (Number.isFinite(p.currentPlaybackDuration)) {
        this.currentPlaybackDuration.set(p.currentPlaybackDuration || 0);
      }
    } catch (_) {}
  }

  _syncPosition() {
    try {
      const pos = this.music.player && this.music.player.queue && this.music.player.queue.position;
      if (Number.isInteger(pos)) this.currentItemIndex.set(pos);
    } catch (_) {}
  }

  // ===== 契约方法 =====

  setQueue(trackIds) {
    this.ids = Array.isArray(trackIds) ? trackIds.slice() : [];
  }

  async changeToQueueItem(trackId, index) {
    let startWith = trackId;
    if ((startWith === undefined || startWith === null || startWith === "") && Number.isInteger(index)) {
      startWith = this.ids[index];
    }
    try {
      await this.music.setQueue({ songs: this.ids, startWith });
    } catch (_) {
      await this.music.setQueue({ songs: this.ids });
    }
  }

  async resume() {
    this.music.play().catch(() => {});
  }

  async pause() {
    this.music.pause();
  }

  skipToNextItem() {
    this.music.skipToNextItem().catch(() => {});
  }

  skipToPreviousItem() {
    this.music.skipToPreviousItem().catch(() => {});
  }

  async seekToTime(seconds, trackIndex) {
    try {
      this.music.player.seekToTime(Math.max(0, seconds || 0));
    } catch (_) {}
  }

  async setShuffle(on) {
    this.shuffleMode.set(!!on);
    try {
      const MK = window.MusicKit;
      this.music.player.shuffleMode = on ? MK.PlayerShuffleMode.Songs : MK.PlayerShuffleMode.Off;
    } catch (_) {}
  }

  async setRepeatMode(mode) {
    this.repeatMode.set(mode === "one" || mode === "all" ? mode : "none");
    try {
      const MK = window.MusicKit;
      this.music.player.repeatMode =
        mode === "one" ? MK.PlayerRepeatMode.One :
        mode === "all" ? MK.PlayerRepeatMode.All : MK.PlayerRepeatMode.None;
    } catch (_) {}
  }

  async setVolume(v) {
    const vol = Math.min(1, Math.max(0, Number(v) || 0));
    this.volume.set(vol);
    try {
      this.music.player.volume = vol;
    } catch (_) {}
  }

  clearQueue() {
    try {
      this.music.stop();
    } catch (_) {}
    this.hasLoadedItem.set(false);
    this.isPlaying.set(false);
    this.ids = [];
  }
}
