import { generateText, type LanguageModel, type ModelMessage } from "ai";

/**
 * Phase 5.5 — the §6a interrogation harness. BEFORE spending real money / touching
 * real 115, we verify the agent is "聪明" (like the hermes run): we ASK it how it
 * would handle the Lycoris-Recoil edge cases and read its reasoning, with NO tools
 * and NO side effects. The questions are a running conversation so the agent's
 * context builds the way it would in a real task. The human judges the answers and
 * tunes the prompt until they stably match the requirements — only then 6b/live.
 */

export interface InterrogationQuestion {
  id: string;
  /** The question put to the agent. */
  prompt: string;
  /** What a correct (hermes-like) answer should show — for the human reviewer. */
  expectation: string;
}

export const INTERROGATION_QUESTIONS: readonly InterrogationQuestion[] = [
  // Open-ended walkthroughs FIRST (empty context) — the truest test of whether the
  // agent reads its skill on its own and drives the WHOLE loop, vs filling in a
  // scaffolded questionnaire that hints at the answer.
  {
    id: "open_movie_walkthrough",
    prompt:
      "你现在的任务:获取电影《奥本海默》(2023)。请只用【中文文字】描述你的完整打算——从零开始按 1. 2. 3. 列出你会【依次调用哪个工具、为什么】,直到这部电影入库,不要省略任何步骤。⚠️ 这是问询不是执行:绝对不要真的调用工具、不要输出任何 tool_call 或函数调用语法,就用文字把你的计划讲清楚。",
    expectation:
      "主动先 readSkill(movie + protocol);再 search(裸标题优先、别一上来带年份)→证据先行选对片(对年份、防翻拍、剔除同名不同作品)→对多个同片转存分享按最优排序用 transferUntilLanded(只收 fail-loud 转存分享链 115/夸克/天翼/123,磁力不行、第一个秒传即停),或单个/磁力用 transferCandidate→inspectStaging 验是正片→flattenMovie(自动挖视频+字幕、删壳)→deleteFiles 清花絮→markObtained([\"MOVIE\"])(最后一步)→finish。重点看:是否真去读 skill、是否用 flattenMovie、面对多个黑盒死链是否会用 transferUntilLanded 让系统替它穿透死链(而不是一个个手动试)。",
  },
  {
    id: "open_tv_walkthrough",
    prompt:
      "你现在的任务:用户要获取《绝命毒师》全 5 季,缺集横跨多个季,PanSou 只有一个『全五季』嵌套全集包。请只用【中文文字】描述你的完整打算——从零开始按 1. 2. 3. 列出你会【依次调用哪个工具、为什么】,直到入库,不要省略任何步骤。⚠️ 这是问询不是执行:绝对不要真的调用工具、不要输出任何 tool_call 或函数调用语法,就用文字把你的计划讲清楚。",
    expectation:
      "主动先 readSkill(tv + protocol);再 search→认出全集包只转一次→inspectStaging 看嵌套→先把整盘分发计划想好(Evidence→Facts→Decision:每个缺集→对应文件+字幕→哪个季)→一次 moveToSeason({moves:[每季一条]}) 只搬缺集、字幕同季、已有季不复制→inspectTargetDir 验收→markObtained→discardStaging→finish。重点看:是否真读 skill、是否先规划再一次性批量分发。",
  },
  {
    id: "first_step",
    prompt: "现在让你获取莉可丽丝(Lycoris Recoil)第一季,你第一步做什么?",
    expectation: "从一个合理关键词搜索开始,先判断证据,而不是盲目转存。",
  },
  {
    id: "full_season_pack",
    prompt:
      "假设 PanSou 返回了这批候选,其中有一个明确的『莉可丽丝 全集 1080p』完整全季包,还有若干分集包。你还继续搜吗?还是转存?转哪个?会转多个覆盖全季的资源吗?",
    expectation: "认出全季包、只转这一个、不再搜、不堆叠多个覆盖全季的包(直接照出莉可丽丝事故会不会复现)。",
  },
  {
    id: "verify_landed",
    prompt: "转存之后,你怎么确认资源真的落盘了,而不是凭转存返回值就当成功?",
    expectation: "调用只读目录工具(inspectStaging/inspectTargetDir)看 staging/Season 的真实状态,信回读证据。",
  },
  {
    id: "staging_classification",
    prompt: "inspectStaging 显示 staging 里除了正片,还有字幕、特典(NCOP/SP),以及一个疑似别的作品的视频。你怎么处理这些?",
    expectation: "分类:挖正片进 Season、隔离异作品待人工复核、残留显式归类不静默留;绝不把异作品自动映射成某集。",
  },
  {
    id: "mark_obtained",
    prompt: "你怎么标记某一集已获取?在标记之前你需要确认什么?",
    expectation: "markObtained 是最后一步:先 move 进对应季目录、flatten 清壳,看 inspectTargetDir 确认正片此刻就位,才声明已获取的 codes;不靠文件名编码身份、不维护映射层、不指望系统机械回读替你核。",
  },
  {
    id: "overlapping_ranges",
    prompt: "假设没有刚好的全季包,只有 1-10、8-13、12-20 这种重叠分集。你怎么办?扁平化后出现重复集怎么处理?",
    expectation: "组合最少的非冗余范围覆盖全季、扁平化、看到重复按真实大小分组保大删小(Life Tree),用智能不用正则。",
  },
  {
    id: "dead_link",
    prompt: "假设你选的一个候选转存失败/是死链(回读 staging 是空的)。你怎么办?",
    expectation: "把失败当证据、换一个覆盖该缺口的候选重新决策,不机械顺着 provider 顺序往下试。",
  },
  {
    id: "daily_patrol_latest_only",
    prompt:
      "每日巡检场景:这一季你只缺最新一集 S01E13,但唯一覆盖它的资源是一个含全集(1-13)的包。你怎么办?会不会把已有的 1-12 又复制一遍?",
    expectation: "转该包但只把缺的最新集挖进去/只留最新集,其余与已有重复的按保大删小,不无谓地把已有集复制一遍。",
  },
  {
    id: "multi_season_pack",
    prompt:
      "换个剧:你要获取《绝命毒师》全部 5 季,缺集横跨多个季。PanSou 返回一个『绝命毒师 全五季』完整包(里面是 Season 1 / Season 2 / ... 的嵌套目录)。你怎么转?转存后怎么把文件放进各自的季目录?",
    expectation:
      "只转这一个全集包(一次);转存后看真实 staging 的嵌套结构,提交一个分发计划 moveToSeason({moves:[{season,fileIds}]})、每季一条 move 把文件分发进它自己的 Season 目录(每个视频的字幕跟它同季同在 fileIds 里),而不是全堆在一个目录。",
  },
  {
    id: "partial_seasons_full_pack",
    prompt:
      "你只缺第 2 季的 S02E13 一集,但唯一覆盖它的资源是含全 5 季的全集包。你怎么办?会不会把已经有的其他季(第1、3、4、5季)又复制一遍?",
    expectation:
      "转全集包,但只把缺的 S02E13 挖进第 2 季目录;先用 inspectTargetDir(season) 看各季已有什么,已覆盖的季绝不复制;staging 里其余季的文件按残留处理,不搬不复制。",
  },
  {
    id: "ongoing_plus_completed_gap",
    prompt:
      "一部多季剧:第 1-3 季已完结,但第 2 季当年漏了 S02E07 没拿到;第 4 季正在更新,已播到 S04E05,S04E06 还没播出。用户要『获取全剧』。你对各季分别怎么处理?",
    expectation:
      "把第 2 季缺的 S02E07 补上(完结季的缺集);第 4 季把已播的缺集补到 S04E05,S04E06 未播出=不算缺、不去找、留着等以后巡检;绝不把未播集当缺集,绝不虚构。状态(缺/补齐)是按应有vs实有自然算的。",
  },
  {
    id: "unobtainable_completed_gap",
    prompt:
      "某个已完结季缺一集,但你认真搜了各种关键词,资源市场就是没有任何资源覆盖它。你怎么办?",
    expectation:
      "诚实留缺口:finish/reportNoCoverage 时如实标它仍缺,绝不虚构覆盖、绝不乱转个不含它的包凑数;这一集留给下次巡检再试。",
  },
  {
    id: "only_some_remaining_seasons",
    prompt:
      "用户已经在追踪第 1 季,现在他在前端只点了要获取第 3 季和第 5 季(不要第 2、4 季)。你这次任务的获取范围是什么?会不会顺手把第 2、4 季也获取了?",
    expectation:
      "need 只含第 3、5 季的缺集,只往第 3、5 季目录落;绝不碰第 1、2、4 季,绝不自作主张多获取用户没点的季。",
  },
  // 2026-07-06 获取循环四病（攻壳事故 run 7bc9dbf3）——新工具语义的理解验收:
  {
    id: "terminal_no_coverage",
    prompt:
      "你认真搜索并核对后确认资源市场确无该作品的任何覆盖,于是调用 reportNoCoverage 上报,返回成功。接下来你还会做什么?还需要再 readSkill 复查、再上报一次、或调用 finish 吗?",
    expectation:
      "认得工具描述里的 TERMINAL 语义:上报成功=任务立即结束,不再有任何后续动作——绝不二次上报(攻壳事故的 2.5 分钟死尾巴)、不需要也不能再 finish。",
  },
  {
    id: "repeat_search_notice",
    prompt:
      "你调用 searchResources 搜某关键词,返回里带着提示:「⚠️「莉可丽丝」已是第 2 次搜索(结果与上次相同,共 20 候选)。换实质不同的新词,或立即基于已有证据决策。」你接下来怎么做?",
    expectation:
      "明白重复同词只会拿到同一快照、白烧轮次;要么换【实质不同】的新词(繁体/英文/罗马音升级,不是加空格换标点),要么立即基于已有 20 候选做决策(转存或上报);绝不第三次搜同词。",
  },
  {
    id: "taboo_warning_reaction",
    prompt:
      "动漫任务里,你搜「攻壳机动队 ARISE」和「攻壳机动队 2020」,返回里带 warnings:一条说关键词带了片名之外的附加词「ARISE」疑似另一部系列作品,一条说动漫忌 4 位年份。你怎么处理这两条警告?",
    expectation:
      "把警告当搜索纪律的校验信号:年份直接去掉重搜(动漫加年份召回归零或拉真人版);ARISE 先核对它是否属于本次目标作品——若是隔壁衍生系列就放弃该词(跨系列会把任务拉偏),若确认是本作官方别名/罗马音可说明理由继续。不无视警告,也不因警告就中止任务。",
  },
  {
    id: "digest_hint_reaction",
    prompt:
      "你换了个新关键词搜索,返回里前置了一句:「提示:上一快照「攻殻機動隊」有 58 个候选尚未筛过——候选列表就在你此前那次 searchResources 的返回里,回读不花预算;先消化再换词通常更快。」你接下来怎么做?",
    expectation:
      "先回头消化那 58 个候选(回读自己先前 searchResources 返回的候选列表,不花预算),读标题判断里面有没有目标本体/全集包,消化完再决定是否需要继续换词——而不是继续换词穷搜(攻壳事故:58 候选没筛就连搜 19 次)。",
  },
];

export interface InterrogationEntry extends InterrogationQuestion {
  answer: string;
}

export interface RunInterrogationRequest {
  model: LanguageModel;
  /** The task agent's real system prompt (so we interrogate the SHIPPING prompt). */
  systemPrompt: string;
  /** A short scenario framing (target title / season / missing episodes). */
  scenario: string;
  /** Optional: ask only these question ids (e.g. just the movie walkthrough). */
  only?: string[];
}

/**
 * Put the questions to the agent as ONE running conversation (no tools, no side
 * effects) and collect its answers for the human to judge.
 */
export async function runInterrogation(
  request: RunInterrogationRequest,
): Promise<InterrogationEntry[]> {
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: `${request.scenario}

我现在不是让你真的动手,而是要"问询"你的判断。下面我会一个个问你遇到具体情况会怎么做,请用中文清楚说明你的推理和会调用哪些工具、为什么。不要假装已经执行,只描述你的打算。`,
    },
  ];
  const transcript: InterrogationEntry[] = [];
  const questions = request.only
    ? INTERROGATION_QUESTIONS.filter((q) => request.only!.includes(q.id))
    : INTERROGATION_QUESTIONS;
  for (const question of questions) {
    messages.push({ role: "user", content: question.prompt });
    const result = await generateText({
      model: request.model,
      system: request.systemPrompt,
      messages,
    });
    messages.push({ role: "assistant", content: result.text });
    transcript.push({ ...question, answer: result.text });
  }
  return transcript;
}
