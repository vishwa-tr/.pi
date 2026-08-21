---
name: readable-code
description: Preserve named values, logical spacing, local structure, and straightforward React patterns when writing or reviewing code. Use for implementation and refactoring where readability, state design, or easy debugging matters.
---

# Readable Code

## Purpose

Prefer the smallest clear implementation. Preserve code that is easy for a human to scan, debug,
and extend; do not optimize for the fewest lines. Follow project-local conventions and surrounding
code before these defaults.

## Named Values

Build a non-trivial query, payload, filter, or configuration object in a named variable before the
call that consumes it:

```js
const appointmentQuery = { patientId: patientId };

if (status != null) {
    appointmentQuery.status = status;
}

const appointmentDocs = await appointmentModel.find(appointmentQuery).lean().exec();
```

A short literal that is complete and unlikely to grow can remain inline. Land awaited results in a
named variable before passing them to another call when that makes the operation easier to inspect.

## Vertical Spacing

Use blank lines to separate logical steps:

```js
const rangeEnd = dateService.add24Hours(date);
const rangeStart = dateService.convertToStartOfDay(date);

query.date = { $gte: rangeStart, $lt: rangeEnd };
```

Typical boundaries are validation, construction, execution, and result handling. Preserve useful
spacing already present in a file.

## Naming And Structure

Read surrounding functions before introducing names. Match local vocabulary such as `query`,
`validation`, `verified`, or `result` rather than adding a parallel naming scheme.

- Keep named queries, payloads, configuration objects, and intermediate values when they improve
  scanning or extension.
- Use one named `useState` per value; avoid generated state bags and implicit object spreads.
- A hook that wraps one behavior should return that behavior directly.
- Prefer specific functions over one generalized function held together by refs and branching.

## React Identity

Do not add `useMemo`, `useCallback`, `React.memo`, or ref workarounds without a concrete identity
consumer. When stable identity is required, name that dependency or lifecycle reason in the design
rather than applying memoization speculatively.

## Refactors

- Preserve existing readable structure unless changing it is part of the task.
- Do not inline named values or repeated property access when the named form is clearer.
- Do not remove blank lines merely to shorten a function.
- Do not bundle unrelated readability cleanup with a functional change.
- Let local project conventions and formatters override this skill.

## Comments

Do not add comments that restate code or narrate straightforward behavior. Use source comments only
for constraints a reader would otherwise break, such as external bugs or required ordering. Put
routine rationale and background in the task report or commit message instead.
