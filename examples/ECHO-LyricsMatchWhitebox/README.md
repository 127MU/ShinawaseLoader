# ECHO Lyrics Match Whitebox

**Loader Mod only** — does not patch ECHO / ECHOSteam source.

1.3.2 为鹤良修改版：在 1.1.x 的抽屉交互之上加入手动候选面板、翻译预览、记住本曲选择，以及搜索词标准化。

## 为什么需要它

- Steam 默认关闭 `lyricsCandidatePanelAutoOpenEnabled`，网络匹配在后台进行。旧版白盒会强制打开该开关，导致**每次播放都在歌词页中央弹出浮层**，挡住歌词。本 Mod 默认不再自动弹出，并在启动时清除此前强制打开的自动弹出。
- 从 26.10.8 起，ECHO Steam 的网易云 / QQ 音乐 / LRCLIB / AMLL 歌词由创意工坊条目 **「ECHO 网络歌词匹配」**（<https://steamcommunity.com/sharedfiles/filedetails/?id=3817009079>）提供。**没有订阅并启用它，ECHO 和本 Mod 都只能搜到本地歌词，结果永远是空白。** 订阅后 ECHO 自带的手动搜索仍只查「已启用来源」（设置里只保留本地），所以本 Mod 的面板和「重新匹配」会按名字逐个查询这些来源，再合并结果。

## 用法

1. 标题栏 **「歌词匹配候选」** 按钮（列表图标，紧挨官方「歌词设置」）打开候选面板：
   - 左侧是所有来源的候选，可按来源、「仅逐行」「仅带翻译」筛选；
   - 右侧逐行预览原文、翻译和罗马音；
   - 「应用这条歌词」后默认 **记住本曲选择**，下次播放同一首歌自动应用。
2. 官方 **「歌词设置」** 抽屉「匹配」页保留 **重新匹配**：先找标题、歌手、时长都一致的候选直接应用；找不到时打开上面的候选面板。从其他页面点击会先打开歌词页。
3. 抽屉里的「自动打开候选」开关控制 ECHO 自带的浮层，默认关闭。

来源筛选按钮固定可读的文字与布局，不随 MV 背景配色变成空白；ECHO 自带面板没有候选时显示「全部来源 0」和说明。

已知限制：流媒体歌曲的候选预览只有 ECHO 给出的前几行（网易云歌词接口不允许页面跨域读取，完整预览只对 LRCLIB 生效）；新面板目前只有中文文案。

## 安装

安装器内置本 Mod，可与流媒体、MV 一键全部安装；也可导入 `examples/packages/ECHO-LyricsMatchWhitebox.echomod` 到 `Mods`，用 `ECHO.modded.exe` 启动。

## 配置

| 项 | 默认 | 说明 |
| --- | --- | --- |
| `forceEnable` | `false` | 启动时强制打开自动弹出候选（旧行为，不推荐） |
| `disableAutoOpenOnBoot` | `true` | 启动时关掉自动弹出，避免播放盖住歌词 |
| `injectCornerIcon` | `false` | 不要开启。会叠一个深色圆钮；请用官方标题栏「歌词设置」 |
| `keepForced` | `false` | 被关掉后是否再次强制打开（仅 `forceEnable` 时有意义） |
| `injectToggle` | `true` | 在「匹配 → 当前歌曲」注入「自动打开候选」 |
| `injectRematch` | `true` | 注入「重新匹配」按钮 |
| `closeDrawerOnRematch` | `false` | 重新匹配后是否关闭抽屉（默认留在抽屉内查看） |
| `notify` | `true` | toast |
| `locale` | `auto` | 文案语言 |
| `normalizeEnabled` | `true` | 搜索前统一处理全角/半角、繁简、假名、括号与噪音词 |
| `normalizeTraditional` | `false` | 繁体转简体（内置 OpenCC 词表，含假名的标题跳过） |
| `normalizeKana` | `off` | 假名处理：`off` / `auto` / `hiragana` / `katakana` |
| `normalizeNoise` | `true` | 去掉 (MV)、[Official Video]、【歌詞】、feat.、prod. 等后缀 |
| `normalizeKeepVersion` | `true` | 把 Live / Cover / Remix / TV Size 等版本词规范后保留 |
| `normalizeIncludeArtist` | `false` | 搜索词附带歌手（LRCLIB 对「歌名 歌手」常返回空，默认只发歌名） |
| `normalizeDebug` | `false` | 在开发者工具控制台打印最终搜索词 |

繁简转换词表由 OpenCC 的 t2s 词典生成（Apache-2.0，<https://github.com/BYVoid/OpenCC>），内嵌在 `mod.js` 中，无运行时依赖。

## 自检

```powershell
node .\scripts\_smoke-lyrics-whitebox.cjs
node --test tests/example-ui-regressions.test.mjs
node .\scripts\pack-echomod.mjs .\examples\ECHO-LyricsMatchWhitebox\echomod .\examples\packages\ECHO-LyricsMatchWhitebox.echomod
```
