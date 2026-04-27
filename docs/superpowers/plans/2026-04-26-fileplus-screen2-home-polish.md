# FilePlus Screen 2 — Home polish plan

**Phase:** Phase 3, per-screen polish, Screen 2 of 14.
**Spec section:** [docs/UI-SPEC.md](../../UI-SPEC.md) §A.2.
**Surface:** `#screen-home` in [frontend/index.html](../../../frontend/index.html) (lines 387–525), supporting CSS in [frontend/src/styles.css](../../../frontend/src/styles.css), tab-switch logic in [frontend/src/app.js](../../../frontend/src/app.js).
**Working protocol:** normally one-fix-at-a-time per `feedback_one_fix_at_a_time`; in this round the user explicitly authorized completing all six Tier 1 items in a single sweep via two parallel subagents.

---

## Audit findings

### Tier 1 — clear spec violations (this sweep)

1. **Sub-tab underline indicator invisible on first paint.** `.fp-tabs__indicator` is only positioned inside the `switch-home-tab` action handler ([app.js:1688-1701](../../../frontend/src/app.js#L1688-L1701)); the page loads with `width: 0`. Init under the active tab on DOMContentLoaded.
2. **Selected-row left bar flush to edge.** Spec: 4px from edge. [styles.css:4637](../../../frontend/src/styles.css#L4637) sets `left: 0` (global rule at L1987 correctly uses `left: 4px`).
3. **"view all →" hardcodes `font-size:12px`.** [index.html:413](../../../frontend/index.html#L413) and three siblings inline `style="height:24px;padding:0 8px;font-size:12px"`. Spec: `t-body` Inter 500 `text-secondary`.
4. **Inline-style spam on Recent / Favorites rows.** `.fp-row__recent-path`, `.fp-row__recent-time`, `.fp-row__hover-actions`, `.home-pane` wrappers, and the favorites star button all repeat identical inline style chains. Promote to CSS classes.
5. **Disabled Shared tab inlines opacity.** [index.html:399](../../../frontend/index.html#L399) inlines `opacity:.4;pointer-events:none;cursor:default`; no `.fp-tabs__item[disabled]` rule exists.
6. **Missing time-group sections.** Spec: Today, Yesterday, This week, Earlier this month, Older. Markup ships only Today + Yesterday.

### Tier 2 — deferred (queue for next sweep)

7. Hover-action column reserves layout width when invisible — should be absolutely positioned.
8. Tag-chip variant inconsistent across rows (`fp-chip--tinted` only on the selected row).
9. Pointless `<div style="padding:0">` wrapper in Favorites pane.
10. Shared pane ships an empty-state body even though its tab is `pointer-events:none` — dead UI.
11. Favorites star uses both `fill` and `stroke` on the same accent color — drop the stroke.
12. First-paint hardcoded `fp-row--selected` on Today's first row — remove once `/api/recent` is wired.

---

## Execution

Two subagents in parallel:

- **Agent A** — Task 1 (JS only, [app.js](../../../frontend/src/app.js)).
- **Agent B** — Tasks 2–6 (HTML + CSS, [index.html](../../../frontend/index.html) + [styles.css](../../../frontend/src/styles.css)).

After both return, main session verifies diffs against this plan and against `feedback_design_tokens_over_adhoc` before handing the build back to the user for Electron reload + visual check.
