// Apple 官方 zh-Hans 文案（2026-10-26 从 music.apple.com/cn/sspai 线上页面 el.i18n.t() 逐字采集）
// 占位符格式为 Apple 的 @@key@@ 模板，与组件内部回退格式一致。

const DICT = {
  "ASE.Web.IPod.About.Available": "可用",
  "ASE.Web.IPod.About.Capacity": "容量",
  "ASE.Web.IPod.About.Songs": "歌曲",
  "ASE.Web.IPod.About.Version": "版本",
  "ASE.Web.IPod.Backlight.AlwaysOn": "始终打开",
  "ASE.Web.IPod.Backlight.FiveSeconds": "5 秒",
  "ASE.Web.IPod.Backlight.Off": "关",
  "ASE.Web.IPod.Backlight.OneSecond": "1 秒",
  "ASE.Web.IPod.Backlight.ThreeSeconds": "3 秒",
  "ASE.Web.IPod.Backlight.TwoSeconds": "2 秒",
  "ASE.Web.IPod.Error.NotConnected": "没有接入互联网",
  "ASE.Web.IPod.Game.GameOver": "游戏结束",
  "ASE.Web.IPod.Game.LaunchBall": "按下中央键发射球",
  "ASE.Web.IPod.Game.Title": "Brick",
  "ASE.Web.IPod.Menu.All": "全部",
  "ASE.Web.IPod.Menu.AllSongs": "所有歌曲",
  "ASE.Web.IPod.Menu.Artists": "艺人",
  "ASE.Web.IPod.Menu.NoMusic": "无音乐",
  "ASE.Web.IPod.Menu.NowPlaying": "正在播放",
  "ASE.Web.IPod.Menu.Playlists": "播放列表",
  "ASE.Web.IPod.Menu.Settings": "设置",
  "ASE.Web.IPod.Menu.Songs": "歌曲",
  "ASE.Web.IPod.NowPlaying.PlaybackProgress": "播放进度",
  "ASE.Web.IPod.NowPlaying.Position": "第 @@index@@ 个（共 @@total@@ 个）",
  "ASE.Web.IPod.NowPlaying.RepeatAll": "全部重复播放",
  "ASE.Web.IPod.NowPlaying.RepeatOne": "单曲重复播放",
  "ASE.Web.IPod.NowPlaying.ShuffleOn": "随机播放已开启",
  "ASE.Web.IPod.NowPlaying.ShuffleOnRepeatAll": "随机播放已开启、全部重复播放",
  "ASE.Web.IPod.NowPlaying.ShuffleOnRepeatOne": "随机播放已开启、单曲重复播放",
  "ASE.Web.IPod.NowPlaying.Volume": "音量",
  "ASE.Web.IPod.Reset.Cancel": "取消",
  "ASE.Web.IPod.Reset.Reset": "重设",
  "ASE.Web.IPod.Settings.About": "关于",
  "ASE.Web.IPod.Settings.BacklightTimer": "背光计时器",
  "ASE.Web.IPod.Settings.Clicker": "点按声",
  "ASE.Web.IPod.Settings.Repeat": "重复播放",
  "ASE.Web.IPod.Settings.ResetAllSettings": "重设所有设置",
  "ASE.Web.IPod.Settings.Shuffle": "随机播放",
  "ASE.Web.IPod.Settings.Value.All": "全部",
  "ASE.Web.IPod.Settings.Value.Off": "关",
  "ASE.Web.IPod.Settings.Value.On": "开",
  "ASE.Web.IPod.Settings.Value.One": "单曲",
  "ASE.Web.IPod.Settings.Value.Songs": "歌曲",
  "ASE.Web.IPod.Status.Loading": "正在加载",
  "ASE.Web.IPod.Status.Ready": "已准备就绪",
  "ASE.Web.IPod.Wheel.Back": "返回",
  "ASE.Web.IPod.Wheel.Forward": "前进",
  "ASE.Web.IPod.Wheel.Menu": "菜单",
  "ASE.Web.IPod.Wheel.Pause": "暂停",
  "ASE.Web.IPod.Wheel.Play": "播放",
  "ASE.Web.IPod.Wheel.Select": "选择"
};

function interpolate(template, params) {
  if (!params) return template;
  return String(template).replace(/@@([a-zA-Z0-9_]+)@@/g, (_, key) =>
    params[key] !== undefined && params[key] !== null ? String(params[key]) : ""
  );
}

// 组件宿主 i18n 最小契约：只需 t(key, params)
export const zhI18n = {
  t(key, params) {
    const s = DICT[key];
    return s === undefined ? undefined : interpolate(s, params);
  }
};

export const ZH_HANS_CN = "zh-Hans-CN";
