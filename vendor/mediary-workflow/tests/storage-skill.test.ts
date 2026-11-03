import { describe, expect, it } from "vitest";
import { getStorageSkill, readSkillSection } from "../src/index.js";

describe("brand-aware storage skill", () => {
  it("getStorageSkill('quark') teaches 转存分享, 无磁力, and fail-loud codes", () => {
    const quark = getStorageSkill("quark");
    expect(quark).toContain("转存分享");
    expect(quark).toMatch(/无磁力|NO magnet|没有.*磁力/i);
    expect(quark).toContain("41006"); // 分享不存在 fail-loud code
    expect(quark).toContain("夸克");
  });

  it("getStorageSkill('pan115') keeps the 115 transfer model (秒传/magnet)", () => {
    const pan115 = getStorageSkill("pan115");
    expect(pan115).toContain("115");
    expect(pan115).toMatch(/秒传/);
    expect(pan115).toMatch(/magnet/i);
    expect(pan115).not.toContain("41006"); // 115 has no quark codes
  });

  it("getStorageSkill('guangya') teaches the magnet/offline-task model and does NOT throw", () => {
    const guangya = getStorageSkill("guangya");
    expect(guangya).toBeTruthy();
    expect(guangya.length).toBeGreaterThan(0);
    // magnet/offline drive: candidates are magnets resolved → offline task → poll
    expect(guangya).toMatch(/磁力|magnet/i);
    expect(guangya).toMatch(/光鸭/);
    // a 115/quark/光鸭 SHARE link is rejected loud on this magnet-only drive
    expect(guangya).toContain("GUANGYA_ONLY_MAGNET");
    // must NOT mislead with 115-only 秒传 wording
    expect(guangya).not.toMatch(/秒传/);
    // must NOT carry quark fail-loud codes
    expect(guangya).not.toContain("41006");
  });

  it("getStorageSkill('tianyi') teaches 转存分享, 无磁力, TIANYI_NO_MAGNET, and fail-loud share signals; does NOT throw", () => {
    const tianyi = getStorageSkill("tianyi");
    expect(tianyi).toBeTruthy();
    expect(tianyi.length).toBeGreaterThan(0);
    // share-transfer (SHARE_SAVE) drive, like 夸克 — the 115-秒传 equivalent
    expect(tianyi).toContain("转存分享");
    expect(tianyi).toMatch(/秒传/);
    expect(tianyi).toContain("天翼");
    expect(tianyi).toContain("cloud.189.cn");
    // no magnet/offline API on 天翼 — a magnet fails loud with this sentinel
    expect(tianyi).toMatch(/无磁力|NO magnet/i);
    expect(tianyi).toContain("TIANYI_NO_MAGNET");
    // a dead / expired / access-code-required share fails LOUD (switch candidate)
    expect(tianyi).toMatch(/分享不存在|已失效|已过期|需要提取码|ShareNotFound/);
    // must NOT carry 夸克's fail-loud code (different brand)
    expect(tianyi).not.toContain("41006");
  });

  it("getStorageSkill('pan123') teaches 转存 (秒传复制), 无磁力, PAN123_NO_MAGNET, and fail-loud share signals; does NOT throw", () => {
    const pan123 = getStorageSkill("pan123");
    expect(pan123).toBeTruthy();
    expect(pan123.length).toBeGreaterThan(0);
    // share-transfer drive (share/get 列文件 → file/copy/async 秒传复制), like 夸克/天翼
    expect(pan123).toContain("转存分享");
    expect(pan123).toMatch(/秒传/);
    expect(pan123).toContain("123网盘");
    expect(pan123).toContain("123pan.com");
    // mirror share domains are real (123684/123865/123912) — the agent must not
    // reject a candidate just because it is not on the main domain
    expect(pan123).toMatch(/123684|镜像/);
    // no magnet/offline API on 123 (v1) — a magnet fails loud with this sentinel
    expect(pan123).toMatch(/无磁力|NO magnet/i);
    expect(pan123).toContain("PAN123_NO_MAGNET");
    // a dead / cancelled / wrong-code share fails LOUD (switch candidate)
    expect(pan123).toMatch(/分享不存在|已取消|已失效|已过期|提取码错误|链接失效/);
    // the ONE dead-share message the code itself guarantees (saveShare's empty/dead
    // reply) must be in the examples — the rest await T10 live calibration
    expect(pan123).toContain("分享为空 / 已失效");
    // transferUntilLanded accepts every fail-loud 转存分享 brand (the sandbox gate
    // rejects only magnets/unknown) — the arm recommends it for a movie, exactly
    // like the quark/tianyi arms, and must NOT carry the old Do-NOT-use warning
    expect(pan123).toMatch(/transferUntilLanded[^.]*(burns through|automatically)/);
    expect(pan123).not.toMatch(/Do NOT use transferUntilLanded/i);
    expect(pan123).not.toMatch(/115-share-only|it is 115/);
    expect(pan123).toContain("transferCandidate");
    // the third outcome (settle window exhausted on a big async copy) is taught:
    // re-read before re-transferring or burning the candidate
    expect(pan123).toContain("no_target_change");
    // black-box gate keeps the publish-time heuristic (早于最新集=基本不含)
    expect(pan123).toMatch(/publish time|发布时间/i);
    // must NOT carry other brands' fail-loud codes / sentinels
    expect(pan123).not.toContain("41006");
    expect(pan123).not.toMatch(/TIANYI_NO_MAGNET|QUARK_NO_MAGNET|GUANGYA_ONLY_MAGNET/);
  });

  it("getStorageSkill throws for an unknown brand", () => {
    expect(() => getStorageSkill("baidu")).toThrowError(/unknown storage brand/i);
  });

  it.each(["pan115", "quark", "guangya", "tianyi", "pan123"])(
    "%s teaches the systemic-block STOP rule (quota/auth = account problem, not a dead link)",
    (brand) => {
      const skill = getStorageSkill(brand);
      // distinguishes a systemic ACCOUNT block from an ordinary dead link
      expect(skill).toMatch(/系统性|systemic|账号|account/i);
      expect(skill).toMatch(/配额|额度|VIP|登录|鉴权/);
      // it must tell the agent to STOP, not keep grinding every candidate
      expect(skill).toMatch(/立即停|STOP|不要(再|继续)|别(再|继续)/i);
      expect(skill).toContain("systemicBlock"); // the surfaced tool field
      // and NOT report "no resource" (the resource exists)
      expect(skill).toMatch(/资源.*(存在|有)|不是.*没有?资源|别甩锅/);
    },
  );

  it("readSkillSection selects the brand variant for dead-links-black-box", () => {
    expect(readSkillSection("dead-links-black-box", "quark")).toBe(getStorageSkill("quark"));
    expect(readSkillSection("dead-links-black-box", "pan115")).toBe(getStorageSkill("pan115"));
    expect(readSkillSection("dead-links-black-box", "guangya")).toBe(getStorageSkill("guangya"));
    expect(readSkillSection("dead-links-black-box", "tianyi")).toBe(getStorageSkill("tianyi"));
    expect(readSkillSection("dead-links-black-box", "pan123")).toBe(getStorageSkill("pan123"));
    // defaults to 115 when no brand is given (single-user / legacy)
    expect(readSkillSection("dead-links-black-box")).toBe(getStorageSkill("pan115"));
  });

  it("readSkillSection still serves shared sections regardless of brand", () => {
    expect(readSkillSection("protocol", "quark")).toContain("Evidence");
    expect(readSkillSection("dedup", "quark")).toContain("larger");
    expect(readSkillSection("nope", "quark")).toContain("Unknown skill section");
  });
});
