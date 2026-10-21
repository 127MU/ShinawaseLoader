# Examples

Official sample packages. Source folders are not copied by `setup-modloader.bat`; the installer **optional packages** step can import the built `.echomod` files into the game `Mods` folder. Names match `echo.mod.json`.

## Preinstall (installer optional packages)

All three appear in the setup optional-package list (checked by default). The Windows Manager's options page also offers **Install all**:

| Name | Folder | Package |
| --- | --- | --- |
| ECHO Streaming | [ECHO-Streaming](ECHO-Streaming) | `examples/packages/ECHO-Streaming.echomod` |
| ECHO MV | [ECHO-MV](ECHO-MV) | `examples/packages/ECHO-MV.echomod` |
| ECHO Lyrics Match Whitebox | [ECHO-LyricsMatchWhitebox](ECHO-LyricsMatchWhitebox) | `examples/packages/ECHO-LyricsMatchWhitebox.echomod` |

Rebuild from the repository root:

```powershell
.\pack-mod.bat .\examples\ECHO-Streaming\echomod .\examples\packages\ECHO-Streaming.echomod --zip
.\pack-mod.bat .\examples\ECHO-MV\echomod .\examples\packages\ECHO-MV.echomod --zip
.\pack-mod.bat .\examples\ECHO-LyricsMatchWhitebox\echomod .\examples\packages\ECHO-LyricsMatchWhitebox.echomod --zip
```

Every installer example ships a `config.schema.json` fallback form; most also include a custom `configUi` page (loader >= 1.6.0).

ECHO Streaming 1.7.5 supports the echo-steam 26.10.8+ playlist wall: link import opens a floating card shaped like ECHO's own "new playlist" card on the collection home, NetEase daily playlists sit between the home header and the wall, and wall detail pages get no import button because they no longer have a playlist rail. It keeps the independent Liked route, the player transport controls and the older sidebar layouts. Streaming likes have their own play-all and shuffle actions, independent of the local liked-track count. Artist album integration ignores hidden cached routes and inactive album tabs. Update the Loader together with the package and restart ECHO so the isolated runtime receives the playlist-track compatibility patch. With a wallpaper or acrylic window the source rail stays transparent like ECHO's own sidebar. These adapters have focused offline coverage under `ECHO-Streaming/dev/*compat.test.mjs`; real-client playback and provider requests require separate validation.

Lyrics matching uses the official titlebar **歌词设置** button → right-side drawer. It does **not** auto-pop a floating overlay on every play or inject a circular corner icon. Source filters show an explicit empty state until candidates arrive.

Lyrics Match Whitebox 1.3.2 (鹤良's revision) adds a titlebar **歌词匹配候选** panel: candidates from NetEase, LRCLIB, QQ Music and AMLL with translation preview, a remembered per-track choice, and search-text normalization (traditional/simplified, kana, noise words). Since 26.10.8 ECHO Steam gets online lyrics only from the Workshop item "ECHO 网络歌词匹配" (published file 3817009079); without it, both ECHO's search and the panel find local lyrics only. With it, ECHO's own search still covers only `lyricsEnabledProviders` (local), so the panel and **重新匹配** query each source by name.

## Reference mods

Other sample Mods live under [`reference/`](reference/) as archived implementations. They are **not** listed in the installer optional packages and are **not** imported by `setup-modloader`. Pack and drop them yourself if you need them. See [`reference/README.md`](reference/README.md).

Drop a built `.echomod` into the selected Steam game's `"<ECHO_ROOT>\Mods"` folder, or import it from the in-app Mods page. Runtime userData is `%APPDATA%\ECHO Steam`, not leftover `ECHO NEXT` / `ECHO`.
