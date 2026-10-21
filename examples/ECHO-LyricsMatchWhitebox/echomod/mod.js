/**
 * ECHO Lyrics Match Whitebox
 *
 * Restores drawer rematch + optional candidate panel, but does NOT auto-pop a
 * floating overlay on every track change. Entry point is a persistent
 * top-right lyrics-settings icon on the lyrics page → opens the official
 * right-side drawer (same as ECHODev / titlebar「歌词设置」).
 *
 * Does not patch ECHO / ECHOSteam source.
 */
const external = echoExternalMod;
const config = external.config && typeof external.config === 'object' ? external.config : {};

/** Legacy: force-enable floating candidate panel. Default OFF — auto-pop is the bug. */
const forceEnable = config.forceEnable === true;
/** Re-enable if something else clears the flag. Only meaningful with forceEnable. */
const keepForced = config.keepForced === true;
/** On boot, clear a previously forced auto-open so play no longer pops the overlay. */
const disableAutoOpenOnBoot = config.disableAutoOpenOnBoot !== false;
const injectToggle = config.injectToggle !== false;
const injectRematch = config.injectRematch !== false;
/** Keep drawer open on rematch so matching stays in the side drawer (ECHODev-style). */
const closeDrawerOnRematch = config.closeDrawerOnRematch === true;
/** Never inject a floating corner blob; lyrics settings already lives in the titlebar. */
const injectCornerIcon = config.injectCornerIcon === true;
const notify = config.notify !== false;

/* NORMALIZER_START */
/**
 * Lyrics search text normalization.
 *
 * ECHO's manual lyrics search accepts a single string and treats it as the
 * track title (artist is left empty by the host), so the only lever a mod has
 * is making that string as searchable as possible:
 *   - NFKC: full-width ASCII / half-width katakana -> canonical width
 *   - Traditional Chinese -> Simplified Chinese (opt-in; OpenCC t2s dictionaries)
 *   - Japanese kana folding (opt-in; "auto" folds pure-kana katakana to hiragana)
 *   - Bracketed video/audio noise removal and version-tag canonicalization
 *   - Punctuation / symbol folding and whitespace collapse
 *
 * The Traditional->Simplified dictionary data below is generated from
 * OpenCC's t2s dictionaries (Apache-2.0, https://github.com/BYVoid/OpenCC).
 * No runtime dependency is required.
 */
const LYRICS_T2S_PHRASES = "一坏 一坯|一目瞭然 一目了然|七逕 七迳|上逕 上迳|上鍊 上链|不可貲計 不可赀計|不瞭解 不了解|么麼 幺麽|么麽 幺麽|九逕山 九迳山|乾乾淨淨 干干净净|乾乾脆脆 干干脆脆|乾佑縣 乾佑县|乾元 乾元|乾卦 乾卦|乾嘉 乾嘉|乾圖 乾图|乾坤 乾坤|乾坤一擲 乾坤一掷|乾坤再造 乾坤再造|乾坤大挪移 乾坤大挪移|乾宅 乾宅|乾安縣 乾安县|乾安鎮 乾安镇|乾州 乾州|乾斷 乾断|乾斷食 干断食|乾旦 乾旦|乾曜 乾曜|乾清宮 乾清宫|乾盛世 乾盛世|乾紅 干红|乾綱 乾纲|乾縣 乾县|乾象 乾象|乾造 乾造|乾道 乾道|乾闥婆 乾闼婆|乾陵 乾陵|乾隆 乾隆|乾隆年間 乾隆年间|乾隆皇帝 乾隆皇帝|二噁英 二𫫇英|仇讎 仇雠|以免藉口 以免借口|以功覆過 以功覆过|任筆沈詩 任笔沈诗|侔德覆載 侔德覆载|傢俱 家具|傷亡枕藉 伤亡枕藉|允祕 允祕|八濛山 八濛山|其陰多蒐 其阴多蒐|凌藉 凌借|出醜狼藉 出丑狼藉|函覆 函复|剋架 剋架|剋毒 剋毒|千鍾粟 千锺粟|南氾 南氾|南逕 南迳|反反覆覆 反反复复|反覆 反复|反覆思維 反复思维|反覆思量 反复思量|反覆性 反复性|名覆金甌 名复金瓯|吳祕 吴祕|吳育昇 吴育昇|哪吒 哪吒|回覆 回复|土坏 土坯|坏土 坯土|坏子 坯子|坏布 坯布|坏戶 坯户|墨沈沈 墨沉沉|壺裏乾坤 壶里乾坤|大目乾連冥間救母變文 大目乾连冥间救母变文|宫商角徵羽 宫商角徵羽|射覆 射覆|尼乾子 尼乾子|尼乾陀 尼乾陀|年釐 年釐|幺麼 幺麽|幺麼小丑 幺麽小丑|幺麼小醜 幺麽小丑|康乾 康乾|張昇 张昇|張法乾 张法乾|彷彿 仿佛|彷徨 彷徨|徐胤昇 徐胤昇|復甦 复苏|徵弦 徵弦|徵絃 徵弦|徵羽摩柯 徵羽摩柯|徵聲 徵声|徵調 徵调|徵音 徵音|情有獨鍾 情有独钟|想像 想像|意志消沈 意志消沉|慰藉 慰藉|慰藉着 慰藉着|憑藉 凭借|憑藉着 凭借着|懷釐 怀釐|成甦 成甦|所費不貲 所费不赀|手鍊 手链|打坏 打坯|扞格 扞格|扭轉乾坤 扭转乾坤|批覆 批复|找藉口 找借口|折戟沈沙 折戟沉沙|折戟沈河 折戟沉河|拉坏 拉坯|拉鍊 拉链|拉鍊工程 拉链工程|拜覆 拜复|挨剋 挨剋|捏坏 捏坯|擊沈 击沉|據瞭解 据了解|文錦覆阱 文锦覆阱|於世成 於世成|於乎 於乎|於仲完 於仲完|於倫 於伦|於其一 於其一|於則 於则|於勇明 於勇明|於呼哀哉 於呼哀哉|於單 於单|於坦 於坦|於崇文 於崇文|於忠祥 於忠祥|於惟一 於惟一|於戲 於戏|於敖 於敖|於梨華 於梨华|於清言 於清言|於潛 於潜|於琳 於琳|於穆 於穆|於竹屋 於竹屋|於菟 於菟|於邑 於邑|於陵子 於陵子|旋乾轉坤 旋乾转坤|旋轉乾坤 旋转乾坤|旋轉乾坤之力 旋转乾坤之力|明瞭 明了|明覆 明复|昏沈 昏沉|春蒐 春蒐|春釐 春釐|暗沈沈 暗沉沉|書中自有千鍾粟 书中自有千锺粟|有序 有序|朝乾夕惕 朝乾夕惕|木吒 木吒|李乾德 李乾德|李昇 李昇|李昇勳 李昇勋|李澤鉅 李泽钜|李祕 李祕|李鍊福 李链福|李鍾郁 李锺郁|束脩 束脩|東氾 东氾|林甦 林甦|校讎 校雠|梁昇卿 梁昇卿|梁章鉅 梁章钜|楊甦棣 杨甦棣|楊聯陞 杨联陞|樊於期 樊於期|橡椀 橡椀|死氣沈沈 死气沉沉|段脩 段脩|毛坏 毛坯|水逕 水迳|氾勝之 氾胜之|氾南 氾南|氾國 氾国|氾水 氾水|沈下 沉下|沈不住氣 沉不住气|沈住氣 沉住气|沈冤 沉冤|沈厚 沉厚|沈吟 沉吟|沈寂 沉寂|沈得住氣 沉得住气|沈思 沉思|沈思往事 沉思往事|沈悶 沉闷|沈沒 沉没|沈沒成本 沉没成本|沈浮 沉浮|沈浸 沉浸|沈浸於 沉浸于|沈淪 沉沦|沈湎 沉湎|沈湎酒色 沉湎酒色|沈溺 沉溺|沈滯 沉滞|沈滯性 沉滞性|沈澱 沉淀|沈澱出來 沉淀出来|沈澱劑 沉淀剂|沈澱法 沉淀法|沈澱物 沉淀物|沈濁 沉浊|沈甸甸 沉甸甸|沈痛 沉痛|沈痼 沉痼|沈痾 沉疴|沈睡 沉睡|沈睡不醒 沉睡不醒|沈砂池 沉砂池|沈積 沉积|沈積岩 沉积岩|沈積石 沉积石|沈筒 沉筒|沈船 沉船|沈落 沉落|沈詩任筆 沈诗任笔|沈迷 沉迷|沈迷不醒 沉迷不醒|沈醉 沉醉|沈重 沉重|沈降 沉降|沈陷 沉陷|沈靜 沉静|沈靜下來 沉静下来|沈香 沉香|沈鬱 沉郁|沈魚落雁 沉鱼落雁|沈默 沉默|沈默不語 沉默不语|沈默寡言 沉默寡言|沙逕 沙迳|河逕 河迳|流徵 流徵|浪蕩乾坤 浪荡乾坤|浮沈 浮沉|海哩 海里|深沈 深沉|深沈不露 深沉不露|溫昇豪 温昇豪|滑藉 滑借|烏昇 乌昇|烏沈沈 乌沉沉|烏逕 乌迳|無序 无序|狐藉虎威 狐借虎威|王彥昇 王彦昇|珍珠項鍊 珍珠项链|甚鉅 甚钜|甦生 苏生|甦醒 苏醒|申昇勳 申昇勋|申覆 申复|畢昇 毕昇|發覆 发覆|盧象昇 卢象昇|目劄 目劄|瞭哨 瞭哨|瞭如 了如|瞭如指掌 了如指掌|瞭望 瞭望|瞭然 了然|瞭然於心 了然于心|瞭若指掌 了若指掌|瞭解 了解|瞭解到 了解到|破釜沈舟 破釜沉舟|磚坏 砖坯|示覆 示复|社逕 社迳|祕丕笈 祕丕笈|祕彭祖 祕彭祖|祕瓊 祕琼|祝釐 祝釐|神祇 神祇|稟覆 禀复|竺乾 竺乾|答覆 答复|篤麼 笃麽|簡單明瞭 简单明了|籌畫 筹划|素藉 素借|老態龍鍾 老态龙钟|耳沈 耳沉|肉脩 肉脩|肘手鍊足 肘手链足|胤祕 胤祕|脩敬 脩敬|脩炳 脩炳|脩脡 脩脡|脩脯 脩脯|脩金 脩金|脫坏 脱坯|腶脩 腶脩|英哩 英里|茅蒐 茅蒐|茵藉 茵借|萬鍾 万锺|落雁沈魚 落雁沉鱼|蒐于紅 蒐于红|蒐於紅 蒐于红|蒐狩 蒐狩|蒐獮 蒐狝|蒐獵 蒐猎|蒐田 蒐田|蒐畋 蒐畋|蒐苗 蒐苗|蒜薹 蒜薹|蔣昇 蒋昇|蕓薹 芸薹|蕩覆 荡覆|蕭乾 萧乾|藉代 借代|藉以 借以|藉助 借助|藉助於 借助于|藉卉 借卉|藉口 借口|藉喻 借喻|藉寇兵 借寇兵|藉寇兵齎盜糧 借寇兵赍盗粮|藉手 借手|藉據 借据|藉故 借故|藉故推辭 借故推辞|藉方 借方|藉條 借条|藉槁 借槁|藉機 借机|藉此 借此|藉此機會 借此机会|藉甚 借甚|藉由 借由|藉着 借着|藉端 借端|藉端生事 借端生事|藉箸代籌 借箸代筹|藉草枕塊 借草枕块|藉藉 藉藉|藉藉无名 藉藉无名|藉詞 借词|藉讀 借读|藉資 借资|衹得 只得|衹見樹木 只见树木|衹見樹木不見森林 只见树木不见森林|袁祕 袁祕|袖裏乾坤 袖里乾坤|袷袢 袷袢|製坏 制坯|覆上 覆上|覆住 覆住|覆信 复信|覆冒 覆冒|覆呈 复呈|覆命 复命|覆墓 复墓|覆宗 覆宗|覆帳 复帐|覆幬 覆帱|覆成 覆成|覆按 复按|覆文 复文|覆杯 覆杯|覆校 复校|覆瓿 覆瓿|覆盂 覆盂|覆盆 覆盆|覆盆子 覆盆子|覆盤 覆盘|覆育 覆育|覆蕉尋鹿 覆蕉寻鹿|覆逆 覆逆|覆醢 覆醢|覆醬瓿 覆酱瓿|覆電 复电|覆露 覆露|覆鹿尋蕉 覆鹿寻蕉|覆鹿遺蕉 覆鹿遗蕉|覆鼎 覆鼎|見覆 见复|角徵 角徵|角徵羽 角徵羽|計畫 计划|許甦魂 许甦魂|變徵 变徵|變徵之聲 变徵之声|變徵之音 变徵之音|讎定 雠定|谿工 谿工|貂覆額 貂覆额|買臣覆水 买臣覆水|赤石逕 赤石迳|踅門瞭戶 踅门了户|躪藉 躏借|載沈載浮 载沉载浮|載浮載沈 载浮载沉|辛祕 辛祕|逆釐 逆釐|逕口 迳口|逕聯 迳联|逕頭 迳头|郭子乾 郭子乾|酒逢知己千鍾少 酒逢知己千锺少|醞藉 酝借|重覆 重复|金吒 金吒|金昇玟 金昇玟|金鍊 金链|鈞覆 钧复|鉅子 钜子|鉅萬 钜万|鉅防 钜防|鉸鍊 铰链|銀鍊 银链|鋼坏 钢坯|錢鍾書 钱锺书|鍊墜 链坠|鍊子 链子|鍊形 链形|鍊條 链条|鍊錘 链锤|鍊鎖 链锁|鍛鍾 锻锺|鍾繇 锺繇|鍾萬梅 锺万梅|鍾重發 锺重发|鍾鍛 锺锻|鍾馗 锺馗|鎖鍊 锁链|鐵鍊 铁链|鑽石項鍊 钻石项链|鑿坏 凿坯|閻鶴昇 阎鹤昇|陰沈 阴沉|陰沈沈 阴沉沉|陰陰沈沈 阴阴沉沉|陳志昇 陈志昇|陳昇 陈昇|陳甦 陈甦|陶坏 陶坯|雁杳魚沈 雁杳鱼沉|雖覆能復 虽覆能复|電覆 电复|露覆 露覆|韓昇延 韩昇延|韓甦 韩甦|項鍊 项链|頗覆 颇覆|頸鍊 颈链|顛乾倒坤 颠乾倒坤|顛倒乾坤 颠倒乾坤|顧藉 顾借|馮甦 冯甦|魏徵 魏徵|魚沈雁杳 鱼沉雁杳|麪坏兒 面坯儿|麼些族 麽些族|黃甦 黄甦|黃鍾公 黄锺公|黑沈沈 黑沉沉|龍鍾 龙钟|龔昇 龚昇";
const LYRICS_T2S_CHARS = "㑯 㑔|㑳 㑇|㑶 㐹|㓨 刾|㗲 𠵾|㘚 㘎|㜄 㚯|㜏 㛣|㜢 𡞱|㠏 㟆|㠣 𫵷|㥮 㤘|㩜 㨫|㩳 㧐|㩵 擜|㺏 𤠋|䁪 𥇢|䁻 䀥|䃮 鿎|䊷 䌶|䋙 䌺|䋚 䌻|䋹 䌿|䋻 䌾|䍦 䍠|䎱 䎬|䓣 𬜯|䙡 䙌|䜀 䜧|䝼 䞍|䡵 𫟦|䥇 䦂|䥑 鿏|䥕 𬭯|䥱 䥾|䦛 䦶|䦟 䦷|䧢 𨸟|䮄 𫠊|䯀 䯅|䰾 鲃|䱷 䲣|䱽 䲝|䲁 鳚|䲘 鳤|䴉 鹮|丟 丢|並 并|乾 干|亂 乱|亙 亘|亞 亚|佇 伫|佈 布|佔 占|併 并|來 来|侖 仑|侶 侣|侷 局|俁 俣|係 系|俔 伣|俠 侠|俥 伡|俬 私|倀 伥|倆 俩|倈 俫|倉 仓|個 个|們 们|倖 幸|倫 伦|倲 㑈|偉 伟|偑 㐽|側 侧|偵 侦|偽 伪|傌 㐷|傑 杰|傖 伧|傘 伞|備 备|傢 家|傭 佣|傯 偬|傳 传|傴 伛|債 债|傷 伤|傾 倾|僂 偻|僅 仅|僉 佥|僑 侨|僕 仆|僞 伪|僤 𫢸|僥 侥|僨 偾|僱 雇|價 价|儀 仪|儁 俊|儂 侬|億 亿|儈 侩|儉 俭|儎 傤|儐 傧|儔 俦|儕 侪|儘 尽|償 偿|優 优|儲 储|儷 俪|儸 㑩|儺 傩|儻 傥|儼 俨|兇 凶|兌 兑|兒 儿|兗 兖|內 内|兩 两|冊 册|冑 胄|冪 幂|凈 净|凍 冻|凜 凛|凱 凯|別 别|刪 删|剄 刭|則 则|剋 克|剎 刹|剗 刬|剛 刚|剝 剥|剮 剐|剴 剀|創 创|剷 铲|劃 划|劄 札|劇 剧|劉 刘|劊 刽|劌 刿|劍 剑|劏 㓥|劑 剂|劚 㔉|勁 劲|動 动|務 务|勛 勋|勝 胜|勞 劳|勢 势|勣 𪟝|勩 勚|勱 劢|勳 勋|勵 励|勸 劝|勻 匀|匭 匦|匯 汇|匱 匮|區 区|協 协|卹 恤|卻 却|卽 即|厙 厍|厠 厕|厤 历|厭 厌|厲 厉|厴 厣|參 参|叄 叁|叢 丛|吒 咤|吳 吴|吶 呐|呂 吕|咼 呙|員 员|唄 呗|唸 念|問 问|啓 启|啞 哑|啟 启|啢 唡|喎 㖞|喚 唤|喪 丧|喫 吃|喬 乔|單 单|喲 哟|嗆 呛|嗇 啬|嗊 唝|嗎 吗|嗚 呜|嗩 唢|嗰 𠮶|嗶 哔|嘆 叹|嘍 喽|嘓 啯|嘔 呕|嘖 啧|嘗 尝|嘜 唛|嘩 哗|嘮 唠|嘯 啸|嘰 叽|嘵 哓|嘸 呒|嘽 啴|噁 恶|噓 嘘|噚 㖊|噝 咝|噠 哒|噥 哝|噦 哕|噯 嗳|噲 哙|噴 喷|噸 吨|噹 当|嚀 咛|嚇 吓|嚌 哜|嚐 尝|嚕 噜|嚙 啮|嚥 咽|嚦 呖|嚧 𠰷|嚨 咙|嚮 向|嚲 亸|嚳 喾|嚴 严|嚶 嘤|囀 啭|囁 嗫|囂 嚣|囅 冁|囈 呓|囉 啰|囌 苏|囑 嘱|囪 囱|圇 囵|國 国|圍 围|園 园|圓 圆|圖 图|團 团|垻 坝|埡 垭|埨 𫭢|埰 采|執 执|堅 坚|堊 垩|堖 垴|堝 埚|堯 尧|報 报|場 场|塊 块|塋 茔|塏 垲|塒 埘|塗 涂|塚 冢|塢 坞|塤 埙|塵 尘|塸 𫭟|塹 堑|塿 𪣻|墊 垫|墜 坠|墠 𫮃|墮 堕|墰 坛|墳 坟|墶 垯|墻 墙|墾 垦|壇 坛|壋 垱|壎 埙|壓 压|壗 𡋤|壘 垒|壙 圹|壚 垆|壜 坛|壞 坏|壟 垄|壠 垅|壢 坜|壩 坝|壪 塆|壯 壮|壺 壶|壼 壸|壽 寿|夠 够|夢 梦|夥 伙|夾 夹|奐 奂|奧 奥|奩 奁|奪 夺|奬 奖|奮 奋|奼 姹|妝 妆|姍 姗|姦 奸|娙 𫰛|娛 娱|婁 娄|婦 妇|婭 娅|媧 娲|媯 妫|媰 㛀|媼 媪|媽 妈|嫋 袅|嫗 妪|嫵 妩|嫺 娴|嫻 娴|嫿 婳|嬀 妫|嬃 媭|嬈 娆|嬋 婵|嬌 娇|嬙 嫱|嬡 嫒|嬤 嬷|嬪 嫔|嬰 婴|嬸 婶|孃 娘|孋 㛤|孌 娈|孫 孙|學 学|孻 𡥧|孿 孪|宮 宫|寀 采|寢 寝|實 实|寧 宁|審 审|寫 写|寬 宽|寵 宠|寶 宝|將 将|專 专|尋 寻|對 对|導 导|尷 尴|屆 届|屍 尸|屓 屃|屜 屉|屢 屡|層 层|屨 屦|屬 属|岡 冈|峯 峰|峴 岘|島 岛|峽 峡|崍 崃|崑 昆|崗 岗|崙 仑|崢 峥|崬 岽|嵐 岚|嵗 岁|嵽 𫶇|嵾 㟥|嶁 嵝|嶄 崭|嶇 岖|嶔 嵚|嶗 崂|嶠 峤|嶢 峣|嶧 峄|嶨 峃|嶮 崄|嶸 嵘|嶺 岭|嶼 屿|嶽 岳|巋 岿|巒 峦|巔 巅|巖 岩|巘 𪩘|巰 巯|巹 卺|帥 帅|師 师|帳 帐|帶 带|幀 帧|幃 帏|幓 㡎|幗 帼|幘 帻|幟 帜|幣 币|幫 帮|幬 帱|幷 并|幹 干|幾 几|庫 库|廁 厕|廂 厢|廄 厩|廈 厦|廎 庼|廕 荫|廚 厨|廝 厮|廞 𫷷|廟 庙|廠 厂|廡 庑|廢 废|廣 广|廩 廪|廬 庐|廳 厅|弒 弑|弔 吊|弳 弪|張 张|強 强|彄 𫸩|彆 别|彈 弹|彌 弥|彎 弯|彔 录|彙 汇|彠 彟|彥 彦|彫 雕|彲 彨|彿 佛|後 后|徑 径|從 从|徠 徕|復 复|徵 征|徹 彻|恆 恒|恥 耻|悅 悦|悞 悮|悵 怅|悶 闷|悽 凄|惡 恶|惱 恼|惲 恽|惻 恻|愛 爱|愜 惬|愨 悫|愴 怆|愷 恺|愾 忾|慄 栗|態 态|慍 愠|慘 惨|慚 惭|慟 恸|慣 惯|慤 悫|慪 怄|慫 怂|慮 虑|慳 悭|慶 庆|慺 㥪|慼 戚|慾 欲|憂 忧|憊 惫|憐 怜|憑 凭|憒 愦|憖 慭|憚 惮|憤 愤|憫 悯|憮 怃|憲 宪|憶 忆|懇 恳|應 应|懌 怿|懍 懔|懞 蒙|懟 怼|懣 懑|懤 㤽|懨 恹|懲 惩|懶 懒|懷 怀|懸 悬|懺 忏|懼 惧|懾 慑|戀 恋|戇 戆|戔 戋|戧 戗|戩 戬|戰 战|戱 戯|戲 戏|戶 户|扞 捍|拋 抛|拚 拼|挩 捝|挱 挲|挾 挟|捨 舍|捫 扪|捱 挨|捲 卷|掃 扫|掄 抡|掆 㧏|掗 挜|掙 挣|掛 挂|採 采|揀 拣|揚 扬|換 换|揮 挥|揯 搄|損 损|搖 摇|搗 捣|搧 扇|搵 揾|搶 抢|摑 掴|摜 掼|摟 搂|摯 挚|摳 抠|摶 抟|摺 折|摻 掺|撈 捞|撏 挦|撐 撑|撓 挠|撝 㧑|撟 挢|撣 掸|撥 拨|撫 抚|撲 扑|撳 揿|撻 挞|撾 挝|撿 捡|擁 拥|擄 掳|擇 择|擊 击|擋 挡|擓 㧟|擔 担|據 据|擠 挤|擡 抬|擣 捣|擬 拟|擯 摈|擰 拧|擱 搁|擲 掷|擴 扩|擷 撷|擺 摆|擻 擞|擼 撸|擽 㧰|擾 扰|攄 摅|攆 撵|攏 拢|攔 拦|攖 撄|攙 搀|攛 撺|攜 携|攝 摄|攢 攒|攣 挛|攤 摊|攪 搅|攬 揽|敎 教|敓 敚|敗 败|敘 叙|敵 敌|數 数|斂 敛|斃 毙|斆 敩|斕 斓|斬 斩|斷 断|於 于|旂 旗|旣 既|昇 升|時 时|晉 晋|晛 𬀪|晝 昼|暈 晕|暉 晖|暐 𬀩|暘 旸|暢 畅|暫 暂|曄 晔|曆 历|曇 昙|曉 晓|曏 向|曖 暧|曠 旷|曥 𣆐|曨 昽|曬 晒|書 书|會 会|朥 𦛨|朧 胧|朮 术|東 东|枴 拐|柵 栅|柺 拐|査 查|桱 𣐕|桿 杆|梔 栀|梘 枧|梜 𬂩|條 条|梟 枭|梲 棁|棄 弃|棊 棋|棖 枨|棗 枣|棟 栋|棡 㭎|棧 栈|棲 栖|棶 梾|椏 桠|椲 㭏|楊 杨|楓 枫|楨 桢|業 业|極 极|榘 矩|榦 干|榪 杩|榮 荣|榲 榅|榿 桤|構 构|槍 枪|槓 杠|槤 梿|槧 椠|槨 椁|槮 椮|槳 桨|槶 椢|槼 椝|樁 桩|樂 乐|樅 枞|樑 梁|樓 楼|標 标|樞 枢|樢 㭤|樣 样|樧 榝|樫 㭴|樳 桪|樸 朴|樹 树|樺 桦|樿 椫|橈 桡|橋 桥|機 机|橢 椭|橫 横|橯 𣓿|檁 檩|檉 柽|檔 档|檜 桧|檟 槚|檢 检|檣 樯|檮 梼|檯 台|檳 槟|檸 柠|檻 槛|櫃 柜|櫍 𬃊|櫓 橹|櫚 榈|櫛 栉|櫝 椟|櫞 橼|櫟 栎|櫥 橱|櫧 槠|櫨 栌|櫪 枥|櫫 橥|櫬 榇|櫱 蘖|櫳 栊|櫸 榉|櫻 樱|欄 栏|欅 榉|權 权|欏 椤|欒 栾|欓 𣗋|欖 榄|欞 棂|欽 钦|歎 叹|歐 欧|歟 欤|歡 欢|歲 岁|歷 历|歸 归|歿 殁|殘 残|殞 殒|殤 殇|殨 㱮|殫 殚|殭 僵|殮 殓|殯 殡|殰 㱩|殲 歼|殺 杀|殻 壳|殼 壳|毀 毁|毆 殴|毿 毵|氂 牦|氈 毡|氌 氇|氣 气|氫 氢|氬 氩|氳 氲|氾 泛|汎 泛|汙 污|決 决|沒 没|沖 冲|況 况|泝 溯|洩 泄|洶 汹|浹 浃|浿 𬇙|涇 泾|涗 涚|涼 凉|淒 凄|淚 泪|淥 渌|淨 净|淩 凌|淪 沦|淵 渊|淶 涞|淺 浅|渙 涣|減 减|渢 沨|渦 涡|測 测|渾 浑|湊 凑|湋 𣲗|湞 浈|湧 涌|湯 汤|溈 沩|準 准|溝 沟|溫 温|溮 浉|溳 涢|溼 湿|滄 沧|滅 灭|滌 涤|滎 荥|滙 汇|滬 沪|滯 滞|滲 渗|滷 卤|滸 浒|滻 浐|滾 滚|滿 满|漁 渔|漊 溇|漍 𬇹|漚 沤|漢 汉|漣 涟|漬 渍|漲 涨|漵 溆|漸 渐|漿 浆|潁 颍|潑 泼|潔 洁|潕 𣲘|潙 沩|潚 㴋|潛 潜|潤 润|潯 浔|潰 溃|潷 滗|潿 涠|澀 涩|澆 浇|澇 涝|澐 沄|澗 涧|澠 渑|澤 泽|澦 滪|澩 泶|澫 𬇕|澮 浍|澱 淀|澾 㳠|濁 浊|濃 浓|濄 㳡|濆 𣸣|濕 湿|濘 泞|濚 溁|濛 蒙|濜 浕|濟 济|濤 涛|濧 㳔|濫 滥|濰 潍|濱 滨|濺 溅|濼 泺|濾 滤|瀂 澛|瀅 滢|瀆 渎|瀇 㲿|瀉 泻|瀋 沈|瀏 浏|瀕 濒|瀘 泸|瀝 沥|瀟 潇|瀠 潆|瀦 潴|瀧 泷|瀨 濑|瀰 弥|瀲 潋|瀾 澜|灃 沣|灄 滠|灑 洒|灒 𪷽|灕 漓|灘 滩|灙 𣺼|灝 灏|灡 㳕|灣 湾|灤 滦|灧 滟|灩 滟|災 灾|為 为|烏 乌|烴 烃|無 无|煉 炼|煒 炜|煙 烟|煢 茕|煥 焕|煩 烦|煬 炀|煱 㶽|熅 煴|熒 荧|熗 炝|熰 𬉼|熱 热|熲 颎|熾 炽|燀 𬊤|燁 烨|燈 灯|燉 炖|燒 烧|燖 𬊈|燙 烫|燜 焖|營 营|燦 灿|燬 毁|燭 烛|燴 烩|燶 㶶|燻 熏|燼 烬|燾 焘|爍 烁|爐 炉|爛 烂|爭 争|爲 为|爺 爷|爾 尔|牀 床|牆 墙|牘 牍|牴 抵|牽 牵|犖 荦|犛 牦|犢 犊|犧 牺|狀 状|狹 狭|狽 狈|猙 狰|猶 犹|猻 狲|獁 犸|獃 呆|獄 狱|獅 狮|獎 奖|獨 独|獪 狯|獫 猃|獮 狝|獰 狞|獱 㺍|獲 获|獵 猎|獷 犷|獸 兽|獺 獭|獻 献|獼 猕|玀 猡|現 现|琱 雕|琺 珐|琿 珲|瑋 玮|瑒 玚|瑣 琐|瑤 瑶|瑩 莹|瑪 玛|瑲 玱|璉 琏|璊 𫞩|璕 𬍤|璗 𬍡|璡 琎|璣 玑|璦 瑷|璫 珰|璯 㻅|環 环|璵 玙|璸 瑸|璽 玺|璿 璇|瓅 𬍛|瓊 琼|瓏 珑|瓔 璎|瓚 瓒|瓛 𤩽|甌 瓯|甕 瓮|產 产|産 产|畝 亩|畢 毕|畫 画|異 异|畵 画|當 当|疇 畴|疊 叠|痙 痉|痠 酸|痾 疴|瘂 痖|瘋 疯|瘍 疡|瘓 痪|瘞 瘗|瘡 疮|瘧 疟|瘮 瘆|瘲 疭|瘺 瘘|瘻 瘘|療 疗|癆 痨|癇 痫|癉 瘅|癒 愈|癘 疠|癟 瘪|癡 痴|癢 痒|癤 疖|癥 症|癧 疬|癩 癞|癬 癣|癭 瘿|癮 瘾|癰 痈|癱 瘫|癲 癫|發 发|皁 皂|皚 皑|皰 疱|皸 皲|皺 皱|盃 杯|盜 盗|盞 盏|盡 尽|監 监|盤 盘|盧 卢|盪 荡|眞 真|眥 眦|眾 众|睍 𪾢|睏 困|睜 睁|睞 睐|瞘 眍|瞜 䁖|瞞 瞒|瞶 瞆|瞼 睑|矇 蒙|矓 眬|矚 瞩|矯 矫|硃 朱|硜 硁|硤 硖|硨 砗|硯 砚|碕 埼|碩 硕|碭 砀|碸 砜|確 确|碼 码|碽 䂵|磑 硙|磚 砖|磠 硵|磣 碜|磧 碛|磯 矶|磽 硗|磾 䃅|礄 硚|礎 础|礐 𬒈|礙 碍|礦 矿|礪 砺|礫 砾|礬 矾|礱 砻|祕 秘|祿 禄|禍 祸|禎 祯|禕 祎|禡 祃|禦 御|禪 禅|禮 礼|禰 祢|禱 祷|禿 秃|秈 籼|稅 税|稈 秆|稏 䅉|稜 棱|稟 禀|種 种|稱 称|穀 谷|穇 䅟|穌 稣|積 积|穎 颖|穠 秾|穡 穑|穢 秽|穩 稳|穫 获|穭 穞|窩 窝|窪 洼|窮 穷|窯 窑|窵 窎|窶 窭|窺 窥|竄 窜|竅 窍|竇 窦|竈 灶|竊 窃|竪 竖|競 竞|筆 笔|筍 笋|筧 笕|筴 䇲|箇 个|箋 笺|箏 筝|箚 札|節 节|範 范|築 筑|篋 箧|篔 筼|篠 筿|篢 𬕂|篤 笃|篩 筛|篳 筚|篸 𥮾|簀 箦|簍 篓|簑 蓑|簞 箪|簡 简|簣 篑|簫 箫|簹 筜|簽 签|簾 帘|籃 篮|籅 𥫣|籌 筹|籔 䉤|籙 箓|籛 篯|籜 箨|籟 籁|籠 笼|籤 签|籩 笾|籪 簖|籬 篱|籮 箩|籲 吁|粵 粤|糉 粽|糝 糁|糞 粪|糧 粮|糰 团|糲 粝|糴 籴|糶 粜|糹 纟|糾 纠|紀 纪|紂 纣|紃 𬘓|約 约|紅 红|紆 纡|紇 纥|紈 纨|紉 纫|紋 纹|納 纳|紐 纽|紓 纾|純 纯|紕 纰|紖 纼|紗 纱|紘 纮|紙 纸|級 级|紛 纷|紜 纭|紝 纴|紞 𬘘|紡 纺|紬 䌷|紮 扎|細 细|紱 绂|紲 绁|紳 绅|紵 纻|紹 绍|紺 绀|紼 绋|紿 绐|絀 绌|終 终|絃 弦|組 组|絅 䌹|絆 绊|絎 绗|結 结|絕 绝|絛 绦|絝 绔|絞 绞|絡 络|絢 绚|給 给|絨 绒|絪 𬘡|絰 绖|統 统|絲 丝|絳 绛|絶 绝|絹 绢|絺 𫄨|綁 绑|綃 绡|綄 𬘫|綆 绠|綈 绨|綉 绣|綌 绤|綎 𬘩|綏 绥|綐 䌼|綑 捆|經 经|綖 𫄧|綜 综|綝 𬘭|綞 缍|綠 绿|綡 𫟅|綢 绸|綣 绻|綧 𬘯|綪 𬘬|綫 线|綬 绶|維 维|綯 绹|綰 绾|綱 纲|網 网|綳 绷|綴 缀|綵 彩|綸 纶|綹 绺|綺 绮|綻 绽|綽 绰|綾 绫|綿 绵|緄 绲|緇 缁|緊 紧|緋 绯|緑 绿|緒 绪|緓 绬|緔 绱|緗 缃|緘 缄|緙 缂|線 线|緝 缉|緞 缎|締 缔|緡 缗|緣 缘|緦 缌|編 编|緩 缓|緬 缅|緯 纬|緱 缑|緲 缈|練 练|緶 缏|緹 缇|緻 致|緼 缊|縈 萦|縉 缙|縊 缢|縋 缒|縐 绉|縑 缣|縕 缊|縗 缞|縛 缚|縝 缜|縞 缟|縟 缛|縣 县|縧 绦|縫 缝|縭 缡|縮 缩|縯 𬙂|縱 纵|縲 缧|縳 䌸|縴 纤|縵 缦|縶 絷|縷 缕|縹 缥|總 总|績 绩|繃 绷|繅 缫|繆 缪|繒 缯|織 织|繕 缮|繚 缭|繞 绕|繡 绣|繢 缋|繩 绳|繪 绘|繫 系|繭 茧|繮 缰|繯 缳|繰 缲|繳 缴|繶 𫄷|繸 䍁|繹 绎|繻 𦈡|繼 继|繽 缤|繾 缱|繿 䍀|纁 𫄸|纆 𬙊|纇 颣|纈 缬|纊 纩|續 续|纍 累|纏 缠|纓 缨|纔 才|纕 𬙋|纖 纤|纘 缵|纜 缆|缽 钵|罃 䓨|罈 坛|罌 罂|罎 坛|罰 罚|罵 骂|罷 罢|羅 罗|羆 罴|羈 羁|羋 芈|羣 群|羥 羟|羨 羡|義 义|羶 膻|習 习|翫 玩|翬 翚|翹 翘|翽 翙|耬 耧|耮 耢|聖 圣|聞 闻|聯 联|聰 聪|聲 声|聳 耸|聵 聩|聶 聂|職 职|聹 聍|聽 听|聾 聋|肅 肃|脅 胁|脈 脉|脛 胫|脣 唇|脩 修|脫 脱|脹 胀|腎 肾|腖 胨|腡 脶|腦 脑|腫 肿|腳 脚|腸 肠|膃 腽|膕 腘|膚 肤|膞 䏝|膠 胶|膢 𦝼|膩 腻|膽 胆|膾 脍|膿 脓|臉 脸|臍 脐|臏 膑|臘 腊|臚 胪|臟 脏|臠 脔|臢 臜|臥 卧|臨 临|臺 台|與 与|興 兴|舉 举|舊 旧|舖 铺|舘 馆|艙 舱|艤 舣|艦 舰|艫 舻|艱 艰|艷 艳|芻 刍|苧 苎|茲 兹|荊 荆|莊 庄|莖 茎|莢 荚|莧 苋|華 华|菴 庵|菸 烟|萇 苌|萊 莱|萬 万|萴 荝|萵 莴|葉 叶|葒 荭|葤 荮|葦 苇|葯 药|葷 荤|蒍 𫇭|蒐 搜|蒓 莼|蒔 莳|蒕 蒀|蒞 莅|蒼 苍|蓀 荪|蓆 席|蓋 盖|蓮 莲|蓯 苁|蓴 莼|蓽 荜|蔄 𬜬|蔔 卜|蔘 参|蔞 蒌|蔣 蒋|蔥 葱|蔦 茑|蔭 荫|蔯 𫈟|蔿 𫇭|蕁 荨|蕆 蒇|蕎 荞|蕒 荬|蕓 芸|蕕 莸|蕘 荛|蕢 蒉|蕩 荡|蕪 芜|蕭 萧|蕷 蓣|薀 蕰|薈 荟|薊 蓟|薌 芗|薑 姜|薔 蔷|薘 荙|薟 莶|薦 荐|薩 萨|薳 䓕|薴 苧|薵 䓓|薹 苔|薺 荠|藍 蓝|藎 荩|藝 艺|藥 药|藪 薮|藭 䓖|藴 蕴|藶 苈|藹 蔼|藺 蔺|蘀 萚|蘄 蕲|蘆 芦|蘇 苏|蘊 蕴|蘋 苹|蘚 藓|蘞 蔹|蘟 𦻕|蘢 茏|蘭 兰|蘺 蓠|蘿 萝|虆 蔂|虉 𬟁|處 处|虛 虚|虜 虏|號 号|虧 亏|虯 虬|蛺 蛱|蛻 蜕|蜆 蚬|蝀 𬟽|蝕 蚀|蝟 猬|蝦 虾|蝨 虱|蝸 蜗|螄 蛳|螞 蚂|螢 萤|螮 䗖|螻 蝼|螿 螀|蟄 蛰|蟈 蝈|蟎 螨|蟣 虮|蟬 蝉|蟯 蛲|蟲 虫|蟳 𫊻|蟶 蛏|蟻 蚁|蠁 蚃|蠅 蝇|蠆 虿|蠍 蝎|蠐 蛴|蠑 蝾|蠔 蚝|蠟 蜡|蠣 蛎|蠨 蟏|蠱 蛊|蠶 蚕|蠻 蛮|衆 众|衊 蔑|術 术|衕 同|衚 胡|衛 卫|衝 冲|袞 衮|袷 夹|裊 袅|裏 里|補 补|裝 装|裡 里|製 制|複 复|褌 裈|褘 袆|褲 裤|褳 裢|褸 褛|褻 亵|襀 𫌀|襇 裥|襉 裥|襏 袯|襖 袄|襝 裣|襠 裆|襤 褴|襪 袜|襬 摆|襯 衬|襲 袭|襴 襕|覈 核|見 见|覎 觃|規 规|覓 觅|視 视|覘 觇|覡 觋|覥 觍|覦 觎|親 亲|覬 觊|覯 觏|覲 觐|覷 觑|覺 觉|覽 览|覿 觌|觀 观|觴 觞|觶 觯|觸 触|訁 讠|訂 订|訃 讣|計 计|訊 讯|訌 讧|討 讨|訏 𬣙|訐 讦|訒 讱|訓 训|訕 讪|訖 讫|託 托|記 记|訛 讹|訝 讶|訟 讼|訢 䜣|訣 诀|訥 讷|訩 讻|訪 访|設 设|許 许|訴 诉|訶 诃|診 诊|註 注|証 证|詀 𧮪|詁 诂|詆 诋|詎 讵|詐 诈|詒 诒|詔 诏|評 评|詖 诐|詗 诇|詘 诎|詛 诅|詝 𬣞|詞 词|詠 咏|詡 诩|詢 询|詣 诣|試 试|詩 诗|詪 𬣳|詫 诧|詬 诟|詭 诡|詮 诠|詰 诘|話 话|該 该|詳 详|詵 诜|詷 𫍣|詼 诙|詿 诖|誄 诔|誅 诛|誆 诓|誇 夸|誌 志|認 认|誑 诳|誒 诶|誕 诞|誘 诱|誚 诮|語 语|誠 诚|誡 诫|誣 诬|誤 误|誥 诰|誦 诵|誨 诲|說 说|説 说|誰 谁|課 课|誶 谇|誹 诽|誼 谊|誾 訚|調 调|諂 谄|諄 谆|談 谈|諉 诿|請 请|諍 诤|諏 诹|諑 诼|諒 谅|諓 𬣡|論 论|諗 谂|諛 谀|諜 谍|諝 谞|諞 谝|諟 𬤊|諡 谥|諢 诨|諤 谔|諦 谛|諧 谐|諫 谏|諭 谕|諮 咨|諱 讳|諲 𬤇|諳 谙|諴 𫍯|諶 谌|諷 讽|諸 诸|諺 谚|諼 谖|諾 诺|謀 谋|謁 谒|謂 谓|謄 誊|謅 诌|謊 谎|謎 谜|謏 𫍲|謐 谧|謔 谑|謖 谡|謗 谤|謙 谦|謚 谥|講 讲|謝 谢|謠 谣|謡 谣|謨 谟|謫 谪|謬 谬|謭 谫|謳 讴|謹 谨|謾 谩|譁 哗|證 证|譎 谲|譏 讥|譓 𬤝|譖 谮|識 识|譙 谯|譚 谭|譜 谱|譞 𫍽|譟 噪|譫 谵|譭 毁|譯 译|議 议|譴 谴|護 护|譸 诪|譽 誉|譾 谫|讀 读|讅 谉|變 变|讋 詟|讌 䜩|讎 雠|讒 谗|讓 让|讕 谰|讖 谶|讚 赞|讜 谠|讞 谳|谿 溪|豈 岂|豎 竖|豐 丰|豔 艳|豬 猪|豶 豮|貍 狸|貓 猫|貙 䝙|貝 贝|貞 贞|貟 贠|負 负|財 财|貢 贡|貧 贫|貨 货|販 贩|貪 贪|貫 贯|責 责|貯 贮|貰 贳|貲 赀|貳 贰|貴 贵|貶 贬|買 买|貸 贷|貺 贶|費 费|貼 贴|貽 贻|貿 贸|賀 贺|賁 贲|賂 赂|賃 赁|賄 贿|賅 赅|資 资|賈 贾|賊 贼|賑 赈|賒 赊|賓 宾|賕 赇|賙 赒|賚 赉|賜 赐|賞 赏|賠 赔|賡 赓|賢 贤|賣 卖|賤 贱|賦 赋|賧 赕|質 质|賫 赍|賬 账|賭 赌|賰 䞐|賴 赖|賵 赗|賺 赚|賻 赙|購 购|賽 赛|賾 赜|贄 贽|贅 赘|贇 赟|贈 赠|贊 赞|贋 赝|贍 赡|贏 赢|贐 赆|贓 赃|贔 赑|贖 赎|贗 赝|贛 赣|贜 赃|赬 赪|趕 赶|趙 赵|趨 趋|趲 趱|跡 迹|踐 践|踰 逾|踴 踊|蹌 跄|蹕 跸|蹟 迹|蹠 跖|蹣 蹒|蹤 踪|蹺 跷|躂 跶|躉 趸|躊 踌|躋 跻|躍 跃|躎 䟢|躑 踯|躒 跞|躓 踬|躕 蹰|躚 跹|躡 蹑|躥 蹿|躦 躜|躪 躏|軀 躯|車 车|軋 轧|軌 轨|軍 军|軏 𫐄|軑 轪|軒 轩|軔 轫|軛 轭|軝 𬨂|軟 软|軤 轷|軫 轸|軲 轱|軸 轴|軹 轵|軺 轺|軻 轲|軼 轶|軾 轼|較 较|輄 𨐈|輅 辂|輇 辁|輈 辀|載 载|輊 轾|輋 𪨶|輒 辄|輓 挽|輔 辅|輕 轻|輗 𫐐|輛 辆|輜 辎|輝 辉|輞 辋|輟 辍|輥 辊|輦 辇|輩 辈|輪 轮|輬 辌|輮 𫐓|輯 辑|輳 辏|輶 𬨎|輸 输|輻 辐|輼 辒|輾 辗|輿 舆|轀 辒|轂 毂|轄 辖|轅 辕|轆 辘|轉 转|轍 辙|轎 轿|轔 辚|轟 轰|轡 辔|轢 轹|轤 轳|辦 办|辭 辞|辮 辫|辯 辩|農 农|迴 回|逕 径|這 这|連 连|週 周|進 进|遊 游|運 运|過 过|達 达|違 违|遙 遥|遜 逊|遞 递|遠 远|遡 溯|適 适|遲 迟|遶 绕|遷 迁|選 选|遺 遗|遼 辽|邁 迈|還 还|邇 迩|邊 边|邏 逻|邐 逦|郟 郏|郵 邮|鄆 郓|鄉 乡|鄒 邹|鄔 邬|鄖 郧|鄧 邓|鄩 𬩽|鄭 郑|鄰 邻|鄲 郸|鄳 𫑡|鄴 邺|鄶 郐|鄺 邝|酇 酂|酈 郦|醃 腌|醖 酝|醜 丑|醞 酝|醟 蒏|醣 糖|醫 医|醬 酱|醱 酦|醲 𬪩|釀 酿|釁 衅|釃 酾|釅 酽|釋 释|釐 厘|釒 钅|釓 钆|釔 钇|釕 钌|釗 钊|釘 钉|釙 钋|針 针|釣 钓|釤 钐|釦 扣|釧 钏|釩 钒|釴 𬬩|釵 钗|釷 钍|釹 钕|釺 钎|釾 䥺|釿 𬬱|鈀 钯|鈁 钫|鈃 钘|鈄 钭|鈅 钥|鈇 𫓧|鈈 钚|鈉 钠|鈍 钝|鈎 钩|鈐 钤|鈑 钣|鈒 钑|鈔 钞|鈕 钮|鈞 钧|鈡 钟|鈣 钙|鈥 钬|鈦 钛|鈧 钪|鈮 铌|鈰 铈|鈳 钶|鈴 铃|鈷 钴|鈸 钹|鈹 铍|鈺 钰|鈽 钸|鈾 铀|鈿 钿|鉀 钾|鉅 巨|鉆 钻|鉈 铊|鉉 铉|鉊 𬬿|鉋 铇|鉍 铋|鉑 铂|鉕 钷|鉗 钳|鉚 铆|鉛 铅|鉝 𫟷|鉞 钺|鉢 钵|鉤 钩|鉥 𬬸|鉦 钲|鉧 𬭁|鉬 钼|鉭 钽|鉮 𬬹|鉳 锫|鉶 铏|鉷 𫟹|鉸 铰|鉺 铒|鉻 铬|鉿 铪|銀 银|銃 铳|銅 铜|銈 𫓯|銍 铚|銑 铣|銓 铨|銖 铢|銘 铭|銚 铫|銛 铦|銜 衔|銠 铑|銣 铷|銥 铱|銦 铟|銨 铵|銩 铥|銪 铕|銫 铯|銬 铐|銱 铞|銳 锐|銶 𨱇|銷 销|銹 锈|銻 锑|銼 锉|鋁 铝|鋃 锒|鋅 锌|鋇 钡|鋌 铤|鋏 铗|鋐 𬭎|鋒 锋|鋗 𫓶|鋙 铻|鋝 锊|鋟 锓|鋣 铘|鋤 锄|鋥 锃|鋦 锔|鋨 锇|鋩 铓|鋪 铺|鋭 锐|鋮 铖|鋯 锆|鋰 锂|鋱 铽|鋶 锍|鋸 锯|鋹 𬬮|鋼 钢|錀 𬬭|錁 锞|錄 录|錆 锖|錇 锫|錈 锩|錏 铔|錐 锥|錒 锕|錕 锟|錘 锤|錙 锱|錚 铮|錛 锛|錞 𬭚|錟 锬|錠 锭|錡 锜|錢 钱|錤 𫓹|錦 锦|錨 锚|錩 锠|錫 锡|錮 锢|錯 错|録 录|錳 锰|錶 表|錸 铼|錼 镎|鍀 锝|鍁 锨|鍃 锪|鍅 钫|鍆 钔|鍇 锴|鍈 锳|鍊 炼|鍋 锅|鍍 镀|鍔 锷|鍘 铡|鍚 钖|鍛 锻|鍠 锽|鍤 锸|鍥 锲|鍩 锘|鍬 锹|鍭 𬭤|鍰 锾|鍵 键|鍶 锶|鍺 锗|鍼 针|鍾 钟|鎂 镁|鎄 锿|鎇 镅|鎊 镑|鎌 镰|鎓 𬭩|鎔 镕|鎖 锁|鎘 镉|鎚 锤|鎛 镈|鎝 𨱏|鎡 镃|鎢 钨|鎣 蓥|鎦 镏|鎧 铠|鎩 铩|鎪 锼|鎬 镐|鎭 镇|鎮 镇|鎰 镒|鎲 镋|鎳 镍|鎵 镓|鎶 鿔|鎸 镌|鎿 镎|鏃 镞|鏇 旋|鏈 链|鏌 镆|鏍 镙|鏏 𬭬|鏐 镠|鏑 镝|鏗 铿|鏘 锵|鏜 镗|鏝 镘|鏞 镛|鏟 铲|鏡 镜|鏢 镖|鏤 镂|鏨 錾|鏰 镚|鏵 铧|鏷 镤|鏹 镪|鏺 䥽|鏻 𬭸|鏽 锈|鐃 铙|鐄 𨱑|鐇 𫔍|鐋 铴|鐍 𫔎|鐏 𨱔|鐐 镣|鐒 铹|鐓 镦|鐔 镡|鐘 钟|鐙 镫|鐝 镢|鐠 镨|鐥 䦅|鐦 锎|鐧 锏|鐨 镄|鐩 𬭼|鐫 镌|鐮 镰|鐯 䦃|鐲 镯|鐳 镭|鐵 铁|鐶 镮|鐸 铎|鐺 铛|鐽 𫟼|鐿 镱|鑄 铸|鑊 镬|鑌 镔|鑑 鉴|鑒 鉴|鑔 镲|鑕 锧|鑞 镴|鑠 铄|鑣 镳|鑥 镥|鑪 𬬻|鑭 镧|鑰 钥|鑱 镵|鑲 镶|鑷 镊|鑹 镩|鑼 锣|鑽 钻|鑾 銮|鑿 凿|钁 镢|钂 镋|長 长|門 门|閂 闩|閃 闪|閆 闫|閈 闬|閉 闭|開 开|閌 闶|閎 闳|閏 闰|閑 闲|閒 闲|間 间|閔 闵|閘 闸|閡 阂|閣 阁|閤 合|閥 阀|閨 闺|閩 闽|閫 阃|閬 阆|閭 闾|閱 阅|閲 阅|閶 阊|閹 阉|閻 阎|閼 阏|閽 阍|閾 阈|閿 阌|闃 阒|闆 板|闇 暗|闈 闱|闉 𬮱|闊 阔|闋 阕|闌 阑|闍 阇|闐 阗|闑 𫔶|闒 阘|闓 闿|闔 阖|闕 阙|闖 闯|關 关|闞 阚|闠 阓|闡 阐|闢 辟|闤 阛|闥 闼|陘 陉|陝 陕|陞 升|陣 阵|陰 阴|陳 陈|陸 陆|陽 阳|隉 陧|隊 队|階 阶|隑 𬮿|隕 陨|際 际|隤 𬯎|隨 随|險 险|隮 𬯀|隯 陦|隱 隐|隴 陇|隸 隶|隻 只|雋 隽|雖 虽|雙 双|雛 雏|雜 杂|雞 鸡|離 离|難 难|雲 云|電 电|霑 沾|霢 霡|霧 雾|霽 霁|靂 雳|靄 霭|靆 叇|靈 灵|靉 叆|靚 靓|靜 静|靝 靔|靦 腼|靨 靥|鞏 巩|鞝 绱|鞦 秋|鞽 鞒|韁 缰|韃 鞑|韆 千|韉 鞯|韋 韦|韌 韧|韍 韨|韓 韩|韙 韪|韜 韬|韝 鞲|韞 韫|韻 韵|響 响|頁 页|頂 顶|頃 顷|項 项|順 顺|頇 顸|須 须|頊 顼|頌 颂|頍 𫠆|頎 颀|頏 颃|預 预|頑 顽|頒 颁|頓 顿|頔 𬱖|頗 颇|領 领|頜 颌|頠 𬱟|頡 颉|頤 颐|頦 颏|頫 𫖯|頭 头|頮 颒|頰 颊|頲 颋|頴 颕|頵 𫖳|頷 颔|頸 颈|頹 颓|頻 频|頽 颓|顆 颗|題 题|額 额|顎 颚|顏 颜|顒 颙|顓 颛|顔 颜|顗 𫖮|願 愿|顙 颡|顛 颠|類 类|顢 颟|顥 颢|顧 顾|顫 颤|顬 颥|顯 显|顰 颦|顱 颅|顳 颞|顴 颧|風 风|颭 飐|颮 飑|颯 飒|颱 台|颳 刮|颶 飓|颸 飔|颺 飏|颻 飖|颼 飕|飀 飗|飄 飘|飆 飙|飈 飚|飛 飞|飠 饣|飢 饥|飣 饤|飥 饦|飩 饨|飪 饪|飫 饫|飭 饬|飯 饭|飱 飧|飲 饮|飴 饴|飼 饲|飽 饱|飾 饰|飿 饳|餃 饺|餄 饸|餅 饼|餈 糍|餉 饷|養 养|餌 饵|餎 饹|餏 饻|餑 饽|餒 馁|餓 饿|餕 馂|餖 饾|餗 𫗧|餘 余|餚 肴|餛 馄|餜 馃|餞 饯|餡 馅|館 馆|餬 糊|餱 糇|餳 饧|餵 喂|餶 馉|餷 馇|餸 𩠌|餺 馎|餼 饩|餾 馏|餿 馊|饁 馌|饃 馍|饅 馒|饈 馐|饉 馑|饊 馓|饋 馈|饌 馔|饑 饥|饒 饶|饗 飨|饘 𫗴|饜 餍|饞 馋|饢 馕|馬 马|馭 驭|馮 冯|馱 驮|馳 驰|馴 驯|馹 驲|馼 𫘜|駁 驳|駃 𫘝|駉 𬳶|駐 驻|駑 驽|駒 驹|駓 𬳵|駔 驵|駕 驾|駘 骀|駙 驸|駛 驶|駝 驼|駟 驷|駡 骂|駢 骈|駪 𬳽|駭 骇|駰 骃|駱 骆|駸 骎|駼 𬳿|駿 骏|騁 骋|騂 骍|騄 𫘧|騅 骓|騊 𫘦|騌 骔|騍 骒|騎 骑|騏 骐|騑 𬴂|騖 骛|騙 骗|騞 𬴃|騠 𫘨|騤 骙|騧 䯄|騫 骞|騭 骘|騮 骝|騰 腾|騱 𫘬|騵 𫘪|騶 驺|騷 骚|騸 骟|騾 骡|驀 蓦|驁 骜|驂 骖|驃 骠|驄 骢|驅 驱|驊 骅|驌 骕|驍 骁|驎 𬴊|驏 骣|驕 骄|驗 验|驚 惊|驛 驿|驟 骤|驢 驴|驤 骧|驥 骥|驦 骦|驪 骊|驫 骉|骯 肮|髏 髅|髒 脏|體 体|髕 髌|髖 髋|髮 发|鬆 松|鬍 胡|鬚 须|鬢 鬓|鬥 斗|鬧 闹|鬨 哄|鬩 阋|鬮 阄|鬱 郁|鬹 鬶|魎 魉|魘 魇|魚 鱼|魛 鱽|魟 𫚉|魢 鱾|魨 鲀|魯 鲁|魴 鲂|魷 鱿|魺 鲄|鮀 𬶍|鮁 鲅|鮃 鲆|鮆 𫚖|鮈 𬶋|鮊 鲌|鮋 鲉|鮍 鲏|鮎 鲇|鮐 鲐|鮑 鲍|鮒 鲋|鮓 鲊|鮚 鲒|鮜 鲘|鮝 鲞|鮞 鲕|鮟 𩽾|鮠 𬶏|鮡 𬶐|鮣 䲟|鮦 鲖|鮪 鲔|鮫 鲛|鮭 鲑|鮮 鲜|鮳 鲓|鮶 鲪|鮸 𩾃|鮺 鲝|鯀 鲧|鯁 鲠|鯇 鲩|鯉 鲤|鯊 鲨|鯒 鲬|鯔 鲻|鯕 鲯|鯖 鲭|鯗 鲞|鯛 鲷|鯝 鲴|鯡 鲱|鯢 鲵|鯤 鲲|鯧 鲳|鯨 鲸|鯪 鲮|鯫 鲰|鯰 鲶|鯴 鲺|鯷 鳀|鯻 𬶟|鯽 鲫|鯿 鳊|鰁 鳈|鰂 鲗|鰃 鳂|鰆 䲠|鰈 鲽|鰉 鳇|鰊 𬶠|鰌 䲡|鰍 鳅|鰏 鲾|鰐 鳄|鰒 鳆|鰓 鳃|鰛 鳁|鰜 鳒|鰟 鳑|鰠 鳋|鰣 鲥|鰤 𫚕|鰥 鳏|鰧 䲢|鰨 鳎|鰩 鳐|鰭 鳍|鰮 鳁|鰱 鲢|鰲 鳌|鰳 鳓|鰵 鳘|鰶 𬶭|鰷 鲦|鰹 鲣|鰺 鲹|鰻 鳗|鰼 鳛|鰾 鳔|鱀 𬶨|鱂 鳉|鱅 鳙|鱇 𩾌|鱈 鳕|鱉 鳖|鱒 鳟|鱔 鳝|鱖 鳜|鱗 鳞|鱘 鲟|鱚 𬶮|鱝 鲼|鱟 鲎|鱠 鲙|鱣 鳣|鱤 鳡|鱧 鳢|鱨 鲿|鱭 鲚|鱯 鳠|鱲 𫚭|鱷 鳄|鱸 鲈|鱺 鲡|鳥 鸟|鳧 凫|鳩 鸠|鳬 凫|鳲 鸤|鳳 凤|鳴 鸣|鳶 鸢|鳾 䴓|鴆 鸩|鴇 鸨|鴉 鸦|鴒 鸰|鴕 鸵|鴛 鸳|鴝 鸲|鴞 鸮|鴟 鸱|鴣 鸪|鴦 鸯|鴨 鸭|鴯 鸸|鴰 鸹|鴴 鸻|鴷 䴕|鴻 鸿|鴿 鸽|鵁 䴔|鵂 鸺|鵃 鸼|鵏 𬷕|鵐 鹀|鵑 鹃|鵒 鹆|鵓 鹁|鵜 鹈|鵝 鹅|鵟 𫛭|鵠 鹄|鵡 鹉|鵪 鹌|鵬 鹏|鵮 鹐|鵯 鹎|鵰 雕|鵲 鹊|鵷 鹓|鵾 鹍|鶄 䴖|鶇 鸫|鶉 鹑|鶊 鹒|鶓 鹋|鶖 鹙|鶘 鹕|鶚 鹗|鶠 𬸘|鶡 鹖|鶥 鹛|鶩 鹜|鶪 䴗|鶬 鸧|鶯 莺|鶱 𬸣|鶲 鹟|鶴 鹤|鶹 鹠|鶺 鹡|鶻 鹘|鶼 鹣|鶿 鹚|鷀 鹚|鷁 鹢|鷂 鹞|鷄 鸡|鷉 䴘|鷊 鹝|鷓 鹧|鷖 鹥|鷗 鸥|鷙 鸷|鷚 鹨|鷟 𬸦|鷥 鸶|鷦 鹪|鷫 鹔|鷭 𬸪|鷯 鹩|鷲 鹫|鷳 鹇|鷴 鹇|鷸 鹬|鷹 鹰|鷺 鹭|鷽 鸴|鸂 㶉|鸇 鹯|鸊 䴙|鸌 鹱|鸏 鹲|鸑 𬸚|鸕 鸬|鸘 鹴|鸚 鹦|鸛 鹳|鸝 鹂|鸞 鸾|鹵 卤|鹹 咸|鹺 鹾|鹼 碱|鹽 盐|麗 丽|麥 麦|麩 麸|麪 面|麫 面|麬 𤿲|麯 曲|麳 𪎌|麴 曲|麵 面|麼 么|麽 么|黃 黄|黌 黉|點 点|黨 党|黲 黪|黴 霉|黶 黡|黷 黩|黽 黾|黿 鼋|鼂 鼌|鼉 鼍|鼕 冬|鼴 鼹|齊 齐|齋 斋|齎 赍|齏 齑|齒 齿|齔 龀|齕 龁|齗 龂|齘 𬹼|齙 龅|齜 龇|齟 龃|齠 龆|齡 龄|齣 出|齦 龈|齧 啮|齪 龊|齬 龉|齮 𬺈|齯 𫠜|齲 龋|齶 腭|齷 龌|齼 𬺓|龍 龙|龎 厐|龐 庞|龑 䶮|龔 龚|龕 龛|龜 龟|鿁 䜤|鿓 鿒|𠁞 𠀾|𠌥 𠌥|𠏢 𠏢|𠐊 𠐊|𠗣 㓆|𠞆 𠞆|𠠎 𠠎|𠬙 𠬙|𠼤 𠼤|𠽃 𠽃|𠿕 𠿕|𡂡 𡂡|𡃄 𡃄|𡃕 𠴛|𡃤 𡃤|𡄔 𡄔|𡄣 𡄣|𡅏 𠲥|𡅯 𡅯|𡑍 𫭼|𡑭 𡋗|𡓁 𡓁|𡓾 𡋀|𡔖 𡍣|𡞵 㛟|𡟫 𡟫|𡠹 㛿|𡢃 㛠|𡮉 𡭜|𡮣 𡭬|𡳳 𡳃|𡸗 𡸗|𡹬 𡹬|𡻕 岁|𡽗 𡽗|𡾱 㟜|𡿖 𡿖|𢍰 𢍰|𢠼 𢠼|𢣐 𢣐|𢣚 𢘝|𢣭 𢣭|𢤩 𢤩|𢤱 𢤱|𢤿 𢤿|𢯷 𢯷|𢶒 𢶒|𢶫 𢫞|𢷮 𢷮|𢹿 𢬦|𢺳 𢺳|𣈶 暅|𣋋 𣋋|𣍐 𣍐|𣙎 㭣|𣜬 𣜬|𣝕 𣝕|𣞻 𣘓|𣠩 𣞎|𣠲 𣑶|𣯩 𣯩|𣯴 𣯴|𣯶 毶|𣽏 𣽏|𣾷 㳢|𣿉 𣿉|𤁣 𣺽|𤄷 𤄷|𤅶 𣷷|𤑳 𤑳|𤑹 𤑹|𤒎 𤒎|𤒻 𤒻|𤓌 𤓌|𤓎 𤓎|𤓩 𤊰|𤘀 𤘀|𤛮 𤛮|𤛱 𤛱|𤜆 𤜆|𤠮 𤠮|𤢟 𤢟|𤢻 𤢻|𤩂 𤩂|𤪺 㻘|𤫩 㻏|𤬅 𤬅|𤳷 𤳷|𤳸 𤳄|𤷃 𤷃|𤸫 𤸫|𤺔 𤺔|𥊝 𥅿|𥌃 𥅘|𥏝 𥏝|𥕥 𥐰|𥖅 𥐯|𥖲 𥖲|𥗇 𥗇|𥗽 𬒗|𥜐 𥜐|𥜰 𥜰|𥞵 𥞵|𥢢 䅪|𥢶 𥢶|𥢷 𥢷|𥨐 𥨐|𥪂 𥪂|𥯤 𥯤|𥴨 𥴨|𥴼 𥴼|𥵃 𥵃|𥵊 𥵊|𥶽 𥶽|𥸠 𥮋|𥻦 𥻦|𥼽 𥹥|𥽖 𥽖|𥾯 𥾯|𥿊 𥿊|𦀖 𦀖|𦂅 𦂅|𦃄 𦃄|𦃩 𦃩|𦅇 𦅇|𦅈 𦅈|𦆲 𦆲|𦒀 𦒀|𦔖 𦔖|𦘧 𡳒|𦟼 𦟼|𦠅 𦠅|𦡝 𦡝|𦢈 𦢈|𦣎 𦟗|𦧺 𦧺|𦪙 䑽|𦪽 𦪽|𦱌 𦱌|𦾟 𦾟|𧎈 𧎈|𧒯 𧒯|𧔥 𧔥|𧕟 𧕟|𧜗 䘞|𧜵 䙊|𧝞 䘛|𧞫 𧞫|𧟀 𧝧|𧡴 𧡴|𧢄 𧢄|𧦝 𧦝|𧦧 𧦧|𧩕 𧩕|𧩙 䜥|𧩼 𧩼|𧫝 𧫝|𧬤 𧬤|𧭈 𧭈|𧭹 𧭹|𧳟 𧳟|𧵳 䞌|𧶔 𧶔|𧶧 䞎|𧷎 𧷎|𧸘 𧸘|𧹈 𧹈|𧽯 𧽯|𨂐 𨂐|𨄣 𨄣|𨅍 𨅍|𨆪 𨆪|𨇁 𨇁|𨇞 𨇞|𨇤 𨇤|𨇰 𨇰|𨇽 𨇽|𨈊 𨈊|𨈌 𨈌|𨊰 䢀|𨊸 䢁|𨊻 𨊻|𨋢 䢂|𨌈 𨌈|𨍰 𨍰|𨎌 𨎌|𨎮 𨎮|𨏠 𨏠|𨏥 𨏥|𨞺 𨞺|𨟊 𨟊|𨢿 𨢿|𨣈 𨣈|𨣞 𨣞|𨣧 𨣧|𨤻 𨤰|𨥛 𨥛|𨥟 𨥟|𨦫 䦀|𨧀 𬭊|𨧜 䦁|𨧰 𨧰|𨧱 𨧱|𨨏 𬭛|𨨛 𨨛|𨨢 𨨢|𨩰 𨩰|𨪕 𨪕|𨫒 𨫒|𨬖 𨬖|𨭆 𬭶|𨭎 𬭳|𨭖 𨭖|𨭸 𨭸|𨮂 𨮂|𨮳 𨮳|𨯅 䥿|𨯟 𨯟|𨰃 𨰃|𨰋 𨰋|𨰥 𨰥|𨰲 𨰲|𨲳 𨲳|𨳑 𨳑|𨳕 𨳕|𨴗 𨴗|𨴹 𨴹|𨵩 𨵩|𨵸 𨵸|𨶀 𨶀|𨶏 𨶏|𨶮 𨶮|𨶲 𨶲|𨷲 𨷲|𨼳 𨼳|𨽏 𨽏|𩀨 𩀨|𩅙 𩅙|𩎖 𩎖|𩎢 𩎢|𩏂 𩏂|𩏠 𩏠|𩏪 𩏪|𩏷 𩏷|𩑔 𩑔|𩒎 𩒎|𩓣 𩓣|𩓥 𩓥|𩔑 𩔑|𩔳 𩔳|𩖰 𩖰|𩗀 𩗀|𩗓 𩗓|𩗴 𩗴|𩘀 𩘀|𩘝 𩘝|𩘹 𩘹|𩘺 𩘺|𩙈 𩙈|𩚛 𩚛|𩚥 𩚥|𩚩 𩚩|𩚵 𩚵|𩛆 𩛆|𩛌 𩛌|𩛡 𩛡|𩛩 𩛩|𩜇 𩜇|𩜦 𩜦|𩜵 𩜵|𩝔 𩝔|𩝽 𩝽|𩞄 𩞄|𩞦 𩞦|𩞯 䭪|𩟐 𩟐|𩟗 𩟗|𩠴 𩠠|𩡣 𩡣|𩡺 𩡺|𩢡 𩢡|𩢴 𩢴|𩢸 𩢸|𩢾 𩢾|𩣏 𩣏|𩣑 䯃|𩣫 𩣫|𩣵 𩣵|𩣺 𩣺|𩤊 𩤊|𩤙 𩤙|𩤲 𩤲|𩤸 𩤸|𩥄 𩥄|𩥇 𩥇|𩥉 𩥉|𩥑 𩥑|𩦠 𩦠|𩧆 𩧆|𩭙 𩭙|𩯁 𩯁|𩯳 𩯳|𩰀 𩰀|𩰹 𩰹|𩳤 𩳤|𩴵 𩴵|𩵦 𩵦|𩵩 𩵩|𩵹 𩵹|𩶁 𩶁|𩶘 䲞|𩶰 𩶰|𩶱 𩶱|𩷰 𩷰|𩸃 𩸃|𩸄 𩸄|𩸡 𩸡|𩸦 𩸦|𩻗 𩻗|𩻬 𩻬|𩻮 𩻮|𩼶 𩼶|𩽇 𩽇|𩿅 𩿅|𩿤 𩿤|𩿪 𩿪|𪀖 𪀖|𪀦 𪀦|𪀾 𪀾|𪁈 𪁈|𪁖 𪁖|𪂆 𪂆|𪃍 𪃍|𪃏 𪃏|𪃒 𪃒|𪃧 𪃧|𪄆 𪄆|𪄕 𪄕|𪅂 𪅂|𪆷 𪆷|𪇳 𪇳|𪈼 𪈼|𪉸 𪉸|𪋿 𪋿|𪌭 𪌭|𪍠 𪍠|𪓰 𪓰|𪔵 𪔵|𪘀 𪘀|𪘯 𪘯|𪙏 𪙏|𪟖 𪟖|𪷓 𪷓|𫒡 𫒡|𫜦 𫜦|𰻞 𰻝";

const LYRICS_HAN_RE = /\p{Script=Han}/u;
const LYRICS_KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const LYRICS_KATAKANA_RE = /[\u30A1-\u30F6]/u;
const LYRICS_BRACKET_RE = /[\(\[\{（【「『〈《〔〖]([^\)\]\}）】」』〉》〕〗]{0,160})[\)\]\}）】」』〉》〕〗]/gu;
const LYRICS_TRAILING_DASH_RE = /\s*[-–—~〜]\s*([^-–—~〜]{1,80})$/u;
const LYRICS_NOISE_RE = /^(?:mv|pv|music\s*video|official\s*(?:music\s*)?video|official\s*audio|lyric(?:s)?\s*video|lyrics?|audio|full\s*hd|hd|hq|4k|8k|1080p|720p|高音质|高音質|无损|無損|动态歌词|動態歌詞|歌詞|歌词|字幕|中字|中文字幕|繁中字幕|英文字幕|日文字幕|中英字幕|双语字幕|雙語字幕|字幕组|字幕組|中日字幕|english\s*sub(?:s)?|eng\s*sub(?:s)?|with\s*lyrics|romaji|罗马音|羅馬音|official)$/u;

const LYRICS_T2S = (() => {
  const splitEntry = (line) => {
    const separator = line.indexOf(' ');
    if (separator <= 0) return null;
    return [line.slice(0, separator), line.slice(separator + 1)];
  };

  const chars = new Map();
  for (const line of LYRICS_T2S_CHARS.split('|')) {
    const entry = splitEntry(line);
    if (entry && Array.from(entry[0]).length === 1) chars.set(entry[0], entry[1]);
  }

  const phrases = new Map();
  for (const line of LYRICS_T2S_PHRASES.split('|')) {
    const entry = splitEntry(line);
    if (!entry) continue;
    const source = Array.from(entry[0]);
    if (source.length < 2) {
      chars.set(entry[0], entry[1]);
      continue;
    }
    let node = phrases;
    for (const character of source) {
      let next = node.get(character);
      if (!next) {
        next = new Map();
        node.set(character, next);
      }
      node = next;
    }
    node.set('', entry[1]);
  }

  return { chars, phrases };
})();

const createLyricsNormalizer = (options = {}) => {
  const opts = {
    enabled: options.enabled !== false,
    traditionalToSimplified: options.traditionalToSimplified === true,
    kanaMode: ['auto', 'hiragana', 'katakana', 'off'].includes(options.kanaMode)
      ? options.kanaMode
      : 'off',
    stripNoiseWords: options.stripNoiseWords !== false,
    keepVersionTags: options.keepVersionTags !== false,
    includeArtist: options.includeArtist === true,
    maxLength: Number.isFinite(options.maxLength)
      ? Math.max(32, Math.min(240, options.maxLength))
      : 160,
    debug: options.debug === true,
  };

  const toSimplified = (value) => {
    const source = Array.from(value);
    let output = '';
    for (let index = 0; index < source.length;) {
      let node = LYRICS_T2S.phrases;
      let cursor = index;
      let bestEnd = -1;
      let bestValue = null;
      while (cursor < source.length) {
        node = node.get(source[cursor]);
        if (!node) break;
        cursor += 1;
        const candidate = node.get('');
        if (candidate !== undefined) {
          bestEnd = cursor;
          bestValue = candidate;
        }
      }
      if (bestValue !== null) {
        output += bestValue;
        index = bestEnd;
      } else {
        const character = source[index];
        output += LYRICS_T2S.chars.get(character) ?? character;
        index += 1;
      }
    }
    return output;
  };

  const hasTraditionalCharacter = (value) => {
    for (const character of value) {
      const simplified = LYRICS_T2S.chars.get(character);
      if (simplified !== undefined && simplified !== character) return true;
    }
    return false;
  };

  const maybeToSimplified = (value) => (
    opts.traditionalToSimplified && !LYRICS_KANA_RE.test(value) && hasTraditionalCharacter(value)
      ? toSimplified(value)
      : value
  );

  const kataToHira = (value) => value
    .replace(/ヵ/gu, 'か')
    .replace(/ヶ/gu, 'け')
    .replace(/[\u30A1-\u30F6]/gu, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60))
    .replace(/ヷ/gu, 'わ')
    .replace(/ヸ/gu, 'ゐ')
    .replace(/ヹ/gu, 'ゑ')
    .replace(/ヺ/gu, 'を');

  const hiraToKata = (value) => value
    .replace(/[\u3041-\u3096]/gu, (character) => String.fromCharCode(character.charCodeAt(0) + 0x60))
    .replace(/ゕ/gu, 'カ')
    .replace(/ゖ/gu, 'ケ');

  const foldKana = (value) => {
    if (opts.kanaMode === 'off') return value;
    if (opts.kanaMode === 'hiragana') return kataToHira(value);
    if (opts.kanaMode === 'katakana') return hiraToKata(value);
    if (LYRICS_KANA_RE.test(value) && !LYRICS_HAN_RE.test(value) && LYRICS_KATAKANA_RE.test(value)) {
      return kataToHira(value);
    }
    return value;
  };

  const normalizeInner = (value) => {
    let text = String(value ?? '').normalize('NFKC');
    text = maybeToSimplified(text);
    text = text.toLowerCase();
    text = text.replace(/['’‘`´]/gu, '');
    text = text.replace(/[\p{P}\p{S}]+/gu, ' ');
    return text.replace(/\s+/gu, ' ').trim();
  };

  const canonicalVersion = (text) => {
    if (/^(?:tv|anime|game)\s*(?:size|ver(?:sion)?|edit|版)?$/u.test(text)) return 'tv size';
    if (/^(?:short|短版)\s*(?:ver(?:sion)?|size|edit)?$/u.test(text)) return 'short version';
    if (/^(?:long|full|extended|完整版|加长版|加長版)\s*(?:ver(?:sion)?|size|edit)?$/u.test(text)) return 'long version';
    if (/^(?:live|concert|ライブ|现场|現場|演唱会|演唱會)(?:\s*(?:版|ver(?:sion)?))?$/u.test(text)) return 'live';
    if (/^(?:live|concert|ライブ|现场|現場)(?:\s+(?:at|in|from)\b.*|\s+\d{4})$/u.test(text)) return 'live';
    if (/^\d{4}\s+live$/u.test(text)) return 'live';
    if (/^(?:cover|covered)(?:\s+by\s+.*|\s+ver(?:sion)?)?$/u.test(text)) return 'cover';
    if (/^(?:翻唱|翻唱版|カバー|カバー版|歌ってみた|歌みた)(?:\s+by\s+.*)?$/u.test(text)) return 'cover';
    if (/^(?:instrumental|inst|off\s*vocal|オフボーカル|纯音乐|純音樂|无人声|無人聲)(?:\s*(?:ver(?:sion)?|版))?$/u.test(text)) {
      return /off|オフ/u.test(text) ? 'off vocal' : 'instrumental';
    }
    if (/^(?:karaoke|カラオケ|伴奏|卡拉ok|ktv)(?:\s*(?:ver(?:sion)?|版))?$/u.test(text)) return 'karaoke';
    if (/^(?:remix|rmx|bootleg|extended\s+mix|club\s+mix|dub\s+mix|リミックス)(?:\s+.*)?$/u.test(text)) return 'remix';
    if (/^(?:acoustic|unplugged|アコースティック)(?:\s+.*)?$/u.test(text)) return 'acoustic';
    if (/^(?:demo|デモ)(?:\s+.*)?$/u.test(text)) return 'demo';
    if (/^(?:remaster|remastered|リマスター|重制版|重製版|(?:digital\s+)?remaster(?:ed)?)(?:\s+.*)?$/u.test(text)) return 'remaster';
    if (/^\d{4}\s+(?:digital\s+)?remaster(?:ed)?$/u.test(text)) return 'remaster';
    if (/^radio\s*(?:edit|version|ver)$/u.test(text)) return 'radio edit';
    if (/^(?:movie|映画|劇場版|剧场版)(?:\s*(?:ver(?:sion)?|版))?$/u.test(text)) return 'movie version';
    if (/^(?:game|ゲーム)(?:\s*(?:ver(?:sion)?|版))?$/u.test(text)) return 'game version';
    if (/^(?:anime|アニメ|tv\s*anime)(?:\s*(?:ver(?:sion)?|版))?$/u.test(text)) return 'anime version';
    if (/^(?:english|eng|英語|英语)(?:\s*(?:ver(?:sion)?|版))?$/u.test(text)) return 'english version';
    if (/^(?:japanese|jpn|jp|日本語|日本语)(?:\s*(?:ver(?:sion)?|版))?$/u.test(text)) return 'japanese version';
    if (/^(?:chinese|chi|cn|中文|中国語|中国语)(?:\s*(?:ver(?:sion)?|版))?$/u.test(text)) return 'chinese version';
    if (/^(?:female|女性|女声|女聲)(?:\s*(?:ver(?:sion)?|版))?$/u.test(text)) return 'female version';
    if (/^(?:male|男性|男声|男聲)(?:\s*(?:ver(?:sion)?|版))?$/u.test(text)) return 'male version';
    if (/^(?:original|オリジナル)(?:\s*(?:ver(?:sion)?|版))?$/u.test(text)) return 'original version';
    return null;
  };

  const classifyDescriptor = (raw) => {
    const text = normalizeInner(raw);
    if (!text) return { kind: 'noise', text: '' };
    if (/^\d{1,4}$/u.test(text)) return { kind: 'noise', text: '' };
    if (LYRICS_NOISE_RE.test(text)) return { kind: 'noise', text: '' };
    if (/^(?:prod|produced\s+by)\b/u.test(text)) return { kind: 'noise', text: '' };
    if (/^(?:feat|ft|featuring|with)\b/u.test(text)) return { kind: 'noise', text: '' };
    const version = canonicalVersion(text);
    if (version) return { kind: 'version', text: version };
    return { kind: 'content', text };
  };

  const replaceBrackets = (value) => value.replace(LYRICS_BRACKET_RE, (match, inner) => {
    const descriptor = classifyDescriptor(inner);
    if (descriptor.kind === 'noise') return ' ';
    if (descriptor.kind === 'version') {
      return opts.keepVersionTags ? ` ${descriptor.text} ` : ' ';
    }
    return descriptor.text ? ` ${descriptor.text} ` : ' ';
  });

  const stripTrailingDescriptors = (value) => {
    let text = value;
    for (let index = 0; index < 3; index += 1) {
      const match = text.match(LYRICS_TRAILING_DASH_RE);
      if (!match || match.index === undefined) break;
      const descriptor = classifyDescriptor(match[1]);
      if (descriptor.kind === 'content') break;
      text = text.slice(0, match.index);
      if (descriptor.kind === 'version' && opts.keepVersionTags) text += ` ${descriptor.text} `;
    }
    return text;
  };

  const stripTrailingNoise = (value) => value.replace(
    /\s+(?:mv|pv|music\s+video|official\s+(?:music\s+)?video|official\s+audio|lyric(?:s)?\s+video|audio|full\s+hd|hd|hq|4k|8k|1080p|720p|字幕|中文字幕|繁中字幕|英文字幕|日文字幕|中英字幕|双语字幕|雙語字幕|字幕组|字幕組|歌词|歌詞)\s*$/u,
    '',
  );

  const isPlaceholderArtist = (value) => /^(?:unknown(?:\s+artist)?|未知(?:艺术家|藝術家|歌手)?|群星|佚名|various\s+artists|va)$/u.test(value);

  const normalize = (value) => {
    if (value === null || value === undefined) return '';
    let text = String(value);
    if (!opts.enabled) return text.replace(/\s+/gu, ' ').trim();
    text = text.normalize('NFKC');
    text = text.replace(/[\p{Cc}\p{Cf}]+/gu, ' ');
    text = maybeToSimplified(text);
    text = text.toLowerCase();
    text = text.replace(/['’‘`´]/gu, '');
    if (opts.stripNoiseWords) {
      text = replaceBrackets(text);
      text = stripTrailingDescriptors(text);
    }
    text = text.replace(/[\p{P}\p{S}]+/gu, ' ');
    text = text.replace(/\b(?:feat|ft|featuring)\b(?:\s+(?!(?:live|cover|instrumental|off|karaoke|remix|acoustic|demo|remaster|remastered|tv|short|long|movie|game|anime|english|japanese|chinese|female|male|original|ver|version)\b)\S+)*/gu, ' ');
    text = text.replace(/\b(?:produced\s+by|prod)\b(?:\s+(?!(?:live|cover|instrumental|off|karaoke|remix|acoustic|demo|remaster|remastered|tv|short|long|movie|game|anime|english|japanese|chinese|female|male|original|ver|version)\b)\S+)*/gu, ' ');
    if (opts.stripNoiseWords) text = stripTrailingNoise(text);
    text = foldKana(text);
    text = text.replace(/\s+/gu, ' ').trim();
    if (text.length > opts.maxLength) {
      text = Array.from(text).slice(0, opts.maxLength).join('').trim();
    }
    return text;
  };

  const buildQuery = (track, status) => {
    const titleSource = track?.title || status?.currentTrackTitle || '';
    const artistSource = track?.artist || status?.currentTrackArtist || '';
    const title = normalize(titleSource);
    let artist = normalize(artistSource);
    let query;
    if (!title) {
      query = artist || undefined;
    } else if (!artist || !opts.includeArtist || isPlaceholderArtist(artist)) {
      query = title;
    } else {
      artist = artist.split(/\s+(?:feat|ft|featuring|with|prod)\s+/u)[0].trim();
      query = !artist || title.includes(artist) ? title : `${title} ${artist}`;
    }
    if (opts.debug && typeof console !== 'undefined' && typeof console.debug === 'function') {
      console.debug('[lyrics-match-whitebox] search query', {
        title: titleSource,
        artist: artistSource,
        query,
      });
    }
    return query;
  };

  return { normalize, buildQuery, toSimplified, foldKana, classifyDescriptor };
};

/** Text normalization options, configurable from ECHO settings. */
const normalizeOptions = {
  enabled: config.normalizeEnabled !== false,
  traditionalToSimplified: config.normalizeTraditional === true,
  kanaMode: config.normalizeKana || 'off',
  stripNoiseWords: config.normalizeNoise !== false,
  keepVersionTags: config.normalizeKeepVersion !== false,
  includeArtist: config.normalizeIncludeArtist === true,
  debug: config.normalizeDebug === true,
};
const lyricsNormalizer = createLyricsNormalizer(normalizeOptions);
const buildSearchQuery = (track, status) => lyricsNormalizer.buildQuery(track, status);
/* NORMALIZER_END */

const chinese = (() => {
  const configured = String(config.locale || 'auto');
  const lang = String(document.documentElement.lang || navigator.language || '');
  return configured === 'zh-CN'
    || (configured !== 'en-US' && lang.toLowerCase().startsWith('zh'));
})();

const copy = {
  toastOn: chinese
    ? '歌词匹配白盒：已开启自动弹出候选（播放时会盖住歌词页）。'
    : 'Lyrics match white-box: auto-open candidates enabled (covers the lyrics page while playing).',
  toastOff: chinese
    ? '歌词匹配改为右上角图标进入抽屉，播放时不再自动弹出浮层。'
    : 'Lyrics matching uses the top-right icon → drawer; no auto overlay while playing.',
  toggleLabel: chinese ? '自动打开候选' : 'Auto open lyrics chooser',
  toggleHint: chinese
    ? '网络匹配时在歌词页弹出候选浮层。默认关闭；需要时在抽屉里手动打开。'
    : 'Show the floating candidate panel during network matching. Off by default.',
  rematchTitle: chinese ? '重新匹配' : 'Rematch lyrics',
  rematchHint: chinese
    ? '手动搜索并选择歌词候选'
    : 'Search and choose lyrics candidates',
  rematchAction: chinese ? '匹配' : 'Match',
  rematchBusy: chinese ? '匹配中…' : 'Matching…',
  allSources: chinese ? '全部来源' : 'All sources',
  emptySources: chinese ? '候选返回后可筛选来源。ECHO Steam 的网易云 / QQ 音乐 / LRCLIB / AMLL 歌词来自创意工坊「ECHO 网络歌词匹配」，未订阅或未启用时只能搜到本地歌词；标题栏「歌词匹配候选」按钮会逐个来源查询。' : 'Source filters appear when candidates arrive. ECHO Steam gets NetEase / QQ Music / LRCLIB / AMLL lyrics from the Workshop item "ECHO 网络歌词匹配"; without it enabled only local lyrics are found. The titlebar lyrics-candidates button queries each source by name.',
  rematchToast: chinese
    ? '已开始重新匹配，请在抽屉「匹配」页查看结果。'
    : 'Rematch started — check the Match tab in the drawer.',
  directAppliedToast: chinese
    ? '已直接匹配并应用最佳歌词；需要换源可在抽屉「匹配」页再搜索。'
    : 'Best lyrics matched and applied directly; use the Match tab for another source.',
  cornerIconLabel: chinese ? '歌词设置' : 'Lyrics settings',
  cornerIconTitle: chinese
    ? '打开歌词设置抽屉（匹配 / 显示 / 桌面 / 高级）'
    : 'Open lyrics settings drawer (Match / Display / Desktop / Advanced)',
};

const TOGGLE_HOST = 'data-echo-lmwb-host';
const TOGGLE_INPUT = 'data-echo-lmwb-input';
const REMATCH_HOST = 'data-echo-lmwb-rematch';
const CORNER_HOST = 'data-echo-lmwb-corner';
const STYLE_HOST = 'data-echo-lmwb-style';
const SETTING_KEY = 'lyricsCandidatePanelAutoOpenEnabled';
const REMATCH_EVENT = 'lyrics:rematch-requested';
const SEARCH_EVENT = 'lyrics:search-requested';
const OPEN_DRAWER_EVENT = 'app:open-lyrics-settings';

/**
 * Steam/asar sometimes clips match-panel actions; also keep our drawer injects
 * from stretching host audio-device-pill / engine-meter grids.
 * Keep the official lyrics settings drawer docked to the right (ECHODev-style).
 */
const PANEL_LAYOUT_CSS = `
.lyrics-match-panel {
  pointer-events: auto !important;
  z-index: 12 !important;
}
/* Keep source chips readable even when MV overrides the lyrics page palette. */
.lyrics-match-panel :is(.lyrics-source-filters, .echo-lmwb-empty-filter) {
  display: flex !important;
  flex: 0 0 auto !important;
  flex-wrap: wrap !important;
  align-items: center !important;
  gap: 6px !important;
  min-height: 30px !important;
  overflow: visible !important;
}
.lyrics-match-panel :is(.lyrics-source-filters, .echo-lmwb-empty-filter) button {
  display: inline-flex !important;
  flex: 0 0 auto !important;
  align-items: center !important;
  gap: 5px !important;
  min-height: 28px !important;
  padding: 3px 10px !important;
  color: var(--theme-page-text, #26384f) !important;
  background: var(--theme-panel-bg, #f8fafc) !important;
  border: 1px solid var(--theme-panel-border, #cbd5e1) !important;
  border-radius: 8px !important;
  font-size: 12px !important;
  line-height: 1.4 !important;
  opacity: 1 !important;
  visibility: visible !important;
}
.lyrics-match-panel .lyrics-source-filters button[data-active="true"] {
  border-color: var(--color-accent, #655ee8) !important;
  box-shadow: inset 0 0 0 1px var(--color-accent, #655ee8) !important;
}
.lyrics-match-panel .lyrics-source-filters button:focus-visible {
  outline: 2px solid var(--color-accent, #655ee8) !important;
  outline-offset: 2px !important;
}
.lyrics-match-panel :is(.lyrics-source-filters, .echo-lmwb-empty-filter) small {
  color: inherit !important;
  font-size: 11px !important;
}
.echo-lmwb-empty-filter {
  padding: 8px;
  border-radius: 8px;
  background: var(--theme-panel-bg, #f8fafc);
}
.echo-lmwb-empty-filter > span {
  flex: 1 1 180px;
  color: var(--theme-page-text, #26384f);
  font-size: 12px;
  line-height: 1.5;
}
.lyrics-match-panel .lyrics-candidate {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) auto !important;
  grid-template-areas:
    "copy footer"
    "badges footer"
    "preview preview"
    "warning warning" !important;
  align-items: start !important;
  overflow: visible !important;
  pointer-events: auto !important;
  min-height: 0 !important;
  height: auto !important;
  padding: 8px 9px !important;
  column-gap: 10px !important;
  row-gap: 5px !important;
}
.lyrics-match-panel .lyrics-candidate-copy { grid-area: copy !important; min-width: 0 !important; }
.lyrics-match-panel .lyrics-candidate-copy em {
  white-space: normal !important;
  display: -webkit-box !important;
  -webkit-box-orient: vertical !important;
  -webkit-line-clamp: 2 !important;
  overflow: hidden !important;
  line-height: 1.35 !important;
}
.lyrics-match-panel .lyrics-candidate-badges {
  grid-area: badges !important;
  flex-wrap: wrap !important;
  max-width: 100% !important;
  max-height: 40px !important;
  overflow: hidden !important;
  min-width: 0 !important;
}
.lyrics-match-panel .lyrics-candidate-badges small {
  max-width: 100% !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
}
.lyrics-match-panel .lyrics-candidate-badges .lyrics-reason-badge ~ .lyrics-reason-badge {
  display: none !important;
}
.lyrics-match-panel .lyrics-candidate-preview {
  grid-area: preview !important;
  min-width: 0 !important;
  max-height: 4.8em !important;
  overflow: hidden !important;
  margin: 0 !important;
}
.lyrics-match-panel .lyrics-candidate-warning {
  grid-area: warning !important;
  min-width: 0 !important;
}
.lyrics-match-panel .lyrics-candidate-footer {
  grid-area: footer !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: flex-end !important;
  align-self: start !important;
  justify-self: end !important;
  position: relative !important;
  z-index: 2 !important;
  pointer-events: auto !important;
}
.lyrics-match-panel .lyrics-candidate-actions,
.lyrics-match-panel .lyrics-candidate-actions button {
  position: relative !important;
  z-index: 2 !important;
  pointer-events: auto !important;
  touch-action: manipulation !important;
}
.lyrics-match-panel__results .lyrics-candidate-list {
  min-height: 0 !important;
  overflow: auto !important;
}

/* Drawer injects: clamp like host pills so long copy cannot blow the grid. */
.lyrics-settings-drawer button[data-echo-lmwb-rematch] {
  min-width: 0 !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
}
.lyrics-settings-drawer button[data-echo-lmwb-rematch] > span {
  min-width: 0 !important;
  max-width: 100% !important;
  overflow: hidden !important;
}
.lyrics-settings-drawer button[data-echo-lmwb-rematch] strong,
.lyrics-settings-drawer button[data-echo-lmwb-rematch] small {
  display: block !important;
  min-width: 0 !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}
.lyrics-settings-drawer label[data-echo-lmwb-host] {
  min-width: 0 !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
}
.lyrics-settings-drawer label[data-echo-lmwb-host] > span {
  min-width: 0 !important;
}
.lyrics-settings-drawer label[data-echo-lmwb-host] small {
  display: -webkit-box !important;
  -webkit-box-orient: vertical !important;
  -webkit-line-clamp: 2 !important;
  overflow: hidden !important;
  white-space: normal !important;
}

/* Keep lyrics settings as a right-side drawer, not a centered floating card. */
.lyrics-settings-drawer-root.audio-drawer-root {
  position: fixed !important;
  inset: 0 !important;
  z-index: 130 !important;
  pointer-events: none !important;
}
.lyrics-settings-drawer-root[data-open="true"] {
  pointer-events: auto !important;
}
/* Keep native candidates clickable while the settings drawer remains open. */
body:has(.page-surface[data-route-id="lyrics"]:not([hidden]) .lyrics-match-panel) .lyrics-settings-drawer-root[data-open="true"],
body:has(.page-surface[data-route-id="lyrics"]:not([hidden]) .lyrics-match-panel) .lyrics-settings-drawer-root .audio-drawer-scrim {
  pointer-events: none !important;
}
body:has(.page-surface[data-route-id="lyrics"]:not([hidden]) .lyrics-match-panel) .lyrics-settings-drawer-root .audio-drawer-scrim {
  background: transparent !important;
}
.lyrics-settings-drawer-root .audio-drawer.lyrics-settings-drawer {
  position: absolute !important;
  top: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  left: auto !important;
  width: min(460px, calc(100vw - 18px)) !important;
  max-width: min(460px, calc(100vw - 18px)) !important;
  height: auto !important;
  margin: 0 !important;
  border-radius: 30px 0 0 30px !important;
  transform-origin: right center !important;
}

/* Default: never paint the leftover circular blob. Official titlebar already has 歌词设置. */
button[data-echo-lmwb-corner],
button.echo-mv-corner {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
  width: 0 !important;
  height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  opacity: 0 !important;
}
`;

let disposed = false;
let enabling = false;
/** Ignore settings events caused by our own writes. */
let selfWriteDepth = 0;
/** User turned the setting off via our injected toggle this session. */
let userOptedOut = false;
let lastNotified = false;
let cachedEnabled = null;
let injectTimer = 0;
let bootTimer = 0;
let bootAttempts = 0;
let rematchBusy = false;
let rematchTimer = 0;
let closeDrawerTimer = 0;
let lyricsOpenTimer = 0;
let lyricsOpenResolve = null;
let cornerSyncTimer = 0;
/** One host candidate search per track. A failed streaming lyric lookup used to stop here. */
const candidateSearchAttempted = new Set();

const cleanups = [];
const MAX_BOOT_ATTEMPTS = 20;
const BOOT_RETRY_MS = 500;
const INJECT_DEBOUNCE_MS = 50;

const getApp = () => {
  const fromExternal = external.echo?.app;
  if (fromExternal?.getSettings && fromExternal?.setSettings) return fromExternal;
  const fromWindow = window.echo?.app;
  if (fromWindow?.getSettings && fromWindow?.setSettings) return fromWindow;
  return null;
};

const isEnabledValue = (value) => value === true;

const readEnabled = async () => {
  const app = getApp();
  if (!app) return null;
  try {
    const settings = await app.getSettings();
    return isEnabledValue(settings?.[SETTING_KEY]);
  } catch {
    return null;
  }
};

const dispatchDisplay = (enabled) => {
  window.dispatchEvent(new CustomEvent('lyrics:display-settings-changed', {
    detail: { [SETTING_KEY]: enabled === true },
  }));
};

const dispatchSettings = (enabled) => {
  const detail = { [SETTING_KEY]: enabled === true };
  window.dispatchEvent(new CustomEvent('settings:changed', { detail }));
  window.dispatchEvent(new CustomEvent('lyrics:display-settings-changed', { detail }));
};

const writeEnabled = async (enabled) => {
  const app = getApp();
  if (!app) return null;
  const next = enabled === true;
  const previous = cachedEnabled;
  selfWriteDepth += 1;
  try {
    cachedEnabled = next;
    syncInjectedInputs(next);
    dispatchDisplay(next);

    const saved = await app.setSettings({ [SETTING_KEY]: next });
    const confirmed = saved && typeof saved === 'object'
      ? isEnabledValue(saved[SETTING_KEY])
      : next;
    cachedEnabled = confirmed;
    syncInjectedInputs(confirmed);
    dispatchSettings(confirmed);
    return confirmed;
  } catch (error) {
    cachedEnabled = typeof previous === 'boolean' ? previous : null;
    if (typeof cachedEnabled === 'boolean') {
      syncInjectedInputs(cachedEnabled);
      dispatchSettings(cachedEnabled);
    }
    try { external.log?.warn?.('[lyrics-match-whitebox] enable failed', error); } catch {}
    throw error;
  } finally {
    selfWriteDepth = Math.max(0, selfWriteDepth - 1);
  }
};

const syncInjectedInputs = (enabled) => {
  if (typeof enabled !== 'boolean') return;
  for (const input of document.querySelectorAll(`input[${TOGGLE_INPUT}]`)) {
    if (input.checked !== enabled) input.checked = enabled;
  }
};

const closeFloatingMatchPanel = () => {
  try {
    const close = document.querySelector('.lyrics-match-panel .lyrics-match-close, .lyrics-match-panel button[aria-label*="Close" i], .lyrics-match-panel button[title*="Close" i]');
    if (close && typeof close.click === 'function') {
      close.click();
      return true;
    }
  } catch {}
  return false;
};

const ensureEnabled = async ({ quiet = false } = {}) => {
  if (!forceEnable || userOptedOut || disposed || enabling) return false;
  const app = getApp();
  if (!app) return false;

  enabling = true;
  try {
    const current = await readEnabled();
    if (disposed || userOptedOut) return false;
    if (current === null) return false;
    cachedEnabled = current;
    if (current === true) {
      syncInjectedInputs(true);
      return true;
    }

    const confirmed = await writeEnabled(true);
    if (confirmed === true && !quiet && notify && !lastNotified && !disposed) {
      lastNotified = true;
      try { external.toast?.(copy.toastOn); } catch {}
    }
    return confirmed === true;
  } catch (error) {
    try { external.log?.warn?.('[lyrics-match-whitebox] enable failed', error); } catch {}
    return false;
  } finally {
    enabling = false;
  }
};

/** Clear a previously forced auto-open so play no longer covers the lyrics page. */
const ensureAutoOpenDisabled = async ({ quiet = false } = {}) => {
  if (forceEnable || disposed || enabling) return false;
  if (!disableAutoOpenOnBoot) return false;
  const app = getApp();
  if (!app) return false;

  enabling = true;
  try {
    const current = await readEnabled();
    if (disposed) return false;
    if (current === null) return false;
    cachedEnabled = current;
    if (current === false) {
      syncInjectedInputs(false);
      closeFloatingMatchPanel();
      return true;
    }

    const confirmed = await writeEnabled(false);
    closeFloatingMatchPanel();
    if (confirmed === false && !quiet && notify && !lastNotified && !disposed) {
      lastNotified = true;
      try { external.toast?.(copy.toastOff); } catch {}
    }
    return confirmed === false;
  } catch (error) {
    try { external.log?.warn?.('[lyrics-match-whitebox] disable auto-open failed', error); } catch {}
    return false;
  } finally {
    enabling = false;
  }
};

const scheduleBoot = () => {
  if (disposed) return;
  if (!forceEnable && !disableAutoOpenOnBoot) return;
  if (bootTimer) window.clearTimeout(bootTimer);
  bootTimer = window.setTimeout(async () => {
    bootTimer = 0;
    if (disposed) return;
    const ok = forceEnable
      ? await ensureEnabled({ quiet: bootAttempts > 0 })
      : await ensureAutoOpenDisabled({ quiet: bootAttempts > 0 });
    bootAttempts += 1;
    if (ok || disposed || bootAttempts >= MAX_BOOT_ATTEMPTS) return;
    if (forceEnable && userOptedOut) return;
    scheduleBoot();
  }, bootAttempts === 0 ? 0 : BOOT_RETRY_MS);
};

const onSettingsEvent = (event) => {
  if (disposed) return;
  if (selfWriteDepth > 0) return;

  const detail = event?.detail;
  const hasKey = detail
    && typeof detail === 'object'
    && !Array.isArray(detail)
    && Object.prototype.hasOwnProperty.call(detail, SETTING_KEY);

  if (hasKey) {
    const enabled = isEnabledValue(detail[SETTING_KEY]);
    cachedEnabled = enabled;
    syncInjectedInputs(enabled);
    if (enabled) {
      userOptedOut = false;
      return;
    }
    if (keepForced && forceEnable && !userOptedOut) {
      void ensureEnabled({ quiet: true });
    }
    return;
  }

  void (async () => {
    const enabled = await readEnabled();
    if (disposed || enabled === null) return;
    cachedEnabled = enabled;
    syncInjectedInputs(enabled);
    if (enabled) {
      userOptedOut = false;
      return;
    }
    if (keepForced && forceEnable && !userOptedOut) {
      await ensureEnabled({ quiet: true });
    }
  })();
};

const findInjectAnchor = () => {
  const automation = document.querySelector(
    '.lyrics-settings-drawer .lyrics-current-track-section .lyrics-current-track-automation',
  );
  if (automation) return { parent: automation, after: null };

  const trackSection = document.querySelector('.lyrics-current-track-section .lyrics-section-collapse-content');
  if (trackSection) return { parent: trackSection, after: null };

  const threshold = document.querySelector(
    '.lyrics-settings-master-section__details .lyrics-match-threshold-control, '
    + '.lyrics-display-panel .lyrics-match-threshold-control, '
    + '.lyrics-match-threshold-control',
  );
  if (threshold?.parentElement) {
    return { parent: threshold.parentElement, after: threshold };
  }

  const details = document.querySelector(
    '#settings-subsection-lyrics-display .lyrics-settings-master-section__details',
  );
  if (details) return { parent: details, after: null };

  return null;
};

const buildToggleRow = (enabled) => {
  const row = document.createElement('label');
  row.className = 'audio-toggle-row';
  row.setAttribute(TOGGLE_HOST, '1');
  row.style.minWidth = '0';

  const text = document.createElement('span');
  text.style.minWidth = '0';
  const title = document.createElement('strong');
  title.textContent = copy.toggleLabel;
  const hint = document.createElement('small');
  hint.textContent = copy.toggleHint;
  text.append(title, hint);

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute(TOGGLE_INPUT, '1');
  input.setAttribute('aria-label', copy.toggleLabel);
  input.checked = enabled === true;

  input.addEventListener('change', () => {
    const want = input.checked === true;
    userOptedOut = !want;
    void (async () => {
      try {
        const confirmed = await writeEnabled(want);
        if (confirmed === null) {
          input.checked = cachedEnabled === true;
          return;
        }
        if (confirmed !== want) {
          input.checked = confirmed;
          userOptedOut = !confirmed;
        }
        if (!confirmed) closeFloatingMatchPanel();
      } catch (error) {
        try { external.log?.warn?.('[lyrics-match-whitebox] toggle failed', error); } catch {}
        input.checked = cachedEnabled === true;
      }
    })();
  });

  row.append(text, input);
  return row;
};

const closeLyricsSettingsDrawer = () => {
  const selectors = [
    '.lyrics-settings-drawer button[aria-label*="Close" i]',
    '.lyrics-settings-drawer button[aria-label*="关闭"]',
    '.lyrics-settings-drawer [data-drawer-close]',
    '.lyrics-settings-drawer .lyrics-settings-close',
    '.audio-drawer-close',
  ];
  for (const selector of selectors) {
    const button = document.querySelector(selector);
    if (button && typeof button.click === 'function') {
      button.click();
      return true;
    }
  }
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  return false;
};

const openLyricsSettingsDrawer = () => {
  window.dispatchEvent(new Event(OPEN_DRAWER_EVENT));
};

const isLyricsSettingsDrawerOpen = () => {
  const root = document.querySelector('.lyrics-settings-drawer-root');
  return root?.getAttribute('data-open') === 'true';
};

const normalizedCandidateKey = (value) => {
  const normalized = lyricsNormalizer.normalize(String(value || ''));
  return lyricsNormalizer.toSimplified(normalized).toLowerCase().replace(/\s+/g, ' ').trim();
};

const isSnapshotLyricsTrack = (track, trackId) =>
  String(track?.mediaType || '').toLowerCase() === 'streaming'
  || String(trackId || track?.id || '').startsWith('streaming:');

const lyricsSnapshotRequest = (track, status, trackId) => {
  const rawDuration = Number(track?.durationSeconds ?? track?.duration ?? (Number(status?.durationMs) / 1000));
  return {
    trackId: track?.id || trackId || status?.currentTrackId,
    mediaType: track?.mediaType || (String(trackId || '').startsWith('streaming:') ? 'streaming' : 'local'),
    sourceId: track?.sourceId ?? null,
    stableKey: track?.stableKey || track?.id || trackId || status?.currentTrackId || null,
    title: track?.title || status?.currentTrackTitle || '',
    artist: track?.artist || status?.currentTrackArtist || 'Unknown Artist',
    album: track?.album ?? null,
    durationSeconds: Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null
  };
};

const searchLyricsForTrack = (track, status, trackId, query, provider) => {
  const lyrics = window.echo?.lyrics;
  if (!lyrics) throw new Error('歌词接口不可用');
  if (isSnapshotLyricsTrack(track, trackId) && typeof lyrics.searchCandidatesForSnapshot === 'function') {
    return lyrics.searchCandidatesForSnapshot(lyricsSnapshotRequest(track, status, trackId), query, provider, 'manual');
  }
  if (typeof lyrics.searchCandidates !== 'function') throw new Error('歌词接口不可用');
  return lyrics.searchCandidates(trackId, query, provider, 'manual');
};

const applyLyricsForTrack = (track, status, trackId, candidateId) => {
  const lyrics = window.echo?.lyrics;
  if (!lyrics) throw new Error('歌词接口不可用');
  if (isSnapshotLyricsTrack(track, trackId) && typeof lyrics.applyCandidateForSnapshot === 'function') {
    return lyrics.applyCandidateForSnapshot(lyricsSnapshotRequest(track, status, trackId), candidateId, 'manual');
  }
  if (typeof lyrics.applyCandidate !== 'function') throw new Error('歌词接口不可用');
  return lyrics.applyCandidate(trackId, candidateId, 'manual');
};

const lrcTimeToMs = (minutes, seconds) => Number(minutes) * 60000 + Math.round(Number(seconds) * 1000);

const parseLrcPreviewRows = (value) => {
  const rows = [];
  for (const raw of String(value || '').split(/\r?\n/u)) {
    const match = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/u);
    if (!match) continue;
    const text = match[3].trim();
    if (!text) continue;
    rows.push({ timeMs: lrcTimeToMs(match[1], match[2]), text });
  }
  return rows;
};

const lrcTextMap = (value) => {
  const map = new Map();
  for (const row of parseLrcPreviewRows(value)) {
    if (!map.has(row.timeMs)) map.set(row.timeMs, row.text);
  }
  return map;
};

const nearestLrcText = (map, timeMs) => {
  if (map.has(timeMs)) return map.get(timeMs);
  let best = null;
  let bestDelta = 350;
  for (const [key, text] of map) {
    const delta = Math.abs(key - timeMs);
    if (delta <= bestDelta) { best = text; bestDelta = delta; }
  }
  return best || null;
};

// Streaming candidates only carry four preview lines from the host. Fetch the
// selected provider's full LRC so the match panel previews the whole lyric,
// not just the credits and first line.
const fetchFullCandidatePreview = async (candidate) => {
  const provider = String(candidate?.provider || '').toLowerCase();
  const rawId = String(candidate?.providerLyricsId || '');
  const id = rawId.includes(':') ? rawId.slice(rawId.indexOf(':') + 1) : rawId;
  if (!id) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    if (provider === 'netease') {
      const url = `https://music.163.com/api/song/lyric?id=${encodeURIComponent(id)}&lv=1&kv=1&tv=1&rv=1`;
      const response = await fetch(url, {
        headers: { Referer: 'https://music.163.com/' },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const data = await response.json();
      const rows = parseLrcPreviewRows(data?.lrc?.lyric);
      if (!rows.length) return null;
      const translations = lrcTextMap(data?.tlyric?.lyric);
      const romanizations = lrcTextMap(data?.romalrc?.lyric);
      return {
        full: true,
        lines: rows.map((row) => ({
          timeMs: row.timeMs,
          text: row.text,
          translation: nearestLrcText(translations, row.timeMs) || undefined,
          romanization: nearestLrcText(romanizations, row.timeMs) || undefined,
        })),
      };
    }
    if (provider === 'lrclib') {
      const response = await fetch(`https://lrclib.net/api/get/${encodeURIComponent(id)}`, {
        headers: { 'User-Agent': 'ECHO-LyricsMatchWhitebox' },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const data = await response.json();
      const rows = parseLrcPreviewRows(data?.syncedLyrics);
      if (!rows.length) return null;
      return { full: true, lines: rows };
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  return null;
};

const previewLyricsForTrack = async (track, candidate) => {
  if (isSnapshotLyricsTrack(track, track?.id)) {
    const full = await fetchFullCandidatePreview(candidate);
    if (full?.lines?.length) return full;
    if (Array.isArray(candidate?.previewLines) && candidate.previewLines.length) {
      return {
        truncated: true,
        lines: candidate.previewLines.map((text) => ({ text: String(text) })),
      };
    }
  }
  return window.echo.lyrics.previewCandidate(track.id, candidate.id);
};

// The host's manual search turns the whole query into a title and drops the
// artist, so its auto-accept guard rejects even exact title/artist matches.
// Ask the selected provider directly, then apply the best exact candidate.
const applyDirectNetworkMatch = async ({ track, status, trackId }) => {
  if (!trackId) return false;
  const lyrics = window.echo?.lyrics;
  if (typeof lyrics?.searchCandidates !== 'function' || typeof lyrics?.applyCandidate !== 'function') {
    return false;
  }
  const rawTitle = track?.title || status?.currentTrackTitle;
  if (!rawTitle) return false;
  const expectedTitle = normalizedCandidateKey(rawTitle);
  const expectedArtist = normalizedCandidateKey(track?.artist || status?.currentTrackArtist || '');
  const rawDuration = Number(track?.durationSeconds ?? track?.duration);
  const duration = Number.isFinite(rawDuration) && rawDuration > 0
    ? rawDuration
    : Number(status?.durationMs) > 0
      ? Number(status.durationMs) / 1000
      : null;
  for (const provider of ['network-match', 'netease', 'lrclib']) {
    let candidates;
    try {
      candidates = await searchLyricsForTrack(track, status, trackId, String(rawTitle), provider);
    } catch {
      continue;
    }
    if (!Array.isArray(candidates) || !candidates.length) continue;
    const ranked = candidates
      .filter((candidate) => candidate && !candidate.instrumental)
      .map((candidate) => {
        const titleMatch = normalizedCandidateKey(candidate.title) === expectedTitle;
        const artistMatch = !expectedArtist || normalizedCandidateKey(candidate.artist) === expectedArtist;
        const candidateDuration = Number(candidate.durationSeconds);
        const delta = duration && Number.isFinite(candidateDuration)
          ? Math.abs(candidateDuration - duration)
          : Infinity;
        return { candidate, titleMatch, artistMatch, delta };
      })
      .filter((entry) => entry.titleMatch && entry.artistMatch && entry.delta <= 3)
      .sort((left, right) => left.delta - right.delta);
    if (!ranked.length) continue;
    try {
      await applyLyricsForTrack(track, status, trackId, ranked[0].candidate.id);
      return true;
    } catch {
      continue;
    }
  }
  return false;
};

const resolveCurrentTrack = async () => {
  const player = external.player || window.__echoExternalPlayer;
  const direct = player?.queue?.()?.currentTrack;
  if (direct?.id) return { track: direct, status: null };

  let status = null;
  try { status = await window.echo?.playback?.getStatus?.(); } catch {}
  if (!status?.currentTrackId) {
    try { status = await player?.status?.(); } catch {}
  }
  const trackId = status?.currentTrackId;
  if (!trackId) return { track: null, status };

  let track = null;
  try { track = await window.echo?.library?.getTrack?.(trackId); } catch {}
  if (!track) {
    track = {
      id: trackId,
      title: status?.currentTrackTitle,
      artist: status?.currentTrackArtist,
      durationSeconds: Number(status?.durationMs) > 0 ? Number(status.durationMs) / 1000 : null,
    };
  }
  return { track, status };
};

const requestRematch = async () => {
  if (disposed || rematchBusy) return;
  rematchBusy = true;
  setRematchBusy(true);
  try {
    if (forceEnable && !userOptedOut) {
      await ensureEnabled({ quiet: true });
    }
    const page = document.querySelector('.lyrics-page');
    const entry = document.querySelector('.player-cover, .transport-lyrics-button');
    const extend = external.extend || window.__echoExternalExtend;
    if ((extend?.navigate || entry) && !page?.getBoundingClientRect?.().width) {
      if (extend?.navigate) extend.navigate('lyrics');
      else entry.click();
      await new Promise((resolve) => {
        lyricsOpenResolve = resolve;
        lyricsOpenTimer = window.setTimeout(() => { lyricsOpenTimer = 0; lyricsOpenResolve = null; resolve(); }, 80);
      });
    }
    if (disposed) return;
    const { track, status } = await resolveCurrentTrack();
    const trackId = track?.id || status?.currentTrackId;
    const directApplied = trackId
      ? await applyDirectNetworkMatch({ track, status, trackId })
      : false;
    if (!directApplied) {
      if (disposed) return;
      if (trackId) {
        // The host's own manual search only covers lyricsEnabledProviders, which
        // ECHO Steam keeps at "local" (online sources are Workshop-provided), so
        // it comes back empty. The whitebox panel names each source explicitly.
        void openMatchPanel();
      } else {
        window.dispatchEvent(new Event(REMATCH_EVENT));
      }
    }
    if (notify && (directApplied || !trackId)) {
      try { external.toast?.(directApplied ? copy.directAppliedToast : copy.rematchToast); } catch {}
    }
    if (closeDrawerOnRematch) {
      closeDrawerTimer = window.setTimeout(() => {
        closeDrawerTimer = 0;
        if (!disposed) closeLyricsSettingsDrawer();
      }, 80);
    }
  } catch (error) {
    try { external.log?.warn?.('[lyrics-match-whitebox] rematch failed', error); } catch {}
  } finally {
    if (disposed) return;
    rematchTimer = window.setTimeout(() => {
      rematchTimer = 0;
      rematchBusy = false;
      if (!disposed) setRematchBusy(false);
    }, 600);
  }
};

const setRematchBusy = (busy) => {
  for (const button of document.querySelectorAll(`button[${REMATCH_HOST}]`)) {
    button.disabled = busy;
    const action = button.querySelector('em');
    if (action) action.textContent = busy ? copy.rematchBusy : copy.rematchAction;
  }
};

const buildRematchButton = () => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'audio-device-pill lyrics-current-track-action';
  button.setAttribute(REMATCH_HOST, '1');
  button.setAttribute('aria-label', copy.rematchTitle);

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '15');
  icon.setAttribute('height', '15');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path1.setAttribute('d', 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8');
  const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path2.setAttribute('d', 'M3 3v5h5');
  icon.append(path1, path2);

  const copyWrap = document.createElement('span');
  const title = document.createElement('strong');
  title.textContent = copy.rematchTitle;
  const hint = document.createElement('small');
  hint.textContent = copy.rematchHint;
  copyWrap.append(title, hint);

  const action = document.createElement('em');
  action.textContent = copy.rematchAction;

  button.append(icon, copyWrap, action);
  button.addEventListener('click', () => {
    void requestRematch();
  });
  return button;
};

const buildCornerIcon = () => {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute(CORNER_HOST, '1');
  button.setAttribute('aria-label', copy.cornerIconLabel);
  button.title = copy.cornerIconTitle;
  button.setAttribute('data-active', isLyricsSettingsDrawerOpen() ? 'true' : 'false');

  // Captions-style icon (matches ECHODev titlebar lyrics-settings).
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('width', '18');
  rect.setAttribute('height', '14');
  rect.setAttribute('x', '3');
  rect.setAttribute('y', '5');
  rect.setAttribute('rx', '2');
  rect.setAttribute('ry', '2');
  const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line1.setAttribute('d', 'M7 15h4M15 15h2M7 11h2M13 11h4');
  icon.append(rect, line1);
  button.append(icon);

  button.addEventListener('click', (event) => {
    try { event?.preventDefault?.(); } catch {}
    try { event?.stopPropagation?.(); } catch {}
    if (isLyricsSettingsDrawerOpen()) {
      closeLyricsSettingsDrawer();
    } else {
      openLyricsSettingsDrawer();
    }
    window.setTimeout(() => syncCornerIconState(), 120);
  });
  return button;
};

const syncCornerIconState = () => {
  const button = document.querySelector(`button[${CORNER_HOST}]`);
  if (!button || typeof button.setAttribute !== 'function') return;
  button.setAttribute('data-active', isLyricsSettingsDrawerOpen() ? 'true' : 'false');
};

const injectToggleRow = () => {
  if (!injectToggle || disposed) return;

  const existing = document.querySelector(`[${TOGGLE_HOST}]`);
  const anchor = findInjectAnchor();
  if (!anchor) {
    existing?.remove();
    return;
  }

  if (existing && existing.parentElement === anchor.parent) {
    if (typeof cachedEnabled === 'boolean') syncInjectedInputs(cachedEnabled);
    return;
  }

  existing?.remove();
  const enabled = cachedEnabled === true;
  const row = buildToggleRow(enabled);
  if (anchor.after && anchor.after.parentElement === anchor.parent) {
    anchor.after.insertAdjacentElement('afterend', row);
  } else {
    anchor.parent.append(row);
  }

  if (cachedEnabled === null) {
    void (async () => {
      const value = await readEnabled();
      if (disposed || value === null) return;
      cachedEnabled = value;
      syncInjectedInputs(value);
    })();
  }
};

const injectRematchButton = () => {
  if (!injectRematch || disposed) return;

  const actions = document.querySelector('.lyrics-current-track-section .lyrics-current-track-actions');
  const existing = document.querySelector(`button[${REMATCH_HOST}]`);
  if (!actions) {
    existing?.remove();
    return;
  }

  if (existing && existing.parentElement === actions) {
    existing.disabled = rematchBusy;
    return;
  }

  existing?.remove();
  const button = buildRematchButton();
  if (rematchBusy) button.disabled = true;
  actions.insertBefore(button, actions.firstChild);
};

const injectCornerButton = () => {
  document.querySelectorAll(`button[${CORNER_HOST}], button.echo-mv-corner`).forEach((node) => {
    try { node.remove(); } catch {}
  });
};

const injectPanelLayoutCss = () => {
  if (disposed) return false;
  let style = document.querySelector(`style[${STYLE_HOST}]`);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute(STYLE_HOST, '1');
    const host = document.head || document.documentElement || document.body;
    if (!host) return false;
    host.appendChild(style);
  }
  if (style.textContent !== PANEL_LAYOUT_CSS) {
    style.textContent = PANEL_LAYOUT_CSS;
  }
  return (style.textContent || '').length > 100;
};

const currentTrack = () => {
  try {
    const player = external.player || window.__echoExternalPlayer;
    return player?.queue?.()?.currentTrack || null;
  } catch {
    return null;
  }
};

const panelGaveUpOnCandidates = (panel) => {
  if (panel.querySelector('.lyrics-candidate, .lyrics-candidate-list .lyrics-candidate')) return false;
  const status = panel.querySelector('.lyrics-match-status')?.textContent || '';
  return /No lyrics found|流媒体歌词服务不可用|没有找到歌词|歌词服务不可用/u.test(status);
};

const requestCandidateSearch = () => {
  const panel = document.querySelector('.lyrics-match-panel');
  if (!panel || !panelGaveUpOnCandidates(panel)) return;
  const track = currentTrack();
  const id = track?.id || 'unknown';
  if (candidateSearchAttempted.has(id)) return;
  candidateSearchAttempted.add(id);
  const query = buildSearchQuery(track, null);
  window.dispatchEvent(new CustomEvent(SEARCH_EVENT, { detail: { query } }));
};

const syncCandidateFilters = () => {
  for (const panel of document.querySelectorAll('.lyrics-match-panel')) {
    const empty = panel.querySelector('.echo-lmwb-empty-filter');
    if (panel.querySelector('.lyrics-source-filters button')) {
      empty?.remove();
      continue;
    }
    if (empty) continue;
    const row = document.createElement('div');
    row.className = 'echo-lmwb-empty-filter';
    const button = document.createElement('button');
    button.type = 'button';
    button.disabled = true;
    button.textContent = copy.allSources;
    const count = document.createElement('small');
    count.textContent = '0';
    button.appendChild(count);
    const hint = document.createElement('span');
    hint.setAttribute('role', 'status');
    hint.textContent = copy.emptySources;
    row.append(button, hint);
    panel.insertBefore(row, panel.querySelector('.lyrics-match-panel__results') || null);
  }
};

const MATCH_ICON_HOST = 'data-echo-lmwb-match-icon';
const MATCH_PANEL_HOST = 'data-echo-lmwb-match-panel';
const MATCH_STYLE_HOST = 'data-echo-lmwb-match-style';
const MATCH_PREF_KEY = 'echo.lmwb.preferences.v1';
const MATCH_PROVIDERS = ['network-match', 'netease', 'lrclib', 'qqmusic', 'amll-ttml'];
const MATCH_PROVIDER_LABELS = {
  'network-match': '网络匹配',
  netease: '网易云',
  lrclib: 'LRCLIB',
  qqmusic: 'QQ 音乐',
  'amll-ttml': 'AMLL',
};

const MATCH_PANEL_CSS = `
.echo-lmwb-match-overlay {
  position: fixed; inset: 0; z-index: 9999; display: flex;
  align-items: center; justify-content: center;
  padding: 24px; background: rgba(8, 12, 22, .62);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
}
.echo-lmwb-match-dialog {
  display: flex; flex-direction: column; width: min(1040px, 94vw);
  height: min(760px, 90vh); overflow: hidden;
  color: var(--theme-page-text, #e8edf7);
  background: var(--theme-panel-bg, #151b28);
  border: 1px solid var(--theme-panel-border, rgba(255,255,255,.14));
  border-radius: 18px; box-shadow: 0 28px 80px rgba(0,0,0,.45);
  font-family: inherit;
}
.echo-lmwb-match-head {
  display: flex; align-items: center; gap: 12px; padding: 16px 18px;
  border-bottom: 1px solid var(--theme-panel-border, rgba(255,255,255,.1));
}
.echo-lmwb-match-head h2 { margin: 0; font-size: 17px; line-height: 1.3; }
.echo-lmwb-match-head p { margin: 2px 0 0; opacity: .68; font-size: 12px; }
.echo-lmwb-match-close {
  margin-left: auto; width: 32px; height: 32px; border-radius: 9px;
  border: 1px solid var(--theme-panel-border, rgba(255,255,255,.14));
  background: transparent; color: inherit; cursor: pointer; font-size: 18px; line-height: 1;
}
.echo-lmwb-match-close:hover { background: rgba(127,127,127,.18); }
.echo-lmwb-match-search { display: flex; gap: 8px; padding: 12px 18px 8px; }
.echo-lmwb-match-search input {
  flex: 1; min-width: 0; height: 38px; padding: 0 12px; border-radius: 10px;
  color: inherit; background: rgba(127,127,127,.12);
  border: 1px solid var(--theme-panel-border, rgba(255,255,255,.16));
  outline: none; font-size: 13px;
}
.echo-lmwb-match-search input:focus { border-color: var(--color-accent, #7c6cff); }
.echo-lmwb-match-search button, .echo-lmwb-match-apply {
  height: 38px; padding: 0 16px; border-radius: 10px; cursor: pointer;
  border: 1px solid transparent; color: #fff; background: var(--color-accent, #6d5dfc);
  font-size: 13px; font-weight: 600;
}
.echo-lmwb-match-search button:disabled, .echo-lmwb-match-apply:disabled { opacity: .45; cursor: default; }
.echo-lmwb-match-filters {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 4px 18px 10px;
}
.echo-lmwb-chip {
  min-height: 27px; padding: 2px 10px; border-radius: 999px; cursor: pointer;
  color: inherit; background: rgba(127,127,127,.12);
  border: 1px solid var(--theme-panel-border, rgba(255,255,255,.14));
  font-size: 12px;
}
.echo-lmwb-chip[data-active="true"] {
  color: #fff; border-color: var(--color-accent, #6d5dfc);
  background: var(--color-accent, #6d5dfc);
}
.echo-lmwb-toggle { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; opacity: .9; }
.echo-lmwb-toggle input { accent-color: var(--color-accent, #6d5dfc); }
.echo-lmwb-match-body { display: flex; flex: 1; min-height: 0; border-top: 1px solid var(--theme-panel-border, rgba(255,255,255,.08)); }
.echo-lmwb-match-list {
  flex: 0 0 320px; min-width: 260px; overflow: auto; padding: 10px;
  border-right: 1px solid var(--theme-panel-border, rgba(255,255,255,.1));
}
.echo-lmwb-cand {
  display: block; width: 100%; margin: 0 0 7px; padding: 9px 10px;
  text-align: left; color: inherit; cursor: pointer;
  background: rgba(127,127,127,.08); border-radius: 10px;
  border: 1px solid transparent;
}
.echo-lmwb-cand:hover { background: rgba(127,127,127,.16); }
.echo-lmwb-cand[data-active="true"] {
  border-color: var(--color-accent, #6d5dfc);
  background: color-mix(in srgb, var(--color-accent, #6d5dfc) 18%, transparent);
}
.echo-lmwb-cand-top { display: flex; align-items: center; gap: 7px; font-size: 11px; opacity: .85; }
.echo-lmwb-cand-provider { font-weight: 700; }
.echo-lmwb-cand-score { margin-left: auto; font-variant-numeric: tabular-nums; }
.echo-lmwb-cand-title { margin-top: 4px; font-size: 13px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.echo-lmwb-cand-sub { margin-top: 3px; font-size: 11px; opacity: .66; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.echo-lmwb-badge {
  display: inline-block; margin-left: 4px; padding: 0 5px; border-radius: 5px;
  font-size: 10px; line-height: 16px; color: #d8ccff; background: rgba(109,93,252,.28);
}
.echo-lmwb-match-preview { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.echo-lmwb-preview-meta { padding: 14px 18px 10px; border-bottom: 1px solid var(--theme-panel-border, rgba(255,255,255,.08)); }
.echo-lmwb-preview-meta strong { display: block; font-size: 14px; }
.echo-lmwb-preview-meta span { display: block; margin-top: 3px; font-size: 12px; opacity: .68; }
.echo-lmwb-preview-lines { flex: 1; overflow: auto; padding: 10px 18px 18px; }
.echo-lmwb-preview-empty { padding: 32px 18px; font-size: 13px; opacity: .65; }
.echo-lmwb-line { display: flex; gap: 10px; padding: 7px 0; border-bottom: 1px dashed rgba(127,127,127,.16); }
.echo-lmwb-line-time { flex: 0 0 42px; padding-top: 2px; font-size: 11px; opacity: .52; font-variant-numeric: tabular-nums; }
.echo-lmwb-line-text { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.55; white-space: pre-wrap; }
.echo-lmwb-line-trans { margin-top: 2px; font-size: 12px; opacity: .78; }
.echo-lmwb-line-rom { margin-top: 1px; font-size: 11px; opacity: .56; font-style: italic; }
.echo-lmwb-match-foot {
  display: flex; align-items: center; gap: 12px; padding: 12px 18px;
  border-top: 1px solid var(--theme-panel-border, rgba(255,255,255,.1));
}
.echo-lmwb-match-foot label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; opacity: .85; }
.echo-lmwb-match-status { flex: 1; min-width: 0; font-size: 12px; opacity: .65; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

const matchState = {
  open: false,
  track: null,
  candidates: [],
  selected: null,
  preview: null,
  query: '',
  filter: 'all',
  syncedOnly: false,
  translatedOnly: false,
  loading: false,
  enriching: false,
  overlay: null,
  input: null,
  list: null,
  previewEl: null,
  statusEl: null,
  applyEl: null,
  searchEl: null,
  filtersEl: null,
  rememberEl: null,
};

const matchPrefs = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(MATCH_PREF_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
};

const writeMatchPrefs = (prefs) => {
  try {
    localStorage.setItem(MATCH_PREF_KEY, JSON.stringify(prefs));
  } catch {}
};

const matchTrackKey = (track) => {
  if (!track) return '';
  return String(track.path || track.stableKey || track.id || '')
    || [lyricsNormalizer.normalize(track.title || ''), lyricsNormalizer.normalize(track.artist || ''), Number(track.durationSeconds ?? track.duration) || ''].join('|');
};

const matchDuration = (track) => Number(track?.durationSeconds ?? track?.duration);

const matchNormalized = (value) => lyricsNormalizer.normalize(String(value ?? ''));

const matchTextClose = (left, right) => {
  const a = matchNormalized(left);
  const b = matchNormalized(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
};

const matchSource = (candidate) => candidate?.sourceLabel
  || MATCH_PROVIDER_LABELS[candidate?.provider]
  || candidate?.provider
  || '未知来源';

const matchCandidateScore = (candidate) => {
  const base = Number(candidate?.score) || 0;
  if (candidate?.instrumental) return Math.min(base, 0.5);
  const title = Number(candidate?.titleScore);
  const artist = Number(candidate?.artistScore);
  const artistMatches = Boolean(matchState.track?.artist) && matchTextClose(candidate?.artist, matchState.track?.artist);
  const titleExact = Boolean(matchState.track?.title)
    && matchNormalized(candidate?.title) === matchNormalized(matchState.track?.title);
  if (titleExact && artistMatches) {
    const duration = matchDuration(matchState.track);
    const candidateDuration = Number(candidate?.durationSeconds);
    if (Number.isFinite(duration) && Number.isFinite(candidateDuration)
      && Math.abs(duration - candidateDuration) <= 3) return 1;
    return 0.96;
  }
  if (titleExact && !matchState.track?.artist) return 0.9;
  if (Number.isFinite(title) && title >= 0.98 && artistMatches) return 1;
  const combined = Number.isFinite(title)
    ? title * (Number.isFinite(artist) ? 0.7 : 0.9) + (Number.isFinite(artist) ? artist * 0.3 : 0)
    : 0;
  return Math.max(base, combined);
};

const candidateMatchesPreference = (candidate, preference) => {
  if (!candidate || !preference) return false;
  if (candidate.id && candidate.id === preference.candidateId) return true;
  if (candidate.contentFingerprint && candidate.contentFingerprint === preference.fingerprint) return true;
  if (candidate.providerLyricsId && candidate.providerLyricsId === preference.providerLyricsId) return true;
  return false;
};

const findPreference = (track) => {
  const prefs = matchPrefs();
  const key = matchTrackKey(track);
  if (key && prefs[key]) return prefs[key];
  const duration = matchDuration(track);
  const title = matchNormalized(track?.title);
  if (!title) return null;
  for (const value of Object.values(prefs)) {
    if (!value || typeof value !== 'object') continue;
    // Exact title only: "includes" let a choice for "Love" apply to "Lovers".
    if (matchNormalized(value.title) !== title) continue;
    const storedDuration = Number(value.durationSeconds);
    if (Number.isFinite(duration) && Number.isFinite(storedDuration)
      && Math.abs(duration - storedDuration) > 3) continue;
    if (value.artist && track?.artist && !matchTextClose(value.artist, track.artist)) continue;
    return value;
  }
  return null;
};

const savePreference = (track, candidate) => {
  if (!track?.id || !candidate?.id) return;
  const prefs = matchPrefs();
  const key = matchTrackKey(track) || track.id;
  prefs[key] = {
    candidateId: candidate.id,
    provider: candidate.provider || '',
    providerLyricsId: candidate.providerLyricsId || '',
    fingerprint: candidate.contentFingerprint || '',
    title: track.title || '',
    artist: track.artist || '',
    durationSeconds: Number(track.durationSeconds ?? track.duration) || null,
    score: Number(candidate.score) || null,
    savedAt: Date.now(),
  };
  const entries = Object.entries(prefs).sort((a, b) => (Number(b[1]?.savedAt) || 0) - (Number(a[1]?.savedAt) || 0)).slice(0, 200);
  writeMatchPrefs(Object.fromEntries(entries));
};

const removePreference = (track) => {
  const prefs = matchPrefs();
  const key = matchTrackKey(track);
  if (key && prefs[key]) {
    delete prefs[key];
    writeMatchPrefs(prefs);
  }
};

const getStoredCandidates = async (trackId) => {
  try {
    const value = await window.echo?.lyrics?.getStoredCandidates?.(trackId);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

const dedupeCandidates = (candidates) => {
  const seen = new Set();
  const result = [];
  for (const candidate of candidates) {
    if (!candidate || !candidate.id) continue;
    const key = candidate.providerLyricsId || candidate.contentFingerprint
      || [candidate.provider, candidate.title, candidate.artist, candidate.durationSeconds].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
};

const sortCandidates = (candidates) => [...candidates].sort((a, b) => {
  const score = matchCandidateScore(b) - matchCandidateScore(a);
  if (score) return score;
  const synced = Number(Boolean(b.hasSynced)) - Number(Boolean(a.hasSynced));
  if (synced) return synced;
  const translated = Number(Boolean(b._translated)) - Number(Boolean(a._translated));
  if (translated) return translated;
  return (Number(a.durationDeltaSeconds) || 999) - (Number(b.durationDeltaSeconds) || 999);
});

// ECHO Steam keeps only "local" in lyricsEnabledProviders (its settings
// normalizer drops network ids): since 26.10.8 NetEase / QQ / LRCLIB / AMLL
// come from the Workshop item "ECHO 网络歌词匹配" and only answer by name, so a
// search without an explicit provider never leaves the disk. Name every source explicitly and merge, instead of stopping at
// the first non-empty answer (a local sidecar used to hide all network results).
const searchCandidatesForPanel = async (track, query) => {
  if (!track?.id) throw new Error('没有当前歌曲');
  const search = (provider) => searchLyricsForTrack(track, null, track.id, query, provider);
  const providers = MATCH_PROVIDERS.filter((id) => id !== 'network-match');
  const failures = [];
  const results = await Promise.allSettled([search('network-match'), ...providers.map((id) => search(id))]);
  const merged = [];
  results.forEach((result, index) => {
    const provider = index === 0 ? 'network-match' : providers[index - 1];
    if (result.status === 'fulfilled' && Array.isArray(result.value)) merged.push(...result.value);
    else failures.push(`${MATCH_PROVIDER_LABELS[provider] || provider}：${result.reason?.message || result.reason || '失败'}`);
  });
  return { candidates: dedupeCandidates(merged), failures };
};

const matchLineTime = (timeMs) => {
  const value = Number(timeMs);
  if (!Number.isFinite(value) || value < 0) return '--:--';
  const seconds = Math.floor(value / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

const matchCandidateVisible = (candidate) => {
  if (matchState.filter !== 'all' && candidate.provider !== matchState.filter) return false;
  if (matchState.syncedOnly && !candidate.hasSynced) return false;
  if (matchState.translatedOnly && !candidate._translated) return false;
  return true;
};

const matchStatus = (text) => {
  if (matchState.statusEl) matchState.statusEl.textContent = text;
};

const renderMatchPreview = () => {
  const host = matchState.previewEl;
  if (!host) return;
  host.replaceChildren();
  const candidate = matchState.selected;
  if (!candidate) {
    const empty = document.createElement('div');
    empty.className = 'echo-lmwb-preview-empty';
    empty.textContent = '从左侧选择一条歌词，这里会显示逐行原文、翻译和罗马音。';
    host.append(empty);
    return;
  }
  const meta = document.createElement('div');
  meta.className = 'echo-lmwb-preview-meta';
  const title = document.createElement('strong');
  title.textContent = candidate.title || '未命名歌词';
  const info = document.createElement('span');
  const parts = [matchSource(candidate), candidate.artist || '未知歌手'];
  if (Number.isFinite(Number(candidate.durationSeconds))) {
    parts.push(`${Math.floor(Number(candidate.durationSeconds) / 60)}:${String(Math.round(Number(candidate.durationSeconds) % 60)).padStart(2, '0')}`);
  }
  if (candidate.hasSynced) parts.push('逐行');
  if (candidate._translated) parts.push('带翻译');
  info.textContent = parts.join(' · ');
  meta.append(title, info);
  host.append(meta);

  const linesHost = document.createElement('div');
  linesHost.className = 'echo-lmwb-preview-lines';
  const preview = matchState.preview;
  const lines = Array.isArray(preview?.lines) ? preview.lines : [];
  if (lines.length) {
    for (const line of lines.slice(0, 160)) {
      const row = document.createElement('div');
      row.className = 'echo-lmwb-line';
      const time = document.createElement('span');
      time.className = 'echo-lmwb-line-time';
      time.textContent = matchLineTime(line.timeMs);
      const text = document.createElement('div');
      text.className = 'echo-lmwb-line-text';
      const original = document.createElement('div');
      original.textContent = line.text || '';
      text.append(original);
      if (line.translation) {
        const translation = document.createElement('div');
        translation.className = 'echo-lmwb-line-trans';
        translation.textContent = line.translation;
        text.append(translation);
      }
      if (line.romanization) {
        const romanization = document.createElement('div');
        romanization.className = 'echo-lmwb-line-rom';
        romanization.textContent = line.romanization;
        text.append(romanization);
      }
      row.append(time, text);
      linesHost.append(row);
    }
  } else {
    const empty = document.createElement('div');
    empty.className = 'echo-lmwb-preview-empty';
    empty.textContent = preview?.plain || '这条候选没有可显示的歌词内容。';
    linesHost.append(empty);
  }
  host.append(linesHost);
};

const renderMatchList = () => {
  const host = matchState.list;
  if (!host) return;
  host.replaceChildren();
  const visible = matchState.candidates.filter(matchCandidateVisible);
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'echo-lmwb-preview-empty';
    empty.textContent = matchState.loading ? '正在搜索候选…' : '没有符合筛选条件的候选。';
    host.append(empty);
    return;
  }
  for (const candidate of visible) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'echo-lmwb-cand';
    button.dataset.id = candidate.id;
    if (matchState.selected?.id === candidate.id) button.dataset.active = 'true';

    const top = document.createElement('div');
    top.className = 'echo-lmwb-cand-top';
    const provider = document.createElement('span');
    provider.className = 'echo-lmwb-cand-provider';
    provider.textContent = matchSource(candidate);
    const score = document.createElement('span');
    score.className = 'echo-lmwb-cand-score';
    score.textContent = `${Math.round(matchCandidateScore(candidate) * 100)}%`;
    top.append(provider, score);

    const title = document.createElement('div');
    title.className = 'echo-lmwb-cand-title';
    title.textContent = candidate.title || '未命名';
    if (candidate._translated) {
      const badge = document.createElement('span');
      badge.className = 'echo-lmwb-badge';
      badge.textContent = '译';
      title.append(badge);
    }

    const sub = document.createElement('div');
    sub.className = 'echo-lmwb-cand-sub';
    const subParts = [candidate.artist || '未知歌手'];
    const duration = Number(candidate.durationSeconds);
    if (Number.isFinite(duration)) subParts.push(matchLineTime(duration * 1000));
    subParts.push(candidate.instrumental ? '纯音乐' : (candidate.hasSynced ? '逐行' : '纯文本'));
    if (Number.isFinite(Number(candidate.durationDeltaSeconds)) && Math.abs(Number(candidate.durationDeltaSeconds)) >= 1) {
      subParts.push(`Δ${Math.abs(Number(candidate.durationDeltaSeconds)).toFixed(1)}s`);
    }
    sub.textContent = subParts.join(' · ');

    button.append(top, title, sub);
    button.addEventListener('click', () => { void selectMatchCandidate(candidate); });
    host.append(button);
  }
};

const selectMatchCandidate = async (candidate) => {
  matchState.selected = candidate;
  matchState.preview = null;
  renderMatchList();
  renderMatchPreview();
  if (matchState.applyEl) matchState.applyEl.disabled = !candidate;
  matchStatus(candidate ? `已选择：${candidate.title || '未命名'} · ${matchSource(candidate)}` : '');
  if (!candidate || !matchState.track?.id) return;
  try {
    const preview = await previewLyricsForTrack(matchState.track, candidate);
    if (matchState.selected?.id !== candidate.id) return;
    matchState.preview = preview;
    const lines = Array.isArray(preview?.lines) ? preview.lines : [];
    candidate._translated = lines.some((line) => Boolean(line.translation));
    candidate._lineCount = lines.length;
    renderMatchList();
    renderMatchPreview();
    if (candidate._translated) matchStatus(`已选择：${candidate.title || '未命名'} · 含翻译`);
  } catch (error) {
    matchStatus(`预览失败：${error?.message || error}`);
  }
};

const enrichMatchCandidates = async (candidates, trackId) => {
  if (!trackId || !candidates.length) return;
  if (isSnapshotLyricsTrack(matchState.track, trackId)) return;
  matchState.enriching = true;
  const queue = candidates.slice(0, 14);
  let cursor = 0;
  let active = 0;
  await new Promise((resolve) => {
    const next = () => {
      if (cursor >= queue.length && active === 0) { resolve(); return; }
      while (active < 3 && cursor < queue.length) {
        const candidate = queue[cursor++];
        active += 1;
        window.echo.lyrics.previewCandidate(trackId, candidate.id).then((preview) => {
          const lines = Array.isArray(preview?.lines) ? preview.lines : [];
          candidate._translated = lines.some((line) => Boolean(line.translation));
          candidate._lineCount = lines.length;
        }).catch(() => {}).finally(() => {
          active -= 1;
          renderMatchList();
          if (matchState.selected?.id === candidate.id && matchState.preview) renderMatchPreview();
          next();
        });
      }
    };
    next();
  });
  matchState.enriching = false;
  renderMatchList();
  ensureVisibleMatchSelection();
};

const ensureVisibleMatchSelection = () => {
  if (matchState.selected && matchCandidateVisible(matchState.selected)) return;
  const first = matchState.candidates.find(matchCandidateVisible);
  if (first) {
    void selectMatchCandidate(first);
  } else {
    matchState.selected = null;
    matchState.preview = null;
    renderMatchList();
    renderMatchPreview();
    if (matchState.applyEl) matchState.applyEl.disabled = true;
  }
};

const updateMatchFilters = () => {
  const host = matchState.filtersEl;
  if (!host) return;
  for (const chip of host.querySelectorAll('[data-provider]')) {
    chip.dataset.active = chip.dataset.provider === matchState.filter ? 'true' : 'false';
  }
  const synced = host.querySelector('[data-filter="synced"]');
  if (synced) synced.checked = matchState.syncedOnly;
  const translated = host.querySelector('[data-filter="translated"]');
  if (translated) translated.checked = matchState.translatedOnly;
};

const applySelectedMatch = async () => {
  const candidate = matchState.selected;
  const track = matchState.track;
  if (!candidate || !track?.id) return;
  if (matchState.applyEl) matchState.applyEl.disabled = true;
  matchStatus('正在应用歌词…');
  try {
    await applyLyricsForTrack(track, null, track.id, candidate.id);
    if (matchState.rememberEl?.checked !== false) savePreference(track, candidate);
    matchStatus(`已应用：${candidate.title || '未命名'} · ${matchSource(candidate)}`);
    try { external.toast?.(`已应用歌词：${matchSource(candidate)}`); } catch {}
  } catch (error) {
    matchStatus(`应用失败：${error?.message || error}`);
    if (matchState.applyEl) matchState.applyEl.disabled = false;
  }
};

const closeMatchPanel = () => {
  if (matchState.overlay) {
    try { matchState.overlay.remove(); } catch {}
  }
  matchState.open = false;
  document.querySelector(`button[${MATCH_ICON_HOST}]`)?.setAttribute('data-active', 'false');
  matchState.overlay = null;
  matchState.list = null;
  matchState.previewEl = null;
  matchState.statusEl = null;
  matchState.applyEl = null;
  matchState.searchEl = null;
  matchState.filtersEl = null;
  matchState.rememberEl = null;
  document.documentElement.style.removeProperty('overflow');
  try { document.removeEventListener('keydown', onMatchKeydown); } catch {}
};

const onMatchKeydown = (event) => {
  if (event.key === 'Escape' && matchState.open) closeMatchPanel();
};

const injectMatchStyle = () => {
  let style = document.querySelector(`style[${MATCH_STYLE_HOST}]`);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute(MATCH_STYLE_HOST, '1');
    (document.head || document.documentElement || document.body)?.append(style);
  }
  if (style.textContent !== MATCH_PANEL_CSS) style.textContent = MATCH_PANEL_CSS;
};

const buildMatchPanel = () => {
  injectMatchStyle();
  const overlay = document.createElement('div');
  overlay.className = 'echo-lmwb-match-overlay';
  overlay.setAttribute(MATCH_PANEL_HOST, '1');
  overlay.addEventListener('click', (event) => { if (event.target === overlay) closeMatchPanel(); });

  const dialog = document.createElement('div');
  dialog.className = 'echo-lmwb-match-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', '歌词匹配候选');

  const head = document.createElement('div');
  head.className = 'echo-lmwb-match-head';
  const heading = document.createElement('div');
  const h2 = document.createElement('h2');
  h2.textContent = '歌词匹配';
  const subtitle = document.createElement('p');
  subtitle.textContent = '手动挑选逐行、翻译更完整的版本；可记住本曲选择，下次自动应用。';
  heading.append(h2, subtitle);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'echo-lmwb-match-close';
  close.setAttribute('aria-label', '关闭歌词匹配');
  close.textContent = '×';
  close.addEventListener('click', closeMatchPanel);
  head.append(heading, close);

  const searchRow = document.createElement('div');
  searchRow.className = 'echo-lmwb-match-search';
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = '歌名 / 歌手 / 关键词';
  input.setAttribute('aria-label', '歌词搜索关键词');
  const searchButton = document.createElement('button');
  searchButton.type = 'button';
  searchButton.textContent = '搜索';
  searchButton.addEventListener('click', () => { void refreshMatchCandidates(); });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); void refreshMatchCandidates(); } });
  searchRow.append(input, searchButton);

  const filters = document.createElement('div');
  filters.className = 'echo-lmwb-match-filters';
  const makeChip = (provider) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'echo-lmwb-chip';
    chip.dataset.provider = provider;
    chip.textContent = provider === 'all' ? '全部来源' : (MATCH_PROVIDER_LABELS[provider] || provider);
    chip.addEventListener('click', () => {
      matchState.filter = provider;
      updateMatchFilters();
      renderMatchList();
      ensureVisibleMatchSelection();
    });
    return chip;
  };
  filters.append(makeChip('all'), ...MATCH_PROVIDERS.map(makeChip));
  const syncedLabel = document.createElement('label');
  syncedLabel.className = 'echo-lmwb-toggle';
  const syncedInput = document.createElement('input');
  syncedInput.type = 'checkbox';
  syncedInput.dataset.filter = 'synced';
  syncedInput.addEventListener('change', () => {
    matchState.syncedOnly = syncedInput.checked;
    renderMatchList();
    ensureVisibleMatchSelection();
  });
  syncedLabel.append(syncedInput, document.createTextNode('仅逐行'));
  const translatedLabel = document.createElement('label');
  translatedLabel.className = 'echo-lmwb-toggle';
  const translatedInput = document.createElement('input');
  translatedInput.type = 'checkbox';
  translatedInput.dataset.filter = 'translated';
  translatedInput.addEventListener('change', () => {
    matchState.translatedOnly = translatedInput.checked;
    renderMatchList();
    ensureVisibleMatchSelection();
  });
  translatedLabel.append(translatedInput, document.createTextNode('仅带翻译'));
  filters.append(syncedLabel, translatedLabel);

  const body = document.createElement('div');
  body.className = 'echo-lmwb-match-body';
  const list = document.createElement('div');
  list.className = 'echo-lmwb-match-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', '歌词候选列表');
  const preview = document.createElement('div');
  preview.className = 'echo-lmwb-match-preview';
  body.append(list, preview);

  const foot = document.createElement('div');
  foot.className = 'echo-lmwb-match-foot';
  const rememberLabel = document.createElement('label');
  const remember = document.createElement('input');
  remember.type = 'checkbox';
  remember.checked = true;
  rememberLabel.append(remember, document.createTextNode('记住本曲选择，下次自动应用'));
  const status = document.createElement('span');
  status.className = 'echo-lmwb-match-status';
  status.setAttribute('role', 'status');
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'echo-lmwb-match-apply';
  apply.textContent = '应用这条歌词';
  apply.disabled = true;
  apply.addEventListener('click', () => { void applySelectedMatch(); });
  foot.append(rememberLabel, status, apply);

  dialog.append(head, searchRow, filters, body, foot);
  overlay.append(dialog);
  document.body.append(overlay);

  matchState.overlay = overlay;
  matchState.input = input;
  matchState.searchEl = searchButton;
  matchState.filtersEl = filters;
  matchState.list = list;
  matchState.previewEl = preview;
  matchState.statusEl = status;
  matchState.applyEl = apply;
  matchState.rememberEl = remember;
  document.documentElement.style.setProperty('overflow', 'hidden');
  document.addEventListener('keydown', onMatchKeydown);
  updateMatchFilters();
};

let matchSearchSeq = 0;

const refreshMatchCandidates = async () => {
  if (!matchState.open) return;
  const track = matchState.track;
  if (!track?.id) {
    matchStatus('没有检测到当前歌曲，请先播放一首歌。');
    return;
  }
  const query = String(matchState.input?.value || '').trim() || buildSearchQuery(track, null);
  // Enter in the field is not blocked by the disabled button; the newest search wins.
  const seq = ++matchSearchSeq;
  matchState.query = query;
  matchState.loading = true;
  matchState.candidates = [];
  matchState.selected = null;
  matchState.preview = null;
  if (matchState.list) matchState.list.replaceChildren();
  renderMatchPreview();
  if (matchState.applyEl) matchState.applyEl.disabled = true;
  if (matchState.searchEl) matchState.searchEl.disabled = true;
  matchStatus(`正在搜索「${query}」…`);
  try {
    const result = await searchCandidatesForPanel(track, query);
    if (seq !== matchSearchSeq || !matchState.open || matchState.track !== track) return;
    matchState.candidates = sortCandidates(result.candidates);
    matchState.loading = false;
    if (matchState.searchEl) matchState.searchEl.disabled = false;
    renderMatchList();
    const visible = matchState.candidates.filter(matchCandidateVisible);
    matchStatus(visible.length
      ? `找到 ${matchState.candidates.length} 条候选；点击左侧条目预览翻译与逐行效果。`
      : '没有找到候选。可以换关键词；网络歌词需要在创意工坊订阅并启用「ECHO 网络歌词匹配」。');
    if (visible[0]) void selectMatchCandidate(visible[0]);
    void enrichMatchCandidates(matchState.candidates, track.id);
  } catch (error) {
    if (seq !== matchSearchSeq) return;
    matchState.loading = false;
    if (matchState.searchEl) matchState.searchEl.disabled = false;
    matchStatus(`搜索失败：${error?.message || error}`);
  }
};

let matchPanelOpening = false;

const openMatchPanel = async () => {
  if (disposed || matchPanelOpening) return;
  if (matchState.open) {
    matchState.input?.focus?.();
    return;
  }
  // A second click while the track lookup is pending used to build a second
  // overlay that nothing could close.
  matchPanelOpening = true;
  let track = null;
  try {
    try { track = (await resolveCurrentTrack()).track; } catch {}
  } finally {
    matchPanelOpening = false;
  }
  if (disposed || matchState.open) return;
  if (!track) track = currentTrack();
  matchState.open = true;
  matchState.track = track || null;
  matchState.query = track ? buildSearchQuery(track, null) : '';
  matchState.candidates = [];
  matchState.selected = null;
  matchState.preview = null;
  matchState.filter = 'all';
  matchState.syncedOnly = false;
  matchState.translatedOnly = false;
  buildMatchPanel();
  document.querySelector(`button[${MATCH_ICON_HOST}]`)?.setAttribute('data-active', 'true');
  if (matchState.input) matchState.input.value = matchState.query;
  if (!track?.id) {
    matchStatus('没有检测到当前歌曲，请先播放一首歌。');
    return;
  }
  void refreshMatchCandidates();
};

const buildMatchIcon = () => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'titlebar-action';
  button.setAttribute(MATCH_ICON_HOST, '1');
  button.setAttribute('aria-label', '歌词匹配候选');
  button.title = '打开歌词匹配候选（手动挑选翻译/逐行版本）';
  button.setAttribute('data-active', matchState.open ? 'true' : 'false');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '17');
  icon.setAttribute('height', '17');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  const paths = [
    'M8 6h13M8 12h13M8 18h13',
    'M3 6h.01M3 12h.01M3 18h.01',
  ];
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    icon.append(path);
  }
  button.append(icon);
  button.addEventListener('click', (event) => {
    try { event?.preventDefault?.(); } catch {}
    try { event?.stopPropagation?.(); } catch {}
    void openMatchPanel();
  });
  return button;
};

const injectMatchIcon = () => {
  if (disposed) return;
  const actions = document.querySelector('.app-titlebar-actions');
  let button = document.querySelector(`button[${MATCH_ICON_HOST}]`);
  if (!actions) {
    button?.remove();
    return;
  }
  if (!button) {
    button = buildMatchIcon();
    const anchor = actions.querySelector('button[aria-label="歌词设置"]');
    if (anchor?.after) anchor.after(button);
    else actions.append(button);
  } else if (button.parentElement !== actions) {
    actions.append(button);
  }
  button.setAttribute('data-active', matchState.open ? 'true' : 'false');
};

const autoApplyPreference = async (track) => {
  if (!track?.id || disposed) return;
  const preference = findPreference(track);
  if (!preference) return;
  try {
    const current = await window.echo?.lyrics?.getForTrack?.(track.id);
    if (current && (current.providerLyricsId === preference.providerLyricsId
      || current.contentFingerprint === preference.fingerprint)) return;
    let candidates = await getStoredCandidates(track.id);
    let candidate = candidates.find((item) => candidateMatchesPreference(item, preference));
    if (!candidate) {
      const query = preference.title || track.title || buildSearchQuery(track, null);
      const result = await searchCandidatesForPanel(track, query);
      candidate = result.candidates.find((item) => candidateMatchesPreference(item, preference));
    }
    if (!candidate) return;
    await applyLyricsForTrack(track, null, track.id, candidate.id);
    try { external.toast?.(`已自动应用上次选择的歌词：${matchSource(candidate)}`); } catch {}
  } catch {}
};

let matchWatchTimer = 0;
let matchLastTrackId = '';

const startMatchWatcher = () => {
  if (matchWatchTimer || disposed) return;
  matchWatchTimer = window.setInterval(() => {
    if (disposed || document.hidden) return;
    void (async () => {
      const { track } = await resolveCurrentTrack();
      if (!track?.id || track.id === matchLastTrackId) return;
      matchLastTrackId = track.id;
      window.setTimeout(() => {
        if (!disposed && !matchState.open) void autoApplyPreference(track);
      }, 1800);
    })().catch(() => {});
  }, 2000);
};


const injectAll = () => {
  if (disposed) return;
  injectPanelLayoutCss();
  injectToggleRow();
  injectRematchButton();
  injectCornerButton();
  injectMatchIcon();
  syncCandidateFilters();
  requestCandidateSearch();
};

const scheduleInject = () => {
  if (disposed) return;
  // Coalesce updates without letting continuously changing lyrics starve the injection.
  if (injectTimer) return;
  injectTimer = window.setTimeout(() => {
    injectTimer = 0;
    if (!disposed) injectAll();
  }, INJECT_DEBOUNCE_MS);
};

window.addEventListener('settings:changed', onSettingsEvent);
window.addEventListener('lyrics:display-settings-changed', onSettingsEvent);
cleanups.push(() => {
  window.removeEventListener('settings:changed', onSettingsEvent);
  window.removeEventListener('lyrics:display-settings-changed', onSettingsEvent);
});

{
  const observer = new MutationObserver((records) => {
    if (disposed) return;
    const relevant = '.app-titlebar-actions, .lyrics-settings-drawer-root, .lyrics-current-track-section, .lyrics-match-threshold-control, #settings-subsection-lyrics-display, .lyrics-match-panel';
    if (records.length && !records.some((record) => record.target?.closest?.(relevant)
      || [...(record.addedNodes || []), ...(record.removedNodes || [])].some((node) => node.matches?.(relevant) || node.querySelector?.(relevant)))) return;
    scheduleInject();
    if (cornerSyncTimer) window.clearTimeout(cornerSyncTimer);
    cornerSyncTimer = window.setTimeout(() => {
      cornerSyncTimer = 0;
      if (!disposed) syncCornerIconState();
    }, 80);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-open', 'class'] });
  cleanups.push(() => observer.disconnect());
}

injectPanelLayoutCss();
scheduleBoot();
injectAll();
startMatchWatcher();

return () => {
  disposed = true;
  document.querySelectorAll('.echo-lmwb-empty-filter').forEach((node) => node.remove());
  if (bootTimer) window.clearTimeout(bootTimer);
  if (injectTimer) window.clearTimeout(injectTimer);
  if (cornerSyncTimer) window.clearTimeout(cornerSyncTimer);
  if (rematchTimer) window.clearTimeout(rematchTimer);
  if (closeDrawerTimer) window.clearTimeout(closeDrawerTimer);
  if (lyricsOpenTimer) window.clearTimeout(lyricsOpenTimer);
  if (matchWatchTimer) window.clearInterval(matchWatchTimer);
  // Drops the Escape listener and the page scroll lock along with the overlay.
  if (matchState.open || matchState.overlay) closeMatchPanel();
  lyricsOpenResolve?.();
  for (const cleanup of cleanups.splice(0)) {
    try { cleanup(); } catch {}
  }
  for (const node of document.querySelectorAll(`[${TOGGLE_HOST}], button[${REMATCH_HOST}], button[${CORNER_HOST}], button[${MATCH_ICON_HOST}], [${MATCH_PANEL_HOST}], style[${STYLE_HOST}], style[${MATCH_STYLE_HOST}]`)) {
    try { node.remove(); } catch {}
  }
};
