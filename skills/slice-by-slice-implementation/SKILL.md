---
name: slice-by-slice-implementation
description: Implement software incrementally through small user-reviewed slices. Use whenever the user says “slice by slice,” asks for incremental implementation with review checkpoints, wants to course-correct between changes, or says “bring the next slice.” Each slice may be intentionally incomplete and does not need to deliver an entire working feature.
---

# Slice-by-slice implementation

Use short implementation-and-review loops so the user can steer design decisions before they spread across the codebase.

## Establish the working agreement

Before editing:

1. Read applicable repository instructions, the implementation plan, and nearby code.
2. Inspect the current branch and working tree. Preserve existing user changes. Record which modified files predate the slice and treat them as user-owned: do not edit, stage, unstage, restore, or commit them unless the user explicitly brings them into a dedicated slice.
3. Identify the smallest dependency-ordered change that advances the plan.
4. State the proposed slice boundary briefly, including what will remain untouched.

Do not reinterpret “slice” as “complete one feature end to end.” A slice may be one schema field, one query family, one state transition, one migration step, or one focused test group. Prefer a smaller boundary when the user wants frequent review.

## Choose a useful slice

A good slice:

- has one clear review question;
- follows existing code patterns and design;
- changes only the files needed for that question;
- can be understood from a compact diff;
- advances dependencies in a safe order;
- leaves the tree internally coherent, even if the larger feature is not operational yet.

Examples of appropriately small slices include:

- declare persistence fields without changing behavior;
- add default read filtering to one family of queries;
- protect update targets from a new lifecycle state;
- convert one deletion flow while leaving related flows unchanged;
- register one restart-safe migration step;
- add focused verification for behavior already implemented.

Avoid bundling adjacent work merely because it is straightforward. Do not add migrations, UI behavior, tests, refactors, or related entities until their own slice unless they are required to keep the current change safe and coherent.

Defer cross-cutting integration files until the prerequisite schema, query, and lifecycle decisions they depend on have been reviewed. Editing them early causes repeated churn and makes unrelated user work difficult to isolate. If such a file is already modified, leave it untouched until its dedicated slice unless the user explicitly approves combining the work.

## Implement and stop

For each slice:

1. Make only the announced change.
2. Match nearby naming, query, error, and formatting patterns.
3. Inspect the resulting diff for accidental or opportunistic changes.
4. Run only verification authorized by the user and repository instructions.
5. Report:
   - the behavior introduced;
   - changed files;
   - important behavior deliberately not changed;
   - verification performed or deferred.
6. Leave changes unstaged and stop for review unless the user explicitly requested another boundary.

Do not continue into the next logical change while waiting for review. An incomplete overall feature is expected during this workflow.

## Respond to review

Treat feedback as a checkpoint, not as resistance to the plan:

- Adjust or back out the current uncommitted slice when requested.
- Reduce future slice size immediately if the user says the work is too broad.
- Explain a design choice concisely when asked, then wait for acceptance or correction.
- Preserve approved earlier commits; do not rewrite them unless the user explicitly authorizes an amend or history change.

When the user approves a slice and asks to commit, follow repository verification and commit-authorization rules. Inspect the index first and commit only the changes that are already staged. Do not stage additional files, and do not include unstaged or partially staged changes, unless the user explicitly asks. If the staged set does not match the approved slice, stop and clarify rather than silently changing the index.

Keep commit count low without obscuring history. When the staged slice logically completes the immediately preceding local commit, prefer amending that commit when permitted by the applicable Git authorization rules. Never amend merely because it is technically possible, and never fold unrelated slices or user work together. Do not push unless separately requested.

When the user says “bring the next slice,” choose the next smallest dependency-ordered change, announce its boundary, implement it, inspect it, and stop again for review.

## Keep progress truthful

Do not claim the overall feature works until all required slices and final verification are complete. Track deferred integration work explicitly. At the final boundary, run the agreed full verification and compare the completed implementation against the original plan so small-slice development does not leave gaps.
