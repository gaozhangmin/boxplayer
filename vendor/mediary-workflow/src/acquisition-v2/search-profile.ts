import type { MediaType } from "../domain.js";

/**
 * The fine-grained search profile a title falls into — finer than `MediaType`
 * because PanSou keyword strategy differs sharply by region (a US series needs
 * 英文名+Complete; a 国漫 needs +国漫; a movie wants the bare 中文名 and dies on
 * +4K). Derived from `type` + TMDB `origin_country`. See the 2026-06-16 design
 * spec for the per-profile recipes.
 */
export type SearchProfile =
  | "movie"
  | "cn-tv"
  | "us-tv"
  | "kr-tv"
  | "jp-tv"
  | "generic-tv"
  | "jp-anime"
  | "cn-anime"
  | "us-anime"
  | "generic-anime";

// Co-productions list multiple origins; resolve by a fixed precedence and take
// the first match. tv → the 国产/合拍 circle first; anime is JP-centric.
const TV_ORIGIN_PRECEDENCE: Array<[string, SearchProfile]> = [
  ["CN", "cn-tv"],
  ["US", "us-tv"],
  ["KR", "kr-tv"],
  ["JP", "jp-tv"],
];
const ANIME_ORIGIN_PRECEDENCE: Array<[string, SearchProfile]> = [
  ["JP", "jp-anime"],
  ["CN", "cn-anime"],
  ["US", "us-anime"],
];

export function searchProfile(input: {
  type: MediaType;
  originCountries: string[];
}): SearchProfile {
  if (input.type === "movie") {
    return "movie";
  }
  const table = input.type === "anime" ? ANIME_ORIGIN_PRECEDENCE : TV_ORIGIN_PRECEDENCE;
  for (const [country, profile] of table) {
    if (input.originCountries.includes(country)) {
      return profile;
    }
  }
  return input.type === "anime" ? "generic-anime" : "generic-tv";
}

export const SEARCH_PROFILES: readonly SearchProfile[] = [
  "movie",
  "cn-tv",
  "us-tv",
  "kr-tv",
  "jp-tv",
  "generic-tv",
  "jp-anime",
  "cn-anime",
  "us-anime",
  "generic-anime",
];

// Cross-type laws (real PanSou research + 2026-06-17 deep re-research & user
// correction) — ride along on EVERY recipe.
const UNIVERSAL_LAWS = [
  "⓪ raw 裸标题召回最全,系统已预搜好摆进活期文档(viewResourceSnapshot);searchResources 仅用于繁体/英文/原名升级,别拿它重搜 raw。",
  "① 单次返回 0 几乎从不代表无资源:PanSou API 抖动极剧,同一关键词连续两次可 0↔900 来回(实测 Breaking Bad 0→903;斗破苍穹/遮天 曾报 0 实为 140-196)。遇 0 必原样复搜 2-3 次再判,绝不凭单次 0 下『无资源』结论。",
  "② 画质/字幕/年份词不进搜索词:把 4K/1080P/蓝光/中字/字幕/年份 拼进关键词会把召回打成 raw 子集或归零(实测 铁拳教育 84→+1080p=0、奥本海默 185→+中字=0、+2024=0)。画质/中字只在召回后读标题判;系统也会自动 strip 这些词。",
  "③ count ≠ 相关性:读 top 标题确认是目标本体+全集,别只看数量。年份/季只是『活期文档仍不够时』的最后兜底升级键且仅限真人片(动漫忌:归零或拉同名真人版),首选永远是裸标题全量。",
  "④ 子类型词永不进搜索词:+美剧/+韩剧/+日剧/+国产剧/+番剧/+动画 几乎从不帮忙,常把召回打到 0 或顶噪声。唯二例外:国漫的 +国漫(发布标题真带此 tag,用于和真人版同名消歧)、切尔诺贝利 +美剧(裸名全 0 的孤例兜底)。",
  "⑤ 搜索关键词语言跟字幕偏好:偏好中文字幕(默认)→ 外国片(美/日/韩剧、动漫)一律用【中文译名】(活期文档里已是中文译名召回)——中文名资源带中字、且在本站召回更好;偏好原文 → 才用原名/英文名升级(召回大但多无中字)。原名只作中文名仍 0 的升级兜底,且兜底要在结果里挑带中字的,没有则按字幕偏好判弱覆盖。",
].join("\n");

// Per-profile lead strategy (实证:2026-06-16 初版 + 2026-06-17 深度再调研/用户纠偏。
// 核心纠偏:外国片一律裸中文名先行(匹配中文字幕偏好+本站召回更好);0 必复搜
// 2-3 次应对 API 抖动;子类型词基本有害(国漫 +国漫 例外)。)
const PROFILE_RECIPES: Record<SearchProfile, string> = {
  movie:
    "电影:首搜【裸中文名】(进口片用网盘通行译名,续集用中文数字尾:沙丘2/银河护卫队3/壮志凌云2)。0 必复搜(抖动剧烈)。" +
    "同名陷阱→加年份切片:国产片常用字/重名/电视剧子串(默杀→默杀 2024、抓娃娃→抓娃娃 2024、孤注一掷→撞 1969 同名片);进口片通用系列词(蝙蝠侠→蝙蝠侠 2022)、纯数字续集会漂到错的同名续作(阿凡达2→2025 火与烬,改用带副标题全名 阿凡达水之道)。" +
    "弱时英文名仅当英文名本身独特(Full River Red/Killers of the Flower Moon 干净);常用词英文名是灾难(YOLO/Napoleon/Inception/Barbie 全噪声)。避免:中文名+画质(全 0)、+电影 子类型词(抑制结果)。" +
    "中字靠【读标题】判,别把 中字/国语/双语/字幕 拼进关键词(实测普遍砍召回:盗梦 3→1、星际 6→0、沙丘 53→0;中文资源站电影命名用 CHS-ENG/CHS/中英双字/双语/简繁/国粤,不写『中字』)。多数进口片裸中文名首搜就已带中字,读标题挑即可。",
  "cn-tv":
    "国产剧:首搜【裸中文名】(8/10 把『全N集/COMPLETE』包顶 top)。0 必复搜(隐秘的角落 0↔20)。" +
    "同名常用字(三体/狂飙/山海情)→ +年份 收窄。多季剧裸名一次召回所有季全集包,严禁逐季(庆余年 第二季→坍缩到 1 条)。" +
    "避免:+国产剧/电视剧 子类型词(10/10 从未帮忙、只增噪)、裸英文(撞海量英美剧)、画质词当搜索键。",
  "us-tv":
    "美剧:首搜【裸中文译名】(实测 权力的游戏83/绝命毒师83/怪奇物语129 命中且带中字;英文名 surface 的多是无中字的 scene 包,对中文用户没用)。0 必复搜(Breaking Bad 实测 0↔903)。" +
    "锁缺季→中文名+第N季(权力的游戏 第八季 101 全对)。英文名仅『中文名复搜仍 0』的最后兜底,且必须在英文结果里挑带中字(内封/外挂简繁中字)的,没有就按字幕偏好判弱覆盖。" +
    "避免:中文名+美剧(实测 0 胜 7、纯有害)、裸英文名当首选(无中字+抖动 0↔900)。切尔诺贝利是孤例:裸中/裸英全 0,只能 切尔诺贝利 美剧 / 切尔诺贝利 1080P。",
  "kr-tv":
    "韩剧:首搜【裸中文译名】(译名基本统一)。0 必复搜。" +
    "同名常用字(王国/信号)→ +年份(信号 2016→#1);多季→+中文季号(顶楼 第三季);译名太冷门召不回(衣袖红镶边)→英文原名(The Red Sleeve)。" +
    "避免:+韩剧 子类型词(5+/10 直接打成 0)、常用词英文名当首搜(Kingdom/Penthouse/Signal 撞海量同名噪声)、画质词当首选。",
  "jp-tv":
    "日剧:首搜【裸中文通用正名】——译名多版不统一是最大坑(Silent=静雪、Legal High=胜者即是正义,用错被同名英美剧/AV 淹没)。0 必复搜。" +
    "被同名淹→英文/罗马名(静雪→Silent、非自然死亡→Unnatural);裸名混进动漫→+年份降噪(重启人生→重启人生 2023)。" +
    "避免:+日剧(归零或全噪)、单词型英文名(Silent 被淹)、片假名(AV 污染)。库存盲区敢判无货(大豆田永久子/宽松世代TV剧本就无货),别换词瞎搜。",
  "generic-tv":
    "电视剧(地区未定):首搜【裸中文名/译名】。0 必复搜。弱时 +年份 降噪;像美剧再退英文名兜底(挑带中字的)。避免:+子类型词、画质词当搜索键。",
  "jp-anime":
    "日漫:首搜【裸中文译名】(9/10 字幕组合集顶 top,LoliHouse/DBD-Raws/喵萌)。0 必复搜 1-2 次(索引 flaky:葬送的芙莉莲 0→117、莉可丽丝 0→102)。" +
    "被同名压(莉可丽丝撞无关美剧)→ 标准连写罗马音(Lycoris Recoil/Jujutsu Kaisen/Frieren;Kimetsu no Yaiba、Bocchi the Rock=0,空格脆,命中才用);锁季/篇在已召回候选里读标题挑,别拼进关键词(AND 匹配会塌缩)。" +
    "避免:+番剧/+动画 子类型词(把 100+ 候选打到 0:咒术回战 番剧→0)、+年份(脆且偏:鬼灭2019→19、间谍2022→0)、+4K(归 0;要画质看标题或 +1080P)。",
  "cn-anime":
    "国漫:首搜【裸中文名】(实测 斗破苍穹140/遮天196——调研里报的 bare=0 是 API 抖动,别信)。0 必复搜。" +
    "国漫常与真人版/网文同名:裸名若被真人版/同名噪声占据(完美世界→突袭/犯罪记录、凡人修仙传→真人版顶 top、一人之下→异人之下)→ 加 +国漫 收窄到 GM-Team 干净季包(国漫专属真实 tag);一人之下中文名彻底死(连+国漫都 0)→罗马音 Hitori no Shita;GM-Team tag 里的官方英文名(Battle Through the Heavens/Renegade Immortal)可兜底。" +
    "避免:+动画(混日漫/电视剧)、+番剧/年番/第N季、+年份(危险:拉同名真人版,如 异人之下)。",
  "us-anime":
    "美漫:首搜【裸中文译名】,带间隔号·很关键(哈莉·奎茵→348 净 vs 哈莉奎茵→4 噪);紧凑名不插空格(变形金刚领袖之证 有货、加空格→0)。0 必复搜。" +
    "中文名 <5 条或全噪→裸英文名+Complete/Season 兜底(BoJack Horseman/The Simpsons/Futurama/Adventure Time,召回大但多无中字、对中文用户算弱覆盖);中文网络简称用全名(爱死机→爱死亡和机器人);要中字→中英混合探针(探险活宝 Adventure→外挂简繁中英)。" +
    "避免:+美剧/+动画 子类型词(瑞克和莫蒂 50→7、无敌少侠 127→0)、画质词救零结果(辛普森一家 1080P 仍 0)、罗马音/拼音/自造译名。",
  "generic-anime":
    "动画(地区未定):首搜【裸中文译名】。0 必复搜 1-2 次(动漫索引 flaky)。被同名压→标准连写罗马音兜底;锁季读标题挑。避免:+番剧/+动画、+年份(动漫忌)、+4K(归 0)。",
};

/** The search-strategy hint injected per title (and mirrored in skill.ts). */
export function getSearchRecipe(profile: SearchProfile): string {
  return `${PROFILE_RECIPES[profile]}\n\n通用铁律:\n${UNIVERSAL_LAWS}`;
}

/** Profiles where real 4K genuinely exists (research 证据 2). Everything else
 *  tops out at 1080p — telling the agent so prevents over-searching for 4K that
 *  isn't there (the original "机械逼 4K→过度搜索→撞限" incident). */
const HI_REACHABLE: ReadonlySet<SearchProfile> = new Set([
  "movie",
  "cn-tv",
  "us-tv",
  "kr-tv",
  "generic-tv",
  // 国漫真 4K 存在(GM-Team HEVC=4K、ColorTV/SeeWEB 4K WEB-DL),不是 1080p 天花板。
  "cn-anime",
]);

const QUALITY_KEYWORD_LAW =
  "画质只在召回后读标题判,绝不进搜索关键词(进了会过滤掉标题匹配、还跑偏到同画质的错作品)。";

/**
 * The per-profile quality-preference guidance injected into the system prompt as
 * a 召回后选片优先级 (NOT a search term). "" when the user has no preference
 * (不限/undefined). The guidance always subordinates quality to coverage, and —
 * for profiles where 4K is scarce — actively tells the agent NOT to over-search
 * for it (1080p is the realistic ceiling there).
 */
export function getQualityGuidance(
  profile: SearchProfile,
  preference: "high" | "medium" | undefined,
): string {
  if (preference === undefined) {
    return "";
  }
  if (preference === "medium") {
    return (
      "画质偏好:中(≈1080P)。召回后优先选 1080P / 蓝光(BluRay/BDRip)的【可播放视频文件】(mkv/mp4),有 1080P 时别选 720p/枪版。" +
      // CEILING (mirrors `high`'s two-sidedness). 中 不是只守下限——更要守上限:
      // over-spec 的 2160p/4K/REMUX/原盘 体积动辄数十上百 GB,会塞爆配额。
      // 画质 token 就写在候选标题里,所以这是【转存前/落盘前】读标题就能做的判断——
      // 根本不去转那个巨型文件,而不是转完再删(115 删除=进回收站、30天才真删、
      // 期间仍占配额、手动清还要6位密码,删了重搜重转只会短期堆积占用更高)。
      "⚠️ 上限:看标题就要【避免】2160p / 4K / UHD / REMUX / 蓝光原盘 / ISO / BDMV——这些远超 1080P 目标、体积巨大,转存前读标题判出就直接跳过、不取(绝不先转再删)。" +
      "1080P 几乎各类都有,正常都能满足。但覆盖永远优先:实在【只】有更低画质(720p 等)也照样取下来,绝不为画质留缺;反之实在【只】有 4K/原盘也别为了凑覆盖去转那个巨型文件——优先继续找 1080P 版本。" +
      "🈶 中字例外:若同档(1080P)没有带中文字幕的候选、而高一档(如 4K)有中文字幕,可为中字【破一档】取那个 4K 中字版(中字 > 画质档);但仍只破一档——蓝光原盘 / REMUX / ISO / 整盘镜像照旧避开,不为中字无限抬。" +
      QUALITY_KEYWORD_LAW
    );
  }
  // high
  const head =
    "画质偏好:高(≈4K)。召回后优先选 2160p / 4K / UHD / REMUX 的【可播放视频文件】(mkv/mp4,带 HDR/杜比视界更佳)。" +
    "⚠️ 避免蓝光原盘 / ISO / BDMV 整盘镜像:它动辄上百GB、多数设备无法直接播放,且不是单个视频文件——宁取 4K REMUX 视频,退一步取更低画质的视频版本,也不要整盘镜像。";
  const tail =
    "覆盖永远优先于画质:找不到 4K 就退取 1080P/蓝光视频,绝不为画质放弃任何一集/这部片。" + QUALITY_KEYWORD_LAW;
  if (HI_REACHABLE.has(profile)) {
    return head + "这类内容真 4K 通常存在,值得在已召回候选里挑高的。" + tail;
  }
  return (
    head +
    "但这一类真 4K 极少甚至没有,1080P/蓝光通常就是现实天花板——不要为追 4K 反复改词搜索或加搜,那只会过度消耗预算/撞限。" +
    "已召回候选里有 4K 就取、没有就直接取最佳 1080P。" +
    tail
  );
}

const ANIME_PROFILES: ReadonlySet<SearchProfile> = new Set([
  "jp-anime",
  "cn-anime",
  "us-anime",
  "generic-anime",
]);

/**
 * 病2b（2026-07-06 攻壳事故）：动漫搜索纪律从「提示词里的禁忌」升级为校验器
 * ——但只 WARN 不阻断（个别老番年份真有用、罗马音兜底是配方明令的合法手段;
 * 硬拒会误伤，警告 + 模型自辩即可）。检查三条已立纪律：
 *  ① 动漫忌年份（jp: 脆且偏; cn: 危险、拉同名真人版）
 *  ② 子类型词（番剧/动画/动漫）几乎必砍召回——唯一例外 cn-anime 的 +国漫
 *  ③ 片名之外的拉丁附加词疑似跨系列（ARISE 拉走整个平行系列）
 */
export function animeSearchTabooWarnings(input: {
  keyword: string;
  profile: SearchProfile;
  titleTerms: readonly string[];
}): string[] {
  if (!ANIME_PROFILES.has(input.profile)) {
    return [];
  }
  const warnings: string[] = [];
  const lowerTerms = input.titleTerms.map((t) => t.toLowerCase());

  // 出现在片名/别名里的 4 位数字不是禁忌年份，是名字本身（SAC_2045 / 2046 /
  // Blade Runner 2049）——问询判卷抓出的误伤面，豁免。
  const foreignYears = [...input.keyword.matchAll(/(?:19|20)\d{2}/g)]
    .map((m) => m[0])
    .filter((year) => !input.titleTerms.some((term) => term.includes(year)));
  if (foreignYears.length > 0) {
    warnings.push(
      "⚠️ 关键词含 4 位年份——动漫忌年份（召回归零或拉同名真人版，见搜索配方）。除非你有明确证据这是必要消歧，否则去掉年份重搜。",
    );
  }

  const subtypeWords = ["番剧", "动画", "动漫", "国漫"].filter((w) => input.keyword.includes(w));
  for (const word of subtypeWords) {
    if (word === "国漫" && input.profile === "cn-anime") {
      continue; // 配方明令的真实 tag 消歧词（GM-Team 季包）。
    }
    warnings.push(`⚠️ 关键词含子类型词「${word}」——几乎必砍召回（咒术回战 番剧→0，见搜索配方）。用裸标题。`);
  }

  for (const match of input.keyword.matchAll(/[A-Za-z][A-Za-z0-9'&-]{2,}/g)) {
    const token = match[0].toLowerCase();
    if (!lowerTerms.some((term) => term.includes(token))) {
      warnings.push(
        `⚠️ 关键词带了片名之外的附加词「${match[0]}」——若这是另一部系列作品名（前传/剧场版/衍生），它不在本次目标内，会把搜索拉去隔壁系列；若这是本作官方别名/罗马音则可忽略本警告。`,
      );
    }
  }
  return warnings;
}
