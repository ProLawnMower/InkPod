# InkPod

An e-ink music player for Android that resurrects the iPod — built around the actual Web Component Apple shipped on the Apple Music 404 easter-egg page (the 25th-anniversary iPod tribute), re-engineered for **1-bit black-and-white e-ink displays**.

The interface, Chicago-style bitmap font, click-wheel physics, clicker sound, and even the hidden Brick game are pixel-faithful to the original, because it *is* the original component — self-hosted and fed with your own music.

## Highlights

- **Faithful iPod UI** — Apple's own `web-music-ipod` component, served unmodified (an optional patched variant removes the backlight entry and adds an Albums menu)
- **1-bit e-ink theme** — chassis stripped, pure white screen, black-only ink, all animations neutralized, plus an "Original" mode toggle that restores the full chassis
- **Full-screen immersion** — no system bars; the battery icon shows the real device level
- **Local music** — drop FLAC/MP3/M4A/OGG/WAV files into `/sdcard/Music` (subfolders included); ID3/Vorbis tags parsed, artists grouped, **Albums menu with disc→track ordering** (multi-disc aware), `.m3u` import, ★ Favorites
- **Guest mode** — the built-in iPod easter-egg library (CN/US storefronts, 1,017/1,029 tracks of 30s previews) + catalog search
- **Apple Music mode (experimental)** — MusicKit JS sign-in, personal library sync, full-track playback with a subscription
- **E-ink navigation aid** — tap the inner ring to step the selection one item at a time (upper half = up, lower half = down); dragging still scrolls
- **Hidden gem preserved** — Settings → About → hold Select for 5 seconds unlocks Brick

## Install

Grab `InkPod-<version>.apk` from Releases, then:

```bash
adb install -r InkPod-1.0.apk
adb shell pm grant com.prolawnmower.InkPod android.permission.READ_EXTERNAL_STORAGE
adb shell am start -n com.prolawnmower.InkPod/.MainActivity
```

Or copy the APK to the device and install from a file manager ("unknown sources" must be allowed). On first use: press **Back** (or iPod Settings → **App Settings**) → Local → **Scan /sdcard/Music**.

## Building (for AI agents and humans)

The repo intentionally **does not contain** Apple's component, Apple's demo-library data, or the vendored tag-reader — `tools/fetch-assets.sh` downloads them at build time (see the LICENSE notice).

### Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | ≥ 20 | `node -v` |
| JDK | 21 (Capacitor 7 requires Java 21 source level; 17 will NOT compile) | `java -version` |
| Android SDK | platform 36, build-tools 35.x | `$ANDROID_HOME/platforms/android-36` exists |
| Python | ≥ 3.9 (patch script) | `python3 --version` |
| adb | any recent | `adb version` |

Environment:

```bash
export JAVA_HOME=<path-to-jdk21>
export ANDROID_HOME=<path-to-android-sdk>
```

### Steps

```bash
# 0. fetch third-party assets (Apple component + data, jsmediatags) and patch the component
./tools/fetch-assets.sh

# 1. JS deps + Capacitor sync
npm install
npx cap sync android

# 2. build
cd android && ./gradlew assembleRelease

# 3. install to the connected device
adb install -r app/build/outputs/apk/release/app-release.apk
adb shell pm grant com.prolawnmower.InkPod android.permission.READ_EXTERNAL_STORAGE
adb shell am start -n com.prolawnmower.InkPod/.MainActivity
```

The release APK lands at `android/app/build/outputs/apk/release/app-release.apk`.

**Agent notes / gotchas:**

- If `gradlew` fails within seconds, another Gradle invocation is probably still holding the build lock — rerun after a few seconds.
- The component patcher (`tools/patch-bundle.py`) is idempotent and re-runnable; it reads `web/assets/vendor/web-music-ipod.esm.js` and writes the `…eink.esm.js` variant. Re-run it whenever the original is re-fetched.
- Do not commit `android/keystore.properties` or `*.keystore` — releases should be signed with your own key.
- Desktop debugging: `cd web && python3 -m http.server 8765` → open `http://localhost:8765` (Local mode needs Chrome/Edge folder-picker).

### Quick smoke test on a device

```bash
adb shell pidof com.prolawnmower.InkPod        # process alive
adb exec-out screencap -p > /tmp/s.png          # pixels should be pure black/white
adb shell input keyevent 4                      # Back → Settings sheet opens
```

## How it works (the interesting bits)

- **Feeding the black box** — the component has no data-injection API; on mount it fetches `/includes/ipod/data/{storefront}/{lang}.json` anchored to the serving origin. InkPod installs a `window.fetch` interceptor that answers those requests from in-memory datasets (built-in library, local file scan, or an Apple Music sync). Switching libraries = swap dataset + remount the element.
- **Playback contract** (reverse-engineered) — the component drives a host player through 10 methods + 9 Svelte-store fields; all contract methods must return Promises (the component chains `.catch` on results). `playback-html5.js` implements it over `<audio>`; `playback-musickit.js` over MusicKit.
- **Chromium-83 WebView quirks** (the original e-ink target) — see `web/assets/compat-theme.js`:
  - `inset:` shorthand (Chrome 87+) unsupported → wheel zone buttons collapse; patched with longhands + explicit sizing
  - `overflow: clip` (Chrome 90+) unsupported → progress + volume bars render simultaneously; patched to `hidden`
  - `rotate:` property (Chrome 104+) unsupported → Back icon never mirrors; patched with classic `transform`
  - `:focus-visible` (Chrome 86+) inside a selector *group* invalidates the whole rule on old engines → focus-ring suppression silently never applied; keep such selectors separate
  - Intercepted 206/Range responses work only at offset 0 (fixed upstream in Chromium 93) → local streams are always full-content 200s; tag reading slices file heads in Java (`readHead` plugin) and hands jsmediatags a Blob
- **Bundle patches** (`tools/patch-bundle.py`) — backlight settings entry removal, an **Albums** menu route (reuses playlist-tracks), and an **App Settings** entry that opens the host settings sheet.
- **Dual bundle** — the pristine component ("Original" mode) and the patched one define the same custom element, so exactly one may load per page; flavor switching reloads.

## Project layout

```
web/                        # app core (Capacitor webDir; plain ES modules, no build step)
├── assets/
│   ├── app.js              # mode state machine + UI
│   ├── ipod-host.js        # fetch interception, bundle loading, element mount
│   ├── eink-theme.js       # 1-bit theme + adaptive layout (screen flexes, wheel scales)
│   ├── compat-theme.js     # old-WebView CSS shims (feature-detected)
│   ├── wheel-stepper.js    # ring-tap stepping for e-ink refresh rates
│   ├── playback-html5.js   # local playback adapter (contract implementation)
│   ├── playback-musickit.js# MusicKit adapter + library sync/mapping
│   ├── local-library.js    # folder scan → tags → albums(disc/track) → dataset
│   ├── search.js           # guest-mode iTunes Search
│   ├── i18n-zh.js          # optional zh-Hans strings (harvested from Apple's page)
│   └── vendor/             # fetched assets (not committed)
└── data/                   # fetched built-in libraries (not committed)
android/                    # Capacitor project
├── app/src/main/java/com/prolawnmower/InkPod/
│   ├── MainActivity.java   # immersion, OAuth popup WebView, stream interception
│   ├── LocalMusicPlugin.java  # fixed-root /sdcard/Music scan + readHead slicing
│   └── LocalMusicStream.java  # file path → https://localhost/local-music/ streaming
tools/
├── fetch-assets.sh         # build-time asset fetch + patch
├── patch-bundle.py         # component patches (idempotent)
└── generate-token.mjs      # MusicKit developer-token generator (optional mode)
```

## Legal

MIT for this repository's code (see [LICENSE](LICENSE)). Apple's component and library data are fetched at build time and remain Apple's property — this is a personal, non-commercial study of publicly served assets. MusicKit is loaded from Apple's official CDN per its license. iPod is a trademark of Apple Inc.; this project is not affiliated with Apple.

## Credits

- Apple's web team, for hiding a working iPod inside a 404 page
- [jsmediatags](https://github.com/aadsm/jsmediatags) (MIT)
- [Capacitor](https://capacitorjs.com) (MIT)
