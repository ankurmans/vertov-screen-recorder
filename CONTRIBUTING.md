# Contributing to Vertov

Bug reports, fixes and improvements are welcome.

## Before you start

- For anything larger than a small fix, open an issue first so we can agree on the approach.
- Some features exist only in the hosted service at vertov.app (see the README). Pull requests that
  rebuild those here are unlikely to be merged.
- Report security problems privately through GitHub's "Report a vulnerability" button on this
  repository, not in a public issue.

## Contributor License Agreement

Every pull request author agrees to the [Contributor License Agreement](CLA.md) once, before their
first pull request is merged. You keep the copyright in your work; the agreement lets the
maintainer use it in the hosted service as well as here. To agree, comment on your pull request:

> I have read the Vertov Contributor License Agreement (CLA.md, version 1.0) and I agree to it.

If you are contributing for your employer, name the organisation in the same comment and make sure
you have its permission.

## Making a change

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm run db:migrate:local
pnpm run dev
```

Before opening a pull request, run `npx tsc --noEmit` and `npx vite build`, and describe how you
tested the change. Keep pull requests focused on one change.
