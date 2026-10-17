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

ECHO Streaming 1.7.3 supports the current playlist overview, the independent Liked route, and the new player transport controls while retaining older sidebar layouts. Streaming likes have their own play-all and shuffle actions, independent of the local liked-track count. Artist album integration ignores hidden cached routes and inactive album tabs. Update the Loader together with the package and restart ECHO so the isolated runtime receives the playlist-track compatibility patch. These adapters have focused offline coverage under `ECHO-Streaming/dev/*compat.test.mjs`; real-client playback and provider requests require separate validation.

Lyrics matching uses the official titlebar **歌词设置** button → right-side drawer. It does **not** auto-pop a floating overlay on every play or inject a circular corner icon. Source filters show an explicit empty state until candidates arrive.

## Reference mods

Other sample Mods live under [`reference/`](reference/) as archived implementations. They are **not** listed in the installer optional packages and are **not** imported by `setup-modloader`. Pack and drop them yourself if you need them. See [`reference/README.md`](reference/README.md).

Drop a built `.echomod` into the selected Steam game's `"<ECHO_ROOT>\Mods"` folder, or import it from the in-app Mods page. Runtime userData is `%APPDATA%\ECHO Steam`, not leftover `ECHO NEXT` / `ECHO`.
