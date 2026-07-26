# BODY//KNOT

> A 32×32 biological horror arcade game about growing a living chain inside a host that eventually notices the hand controlling it.

## Play

**Live build:** _add the Vercel URL here_  
**Game Jam page:** _add the vibecode.game URL here_  
**itch.io:** _optional — add later_

BODY//KNOT is free to play in a desktop web browser. No login or download is required.

## About

You are a parasite moving through a constrained 32×32 biological interface.

Cross your own living chain around immune cells to assimilate them. Each successful knot adds new links to your body. Use the mouse Focus to gather cells, avoid or capture the Cutter before it severs your chain, and survive long enough for the host to understand what is really moving inside it.

The final phase changes the relationship between player, cursor and body: distract the Observer with your hand while forming one last knot around the Host Core.

## Core Loop

1. Move through the host with the keyboard.
2. Cross your own chain to close a knot.
3. Assimilate enclosed immune cells.
4. Grow longer and create larger capture opportunities.
5. Protect the chain from the Cutter.
6. Reach the revelation and bind the Host Core.

## Controls

| Input | Action |
|---|---|
| `WASD` / Arrow Keys | Move |
| `Space` | Dash |
| Mouse | Move Focus / bait the Observer |
| `Esc` | Pause / close settings |

## Features

- Continuous self-knotting mechanic inside a logical 32×32 arena
- Physical segmented living chain
- Mouse Focus that gently gathers ordinary cells
- Live capture preview and candidate highlighting
- Cutter enemy that telegraphs and severs threatened links
- Persistent necrotic scars from severed connections
- Fourth-wall horror reveal with local voice acting
- Final two-input challenge: move the body while distracting the eye
- Original procedural ambience and sound effects
- Music, voice and SFX sliders
- Captions, reduced motion, contrast and screen-shake options
- English, Portuguese and Spanish interface support

## Technology

- Next.js
- React
- TypeScript
- Zustand
- HTML5 Canvas 2D
- Web Audio API

## Local Development

Requirements:

- Node.js 20 or newer
- npm

Install and run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Production checks:

```bash
npm run lint
npm run build
```

## Audio

BODY//KNOT combines:

- local voice assets generated with Gemini Text-to-Speech;
- manual editing and loudness work in Audacity;
- original procedurally generated WAV ambience and SFX;
- runtime Web Audio synthesis.

See:

- [Credits](./CREDITS.md)
- [Third-Party Notices](./THIRD_PARTY_NOTICES.md)
- [Audio Documentation](./docs/audio/README_AUDIO.md)

## Game Designer Mind Collaboration

The Game Designer Mind was a recurring design collaborator across the project lineage that evolved from PATCH32 into BODY//KNOT.

After an early prototype failed playtesting, it reframed the fantasy around an infected 32×32 system and an immune response, explored reactive cable topology, and repeatedly reviewed the design for strategic depth, first-90-second clarity, accessibility, minimalism and Game Jam judge impact.

Several Mind-recommended prototypes were implemented and later rejected when testing showed they were too passive or shallow. BODY//KNOT retained the strongest foundations—parasite pressure, living connections, severance, constrained short-form play and a system that becomes visibly alive—while the final self-knot mechanic, Focus cursor, eye reveal, Host Core finale, implementation and release decisions remained under human direction with support from ChatGPT and Codex.

Selected evidence is available in [`docs/screenshots/`](./docs/screenshots/) and summarized in [`docs/README.md`](./docs/README.md).

## Credits

**Design and Development**  
Marcos Beltrão — Shadowchar Studio

**Game Design Collaboration**  
Game Designer Mind — Minds by Animoca Brands

**Development Assistance**  
ChatGPT, OpenAI Codex and ChatGPT Game Studio

**Voice**  
Generated with Gemini Text-to-Speech

**Voice Direction and Audio Editing**  
Marcos Beltrão

**Original Procedural Sound Design**  
Marcos Beltrão with ChatGPT

## Release

BODY//KNOT was created for the VibeBlitz x Minds by Animoca Brands Game Jam in July 2026.

The game is intended for desktop browsers and is best experienced with headphones.

## Repository Use

The source code is publicly visible for portfolio and judging purposes. No permission is granted to redistribute the game, its branding or its original audiovisual assets without authorization.
