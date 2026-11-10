# Client-aware editorial review

An editorial application that brings client context, a writing surface, and layered review into one workspace. It combines immediate pattern checks, paragraph-level AI review, and an on-demand full-document audit. Findings link back to text so an editor can assess them in context.

This is a portfolio staging copy of an MVP. Its example client and article are fictional. The design concepts shown in portfolio materials are not a screenshot of the current implementation.

## Get the source

Browse the `app/` and `engine/` directories in this repository, or download and extract [editorial-review-source.zip](editorial-review-source.zip). The source includes a fictional example and the lockfiles. Client data, dependencies, and build output are excluded.

## Run locally

Install Node.js and npm. From this directory, build the engine first and then the app:

```bash
cd engine
npm ci
npm run build
cd ../app
npm ci
npm run build
```

Start with mock AI responses so no API key or paid request is needed. In PowerShell:

```powershell
$env:BOFU_MOCK_LLM = '1'
npm run start
```

Open `http://127.0.0.1:4610`. The first run creates a fictional workspace in `app/data/`; edits and saved audits are local to that folder. It is ignored by Git.

Pattern checks run in the browser. Paragraph and document AI checks use example responses in mock mode. To use real AI responses, configure `ANTHROPIC_API_KEY` explicitly in your environment and unset `BOFU_MOCK_LLM`; requests can incur API charges and transmit submitted draft and client context to the provider.

## Review paths

1. **Pattern checks:** immediate deterministic feedback as the editor changes.
2. **Paragraph AI review:** checks settled text against the article brief and client workspace.
3. **Document audit:** runs on demand and reports a structured review with priority fixes.

The app binds to localhost and is intended for local experimentation. It has no authentication or multi-user deployment safeguards. AI feedback is advisory and requires editorial review.

## Status

The engine and app build locally. The staged example workspace has been smoke-tested via the local API; further UI, content, security, and licensing review is needed before production use. Client workspaces, saved drafts, private reports, and credentials are not included.
