# Mathematical Obsidian workflow validation

- Issue: [#27](https://github.com/cat0825/cognitive-terrain/issues/27)
- Reviewed: 2026-08-17
- Status: synthetic workflow fixture implemented; mutation/deletion sync remains dependent on Issue #23

## Research boundary

This validation uses public product documentation, one publicly viewable creator video, and an original synthetic vault. It does not copy or reconstruct PiKaChu345's paid/private notes, screenshots, transcript, wording, taxonomy, filenames, or vault structure. No access control is bypassed. The repository fixture is authored from generic mathematical facts and workflow requirements only.

The Bilibili API identifies the public creator account as `PiKaChu345` (`mid=180947374`). The public video “数学笔记当中的超链接到底有什么用” was published on 2025-04-04 and demonstrates a creator-specific mathematical linking practice. It is treated as qualitative evidence, not as a universal curriculum or permission to reuse the underlying vault.

## Public sources

| Source | Evidence used | Repository use |
| --- | --- | --- |
| [PiKaChu345 public profile](https://space.bilibili.com/180947374) | Public creator identity and public video index | Link and high-level workflow observation only |
| [数学笔记当中的超链接到底有什么用](https://www.bilibili.com/video/BV1WwZRYVEBZ/) | Public demonstration of linking mathematical problems, results, methods, and reusable ideas | No screenshots, transcript, note text, or vault assets copied |
| [Obsidian Backlinks](https://help.obsidian.md/plugins/backlinks) | Linked/unlinked mentions, context, filtering, sorting, and backlinks in document | Requirements for forward/backward mathematical navigation |
| [Obsidian Graph view](https://help.obsidian.md/plugins/graph) | Notes as nodes, internal links as edges, local graph, filtering, groups, and returning to a note | Requirements for cross-topic inspection and source return |
| [Obsidian Properties](https://help.obsidian.md/properties) | YAML-backed typed properties, lists, internal links, search, and templates | Requirements for `area`, `mastery`, `confidence`, `exploration`, `status`, and `reviewedAt` |
| [Zettelkasten overview](https://zettelkasten.de/posts/overview/) | Notes connected as a maintained network rather than a folder-only archive | Comparable public maintenance model |
| [Reading for the Zettelkasten Is Searching](https://zettelkasten.de/posts/reading-is-searching/) | Retrieval and connection discovery as active knowledge work | Requirement that terrain recommendations return to actionable notes |

Only links and paraphrased requirements are recorded. External pages and media retain their own copyright; absence of downloadable vault content is not authorization to reproduce it.

## Task model

| Task | Deterministic fixture action | Expected product behavior |
| --- | --- | --- |
| Navigate a result | Open `Heine–Borel 定理`, then follow definition, proof, example, and open-question links | Path-qualified and heading-qualified WikiLinks resolve without losing backlinks |
| Discover a cross-topic bridge | Inspect `拉格朗日乘子` ↔ `虚功原理` | Multiple `areas` survive import and the explicit math/physics link remains traceable |
| Maintain an open problem | Rank `数学研究开放问题` using low mastery/confidence and high exploration | It appears as a maintenance candidate without pretending the gap is solved |
| Return to source | Select the maintenance candidate and open its source | Produce `obsidian://open?vault=MathResearchVault&file=Research%2FOpen%20Questions` |
| Re-import safely | Import the same vault in normal and reversed file order | IDs, fingerprints, paths, and resolved relations remain identical |

## Repeatable protocol

Run:

```bash
npx vitest run tests/integration/math-obsidian-workflow.test.ts
```

The test covers:

1. Import seven nested Markdown notes with zero parse issues and preserve vault/source paths.
2. Resolve dense WikiLinks across definition, theorem, proof, example, research, optimization, and physics notes, including `[[path#heading|alias]]`.
3. Keep exactly 21 resolved links and one deliberate unresolved lemma.
4. Re-import an identical snapshot in reversed file order and compare stable identities and relation results.
5. Rank the open-question note for maintenance and generate the exact Obsidian deep link back to its source.

Changed, renamed, and deleted note reconciliation is deliberately not claimed here. That workflow belongs to [Issue #23](https://github.com/cat0825/cognitive-terrain/issues/23) and its current implementation [PR #33](https://github.com/cat0825/cognitive-terrain/pull/33). Once merged, this fixture should be extended with a second snapshot that changes one proof, renames one example, adds one link, and deletes one retired question.

## Findings

| Classification | Finding | Product impact |
| --- | --- | --- |
| Verified capability | Folder import preserves `vault`, nested `sourcePath`, YAML cognitive fields, path/heading WikiLinks, and deterministic identities | A mathematical workflow can be tested without external/private data |
| Verified capability | Explicit WikiLinks provide inspectable definition/theorem/proof/example and math/physics navigation | Terrain relationships can complement Obsidian backlinks rather than replace them |
| Missing workflow | Main does not yet reconcile changed, renamed, or deleted files during vault re-import | Full vault sync acceptance remains owned by #23/PR #33 |
| Missing workflow | Open questions are ranked generically; there is no dedicated question lifecycle or proof-obligation state machine | Future work should test transitions such as `open → investigating → resolved/rejected` before adding UI |
| Product defect threshold | A resolved WikiLink becoming unresolved, YAML fields being dropped, stable IDs changing on no-op re-import, or source return targeting the wrong file is a regression | These conditions belong in blocking automated tests |
| Speculative preference | Plate collision, mountain ranges, ocean gaps, fog, geology, and temperature metaphors may help exploration | Keep them optional and validate task completion before changing terrain semantics |

## Requirements derived for follow-up

- Preserve explicit Obsidian links as evidence; semantic proximity may suggest a link but must not silently create one.
- Keep planar position stable when mastery, exploration, review, or activity values change.
- Treat cross-discipline membership as multiple declared areas, not forced single-label classification.
- Recommendations must explain why a note surfaced and provide a one-action return to the exact source file.
- A future mutable sync test must compare adds, edits, renames, deletes, links, cognitive fields, and source paths in one atomic outcome.
