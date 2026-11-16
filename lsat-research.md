# LSAT section: research brief and integration plan

Prepared Nov 16, 2026 for Study Lab. **Status: implemented.** The bank now lives in `js/lsat.js` (50 questions: 32 LR, 4 passage sets / 18 RC). Sections 5 and 6 below describe the original 24-question draft and the plan that was followed.

## 1. Current LSAT format (official)

**Logic Games are gone (confirmed).** From the August 2024 test on, Analytical Reasoning ("logic games") was replaced by a second scored Logical Reasoning section. LSAC says this has had virtually no effect on scores. ([LSAC: changes Aug 2024](https://www.lsac.org/lsat/lsat-changes-coming-august-2024), [LSAC blog](https://www.lsac.org/blog/what-to-expect-starting-with-august-2024-lsat), [LSAC: Aug 2024 scores](https://www.lsac.org/blog/august-2024-more-things-change-more-they-stay-same))

**Current format (Aug 2024 through June 2027):** four 35-minute multiple-choice sections. ([LSAC test format](https://www.lsac.org/lsat/taking-lsat/test-format), [LSAC TR-26-01](https://www.lsac.org/sites/default/files/research/TR-26-01.pdf))

| Section | Questions | Time |
|---|---|---|
| Logical Reasoning (scored) | 25–26 | 35 min |
| Logical Reasoning (scored) | 25–26 | 35 min |
| Reading Comprehension (scored) | ~27 | 35 min |
| Unscored pretest (LR or RC, any position) | 25–27 | 35 min |

Scoring is 120–180, with no penalty for wrong answers. There is also an unscored **LSAT Argumentative Writing** essay (50 min: 15 for prewriting, 35 for writing), taken remotely.

**Coming in August 2027:** the unscored section is folded into the scored ones ("embedded pretesting"). The order becomes fixed: **RC first (52 min, 6 passages / 40 questions, 27 scored)**, then **two LR sections (45 min, 32 questions, 25 scored each)**, with 10-minute breaks after sections 1 and 2. Question types, scored question counts (50 LR + 27 RC), time per question, and the score scale all stay the same. New-format LawHub practice tests arrive in Feb 2027. ([LSAC: Aug 2027 change](https://www.lsac.org/lsat-will-look-little-different-starting-august-2027), [ABA Journal](https://www.abajournal.com/web/article/lsat-format-tweaked-starting-august-2027))

**What this means for us:** LR is about two-thirds of the score (50 of 77 scored questions), so the bank should lean roughly 2:1 LR to RC. Pacing is the same in both formats: about **1 min 24 s per LR question** and about **8–9 min per RC passage set**.

## 2. Logical Reasoning

LSAC's description: a short passage (an argument or set of facts drawn from newspapers, magazines, scholarship, ads, or conversation), usually followed by one question, with **5 answer choices**. No knowledge of formal logic terms is needed. ([LSAC: Logical Reasoning](https://www.lsac.org/lsat/taking-lsat/test-format/logical-reasoning)) LSAC lists the skills tested: argument parts, matching patterns, drawing conclusions, analogy, points of disagreement, effect of new evidence, assumptions, principles, flaws, and explanations.

**How often each type appears.** LSAC doesn't publish a breakdown, so these are prep-company estimates. The ranking is consistent across sources, but the exact percentages vary.

| Type (stem cue) | Approx. share of LR |
|---|---|
| Flaw ("most vulnerable to criticism") | ~14–16% |
| Must be true / most strongly supported | ~14–15% |
| Necessary assumption ("relies on", "requires") | ~10% |
| Strengthen | ~8–9% |
| Weaken | ~8% |
| Resolve the paradox / explain | ~6–7% |
| Sufficient assumption ("follows logically if assumed") | ~5–6% |
| Method of reasoning | ~2–5% |
| Main point / conclusion | ~4–5% |
| Role of a statement | ~3–4% |
| Principle (identify / apply) | ~3–5%, higher by some counts |
| Parallel reasoning / parallel flaw | ~4–8% combined |
| Point at issue / agreement | ~2–3% |
| Evaluate the argument | ~1–2% |

Sources: [OpenLawPrep ranking](https://www.openlawprep.com/blog/lsat-logical-reasoning-question-types/), [PowerScore count](https://blog.powerscore.com/lsat/the-most-common-lsat-logical-reasoning-question-types/), [TestMax "LR by the numbers"](https://testmaxprep.com/blog/lsat/logical-reasoning-by-the-numbers). LSAC's own score reports group LR into nine categories: Assumptions; Flaws; Strengthen or Weaken; Techniques, Roles, and Principles; Deductions and Inference; Explain or Resolve; Conclusions and Disputes; Matching Flaws; Matching Structure and Principles ([ScoreGap summary](https://scoregap.com/guides/lsat-question-type-frequency)). The site should tag questions so they can roll up into these categories.

The most common flaw patterns are causation drawn from correlation, unrepresentative samples, necessary vs. sufficient confusion, equivocation, ad hominem / attacking the source, false choice, part-to-whole, and absence of evidence treated as evidence of absence.

## 3. Reading Comprehension

From LSAC ([LSAC: Reading Comprehension](https://www.lsac.org/lsat/taking-lsat/test-format/reading-comprehension)):

- 4 sets per section, each with **5–8 questions**. Each set is either a single passage or a **comparative pair** (Passage A / Passage B). A section has 3–4 single passages and 0–1 comparative pairs; in practice almost always 3 + 1.
- Topics: humanities, social sciences, natural sciences, and law. Passages are dense, use high-level vocabulary, and often present several viewpoints.
- Question types: main idea / primary purpose; explicitly stated detail; inference; meaning of a word or phrase in context; organization / structure; application to a new context; principles; analogies; author's attitude or tone; impact of new information.
- Comparative questions ask how the passages relate: **generalization/instance, principle/application, point/counterpoint**. In practice the questions cover A only, B only, where the authors agree or disagree, how one author would respond to the other, and the relationship between the passages.

Length: LSAC doesn't publish word counts. Prep sources put single passages at **~450–500 words** and comparative pairs at a similar total (**~225–250 words each**) ([Dummies](https://www.dummies.com/article/lsat-33786/the-types-of-reading-passages-youll-find-on-the-lsat-154350), [Blueprint](https://blog.blueprintprep.com/lsat/how-to-approach-reading-comp-on-the-digital-lsat/)). Our drafts are 454 words for the single passage and 206 + 218 for the pair.

## 4. Answer-choice traps (to build into wrong answers and name in feedback)

([Jellypod/LR playbook](https://courses.jellypod.com/courses/lsat-logical-reasoning/lessons/11), [Verbloom RC traps](https://verbloom.dev/blog/lsat-rc-wrong-answer-types), [AnvayaPrep](https://anvayaprep.com/learn/lsat/reading-comprehension/passage-fundamentals/common-rc-trap-answers/))

1. **Out of scope / irrelevant:** a true-sounding answer that doesn't touch the argument's gap.
2. **Too extreme:** all, never, must, only, or "disproved" when the text only hedges. (Strong wording is a red flag to check, not an automatic elimination.)
3. **Half-right:** the first clause is accurate and the second is invented or distorted.
4. **Reversal:** flips a conditional (necessary vs. sufficient), a causal direction, or the task itself (strengthens on a weaken question).
5. **Sub-conclusion / premise for the main point:** offered on main-point and role questions.
6. **True but not responsive:** an accurate passage detail that doesn't answer the question asked.
7. **Shared ground:** on disagreement questions, a claim both speakers accept, or one only one speaker addresses.
8. **Lookalike:** on parallel questions, an answer with similar wording or topic but different logic.
9. **"Some" chains and "most":** wording that sounds like it closes the gap but doesn't.

Each drafted question records its single most tempting wrong answer (`trap`) and why it's wrong (`te`).

## 5. Original draft question set (now merged into `js/lsat.js`)

The set is all original: no LSAC stimuli, passages, or questions were copied or paraphrased. LSAC owns PrepTest content, so if we ever want real questions, they would have to come through LawHub's licensed drills rather than being copied into the site.

| Section | Types | Count |
|---|---|---|
| LR (short) | Main point, Necessary assumption, Sufficient assumption, Strengthen, Weaken, Flaw (sampling), Flaw (necessary vs. sufficient), Must be true, Most strongly supported, Resolve the paradox, Role of a statement, Principle (apply), Parallel reasoning, Point at issue | 14 (one each) |
| RC single passage, "Governing the commons" (Ostrom; 454 words) | Main point, Detail, Inference, Function, Application | 5 |
| RC comparative pair, "Fixing one-sided consumer contracts" (206 + 218 words) | Relationship, Disagreement, Cross-passage response, Function, Agreement | 5 |

Difficulty: 6 easy, 12 medium, 6 hard.

Known weakness: in 11 of 24 questions the correct answer is still the longest choice, after one round of rebalancing. Before shipping, balance answer lengths further so length can't give away the answer.

## 6. How it fits the site: changes needed

Current engine assumptions: `questions.js` tuples `[d, topic, q, [4 choices], explanation]`; `engine.js` builds `{id, s, d, t, q, c, e}`; `app.js` hard-codes letters A–D, keys 1–4, a big bold `.question`, and 10-question rounds built from individual questions.

**Data / schema (minimal extension):**
1. Keep the tuple and add an optional 6th slot, `{ stim, p, trap, te }`. In `engine.js`, map it to `x: r[5]` in the QUESTIONS loop. Existing subjects are unaffected.
2. Allow 4 **or** 5 choices. Correct stays first and choices are still shuffled, which is why explanations refer to content rather than letters. (Option: a `fixed: true` flag to show A–E in authored order like the real test; not needed for the draft.)
3. Export `LSAT_PASSAGES` from the question file, and import it into engine/app.
4. IDs stay `lsat` + index, so new LSAT questions must be appended, never inserted (same rule as today).

**Engine (`engine.js`):**
5. Add `{ key: "lsat", name: "LSAT", blurb: "Logical Reasoning and Reading Comprehension, LSAT style" }` to `SUBJECTS`.
6. Two LSAT round types so "short" and "long" are separate:
   - **LSAT · Short:** 10 LR questions through the existing `buildSession` (filter `!x.p`).
   - **LSAT · Long:** one passage set. Choose a passage (due questions first, then the least-seen passage at the current level) and return all its questions in authored order. Grouping should be a new `buildPassageSession(st, passageKey)`, not a change to `buildSession`.
7. Due reviews: RC questions stay scheduled individually; when one comes due, show it with its passage. (An alternative is scheduling a whole passage set as one unit; it's simpler for the reader but loses per-question spacing. Recommend per-question to start.)
8. Leave LSAT out of the global "Mixed review" by default, since a 450-word passage in the middle of a quick mixed round is jarring. Or include LR only. `interleave` already works with any subject.
9. Levels and spaced-repetition intervals need no changes.

**UI (`app.js` + `styles.css`):**
10. `letters` becomes `["A","B","C","D","E"]`; the key map adds `5`/`e`; the tip text reads "1 to 5" when a question has five choices.
11. Render `x.stim` above the stem as normal-weight body text (`white-space: pre-line` for two-speaker dialogues), and render the stem smaller than today's 1.3rem bold `.question`.
12. **Reading layout** for questions with `x.p`: a passage panel (max-width ~70ch, line-height ~1.6, numbered paragraphs, "Passage A / Passage B" headings for comparative sets). On wide screens (≥1000px), use two columns with a sticky, scrollable passage on the left and the question on the right. On phones, put the passage above the question with a "Show passage" toggle after the first question of the set.
13. Feedback: for long choices, say "The answer is (C)" instead of repeating a 200-character choice, then show the explanation and a second line, "Tempting but wrong: (B) …" with `te`. If the user picked a different wrong answer, label theirs too.
14. Summary/review list: also show the start of the stimulus or the passage title, because LR stems like "Which one of the following most strengthens…" mean nothing on their own.
15. Home: an LSAT card, optionally full-width since the grid is 2 columns and this makes 7 subjects, with "Short (LR)" and "Long (RC)" buttons. Update the hard-coded "Six subjects" header copy.
16. **Optional timer** (off by default, toggled on the LSAT card): count up and show the real-test pace (LR target 1:25 per question; RC target about 8:45 per set, or 1:20 per question). Turn amber after the target. Never auto-submit. Optionally store average time per type locally (a new optional `timing` field in the store; `normalize`/`mergeStores` must keep it, or drop it rather than crash).

**Tests (`tests/engine.test.mjs`, `smoke.mjs`):**
17. Replace the "306 questions, 51 per subject" and "4 choices" assertions with per-subject rules: core subjects have 51 questions with 4 choices; LSAT has 5 choices, a valid `trap` index, and either a `stim` or a valid passage key.
18. The duplicate-text check should key on stem + stimulus/passage, since RC stems like "main point of the passage" will repeat across passages.
19. New tests: a passage session returns all of that passage's questions in order; LR rounds contain no passage questions; LSAT is excluded from mixed review; old stores and backup codes still load.
20. Smoke test: run one LR round and one RC set at phone and laptop widths, and check the passage stays visible.

**No change needed:** Supabase (progress is one `jsonb` blob), sync, backup codes (new card ids are just new keys), and spaced-repetition intervals.

**Suggested build order:** schema + engine + tests → LR rendering + 5 choices → RC layout → timer → write more questions (aim for about 50 LR + 6–8 passage sets, about 2:1 LR to RC, weighted by the frequency table in section 2).
