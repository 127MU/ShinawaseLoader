# ECHO Lyrics Match Whitebox

**Loader Mod only** — does not patch ECHO / ECHOSteam source.

Steam 默认关闭 `lyricsCandidatePanelAutoOpenEnabled`，网络匹配在后台进行。旧版白盒会强制打开该开关，导致**每次播放都在歌词页中央弹出浮层**，挡住歌词。

本 Mod（v1.1+）改为与 ECHODev 一致的交互：

1. 用官方标题栏 **「歌词设置」** 拉开右侧抽屉（不再注入深色小圆图标）
2. 抽屉「匹配」页保留 **重新匹配**：打开原生手动候选搜索，结果会留在面板中供选择；保留当前歌词，避免清缓存触发重载或自动应用后闪现关闭
3. **默认不再自动弹出**候选浮层；需要时在抽屉里打开「自动打开候选」
4. 启动时清除此前强制打开的自动弹出

从其他页面点击「重新匹配」会先打开歌词页。候选面板出现后，抽屉遮罩不会拦截候选的搜索、预览与应用操作。

来源筛选按钮固定可读的文字与布局，不随 MV 背景配色变成空白。搜索中或没有候选时显示「全部来源 0」和说明；候选返回后自动恢复原生来源筛选。

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

## 自检

```powershell
node .\scripts\_smoke-lyrics-whitebox.cjs
node .\scripts\pack-echomod.mjs .\examples\ECHO-LyricsMatchWhitebox\echomod .\examples\packages\ECHO-LyricsMatchWhitebox.echomod
```
