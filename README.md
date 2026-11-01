# 🎲 Roleplay20

A private virtual tabletop for Dungeons & Dragons 5e where **Claude is the Dungeon Master**. Think Roll20, but the DM
builds the world, voices every NPC, runs the monsters and narrates one shared story for the whole table, keeping a
moment private only when it really is (a secret roll, a whisper, a character off on their own).

**Play:** https://josephjackman.com/roleplay20 (password protected; the game server runs around the clock on Fly.io)

## What it does

- **Privacy gate.** One shared password before anything else loads. Three wrong tries lock that device and network out
  for 24 hours (the host can clear lockouts with `npm run unlock`). Only the gate page is public; the rest of the app is
  downloaded from the game server after the password is accepted.
- **Accounts.** Everyone signs in with their own username and password. Each person can be in many campaigns and join
  one with a 6-letter invite code.
- **Session zero by AI.** Describe the story you want; Claude writes a world bible (what players know), DM secrets and a
  story arc (hidden), NPCs with distinct voices, a starting town map and opening quests.
- **Character creation.** A guided builder with all SRD races, classes, backgrounds, ability scores (standard array, point
  buy, 4d6 or your own), skills and expertise, spells, starting gear, portrait, and an "Ask the DM" button that drafts a
  personality and backstory tied to the campaign world.
- **Character sheet (two pages).** Page 1: abilities, saves, skills, attacks, HP, conditions, death saves - click
  anything to roll. Page 2: **Spells & Abilities** - spell slots and every limited-use class ability (Rage, Ki, Second
  Wind, Channel Divinity…). Casting asks which slot level to use and spends that slot.
- **Only the DM changes stats.** Players can't edit hit points, spell slots, uses, Inspiration, coins, items,
  conditions or experience. They say what they do ("I buy the rope", "I use my Inspiration", "we make camp") and the
  DM applies it: it charges coins (paying with change), adds and removes items, heals and hurts, grants rests and Hit
  Dice, and marks abilities used. Fights and spells cast from the sheet are handled by the rules engine. Between
  sessions the sheet is read-only except for your picture (click it to change it any time). During a session you can
  light a torch, end concentration, choose what you wear and wield (not mid-fight) and, right after a long rest,
  change prepared spells.
- **Experience and levels.** XP comes from defeated enemies, completed quests (a quarter of a level by default, more
  for big story goals) and other wins the DM rewards: solved puzzles, discoveries, hard-won talks. The DM can also give
  a milestone level. When a level is ready, the **level-up wizard** (during a session, not mid-fight) asks which class
  gains it - one you have, or a new one if your ability scores allow multiclassing - then walks through hit points,
  features, subclass, ability scores and spells, and repeats if more levels are waiting.
- **Retiring and replacing heroes.** "Retire" at the bottom of the sheet takes a character out of play for good, with
  an optional farewell. Their story stays: the journal, the logs and the DM remember them, and the Party panel lists
  former members. A hero who dies must be laid to rest the same way. The new character is built at the party's level
  (with matching XP), and the next session waits until they're ready.
- **One shared story.** Everyone sees what everyone declares and what happens, addressed by name in one narration.
  The DM writes a private line only when it makes sense: a secret roll, a language only one character speaks, someone
  in another room, or an action a player marks Private that their character could actually do unnoticed. A "private"
  shout or sword swing still happens in plain view.
- **Everyone acts, then the DM narrates.** Each player writes what they do and presses Ready. When everyone is
  ready, the DM resolves all actions together, asks for rolls where the outcome is uncertain, and narrates. If someone
  declares more than one turn holds (three attacks and a sprint), the DM doesn't pick for them: it privately tells that
  player the most they can do, reopens their action to edit, and resolves the round once they've revised it.
- **The whole table, or nobody.** A session begins only when every player is at the table and someone presses
  **Begin session**. If anyone drops off, the game pauses until they're back. Between sessions (or while paused)
  everyone can still read their sheet, maps, handouts and the journal, and chat.
- **Your dice or ours.** Every roll request has "Roll for me" or a box to type what your real d20 showed.
- **Type or talk.** Your action and table talk each have a 🎤 button for voice typing (Chrome, Edge and Safari): speak
  and your words appear in the box, ready to edit. Switching between the two keeps both drafts, and each box only sends
  its own text.
- **Voices.** The story is read aloud with the browser's built-in voices. Every NPC keeps their own voice (gender, age,
  accent, pitch, speed) for the whole campaign - the old lady always sounds like the old lady. Best in Microsoft Edge.
- **Maps.** Town and region maps appear as you discover places; the full map must be found, bought or given in the story.
  Open any map full screen from the Maps & handouts panel and pick a place to light it up. "Hide map" folds the map
  away so the story can use the whole screen.
  Battle maps are generated for scenes and fights with **dynamic lighting and fog of war**: each player sees only what
  their character can see (darkvision, torches, walls, doors). Hidden enemies stay invisible to a player until that
  character notices them - one player may see the goblin while another doesn't. When the story moves people (the party
  climbs to the balcony, an NPC walks in, an enemy creeps out of the dark), the DM moves their tokens to match.
- **Clean combat.** Initiative, turn order, movement limited by speed and terrain, attacks and spells against real AC and
  saving throws, area templates (cones, spheres, lines) that hit everyone inside - friends too - concentration, death
  saves, advantage from conditions and lighting, Sneak Attack, Divine Smite, Rage. Claude plays the monsters with tactics
  that fit them (or switch to instant "quick tactics" on the DM Screen).
- **Documents panel.** Sheet, spells, inventory, private notes, maps and handouts, quests, the people you've met (with a
  "hear their voice" button), the journal (world bible and session logs), party status and a rules reference.
- **Session logs.** Ending a session makes the DM write the campaign log, a "previously on…" recap, NPC and quest
  updates and a compressed memory for future sessions. The top of the journal always shows "The story so far":
  older sessions in a line each, the latest one or two in more detail. Every journal page and handout can be read aloud.
- **DM Screen** (campaign owner): model and effort, enemy tactics, AI cost so far, retry, skip turn, end combat, narrate
  by hand as the narrator or any NPC, and an optional spoiler "god view".

## Joining a game (players)

1. Open https://josephjackman.com/roleplay20 and type the site password the host gave you.
2. Create an account, then paste the 6-letter **invite code** from the host and press Join.
3. Make your character (the "Draft for me" button helps), then **Enter the table**.
4. Each round: read your narration (the cards marked *only you* are yours alone), write what you do, press **Ready**.
   When the DM asks for a roll, press **Roll for me** or type what your real d20 shows.
5. In a fight, it's your turn when the Turn panel appears over the map: drag your token to move, pick an attack and
   click an enemy, or cast from the ✨ Spells panel. Press **End turn** when you're done.

Tip: use Microsoft Edge or Chrome for the best NPC voices, and turn on 🔊 in the top bar.

## Running it (host)

The game server runs on [Fly.io](https://fly.io): one always-on machine near Chicago (shared CPU, 512 MB) with a 1 GB
volume for accounts, campaigns and characters. Nothing has to run on your own PC. You need Node.js 22+, the GitHub CLI
(`gh`, signed in) and an Anthropic API key on the PC you set it up from.

1. `npm run setup` - sets the site password, stores your API key in `.env` (never committed), picks the DM model and
   builds the app. It also (once) creates the public `roleplay20` GitHub repo and turns on GitHub Pages so the gate
   appears at josephjackman.com/roleplay20.
2. `npm run cloud-setup` - installs the Fly.io tool, opens a browser so you can sign in (add a card under Billing),
   creates the app and its volume, copies the settings from `.env` as Fly secrets (values never shown), deploys,
   moves saved games from `data/` once, and writes the cloud address to `server.json` on the `live` branch, where the
   gate page looks it up. Run it again after changing `.env` (a new API key or site password).
3. `npm run deploy` - push code changes to the cloud server.

Useful: `fly logs -a roleplay20` (server log), `fly status -a roleplay20`, `fly ssh console -a roleplay20` (the saved
games are in `/data`). Fly.io billing: about $4 a month for this machine and volume, plus AI usage below.

The gate page asks the address in `server.json` first, so the server can move (another app name, another host) without
changing the website. `TUNNEL=auto npm start` still hosts from a PC through a free Cloudflare tunnel for testing, but
it publishes that PC's address, so the website stops using the cloud server until `npm run cloud-setup` runs again.

Everyone sees each declared action when the round resolves, except actions marked Private (only that player and the DM).

### Why an API key and not the Claude subscription

Anthropic's terms (https://code.claude.com/docs/en/legal-and-compliance) don't allow routing other people's requests
through a Pro/Max subscription login; apps like this must use an API key. If you're on a **Max** plan, your plan includes
monthly API credits for your own apps: claude.ai → Settings → Billing → link a Claude Console organization, then create
the key at platform.claude.com.

### What it costs (API key)

Measured from real prompts: a story turn is ~7K cached + ~7K new input tokens and ~3K output tokens (including
thinking); an enemy turn in combat is roughly a third of that. A typical 3-hour session (~40 story turns, ~40 enemy
turns) costs about:

| DM model | per session | notes |
|---|---|---|
| Claude Opus 5.5 (default) | ~$3 to $6 | richest narration and NPCs |
| Claude Sonnet 5.5 | ~$1.50 to $3 | faster replies, very good storytelling |
| Claude Haiku 5.5 | ~$0.10 to $0.30 | quickest and cheapest, simpler prose |

Building a new world is a one-off ~$0.30 on Opus. Switch models any time on the DM Screen; it shows the running cost.

## Development

```
npm install
npm run dev        # server on :3020 (no tunnel) + Vite on :5173 with hot reload
npm test           # rules, dice, characters, maps, vision, pathing, templates, gate
npm run build      # SRD data + client bundle
```

`node server/index.js --no-tunnel --ai=file --data=data-test` runs with a file-based test DM: each DM request is written
to `data-test/ai-inbox/*.prompt.md` and the server waits for a matching `*.response.json`.

```
server/        Express + Socket.IO server: gate, accounts, campaigns, game engine, combat, AI Dungeon Master
  game/        engine (rounds, rolls, effects, sessions), combat, views (per-player privacy), maps, vision, pathing
  ai/          Claude client (Messages API, structured outputs, prompt caching), prompts, JSON schemas
shared/        rules engine, dice, character builder, spell templates, compiled SRD data (used by server and client)
client/        React app: lobby, character creator, character sheet, game table, map renderers
site/          the public password gate (GitHub Pages)
docs/          CONTRACTS.md - shared data formats
```

The DM's instructions in `server/ai/prompts.js` are distilled from the campaign skills (world-builder, character-creator,
npc-and-encounter, rules-adjudicator, consistency-checker, puzzle-designer, map-maker, session-logger, wrap-up-the-day,
character-manager).

## Credits

Rules content from the **System Reference Document 5.1** by Wizards of the Coast LLC, licensed under
[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). SRD data via [5e-bits/5e-database](https://github.com/5e-bits/5e-database) (MIT).
