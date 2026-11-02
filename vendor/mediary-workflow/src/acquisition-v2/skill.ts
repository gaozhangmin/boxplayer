/**
 * The acquisition SKILL — the agent's on-demand manual.
 *
 * This is the original clawd-media-track skill (SKILL.md + references/) LOCALIZED
 * to the V2 sandbox: every mechanic is re-expressed in the sandbox tools
 * (searchResources / transferCandidate / inspectStaging / inspectTargetDir /
 * moveToSeason / deleteFiles / markObtained / flattenMovie / discardStaging /
 * finish / reportNoCoverage) and scoped handles — never raw pan115 calls, raw cids,
 * manual directory creation, or the original Mac/openclaw runtime. The depth and
 * the hard-won lessons are kept; the machinery is translated.
 *
 * It is read on demand (progressive disclosure, the way Vercel/Anthropic agent
 * skills work — name+section first, full body when the situation calls for it)
 * via the readSkill sandbox tool, so the agent has a HARD reference DURING its
 * loop, not just a static system prompt. Embedded as constants (not loose .md)
 * so it ships reliably in the compiled package.
 */

const PROTOCOL = `# Method protocol (read this before you act)

You drive your own observe → act → verify loop through the sandbox tools. "Intelligence" means: read the evidence the tools actually returned and decide in plain words — NOT acting on a hunch, and NOT firing many side effects before you have looked at what landed.

## Evidence → Facts → Decision (at EVERY decision point)
Before any transferCandidate / moveToSeason / deleteFiles / markObtained, lay out an auditable chain:
1. Evidence: the candidates or files the tools returned — ALL of them, with their id and title/name (and size when shown). Never a top-N sample; searchResources and inspectStaging return everything precisely so you judge from everything.
2. Facts (plain words): what each one actually is — which missing episodes a candidate's title covers; for a movie whether it IS this film and year; whether it is transparent (states size/resolution/episodes/group) or opaque.
3. Decision: from those facts, the SMALLEST set of candidates that covers the whole need.
If you cannot state (1) and (2), you may not proceed.

## Decide the covering set, THEN transfer it — do NOT grope one at a time
- searchResources is a DECISION point: search (re-keyword if the first was weak — add the year, the original title, "全集"/"complete") until your gathered candidates can cover the WHOLE need, then STOP searching. Once you can cover the need, more searching is pure waste. EVERY keyword MUST contain the title or an alias — never a bare genre/year fallback like "电影 2026" or "2026 电影": those name no title, only return noise, and the tool REJECTS them. If the title finds nothing after honest re-keywording, that is no-coverage — report it, do not flail at generic keywords.
- Choosing WHICH candidates to transfer is the DECISION; transferring them is EXECUTION. Once you have decided the covering set, transfer those candidates one after another (each is its own transferCandidate call — that is simply how the tool works) WITHOUT searching again in between. NEVER transfer-one → search-again → transfer-one: that is the over-search that hammers 115's call budget.
- After the transfers land, inspectStaging is a DECISION point again: read the TRUE files, then move / dedup / mark.

## No gambling, no "just in case"
- If a candidate's title does not clearly cover a missing episode (or clearly is not this film), treat it as NOT covering and skip it. Do not transfer "to see what is inside" / "先转再说，没有就删" / "万一有隐藏集".
- If a title explicitly limits its range ("更新至03集", "1-3集") and your missing episode is beyond it → skip immediately.
- If you ever transfer something that turns out not to cover, you OWN the cleanup: classify and remove the staging mess with deleteFiles; never leave staging polluted.

## Honesty
A truly-missing item with NO covering resource anywhere — after a real search — is an honest gap: leave it missing (finish / reportNoCoverage) for the next patrol. Never fabricate coverage; never mark something that is not present. The user values an honest failure over a fake success.`;

const DEAD_LINKS_BLACK_BOX = `# Dead links, magnets, and black-box resources

> 提醒:raw 候选已预搜好,先 viewResourceSnapshot() 通读活期文档再动手;searchResources 只用于繁体/英文升级,别拿画质/字幕词搜。

## What "landed" means
transferCandidate returns the TRUE materialized files (the system rereads for you). Trust THAT, not your prediction.
- A 115 share that transfers without error has landed.
- A 115 share fails LOUD with a clear reason — the real ones you will see: "链接已过期" (expired), "分享已取消" (cancelled), "访问码错误" (wrong access code), "错误的链接" (bad/malformed link). All = dead. Switch to another covering candidate — a dead link is the NORM, never a reason to give up; try the next resource that covers the need. (For a movie, transferUntilLanded over your ranked 115 shares burns through these dead ones automatically.)
- A magnet can SILENTLY fail: no error, yet nothing materializes. Trust the staging reread — if nothing landed, it is dead; move on to a 秒传-able candidate instead of waiting (the account's value is instant transfer, not a slow download).
- **SYSTEMIC BLOCK** (别甩锅): when a transfer fails with "云下载配额不足" / "登录超时" / "请升级VIP" / "鉴权失败" — the resource EXISTS but the ACCOUNT is blocked (quota / auth / VIP). The tool result carries \`systemicBlock: { reason: "..." }\`. **立即停 — DO NOT keep transferring.** Every candidate will fail the same way. Report honestly: the resource was found, the account cannot transfer it (not "no resource"). This is actionable (top up quota / re-login), never blame the resource.

## Black-box gate (this is exactly where the 奥本海默 run failed)
"Transparent" = the title states size / resolution / episodes / release group (e.g. "The.Dark.Knight.2008.2160p.BluRay.FGT 16.68GB"). "Black-box / opaque" = a bare name ("名称: 奥本海默") or a vague bundle ("【变形金刚系列】1~5部").
- If a TRANSPARENT candidate clearly covers the need, select ONLY it and STOP. Do NOT also transfer opaque ones "just in case".
- ONLY when ZERO transparent candidate covers the need may you fall back to a black-box one. When you do, your VERY NEXT step after it lands MUST be inspectStaging to VERIFY it actually holds the target (the right film / the missing episodes) — black-box coverage is UNPROVEN until you read the real files.
  - Verified to cover → process it (move / dedup / mark) and finish. Do NOT keep searching for a "better" one.
  - Does not cover → treat it as a dead candidate, clean its staging residue with deleteFiles, try the next.
- For an ongoing show's just-aired episode, a black-box resource whose publish time predates that episode's air time almost certainly does NOT contain it — do not bet on it.`;

const DEAD_LINKS_BLACK_BOX_QUARK = `# Dead links, 转存, and black-box resources (夸克网盘)

> 提醒:raw 候选已预搜好,先 viewResourceSnapshot() 通读活期文档再动手;searchResources 只用于繁体/英文升级,别拿画质/字幕词搜。

## How transfer works on THIS drive (夸克)
The drive is 夸克网盘. Every candidate is a 夸克分享链 (pan.quark.cn/s/<id>) — a 转存分享 (the 115-秒传 equivalent): the system exchanges the share token, lists the share, and saves its files into staging. transferCandidate returns the TRUE materialized files (the system rereads for you). Trust THAT, not your prediction.

## 无磁力 (this is the key difference from 115)
夸克 has NO magnet / offline-download web API. So there are NO magnet candidates here (the resource provider only surfaces 夸克分享链), and a magnet would fail LOUD ("QUARK_NO_MAGNET") if ever forced. There is therefore NO "magnet silently fails / wait for download" nuance at all — every candidate is an instant 转存分享 that either lands or fails loud.

## Fail-loud (a dead / expired / wrong share)
A 夸克分享 fails LOUD with a clear reason — switch to another covering candidate:
- "分享不存在" (code 41006), "分享已取消 / 已失效 / 已过期", "提取码错误 / 需要提取码". All = dead.
A dead link is the NORM, never a reason to give up — try the next 夸克分享 that covers the need. For a movie, transferUntilLanded over your ranked 夸克分享 burns through the dead ones automatically (it relies on this loud failure, exactly like the 115 path).

## SYSTEMIC BLOCK (别甩锅)
When a 夸克转存 fails with a SYSTEMIC message — "配额不足" / "额度已用完" / "VIP会员" / "登录" / "鉴权" — the resource EXISTS but the ACCOUNT is blocked (quota / auth / VIP). The tool result carries \`systemicBlock: { reason: "..." }\`. **立即停 — DO NOT keep transferring.** Every candidate will fail the same way. Report honestly: the resource was found, the account cannot transfer it (not "no resource"). This is actionable (top up / re-login), never blame the resource.

## Black-box gate (same discipline as 115)
"Transparent" = the title states size / resolution / episodes / release group. "Black-box / opaque" = a bare name or a vague bundle.
- If a TRANSPARENT 夸克分享 clearly covers the need, select ONLY it and STOP. Do NOT also transfer opaque ones "just in case".
- ONLY when ZERO transparent candidate covers may you fall back to a black-box one. When you do, your VERY NEXT step after it lands MUST be inspectStaging to VERIFY it actually holds the target — black-box coverage is UNPROVEN until you read the real files.
  - Verified to cover → process it (move / dedup / mark) and finish. Do NOT keep searching for a "better" one.
  - Does not cover → treat it as a dead candidate, clean its staging residue with deleteFiles, try the next.`;

const DEAD_LINKS_BLACK_BOX_TIANYI = `# Dead links, 转存, and black-box resources (天翼云盘)

> 提醒:raw 候选已预搜好,先 viewResourceSnapshot() 通读活期文档再动手;searchResources 只用于繁体/英文升级,别拿画质/字幕词搜。

## How transfer works on THIS drive (天翼)
The drive is 天翼云盘. Every candidate is a 天翼分享链 (cloud.189.cn/t/<code>) — a 转存分享 (the 115-秒传 equivalent): the system SHARE_SAVE's the share (getShareInfo → listShareDir → createBatchTask{type:SHARE_SAVE} → checkBatchTask 轮询) and saves its files into staging. transferCandidate returns the TRUE materialized files (the system rereads for you). Trust THAT, not your prediction.

## 无磁力 (this is the key difference from 115)
天翼 has NO magnet / offline-download web API. So there are NO magnet candidates here (the resource provider only surfaces 天翼分享链), and a magnet would fail LOUD ("TIANYI_NO_MAGNET") if ever forced. There is therefore NO "magnet silently fails / wait for download" nuance at all — every candidate is an instant 转存分享 that either lands or fails loud.

## Fail-loud (a dead / expired / access-code share)
A 天翼分享 fails LOUD with a clear reason — switch to another covering candidate:
- "分享不存在" / "ShareNotFound", "分享已失效 / 已过期", "需要提取码 / 提取码错误". All = dead (or un-openable without a code you don't have).
A dead link is the NORM, never a reason to give up — try the next 天翼分享 that covers the need. For a movie, transferUntilLanded over your ranked 天翼分享 burns through the dead ones automatically (it relies on this loud failure, exactly like the 115 path).

## SYSTEMIC BLOCK (别甩锅)
When a 天翼转存 fails with a SYSTEMIC message — "配额不足" / "额度已用完" / "VIP会员" / "登录" / "鉴权" — the resource EXISTS but the ACCOUNT is blocked (quota / auth / VIP). The tool result carries \`systemicBlock: { reason: "..." }\`. **立即停 — DO NOT keep transferring.** Every candidate will fail the same way. Report honestly: the resource was found, the account cannot transfer it (not "no resource"). This is actionable (top up / re-login), never blame the resource.

## Black-box gate (same discipline as 115)
"Transparent" = the title states size / resolution / episodes / release group. "Black-box / opaque" = a bare name or a vague bundle.
- If a TRANSPARENT 天翼分享 clearly covers the need, select ONLY it and STOP. Do NOT also transfer opaque ones "just in case".
- ONLY when ZERO transparent candidate covers may you fall back to a black-box one. When you do, your VERY NEXT step after it lands MUST be inspectStaging to VERIFY it actually holds the target — black-box coverage is UNPROVEN until you read the real files.
  - Verified to cover → process it (move / dedup / mark) and finish. Do NOT keep searching for a "better" one.
  - Does not cover → treat it as a dead candidate, clean its staging residue with deleteFiles, try the next.`;

const DEAD_LINKS_BLACK_BOX_PAN123 = `# Dead links, 转存, and black-box resources (123网盘)

> 提醒:raw 候选已预搜好,先 viewResourceSnapshot() 通读活期文档再动手;searchResources 只用于繁体/英文升级,别拿画质/字幕词搜。

## How transfer works on THIS drive (123)
The drive is 123网盘. Every candidate is a 123 分享链 (123pan.com/s/<key> — 123684/123865/123912 等镜像域也是真的,一样能转;提取码在 pwd) — a 转存分享 (the 115-秒传 equivalent): the system opens the share, lists its files, and 秒传复制s them into staging via a server-side async copy, then re-lists the target until the copy settles (the bounded polling is built in — you do NOT wait or poll yourself). transferCandidate returns the TRUE materialized files (the system rereads for you). Trust THAT, not your prediction.

## 无磁力 (this is the key difference from 115)
123 has NO magnet / offline-download API (v1). So there are NO magnet candidates here (the resource provider only surfaces 123 分享链), and a magnet would fail LOUD ("PAN123_NO_MAGNET") if ever forced. There is therefore NO "magnet silently fails / wait for download" nuance at all — every candidate is a 转存分享 that lands, fails loud, or — rarely — reports no_target_change (see below).

## Fail-loud (a dead / cancelled / wrong-code share)
A 123 分享 fails LOUD with a clear reason — switch to another covering candidate:
- "分享为空 / 已失效" (the system's own empty/dead-share report), "分享不存在", "分享已取消 / 链接失效 / 已过期", "提取码错误 / 需要提取码". All = dead.
A dead link is the NORM, never a reason to give up — try the next 123 分享 that covers the need. For a movie, transferUntilLanded over your ranked 123 分享 burns through the dead ones automatically (it relies on this loud failure, exactly like the 115 path).

## no_target_change (the third outcome — NOT a loud failure)
Sometimes the attempt reports no_target_change: the 转存 went through without an error, yet no new video appeared in the target dir within the built-in settle window. A LARGE share's server-side copy can outlast that window, so this can be a FALSE miss. Do NOT immediately re-transfer the same candidate (you may double-land its files) and do NOT instantly write it off: re-read the target directory (inspectStaging) first — if the files have appeared by then, it landed; only when the re-read still shows nothing did it truly not land, and THEN you switch to the next covering candidate.

## SYSTEMIC BLOCK (别甩锅)
When a 123 转存 fails with a SYSTEMIC message — "配额不足" / "额度已用完" / "容量不足" / "VIP会员" / "登录" / "鉴权" — the resource EXISTS but the ACCOUNT is blocked (quota / auth / VIP). The tool result carries \`systemicBlock: { reason: "..." }\`. **立即停 — DO NOT keep transferring.** Every candidate will fail the same way. Report honestly: the resource was found, the account cannot transfer it (not "no resource"). This is actionable (top up / re-login), never blame the resource.

## Black-box gate (same discipline as 115)
"Transparent" = the title states size / resolution / episodes / release group. "Black-box / opaque" = a bare name or a vague bundle.
- If a TRANSPARENT 123 分享 clearly covers the need, select ONLY it and STOP. Do NOT also transfer opaque ones "just in case".
- ONLY when ZERO transparent candidate covers may you fall back to a black-box one. When you do, your VERY NEXT step after it lands MUST be inspectStaging to VERIFY it actually holds the target — black-box coverage is UNPROVEN until you read the real files.
  - Verified to cover → process it (move / dedup / mark) and finish. Do NOT keep searching for a "better" one.
  - Does not cover → treat it as a dead candidate, clean its staging residue with deleteFiles, try the next.
- For an ongoing show's just-aired episode, a black-box resource whose publish time predates that episode's air time almost certainly does NOT contain it — do not bet on it.`;

const DEAD_LINKS_BLACK_BOX_GUANGYA = `# Dead magnets, offline tasks, and black-box resources (光鸭云盘)

> 提醒:raw 候选已预搜好,先 viewResourceSnapshot() 通读活期文档再动手;searchResources 只用于繁体/英文升级,别拿画质/字幕词搜。

## How transfer works on THIS drive (光鸭)
The drive is 光鸭云盘 — a MAGNET / OFFLINE-DOWNLOAD drive (like 115's offline-task path, NOT a share-link/instant-save drive). Every candidate is a 磁力/离线链接 (磁力 / ed2k / BT). transferCandidate runs resolve_res → create_task → polls the offline task until it lands, then returns the TRUE materialized files (the system rereads for you). Trust THAT, not your prediction.

## 仅磁力 (this is the key difference from 115/夸克)
光鸭 saves ONLY magnet/offline links — it has NO instant-save and NO share-link 转存. So a 115/夸克/光鸭 分享链 (share link) is NOT supported here: forcing one fails LOUD with "GUANGYA_ONLY_MAGNET". The resource provider only surfaces 磁力 candidates for this drive, so you should never see a share link — but if a candidate is a share rather than a magnet, skip it; it cannot land on 光鸭.

## Dead magnets fail (move on)
A magnet can be dead: resolve_res returns nothing, or the offline task never materializes (no seeds / removed). 光鸭 surfaces this — when nothing lands, treat the magnet as dead and switch to the NEXT covering 磁力 candidate. A dead magnet is the NORM, never a reason to give up — try the next magnet that covers the need (the system burns through dead ones the same way the 115 offline path does).

## SYSTEMIC BLOCK (别甩锅)
When a 光鸭 transfer fails with a SYSTEMIC message — "配额不足" / "额度已用完" / "VIP会员" / "登录" / "鉴权" / 离线下载被限 — the resource EXISTS but the ACCOUNT is blocked (quota / auth / VIP). The tool result carries \`systemicBlock: { reason: "..." }\`. **立即停 — DO NOT keep transferring.** Every candidate will fail the same way. Report honestly: the resource was found, the account cannot transfer it (not "no resource"). This is actionable (top up / re-login), never blame the resource.

## Black-box gate (same discipline as 115)
"Transparent" = the title states size / resolution / episodes / release group. "Black-box / opaque" = a bare name or a vague bundle.
- If a TRANSPARENT magnet clearly covers the need, select ONLY it and STOP. Do NOT also transfer opaque ones "just in case".
- ONLY when ZERO transparent candidate covers may you fall back to a black-box one. When you do, your VERY NEXT step after it lands MUST be inspectStaging to VERIFY it actually holds the target — black-box coverage is UNPROVEN until you read the real files.
  - Verified to cover → process it (move / dedup / mark) and finish. Do NOT keep searching for a "better" one.
  - Does not cover → treat it as a dead candidate, clean its staging residue with deleteFiles, try the next.
- For an ongoing show's just-aired episode, a black-box resource whose publish time predates that episode's air time almost certainly does NOT contain it — do not bet on it.`;

const DEDUP = `# Deduplication (keep the larger, by real size)

Overlapping ranges (1-10, 8-13) or a fuller pack on top of what a season already has WILL create duplicate episodes once you extract. When the same episode has more than one file:
- Group the files by episode (read the real filenames — you understand "[Grp] Show - 04.mkv" is E04; no regex, no suffix tricks).
- Keep the LARGER file (higher bitrate = better quality), delete the smaller. deleteFiles executes your grouping; the system rereads to confirm.
- Size is the ONLY criterion. "Newer" is not better. "Collection pack" is not better. A "(1)" suffix decides nothing.

## Worked example — Life Tree (生命树)
The season dir already holds E01-E12 at ~1.2GB each (high quality). A new pack lands E01-E14 at ~800MB each. Missing was E13-E14.
- WRONG (the real bug): delete E01-E12, keep the new E01-E14 → you deleted the larger/better files.
- RIGHT: for E01-E12 keep the old 1.2GB and delete the new 800MB; for E13-E14 there is only one file each → keep. Final: E01-E12 (1.2GB) + E13-E14 (800MB) = 14 episodes, each the best available.`;

const MOVIE = `# Movie acquisition playbook

A movie is ONE video file. There are no seasons or episodes; its single coverage token is "MOVIE". The landing directory is just "Title (Year)/" and the file goes DIRECTLY in it — there is NO Season folder, NO season distribution, and NO separate staging to discard. You do NOT moveToSeason and you do NOT discardStaging for a movie: the film lands in the movie directory and flattenMovie cleans its wrapper IN PLACE. (Those are TV/anime tools.)

## Identity is the hard part (apply protocol's Evidence → Facts → Decision)
The candidate must be THIS film — not a remake, sequel, prequel, or same-IP different film. Cross-check BOTH title AND year.
- Reject "蝙蝠侠：黑暗骑士崛起" (2012) when the target is "蝙蝠侠：黑暗骑士" (2008).
- Reject a 1990 version when the target is a later remake.
- When identity is unclear, do NOT transfer speculatively.
Reject packs / collections / box sets / multi-part / anything structured like seasons — a movie is a single film. Reject disc images too: a 蓝光原盘 / ISO / BDMV full-disc dump (often 50–100GB+, isVideo=false) is NOT a usable film — you need ONE playable video file (mkv/mp4/ts). Among confirmed identity matches prefer the highest quality VIDEO stated transparently (4K REMUX/video > 1080p > 720p); prefer a 4K REMUX or even a lower-quality video over a 原盘/ISO even when the disc image is nominally higher quality. Magnets and 115 shares both transfer instantly — judge on identity/quality, never on link type.

## Two transfer tools — pick by the situation
- transferCandidate(snapshotId, candidateId): ONE candidate at a time. Use it for a single obvious share, or for a MAGNET (a magnet does NOT fail loud — only the landing point in inspectStaging tells you whether it 秒传'd; so transfer, then inspect).
- transferUntilLanded({candidateIds:[...]}): MOVIE-ONLY. You RANK several share candidates that are all the SAME film (best resource first) and hand the ordered list over; the system tries them in your order and STOPS at the first that 秒传-lands, abandoning the rest. FAIL-LOUD SHARE LINKS ONLY — every 转存分享 brand (115/夸克/天翼/123) qualifies (it relies on the share's loud failure); magnets are rejected. Why it exists: many shares are dead (链接已过期 / 分享已取消 / 错误的链接 — you will see these constantly), so this burns through the dead ones for you without spending a turn per link. If an attempt reports no_target_change with nothing landed (a large share's async server-side copy can outlast the settle window — a possible FALSE miss), the tool STOPS and hands judgment back: re-read via inspectStaging first, then decide (do NOT immediately re-transfer or write the candidate off).
  - The SET is YOUR semantic choice. A keyword search is a WILDCARD — it mixes in same-named DIFFERENT works (e.g. under "抓娃娃" the movie sits among a 综艺/variety show "姐姐妹妹抓娃娃" and even an unrelated cartoon). NEVER hand it the raw result list — first read every title and include ONLY the ones that are genuinely this film+year. Handing it everything = transferring a wrong work.

## The collapsed loop
search (re-keyword if weak) → decide the ONE correct film and RANK its candidate links (Evidence → Facts → Decision) → transfer it (transferUntilLanded over your ranked shares, or transferCandidate for one share / a magnet) → inspectStaging to read the TRUE files → flattenMovie() AUTOMATICALLY pulls the film AND its subtitles up into the movie directory and removes the wrapper (one call, no per-file selection — a movie is one film, take it all; subtitles MUST land beside the video so the scraper finds them; the wrapper's covers/poster/nfo are discarded with it) → delete any extras (trailers / 花絮 / a bundled different work) with deleteFiles → markObtained(["MOVIE"]) as the LAST step, once the film is in place → finish().

## Worked example — 奥本海默 (the live failure to NOT repeat)
Searching "奥本海默" returns mixed links: a few 115 shares (some 链接已过期 / 分享已取消) and several magnets (some malformed → 错误的链接), most with OPAQUE black-box titles, ~4 dead and 1 good.
- RIGHT: read the titles, keep only the ones that are genuinely this film (drop unrelated same-keyword junk); rank the 115 shares best-first and transferUntilLanded over them — it skips the dead ones and lands the live one; THEN inspectStaging to verify it contains the film; it does → flattenMovie, markObtained MOVIE, finish. A couple of searches, one iterate-transfer, one inspect, done.
- WRONG (what actually happened): after the good resource ALREADY landed, kept searching "奥本海默 2023 mkv" / "Oppenheimer 2023 4K" and transferring more candidates WITHOUT inspecting — over-search, over-transfer, hammering 115. Once a transfer has landed, inspectStaging to verify BEFORE anything else; if it covers, finish.
- ALSO WRONG (复联4 live): a top-quality correct film landed (English scene name, no 中字 marker) — the agent then burned FIVE searches ("国语"/"中字"/"简繁" variants) hunting a Chinese-subs version. Those marker words are STRIPPED to the bare title, so each was just re-running the raw search already read. If the raw snapshot showed no better 中字 candidate, there is none to find: keep the landed film, markObtained with subtitleFallback:true, finish. One landed good file + no visibly-better candidate = STOP.

## Keyword reality (lived)
The provider matches keywords loosely. Best practice: search the BARE title first; adding the year on the first pass is usually NOT best (it can over-narrow — "抓娃娃 2024" returned ZERO here while "抓娃娃" returned dozens, though the year does not always zero results). Add the year, the original/English name, or "全集" only if the first bare-title pass is weak.`;

const TV = `# TV / anime acquisition playbook

You own one OR MORE seasons in scope. The need is "应有 vs 实有 = which episodes are still missing", and it may span several seasons. It is ONE deliberation: keyword strategy, target & season matching, coverage, package normalization, extraction, dedup, marking.

## Season matching
- Season 1 (most Chinese dramas default here): a title without explicit season markers may match — focus on episode coverage ("庆余年 全集", "更新至46集").
- Season 2+ (US/Korean/Japanese dramas): the title MUST explicitly indicate the tracked season. "完结" / "更新至13集" with no season info is probably Season 1 → skip. Only "第二季 ...", "S02E...", "Season 2" count for season 2.
- Worked example — The Pitt (匹兹堡医护前线), tracking Season 2, missing S02E04: "匹兹堡医护前线 完结" (no season → likely S1 → skip); "更新至13集" (no season → skip); "第二季 更新至03集" (S2 but only E01-E03 → does not cover E04 → skip); "第二季 1-6集合集" (S2, covers E04 → TRANSFER).

## Coverage with the FEWEST reliable transfers (and BATCH the decided set)
- If ONE complete / full-season pack covers the whole need, transfer just it and stop searching.
- Otherwise compose the FEWEST non-redundant ranges that cover every missing episode, decide that whole set (Evidence → Facts → Decision), then transfer the set back-to-back (do NOT search again between transfers).
- Worked example — you need 50 episodes and every resource is a single-episode pack: do NOT transfer-one → re-check → transfer-one fifty times (that hammers 115). DECIDE the set of packs that together cover the 50, transfer that decided set in sequence, THEN inspect / dedup / mark once.
- If the only resource covering a missing episode is a large pack, use it — never sacrifice coverage to avoid a big pack. (In the daily patrol specifically, when a small exact-missing resource AND a huge full-season pack both cover, prefer the small exact one — less dedup risk; quality can be upgraded later.)

## Multi-season / complete-series packs
The need may span several seasons and a SINGLE pack ("Breaking Bad Complete Series" / "全五季") may cover them all. Transfer it ONCE, then submit ONE distribution plan that maps the files to EACH season at once: moveToSeason({moves:[{season:1,fileIds:[...]},{season:2,fileIds:[...]}]}) — each video's SUBTITLES ride in the same season's fileIds. Take ONLY still-missing episodes — a season the library already has is NOT recopied (inspectTargetDir(season) shows what each season already holds; recopying a present season is the 莉可丽丝 mistake across seasons). A pack covering seasons beyond the need is fine — take only what is missing, leave the rest in staging.

## Batch distribution (moveToSeason) — plan, ONE call, verify
The move tool is a BATCH plan, not a per-season call. Use it EXACTLY like this:
1. PLAN the whole distribution first (Evidence → Facts → Decision): for EACH still-missing episode write down which staging file id is its video, that video's SUBTITLE file id(s), and which season it belongs to. Confirm the plan covers EXACTLY the missing episodes — nothing already present, no extras.
2. Submit it in ONE call: moveToSeason({moves:[{season:1,fileIds:["videoId","subtitleId",...]},{season:2,fileIds:[...]}]}). Every video's subtitle id sits in the SAME season's fileIds as its video. (A movie omits season entirely.)
3. VERIFY the returned {seasons, staging}: each returned season must hold exactly its missing episodes (+ their subtitles), flat. If a file is misplaced or missing, call moveToSeason again to fix it — moves are cheap (NOT transfer-budget), so distribute-then-verify; do not agonize over a perfect first call.
4. Only once the seasons verify correct: dedup (keep-larger) → markObtained(codes) → discardStaging.

## Messy real packs (lived)
A single "全X集" pack often has INCONSISTENT, watermarked filenames and MIXED quality — e.g. a real 隐秘的角落 全12集 pack held 第1集–第6集 in proper 蓝光1080P (400MB–1GB) but 尝鲜版07–尝鲜版12End in low-quality preview (~150MB), all sprinkled with a 【site.com】 watermark. You map each to its episode by READING the name ("第3集"=E03, "尝鲜版09"=E09, an "End"/"完" marker = the finale) — no regex, no parser. Keep the ORIGINAL names (never rename). If covering the missing episodes only takes proper-quality files, take those; if the only file for a missing episode is a preview/尝鲜版, take it (coverage now, quality upgrades on a later patrol). When two files cover the same episode, dedup keep-larger.

## On patrol / 补缺 — INSPECT THE LANDING POINT FIRST (§6b#8)
The missing-episode list is computed from the DB, and the DB can LAG the disk: a prior run may have already placed an episode on 115, or a crash left files mid-flight, yet the DB still says "missing". So whenever you are补缺 (a daily-patrol / type3 run, or any task that hands you "missing" episodes), your FIRST action — BEFORE any searchResources — is inspectTargetDir for each needed season. Any "missing" episode whose video is ALREADY in its season directory: markObtained it straight from that evidence and remove it from your need; do NOT search or transfer for it. Only the episodes genuinely absent from the landing point go on to search/transfer. (Searching PanSou for files you already have on 115 is wasted budget — exactly the over-search to avoid.)

## Coverage honesty
Only currently-aired, genuinely-missing episodes are obtainable. Unaired future episodes of the latest ongoing season are NOT missing — leave them; the daily patrol gets them when they air. EXCEPTION — provider-ahead (trust a coherent full pack): a real release is often ahead of TMDB, so a coherent full-season pack you transferred can actually deliver episodes BEYOND the aired cursor in your need. Those extra episodes are NOT "unaired with no resource" — THIS pack delivered them, so treat them as ALSO wanted: include them in your moveToSeason plan (with their subtitles) so they land in the season dir and are NOT wiped by discardStaging; then, after inspectTargetDir confirms the real video files landed, markObtained them too. The system records them as provider-ahead (你比 TMDB 抢先拿到) and the frontend shows 超前 — do NOT leave a verified full season half-done at the aired cursor. Hard safety: move+mark ONLY episodes whose files you actually verified landed — NEVER ones a pack merely claims in its title (a "1-24" label is not proof). A truly-missing episode with no covering resource is an honest gap — leave it for the next patrol; never fabricate coverage.

## Clean up & subtitles
Each video's SUBTITLES (.srt / .ass / .ssa / .sub / .idx / .vtt / .sup / .smi; .sub + .idx are a VobSub pair) ride WITH their video in the SAME season's moveToSeason fileIds — they must land beside the video so the scraper finds them; NEVER leave a pack's subtitles behind. After every needed episode (and its subtitles) is moved into its season directory and marked, call discardStaging to wipe the WHOLE staging directory in one shot: leftovers you didn't need — extra episodes, duplicate packs, a bundled different work (e.g. El Camino inside a Breaking Bad pack), covers/nfo — are all discarded wholesale. Keep ONLY what you moved into the seasons; do not isolate or hand-classify residue.`;

const MISTAKES = `# Worked right/wrong examples (the hard-won lessons)

- 莉可丽丝 over-transfer: a show that HAD one full-season pack, yet the agent searched 16 times and transferred 6 overlapping full-season packs. WRONG. Right: recognize the one full pack covers the need, transfer just it, stop.
- 奥本海默 over-search after success: after the one good (black-box) resource already landed, kept searching + transferring more. WRONG. Right: once a transfer lands, inspectStaging to verify; if it covers, finish.
- Life Tree dedup: deleted the larger/better files because they were "old". WRONG. Right: keep the larger by real size, regardless of new/old.
- El Camino: a different film bundled inside a Breaking Bad pack, auto-mapped to an episode. WRONG. Right: isolate it, never auto-map.
- "Just in case" transfer: transferring a non-covering resource hoping it secretly has the episode. WRONG. Right: skip non-covering titles; if a title says "更新至03集" and you need E04, skip.
- Acting on a hunch: transferring / deleting / marking without first stating Evidence → Facts → Decision. WRONG. Right: state the evidence and the facts, then act.
- Serial single transfers: transfer-one → re-search → transfer-one, repeated, hammering 115. WRONG. Right: decide the covering set, then transfer it back-to-back without re-searching.`;

const SUBTITLE = `# External subtitle completion (assrt.net) — only when viewSubtitleSnapshot is in your tools

## The signal
\`viewSubtitleSnapshot\` appearing in your toolset means THIS run needs external Chinese subtitles — the system already searched assrt.net for this title's bare name and laid the candidate packages out as a read-only 活期文档. If the tool is NOT in your toolset, this whole section does not apply — skip it (国产内容 natively Chinese-spoken, or no assrt token configured, or this drive cannot land external subtitle files).

## The flow (alongside, never blocking the video)
1. viewSubtitleSnapshot() — read the candidate packages. Each shows id + title + language tag (e.g. [英 简 双语]), plus community evidence when available (★social vote score · 字幕组 · upload time). Pick ONE whose language covers your need (prefer 简体/双语 for a Chinese-subtitle user); between language-equal candidates, a higher ★ and a known 字幕组 mean the community already validated it — weigh that semantically, it is evidence, not a rule.
2. transferSubtitle({ candidateId }) — land its files into staging. assrt's filelist is per-episode with SxxExx filenames already, so the landed files are named like "Breaking.Bad.S02E01.ass".
3. renameSubtitle({ renames: [{fileId, newName}, …] }) — ONE BATCH call for ALL landed subtitles: decide every subtitle↔episode pairing (fileIds from inspectStaging), then submit them together. Each newName = the matching episode video's prefix + the subtitle extension (Show.S02E01.mkv → Show.S02E01.ass; 简/繁 double subs keep their .sc/.tc infix). NEVER rename one file per call — a 77-episode season is one batch call, not 77 calls (the lived 2026-07-02 lesson: per-file calls collapse at scale and most episodes ship unpaired). Subtitles are the ONLY files you may rename — the documented exception — so the player auto-loads them. Per-item guard violations return in the "errors" list; fix or drop those items, don't retry the whole batch.
4. Move each renamed subtitle with its video via moveToSeason (in the same call as the videos, or a follow-up moveToSeason — both work; the subtitle's fileId rides in its season's fileIds), or let flattenMovie pull it up for a movie — exactly like a subtitle that came bundled inside the resource pack.
5. MULTI-SEASON / at-scale needs: assrt packages are typically PER-SEASON — for a need spanning several seasons pick one package per needed season and transferSubtitle them back-to-back. Do the subtitle pairing while you still know the video filenames (from inspectStaging/inspectTargetDir); videos already moved to their seasons are fine — you saw their names. NEVER discard staging while landed subtitles sit there unrenamed: rename-then-move them first, discard only what you decided not to use. If the video release already ships its own subtitles (bundled .ass/.srt/.sub/.idx in the pack), skipping external subtitles entirely is a valid decision — say so and move on.

## Soft-fail (never block the video)
Subtitle miss / empty filelist / transferSubtitle returning failed / no matching SxxExx episode — all of these are SOFT. Video coverage is the only hard gate. If subtitles don't pan out, proceed with the video alone (markObtained on the video as normal); the user values an honest "video landed, no subtitle" over a blocked task. Never re-search assrt repeatedly — one viewSubtitleSnapshot read, one pick, one transfer attempt, move on.`;

const SEARCH = `# Keyword strategy by media type (lived PanSou research)

## ⛳ 最重要:raw 已经预搜好了,就在你眼前的「活期文档」里
点获取的瞬间,系统已经替你用裸标题(raw)搜过一遍 PanSou,把全量候选当成一份只读「活期文档」摆好了。**你的第一步永远是 viewResourceSnapshot() 通读它**——免费、可反复调、不耗预算。raw 裸标题就是召回最全的最佳实践,绝大多数情况下你需要的资源已经在这份文档里了。

## 🩸 血淋淋实测(真 PanSou,2026-06-29)——别瞎加关键词
PanSou 是对聚合分享标题做**通配符/子串匹配**。分享标题里几乎从不写分辨率/字幕/年份/季,所以**任何限定词只会把召回打成 raw 的子集,或直接归零,永远不会带来新资源**:

| 关键词 | 返回 | | 关键词 | 返回 |
|---|---|---|---|---|
| 铁拳教育(raw) | 84 | | 奥本海默(raw) | 185 |
| 铁拳教育 1080p | 0 | | 奥本海默 中字 | 0 |
| 铁拳教育 中字 | 0 | | 奥本海默 2023 | 3(子集) |
| 铁拳教育 2024 | 0 | | Oppenheimer(英文) | 23(中文名是 8 倍) |
| 庆余年(raw) | 146 | | 庆余年 第二季 | 24(几乎全是子集) |

结论:① 只看裸标题的全量召回(活期文档);② 画质/字幕/年份/季/子类型词**绝不进搜索关键词**(进了就是归零或子集,没好果子吃);③ 外国片用**中文译名**(中文名召回是英文原名的好几倍)。
> 护栏:即便你把画质/字幕词拼进 searchResources 的关键词,系统也会**自动 strip 掉**它们再搜,并回你一条 notice——别依赖它,自己就别加。

## 🔎 searchResources 已降格:只用于「繁体 / 英文 / 原名」升级
raw 已经预搜并摆在活期文档里了,**不要再用 searchResources 重搜 raw**(只会命中 dedup、白占预算)。searchResources 的正当用途只剩一个:当活期文档里的中文 raw 候选不满足时,用**繁体中文 / 英文原名 / 罗马音**做升级搜索(召回不同的资源池)。想缩小范围 → 直接在活期文档里用语义判断,别发新的限定词搜索(那都是 raw 子集)。

## 📖 阅读纪律(怎么读活期文档)
- 用你的语义智能扫这份文档:读标题判 identity / 覆盖 / 画质 / 中字。
- **找到一个不错的、能覆盖需求的资源就直接用,不必通读全部候选**——覆盖优先,别为了"挑更好的"无限读。
- 选中的资源若死链 / 转存失败,**继续往下看**下一个候选。
- **只有把活期文档全部候选通读完、仍然没有任何合适资源,才能 reportNoCoverage**。读了一半就报无覆盖 = 偷懒,禁止。

---

Your per-run input already gives you THIS title's recipe (searchHints). The map below is for the 繁体/英文/原名 升级 case and same-name disambiguation — read it when the活期文档 + injected hint isn't enough.

## Universal laws (every type)
- A single 0 almost NEVER means "no resource": PanSou's API jitters violently — the SAME keyword can swing 0↔900 between consecutive calls (measured: Breaking Bad 0→903; 斗破苍穹/遮天 once reported 0 are really 140-196). On a 0 (升级搜索时), re-run the SAME keyword 2-3 times before ever concluding empty. Most "0"s are lies.
- Quality is NOT a search word. Putting 4K/1080P/蓝光/中字/字幕 into the keyword filters the title match AND skews to wrong works — measured归零 above. Read quality/中字 off the returned titles instead (the system strips these tokens for you if you slip).
- count ≠ relevance: read the top titles to confirm the work itself + full coverage.
- Sub-type tokens NEVER go in the query: +美剧/+韩剧/+日剧/+国产剧/+番剧/+动画 almost never help — they zero the pool or top it with noise. The ONLY exceptions: 国漫's +国漫 (a real release tag, for disambiguating same-name live-action) and Chernobyl's +美剧 (the one show whose bare name is always 0).
- The 升级 keyword's LANGUAGE follows the user's subtitle preference. Prefer 中文 subs (the default) → the 中文译名 already recalled in the活期文档 is best (Chinese-named resources carry 中字 AND recall better). Prefer the original language → only then search by the original/English name (huge recall but mostly NO Chinese subs). The English/original name is the 升级 fallback for "中文名 still 0", and you must then pick the results that carry 中字; if none do, that's weak coverage for a 中文 user.

## Per type (升级搜索时 lead with the BARE 中文 name + hard re-search; tokens are NEVER added)
- 电影 (movie): bare 中文名 (imported films use the common 网盘 译名; sequels keep the Chinese number: 沙丘2/银河护卫队3). Same-name trap → the year is a LAST-resort 升级 slice for live-action ONLY (默杀→默杀 2024, 抓娃娃→抓娃娃 2024), but the activitydoc raw is almost always richer — measured 抓娃娃 2024→0 vs 抓娃娃→dozens. English name ONLY if itself distinctive (Killers of the Flower Moon); common-word English is a disaster (YOLO/Napoleon/Inception/Barbie). NEVER 中文名+画质, +电影.
- 国产剧 (CN tv): bare 中文名 (8/10 puts the 全N集/COMPLETE pack on top). Multi-season: the bare name recalls ALL seasons' packs at once — NEVER search season-by-season (庆余年 第二季 collapses to 24 from 146). NEVER +国产剧/电视剧, bare English, quality words.
- 美剧 (US tv): bare 中文译名 (measured: 权力的游戏83/绝命毒师83/怪奇物语129, all on-target WITH 中字). English name only as the "中文名 still 0" 升级 fallback, then pick the 内封/外挂简繁中字 results. NEVER 中文名+美剧 (measured 0-for-7), bare English as the opener. Chernobyl is the lone exception: 切尔诺贝利 美剧.
- 韩剧 (KR tv): bare 中文译名 (stable). too-niche translation that won't recall (衣袖红镶边) → English original (The Red Sleeve) as 升级. NEVER +韩剧, common-word English as opener (Kingdom/Penthouse/Signal).
- 日剧 (JP tv): bare 中文 COMMON translation — multiple unstable translations is the #1 trap (Silent=静雪, Legal High=胜者即是正义). Buried under same-name → English/romaji 升级 (静雪→Silent, 非自然死亡→Unnatural). NEVER +日剧, single-word English, katakana (AV). Stock blind-spots are real — be willing to declare 无货 rather than keyword-thrash.
- 日漫 (JP anime): bare 中文译名 (9/10 puts a 字幕组 pack on top: LoliHouse/DBD-Raws/喵萌). Buried by same-name (莉可丽丝 vs an unrelated US show) → standard-spelling romaji 升级 (Lycoris Recoil/Jujutsu Kaisen/Frieren); pick a season/篇 by READING the already-recalled titles, never append it. NEVER +番剧/+动画 (咒术回战 番剧→0), +year, +4K.
- 国漫 (CN anime): bare 中文名 (measured 斗破苍穹140/遮天196). If the bare name is taken over by a live-action/same-name (完美世界→突袭, 凡人修仙传→真人版, 一人之下→异人之下) → add +国漫 to narrow to clean GM-Team season packs (the donghua-only real tag); 一人之下 fully dead → romaji Hitori no Shita. NEVER +动画, +番剧/年番/第N季, +year (DANGEROUS: pulls the same-name live-action).
- 美漫 (US anime): bare 中文译名 — the interpunct · matters (哈莉·奎茵→348 clean vs 哈莉奎茵→4 noise). <5 hits or all noise → bare English name + Complete/Season as 升级 (BoJack Horseman/The Simpsons — big recall but mostly no 中字); fan-slang → full name (爱死机→爱死亡和机器人). NEVER +美剧/+动画, quality words, romaji/pinyin/invented translations.`;

const SECTIONS = {
  protocol: PROTOCOL,
  search: SEARCH,
  "dead-links-black-box": DEAD_LINKS_BLACK_BOX,
  dedup: DEDUP,
  movie: MOVIE,
  tv: TV,
  mistakes: MISTAKES,
  subtitle: SUBTITLE,
} as const;

export type SkillSectionName = keyof typeof SECTIONS;

export const SKILL_SECTION_NAMES = Object.keys(SECTIONS) as SkillSectionName[];

/**
 * The brand-specific transfer / dead-links / black-box manual. The transfer model
 * differs by drive brand (115 秒传/magnet vs 夸克 转存分享链/无磁力), so the
 * "dead-links-black-box" section the agent reads is selected by the run's drive
 * provider. Used both as that on-demand section and as a standalone export.
 */
export function getStorageSkill(provider: string): string {
  if (provider === "quark") {
    return DEAD_LINKS_BLACK_BOX_QUARK;
  }
  if (provider === "guangya") {
    return DEAD_LINKS_BLACK_BOX_GUANGYA;
  }
  if (provider === "tianyi") {
    return DEAD_LINKS_BLACK_BOX_TIANYI;
  }
  if (provider === "pan123") {
    return DEAD_LINKS_BLACK_BOX_PAN123;
  }
  if (provider === "pan115") {
    return DEAD_LINKS_BLACK_BOX;
  }
  throw new Error(`unknown storage brand: ${provider}`);
}

/** Read one section of the skill manual on demand, for the run's drive brand
 *  (defaults to 115). The "dead-links-black-box" section is brand-specific; the
 *  rest are shared. Unknown name → a clear error string the agent can recover from. */
export function readSkillSection(section: string, provider: string = "pan115"): string {
  if (section === "dead-links-black-box") {
    return getStorageSkill(provider);
  }
  const body = (SECTIONS as Record<string, string>)[section];
  if (body === undefined) {
    return `Unknown skill section "${section}". Available sections: ${SKILL_SECTION_NAMES.join(", ")}.`;
  }
  return body;
}

/**
 * The index a given agent embeds in its system prompt: which sections to read
 * up front and which to re-read when a situation arises. Each agent is pointed
 * ONLY at the sections in its responsibility — the movie agent is not handed the
 * tv playbook and vice versa — plus the shared protocol/dead-links/dedup/mistakes.
 */
export function skillIndexForAgent(agent: "movie" | "tv"): string {
  const own = agent; // "movie" or "tv"
  return `You have a domain skill manual. Read a section on demand with readSkill({ section: "<name>" }) — do not act from memory when a section covers your situation.
Read NOW, before you start: "protocol" (the Evidence→Facts→Decision + decide-the-covering-set-then-batch method) and "${own}" (your acquisition playbook).
Re-read the moment you hit it: "search" (your first searches return junk / 0 / wrong works — the per-media-type keyword recipes), "dead-links-black-box" (a transfer fails, or every candidate title is opaque), "dedup" (the same episode lands more than once), "subtitle" (viewSubtitleSnapshot is in your toolset — external Chinese subtitles are available for this run), "mistakes" (worked right/wrong examples).
Available sections: ${SKILL_SECTION_NAMES.filter((section) => section !== (own === "movie" ? "tv" : "movie")).join(", ")}.`;
}
