# Security Policy

## Reporting a vulnerability

Please **don't report security vulnerabilities in public issues, discussions or pull requests.**

Report them privately through GitHub: open the repository's **Security** tab and click **Report a vulnerability**. Only the maintainers can see the report.

Please include:

- what the vulnerability is and what an attacker could do with it
- steps to reproduce, or a proof of concept
- the affected version or commit
- any suggested fix, if you have one

## What to expect

- We'll acknowledge your report within **5 working days**.
- We'll keep you updated while we investigate and fix it.
- Once a fix is released, we'll credit you in the advisory unless you'd rather stay anonymous.

## Scope

In scope: the code in this repository, including the Next.js app (`src/`), the worker (`engine/`), and the Docker setup.

Out of scope:

- vulnerabilities in third-party dependencies with no Rowsmith-specific impact (report them upstream)
- your own deployment's configuration, for example exposing MongoDB or Redis to the internet or leaking your `.env`
- cost from Gemini API usage on an instance you run publicly. Rowsmith has no auth by default; see "Limits and abuse protection" in the [README](README.md).

## Supported versions

Only the latest version on the `main` branch receives security fixes.
