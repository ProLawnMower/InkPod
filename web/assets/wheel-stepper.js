// 滚轮内环点按步进（墨水屏专属增强）
// 外圈四键（Menu / Play-Pause / ◀◀ / ▶▶）保持原功能，不做任何拦截。
// 墨水屏刷新跟不上内环连续拖动，因此内环支持"点按方向"：
//   列表界面：内环 上/左 半区 = 上一项，下/右 半区 = 下一项（一次一格）
//   拖动（位移 > 12px 或时长 > 300ms）仍走组件原生滚动，不受影响
//   非列表界面（正在播放 / Brick）：点按不处理（内环在此无滚动语义冲突）
// 返回上级：外圈 Menu 键（原功能）或安卓返回键（见 ipodNavigateBack）。

const TAP_MAX_MS = 300;
const TAP_MAX_MOVE = 12; // px（CSS）

export function attachWheelStepper(el) {
  if (!el || !el.shadowRoot) return;
  const sr = el.shadowRoot;
  const wheel = sr.querySelector('[data-testid="click-wheel"]');
  if (!wheel || wheel.__ipodStepper) return;
  wheel.__ipodStepper = true;

  const menuItems = () => sr.querySelector('[data-testid="menu-items"]');
  const onRing = (ev) => {
    const path = ev.composedPath ? ev.composedPath() : [ev.target];
    return path.some((n) => n && n.dataset && n.dataset.testid === "wheel-ring");
  };
  const sendKey = (key) => {
    const menu = menuItems();
    if (!menu) return;
    menu.focus();
    menu.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  };

  let down = null;

  wheel.addEventListener("pointerdown", (ev) => {
    if (!onRing(ev)) return;          // 只跟踪内环上的按下
    down = { x: ev.clientX, y: ev.clientY, t: Date.now(), id: ev.pointerId };
  }, true);

  wheel.addEventListener("pointerup", (ev) => {
    if (!down || ev.pointerId !== down.id) return;
    const d = down;
    down = null;
    if (Date.now() - d.t > TAP_MAX_MS) return;                    // 长按 → 交给原生
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > TAP_MAX_MOVE) return; // 拖动 → 原生滚动
    if (!menuItems()) return;                                      // 非列表界面不处理

    const r = wheel.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    // 滚轮只有上下语义：上半环 → 上一项，下半环 → 下一项
    const up = ev.clientY < cy;
    sendKey(up ? "ArrowUp" : "ArrowDown");
  }, true);

  wheel.addEventListener("pointercancel", () => { down = null; }, true);
}

// 供安卓返回键使用：iPod 在子菜单时返回上级，返回 true 表示已处理
export function ipodNavigateBack(el) {
  if (!el || !el.shadowRoot) return false;
  const sr = el.shadowRoot;
  const menu = sr.querySelector('[data-testid="menu-items"]');
  const title = sr.querySelector('[data-testid="menu-title"]');
  const isRoot = !title || title.textContent.trim() === "iPod";
  if (!menu || isRoot) return false;
  menu.focus();
  menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  return true;
}
