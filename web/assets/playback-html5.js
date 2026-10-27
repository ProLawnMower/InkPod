// HTML5 Audio 播放适配器 —— 实现 web-music-ipod 组件的 playback 契约
// （契约由逆向 web-music-ipod.esm.js 得出，字段/方法名必须一字不差）
//
// 契约要点：
//  - 8 个 Svelte 兼容可读 store：isPlaying / currentPlaybackTime(秒) / currentPlaybackDuration(秒) /
//    hasLoadedItem / shuffleMode(bool) / repeatMode("none"|"one"|"all") / volume(0..1) /
//    currentItemIndex（queuePosition 缺省时回退到它，两个都提供）
//  - 方法：setQueue(trackIds[]) / changeToQueueItem(trackId, index) / resume / pause /
//    skipToNextItem / skipToPreviousItem / seekToTime(seconds, trackIndex) /
//    setShuffle / setRepeatMode / setVolume / clearQueue
//  - 组件把 hasLoadedItem 的 true→false 沿革视为“队列自然播完”，会清空内部队列并回调 clearQueue()。
//    因此曲目之间推进时 hasLoadedItem 必须保持 true，只有 clearQueue / 整队停止才置 false。

export function writable(initial) {
  let value = initial;
  const subs = new Set();
  return {
    subscribe(fn) {
      fn(value);
      subs.add(fn);
      return () => subs.delete(fn);
    },
    set(v) {
      if (Object.is(v, value)) return;
      value = v;
      for (const fn of subs) fn(v);
    },
    get() {
      return value;
    }
  };
}

export class Html5Playback {
  // resolveTrackUrl: (trackId) => string|Promise<string>（可播放 URL / blob URL）
  // onEvent: 可选回调 ({type, detail})，供外部 UI 提示错误等
  constructor({ resolveTrackUrl, onEvent } = {}) {
    if (typeof resolveTrackUrl !== "function") {
      throw new Error("Html5Playback 需要 resolveTrackUrl(trackId)");
    }
    this.resolveTrackUrl = resolveTrackUrl;
    this.onEvent = onEvent || (() => {});

    this.queue = [];
    this.shuffleHistory = [];
    // 对向跳曲防抖：部分墨水屏数位屏偶发幻影第二触点/镜像坐标，
    // 会让一次点击产生 back+forward 双触发（后者生效=方向反转）。
    // 200ms 内的相反方向跳曲视为幻影，只执行先到者（手指下的真实意图）。
    this._lastSkip = { dir: 0, at: 0 };

    this.isPlaying = writable(false);
    this.currentPlaybackTime = writable(0);
    this.currentPlaybackDuration = writable(0);
    this.hasLoadedItem = writable(false);
    this.shuffleMode = writable(false);
    this.repeatMode = writable("none");
    this.volume = writable(1);
    this.currentItemIndex = writable(0);
    this.queuePosition = this.currentItemIndex; // 别名，语义一致

    this.audio = new Audio();
    this.audio.preload = "auto";
    this._loadingIndex = -1;
    this._wireAudio();
  }

  _emit(type, detail) {
    try {
      this.onEvent({ type, detail });
    } catch (_) {}
  }

  _wireAudio() {
    const a = this.audio;
    a.addEventListener("play", () => this.isPlaying.set(true));
    a.addEventListener("pause", () => this.isPlaying.set(false));
    a.addEventListener("ended", () => this._onEnded());
    a.addEventListener("timeupdate", () => this.currentPlaybackTime.set(a.currentTime || 0));
    a.addEventListener("durationchange", () => {
      if (Number.isFinite(a.duration)) this.currentPlaybackDuration.set(a.duration);
    });
    a.addEventListener("loadedmetadata", () => {
      this.currentPlaybackDuration.set(Number.isFinite(a.duration) ? a.duration : 0);
      this.hasLoadedItem.set(true);
    });
    a.addEventListener("error", () => {
      const idx = this._loadingIndex;
      this._emit("error", {
        trackId: this.queue[idx],
        message: "音频加载失败"
      });
      // 队列里还有别的曲目时跳下一首，否则停下（不触发队列播完语义）
      if (this.queue.length > 1) {
        this.skipToNextItem();
      } else {
        this.isPlaying.set(false);
      }
    });
  }

  _indexByTrackId(trackId) {
    if (trackId === undefined || trackId === null || trackId === "") return -1;
    return this.queue.indexOf(trackId);
  }

  async _loadIndex(index, { keepTime = false } = {}) {
    const trackId = this.queue[index];
    if (trackId === undefined) return;
    this._loadingIndex = index;
    const wasPlaying = !this.audio.paused && !this.audio.ended;
    try {
      const url = await this.resolveTrackUrl(trackId);
      if (this._loadingIndex !== index) return; // 期间已被替换
      this.audio.src = url;
      if (!keepTime) this.currentPlaybackTime.set(0);
      this.currentPlaybackDuration.set(0);
      this.currentItemIndex.set(index);
      this.hasLoadedItem.set(true);
      if (wasPlaying) {
        try {
          await this.audio.play();
        } catch (_) {}
      } else {
        this.audio.load();
      }
    } catch (err) {
      this._emit("error", { trackId, message: String(err && err.message || err) });
    }
  }

  _onEnded() {
    const repeat = this.repeatMode.get();
    if (repeat === "one") {
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
      return;
    }
    this.skipToNextItem({ fromEnded: true });
  }

  _nextIndex(fromEnded) {
    const n = this.queue.length;
    if (n === 0) return -1;
    const cur = this.currentItemIndex.get();
    if (this.shuffleMode.get() && n > 1) {
      if (fromEnded !== true) {
        // 手动跳转也记历史，供“上一首”回退
        this.shuffleHistory.push(cur);
        if (this.shuffleHistory.length > 200) this.shuffleHistory.shift();
      }
      let next = cur;
      while (next === cur) next = Math.floor(Math.random() * n);
      return next;
    }
    const next = cur + 1;
    if (next < n) return next;
    return this.repeatMode.get() === "all" ? 0 : -1; // -1 = 到队尾且不循环
  }

  _prevIndex() {
    const n = this.queue.length;
    if (n === 0) return -1;
    const cur = this.currentItemIndex.get();
    if (this.shuffleMode.get() && this.shuffleHistory.length > 0) {
      return this.shuffleHistory.pop();
    }
    const prev = cur - 1;
    if (prev >= 0) return prev;
    return this.repeatMode.get() === "all" ? n - 1 : 0;
  }

  _guardSkip(dir) {
    const now = Date.now();
    if (this._lastSkip.dir === -dir && now - this._lastSkip.at < 200) {
      this._lastSkip = { dir: 0, at: 0 }; // 吞掉幻影对向信号
      return false;
    }
    this._lastSkip = { dir, at: now };
    return true;
  }

  // ===== 组件契约方法 =====

  async setQueue(trackIds) {
    this.queue = Array.isArray(trackIds) ? trackIds.slice() : [];
    this.shuffleHistory = [];
  }

  changeToQueueItem(trackId, index) {
    let idx = this._indexByTrackId(trackId);
    if (idx < 0 && Number.isInteger(index) && index >= 0 && index < this.queue.length) {
      idx = index;
    }
    if (idx < 0) idx = 0;
    this._loadIndex(idx);
  }

  async resume() {
    if (!this.audio.src && this.queue.length > 0) {
      this._loadIndex(this.currentItemIndex.get() || 0).then(() => {
        this.audio.play().catch(() => {});
      });
      return;
    }
    this.audio.play().catch(() => {});
  }

  async pause() {
    this.audio.pause();
  }

  async skipToNextItem() {
    if (!this._guardSkip(+1)) return;
    const idx = this._nextIndex();
    if (idx < 0) {
      // 队尾且不循环：停在当前曲目（保持已加载，不触发队列播完语义）
      this.audio.pause();
      return;
    }
    this._loadIndex(idx);
  }

  async skipToPreviousItem() {
    if (!this._guardSkip(-1)) return;
    const cur = this.currentItemIndex.get();
    // 常见播放器语义：播放超过 3 秒时“上一首”回到本曲开头
    if ((this.audio.currentTime || 0) > 3) {
      this.audio.currentTime = 0;
      return;
    }
    const idx = this._prevIndex();
    if (idx < 0) return;
    this._loadIndex(idx);
  }

  async seekToTime(seconds, trackIndex) {
    if (Number.isInteger(trackIndex) && trackIndex !== this.currentItemIndex.get()) {
      this._loadIndex(trackIndex).then(() => {
        this.audio.currentTime = Math.max(0, seconds || 0);
      });
      return;
    }
    try {
      this.audio.currentTime = Math.max(0, seconds || 0);
    } catch (_) {}
  }

  async setShuffle(on) {
    this.shuffleMode.set(!!on);
  }

  async setRepeatMode(mode) {
    this.repeatMode.set(mode === "one" || mode === "all" ? mode : "none");
  }

  async setVolume(v) {
    const vol = Math.min(1, Math.max(0, Number(v) || 0));
    this.volume.set(vol);
    this.audio.volume = vol;
  }

  async clearQueue() {
    this.queue = [];
    this.shuffleHistory = [];
    // 对向跳曲防抖：部分墨水屏数位屏偶发幻影第二触点/镜像坐标，
    // 会让一次点击产生 back+forward 双触发（后者生效=方向反转）。
    // 200ms 内的相反方向跳曲视为幻影，只执行先到者（手指下的真实意图）。
    this._lastSkip = { dir: 0, at: 0 };
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.hasLoadedItem.set(false);
    this.isPlaying.set(false);
    this.currentPlaybackTime.set(0);
    this.currentPlaybackDuration.set(0);
    this.currentItemIndex.set(0);
  }

  // 供外部（收藏按钮等）读取当前曲目
  get currentTrackId() {
    return this.queue[this.currentItemIndex.get()];
  }
}
