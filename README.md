# Lumora TV

A fast, good-looking IPTV player for **M3U** and **Xtream Codes** playlists with an **XMLTV TV guide**. It's built for TV remotes first, and also works with a keyboard, mouse or touch screen.

**📥 Download the Android TV / Fire TV app (latest, v1.0.4):** [LumoraTV-1.0.0.apk](https://github.com/mforge420/aurora-tv/raw/main/android/LumoraTV-1.0.0.apk)
(Fire TV *Downloader* code: **2139190**, or the URL `https://github.com/mforge420/aurora-tv/raw/main/android/LumoraTV-1.0.0.apk`)

> Lumora TV is only a player. It does not include any channels or content.

## Android TV app (native)

`android/` is a native Kotlin app for **Android TV, Google TV and Fire TV**. It also runs on phones and tablets.

- **ExoPlayer (Media3) playback**: hardware decoding, HLS, MPEG-TS and MKV/MP4. Device audio decoders handle Dolby Digital (AC3/E-AC3), DTS and multi-channel tracks, which a browser can't play. Live streams reconnect automatically and switch between HLS and TS when needed.
- **No server needed**: the playlist/guide/stream proxy is built into the app, so providers that block web access work out of the box.
- The UI is the same Lumora interface, drawn in a transparent WebView over the native video surface. The preview window, guide, overlays and multi-view all carry over.
- Leanback launcher banner, remote keys (Back, CH±, Play/Pause, FF/RW, Guide, Info, Menu, colour buttons), immersive full-screen, keep-screen-on while playing, backup export to Downloads.

### Build

```bash
npm install                      # once: bundles hls.js / mpegts.js into the APK
cd android
echo "sdk.dir=/path/to/android-sdk" > local.properties   # or set ANDROID_HOME
./gradlew assembleDebug          # → app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease        # minified; uses keystore.properties if present
```

Release signing: create `android/keystore.properties` with `storeFile`, `storePassword`, `keyAlias` and `keyPassword`. Without it, release builds are signed with the debug key, which is fine for sideloading.

### Releasing an update

Installed apps (v1.0.3+) check `android/version.json` on start and offer the update in-app (also *Settings → About → Check for updates*):

1. Bump `versionCode` and `versionName` in `android/app/build.gradle.kts`, and write what's new in `android/release-notes.txt`.
2. Run `./gradlew publishApk` in `android/`. It builds, copies the APK to `android/LumoraTV-1.0.0.apk` (the stable download URL / Downloader code), and rewrites `android/version.json`.
3. Commit and push both files.

### Install on a TV

Turn on *Developer options → USB/network debugging* on the TV, then run:

```bash
adb connect <tv-ip>:5555
adb install -r app-debug.apk
```

On Fire TV you can also use the *Downloader* app.

## Web version — quick start

```bash
npm install
npm start
```

Open **http://localhost:8080** (or `http://<your-computer-ip>:8080` from a TV or phone on the same network). Add a playlist and you're watching.

Requires Node 18+. There are no runtime dependencies besides `hls.js` and `mpegts.js`.

## Features

**Live TV**
- Three-column layout (groups → channels → preview and programme info). The preview starts when you rest on a channel; press OK again to go fullscreen. The video animates smoothly between the two.
- Each channel shows what's on now with a progress bar, the next 4 programmes, a catch-up badge, favourites, recently watched, and number-pad jumping.
- Fullscreen overlay: ▲▼ zap, ◀ slide-in channel list, ▶ options, type digits to jump to a channel number, previous-channel recall.
- Options: audio track, subtitles, quality, aspect ratio (fit/fill/stretch), picture-in-picture, sleep timer, stream stats, reload.

**TV Guide**
- Virtualised EPG grid that stays fast with thousands of channels. It has a now-line, day jumping and a live preview.
- **Catch-up** on past programmes (Xtream `timeshift`, plus M3U `catchup` = default/append/shift/flussonic/custom `catchup-source`).
- **Reminders** for upcoming programmes.
- The XMLTV parser streams the file in a Web Worker and handles `.xml.gz` and 100 MB+ guides. Guide channels are matched to playlist channels by `tvg-id`, falling back to fuzzy name matching. There's a configurable time shift.

**Movies & Series**
- Poster grids, detail pages (plot, cast, rating, backdrop), resume where you left off, *Continue watching*, auto-play next episode, sort by A–Z, rating or year.

**Also**
- **Multi-view**: 2, 3 or 4 channels at once. Audio follows the focused tile.
- Global search across channels, programmes, movies and series.
- Parental PIN with locked groups, hidden groups, and 6 accent themes.
- Backup and restore (JSON), installable PWA, responsive layout down to phones (bottom tab bar).

## Why there is a small server

Most IPTV providers don't send CORS headers, and many use plain `http://`. A browser can't load those directly. `server.js` serves the app and adds two endpoints:

| Endpoint | Purpose |
|---|---|
| `/api/fetch?url=` | Playlists, EPG (decompresses gzip automatically), Xtream API |
| `/api/stream?url=` | Media streams. HLS playlists are rewritten so every segment also goes through the proxy. Supports `ua`/`ref` for per-channel User-Agent and Referer headers. |

In **Automatic** mode the player tries a direct connection first, falls back to the proxy, and remembers which hosts need the proxy. You can change this under *Settings → Playback*.

⚠️ The proxy is open to anyone who can reach the port. Run it on your home network or behind your own authentication; don't expose it to the internet.

## Playback engines

The engine picks a player for each stream and falls back automatically: **hls.js** (`.m3u8`), **mpegts.js** (raw MPEG-TS, the usual Xtream `.ts`, FLV), and the browser's native player (MP4/MKV/WebM, and native HLS on Safari/Tizen/webOS). Live streams reconnect by themselves after network drops or stalls.

## Remote / keyboard

| Key | Action |
|---|---|
| Arrows / OK | Navigate / select |
| Back, Esc, Backspace | Back |
| CH+/CH−, PgUp/PgDn | Zap (fullscreen), page (lists) |
| 0–9 | Jump to channel number |
| G · / · M · F · I | Guide · Search · Mute · Fullscreen window · Info |
| Menu / ▶ (fullscreen) | Options |

Samsung Tizen (10009) and LG webOS (461) back keys and the media keys are mapped.

## Project layout

```
server.js               static server + CORS/stream proxy
public/
  index.html, sw.js, manifest.webmanifest
  css/app.css           design system
  js/
    app.js              shell & router
    nav.js              spatial navigation & key mapping
    vlist.js            virtualised list
    engine.js           playback engine (hls.js / mpegts.js / native, fallback, reconnect)
    player.js           persistent player layer & fullscreen overlay
    library.js          sources, catalog, favourites, resume, EPG index, catch-up URLs
    m3u.js, xtream.js   playlist providers
    epg-worker.js       streaming XMLTV parser
    views/              live, guide, vod, search, multiview, settings, welcome
```
