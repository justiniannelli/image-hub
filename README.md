# Image Hub

A personal AI image hub: generate with Gemini and OpenAI from one place, keep every prompt and image in a searchable archive, and reuse saved looks with `@style` mentions.

**Status: written but never run.** It was authored without Node available, so expect to fix a bug or two on first launch.

## Features
Laid out like a typical AI image studio: a light home screen and a dark full-screen viewer.

- **Home:** search, a filter by medium (Photoreal, 3D render, Diagram, Line drawing…), All / Fav tabs, a row of folders, and a grid of every image with a star to favorite it.
- **Folders:**
  - *Style folders* hold example images plus a description (e.g. `axon`, `diagrams`, `photorealistic`). Type `@axon` in any prompt and the description is added and up to 3 of the images are sent as style examples.
  - *Project folders* keep a project's images together. Deleting one keeps its images.
- **Prompt box** floating at the bottom: attach reference images (+ or drag in), *Auto-improve* (Gemini rewrites your prompt with more detail first), pick the AI and image shape, choose which folder to save in.
- **Viewer:** model and date at the top; star, download, delete; versions v1, v2, v3… down the left; the prompt at the bottom. Click the prompt to see *Your prompt* and the *Prompt used*, with Copy buttons, plus the references, medium and folder.
  - *Edit Prompt* makes a new version from the same reference images (so quality doesn't drift).
  - *Remix* sends the current image along as the starting point for a change.
- **Prompt assistant:** the purple button, bottom right. "Use as prompt" fills whichever prompt box is in front.
- Password login, SQLite database, images stored on disk.

## Run locally
Needs Node 20+ (22 recommended).

```bash
npm install
npm run build
cp .env.example .env   # then fill in keys (on Windows: copy .env.example .env)
npm start
```

Open http://localhost:3000. For live-reload development run `npm run dev:server` and `npm run dev:client` in two terminals, then open http://localhost:5173.

## Host it
**Free and private:** see [DEPLOY.md](DEPLOY.md) (Oracle Cloud free server + Tailscale).

**Paid hosts:**
Any host that runs a Docker container and offers a **persistent disk** works (Fly.io, Railway, Render). Settings:
- Build from the included `Dockerfile`.
- Mount a persistent volume at `/data` (the database and images live there; without it you lose everything on redeploy).
- Set `APP_PASSWORD`, `SESSION_SECRET`, `GEMINI_API_KEY` and/or `OPENAI_API_KEY` as secrets.
- Use HTTPS (hosts provide it). Never deploy without `APP_PASSWORD`: the keys are billable.

## Notes
- Model IDs change often. Override them with `GEMINI_IMAGE_MODEL` / `OPENAI_IMAGE_MODEL` if you want a newer model; the defaults are `gemini-3.1-flash-image` for images and `gemini-3.8-flash` for the prompt assistant.
- Generation is synchronous (the request waits for the model), so a slow model may take up to a minute.
- The medium tag is guessed from words in the prompt; change it in the viewer's prompt panel if it's wrong.
- Not built yet: Animate (video), Upscale, Crop, multi-user accounts, sharing, a firmwide shared library.
