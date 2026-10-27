#!/usr/bin/env python3
# 组件补丁脚本：original → eink bundle
# 补丁 1：移除设置菜单的“背光计时器”项（墨水屏无背光）
# 补丁 2：新增 Albums 主菜单入口与专辑屏幕（复用 playlist-tracks 路由，
#          数据层用 "alb-" 前缀的 playlist 表示专辑，Bh 过滤、Ah 列出）
import sys

SRC = "web/assets/vendor/web-music-ipod.esm.js"
DST = "web/assets/vendor/web-music-ipod.eink.esm.js"


def patch(src: str) -> str:
    n = 0

    # ---- 补丁 1：背光菜单项移除 ----
    target = 'Ee("backlight", e),\n    '
    assert src.count(target) == 1, "backlight anchor not found"
    src = src.replace(target, "")
    n += 1

    # ---- 补丁 2a：主菜单加 Albums（直接构造，绕过 Ee 的 titleKey 查找） ----
    anchor = 'Ee("playlists", e),\n    '
    assert src.count(anchor) == 1, "main menu anchor not found"
    src = src.replace(
        anchor,
        anchor + '{ id: "albums", title: "Albums", action: "navigate", target: "albums" },\n    ')
    n += 1

    # ---- 补丁 2b：gn 路由表注册 albums 屏幕 ----
    anchor = '''    items: Sh,
    listsNowPlaying: !0
  },
'''
    assert src.count(anchor) == 1, "router anchor not found"
    src = src.replace(anchor, anchor + '''  albums: {
    view: "list",
    title: () => "Albums",
    items: __ipodAlbums
  },
''')
    n += 1

    # ---- 补丁 2c：Bh（Playlists 列表）排除 alb- 专辑项 ----
    # ---- 补丁 2d：Ah（Albums 列表构建器，函数提升，紧跟 Bh 定义） ----
    anchor = '''  const i = ((e == null ? void 0 : e.playlists) ?? []).map((l) => ({
    id: l.id,
    title: l.name,
    action: "navigate",
    target: "playlist-tracks",
    contextId: l.id
  }));
  return _l(i, t);
}
'''
    assert src.count(anchor) == 1, "playlists builder anchor not found"
    replacement = '''  const i = ((e == null ? void 0 : e.playlists) ?? []).filter(
    (l) => !(typeof l.id == "string" && l.id.indexOf("alb-") === 0)
  ).map((l) => ({
    id: l.id,
    title: l.name,
    action: "navigate",
    target: "playlist-tracks",
    contextId: l.id
  }));
  return _l(i, t);
}
function __ipodAlbums({ data: e, i18n: t }) {
  const i = ((e == null ? void 0 : e.playlists) ?? []).filter(
    (l) => typeof l.id == "string" && l.id.indexOf("alb-") === 0
  ).map((l) => ({
    id: l.id,
    title: l.name,
    action: "navigate",
    target: "playlist-tracks",
    contextId: l.id
  }));
  return _l(i, t);
}
'''
    src = src.replace(anchor, replacement)
    n += 1

    # ---- 补丁 3：Settings 菜单集成 App Settings 项 ----
    anchor = 'Ee("reset-settings", e)\n  ];\n}'
    assert src.count(anchor) == 1, "settings list anchor not found"
    src = src.replace(anchor,
        'Ee("reset-settings", e),\n    {\n      id: "app-settings",\n      title: "App Settings",\n      action: "appsettings"\n    }\n  ];\n}')
    n += 1

    # ---- 补丁 4：动作分发支持 appsettings（调宿主的全局钩子打开设置面板） ----
    anchor = 'switch (b.action) {\n        case "navigate":'
    assert src.count(anchor) == 1, "action switch anchor not found"
    src = src.replace(anchor,
        'switch (b.action) {\n        case "appsettings":\n          typeof window < "u" && window.__ipodOpenAppSettings && window.__ipodOpenAppSettings();\n          break;\n        case "navigate":')
    n += 1

    print(f"applied {n} patches")
    return src


if __name__ == "__main__":
    base = sys.argv[1] if len(sys.argv) > 1 else "."
    src = open(f"{base}/{SRC}", encoding="utf-8").read()
    out = patch(src)
    open(f"{base}/{DST}", "w", encoding="utf-8").write(out)
    print(f"written: {DST} ({len(out)} bytes)")
