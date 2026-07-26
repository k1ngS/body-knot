# BODY//KNOT Project Rules

## Product

BODY//KNOT is a dark minimalist browser game built for a game jam.
The world is a continuous 32×32 biological arena.

## Architecture

- Use Next.js App Router, TypeScript, Tailwind CSS, Zustand and Canvas 2D.
- React renders menus, overlays, HUD and accessibility controls.
- Canvas renders all gameplay.
- The simulation must use a fixed 60 Hz timestep.
- Keep gameplay simulation separate from React rendering.
- Do not add a backend, login, API, database or online leaderboard.
- Do not add a physics engine.
- Do not add third-party runtime assets.
- Do not modify anything inside reference/.
- All user-facing text must be centralized for future localization.

## Visual direction

- Minimalist occult-biotech horror.
- Near-black background.
- Clear pale silhouettes.
- Restrained violet, cyan and dark red accents.
- No visible square grid.
- Avoid large dashboard panels during gameplay.

## Quality

- No console errors.
- No hydration errors.
- Audio starts only after user interaction.
- Respect reduced motion, captions, audio mute and screen-shake settings.
- Run lint and production build before reporting completion.
- Do not commit changes automatically.
- Do not redesign the approved concept.
