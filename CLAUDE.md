# CLAUDE.md

## No comments in code

Never write a comment in any code file. Comments go stale and mislead agents; the why goes in the commit message and the PR description. Only behaviour-changing tool directives stay: `eslint-disable*`, `oxlint-disable*`, `@ts-expect-error` / `@ts-ignore` / `@ts-nocheck`, `/// <reference`, shebangs, `//go:build`, `# syntax=` in Dockerfiles, `# shellcheck`, `# noqa`, `# type: ignore`, `/* webpackChunkName */`, `@vite-ignore`, `prettier-ignore`, `biome-ignore`, `istanbul` / `c8 ignore`, `@vitest-environment`, `@jsx` / `@jsxImportSource`, `/*!` and `@license` headers. Generated files (lockfiles, `*.gen.ts`, migrations and their `meta/`) stay as their generator writes them; Markdown is not code.
