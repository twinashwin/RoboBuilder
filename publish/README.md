# RoboBuilder

Snap together robot parts, program them with visual blocks, and watch them move in real-time simulation. A no-build vanilla-JS web app — no npm, no bundler, no TypeScript.

## Run locally

```
node serve.mjs
```

Then open `http://localhost:3000`. Requires Node 18+. Zero dependencies.

## Deploy

Drop this folder onto GitHub Pages (or any static host) — it's already wired up to a working Supabase project, so login, email verification, and cross-browser cloud sync work out of the box.

## Use your own Supabase project (optional)

If you want to fork this and run it against your own backend instead of the bundled one:

1. Create a free project at <https://supabase.com>.
2. In the Supabase SQL editor, run [`db/supabase_init.sql`](db/supabase_init.sql) — this creates the `saves` table and the Row-Level Security policies that isolate each user's data.
3. In **Authentication → URL Configuration**, set the **Site URL** and **Redirect URLs** to include both your deployed URL (e.g. `https://<user>.github.io/<repo>/`) and `http://localhost:3000`.
4. Open [`js/auth/supabaseClient.js`](js/auth/supabaseClient.js) and replace `SUPABASE_URL` and `SUPABASE_ANON_KEY` with your project's values from **Project Settings → API**.

## Security note

The Supabase **anon key** shipped here is safe to commit — it's public by design, and the RLS policies in `db/supabase_init.sql` enforce per-user data isolation server-side. Every Supabase-backed static site has its anon key in the browser bundle.

**Never** replace it with a `service_role` key. The service-role key bypasses RLS and grants superuser access — it must stay on a server you control, never in client code.

## Project structure

```
index.html              ← entry point
serve.mjs               ← zero-dep dev server
css/main.css            ← all styles, design tokens in :root
db/supabase_init.sql    ← `saves` table + RLS
js/
├── app.js              ← top-level orchestration
├── core/               ← physics, geometry, sensors
├── canvas/             ← 2D + 3D build, sim, properties panel
├── coding/             ← Blockly + code execution
├── lessons/            ← lessons, tutorials, challenges
└── auth/               ← Supabase auth + cloud sync
```
