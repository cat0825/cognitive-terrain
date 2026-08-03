import { describe, expect, it } from "vitest";
import {
	TODAY_STUDY_PACK_NAME,
	todayStudyPack,
} from "../../src/domain/study-pack";

describe("today study pack", () => {
	it("contains reposts scraped from the user X profile", () => {
		expect(TODAY_STUDY_PACK_NAME).toBe("2026-08-03 X 转帖学习");
		expect(todayStudyPack).toHaveLength(6);
		expect(
			todayStudyPack.every((note) => note.id?.startsWith("x-repost-")),
		).toBe(true);
		expect(
			todayStudyPack.every((note) => note.source?.startsWith("https://x.com/")),
		).toBe(true);
		expect(
			todayStudyPack.every((note) => note.content.includes("今天的练习")),
		).toBe(true);

		const sources = todayStudyPack.map((note) => note.source);
		expect(sources).toEqual(
			expect.arrayContaining([
				"https://x.com/yifanxu_ephai/status/2084040134266404999",
				"https://x.com/AstroHanRay/status/2083917781167456274",
				"https://x.com/LinearUncle/status/2083896092044001507",
				"https://x.com/Suu766/status/2083822324697235928",
				"https://x.com/mnmn94253156337/status/2083707136165687514",
				"https://x.com/tianyi/status/2083519855203078320",
			]),
		);

		expect(new Set(todayStudyPack.flatMap((note) => note.tags ?? []))).toEqual(
			new Set([
				"长程 Agent",
				"状态管理",
				"LoopX",
				"监督与规划",
				"Agent Harness",
				"评测",
				"Benchmark",
				"DeepSeek",
				"Maka",
				"并行开发",
				"Git Worktree",
				"GitHub Issues",
				"Agent Skill",
				"逆向工程",
				"安全研究",
				"经验压缩",
				"视频工作流",
				"Remotion",
				"镜头设计",
				"逐帧验收",
				"开源",
				"开发者反馈",
			]),
		);
	});
});
