# Person 1: synthwave visual theme

2026-10-31. P1's UI no longer reproduces Spotify's visual design. Fonts, colours, surfaces and lighting now follow an original synthwave style. Layout, controls, keyboard behavior and every feature are unchanged.

## Scope: other owners are not affected

- All rules are in `src/synthwave.css` and are prefixed with `html.synthwave`.
- Only P1's `App` adds that class on mount and removes it on unmount (`src/main.tsx`).
- P3's `CloudApp` uses many of the same class names (`hero`, `table`, `tr`, `dialog`, `toast`, …) and loads the same stylesheets. The scope keeps it unchanged. Verified in the default desktop build: no theme class, its original font, a black background, its own green accent, and no grid.
- No P2, P3 or P4 files, shared configs, dependencies or the lockfile changed. The base stylesheets were not edited. The theme is a layer on top of them.

**Rule for future styling:** put P1 visual changes under `html.synthwave …`. An unscoped rule in a shared class restyles P3's screen too.

## Design

| Element | Treatment |
| --- | --- |
| Background | Night-sky gradient with a magenta horizon glow and a perspective neon grid (`body::before`, behind all panels) |
| Panels | Translucent indigo glass, a magenta edge and a violet glow, 14px corners |
| Headings | Orbitron. Page titles use a sunset gradient (yellow → orange → magenta → violet) with a soft glow |
| Body text | Exo 2, light lavender text, muted violet for secondary text |
| Accent | Cyan (`--accent`) for the now-playing state, active toggles and focus rings. Magenta for hover edges, selection and sliders |
| Play buttons | Sunset gradient disc with a magenta halo. Icons stay black for contrast |
| Chips and pills | Violet outline in Orbitron. The selected chip gets a neon gradient fill |
| Menus, submenus, dialogs, toasts, notices | Dark violet glass, magenta edge, cyan focus, cyan toast border, cyan notice bar |

Tokens are on `html.synthwave` (`--sw-*`), and the base tokens (`--accent`, `--surface`, …) are redefined there, so existing rules adopt the palette.

## Fonts and provenance

Bundled locally, because the production CSP allows only `font-src 'self' data:`, so hosted fonts would be blocked. Taken unmodified from the official [google/fonts](https://github.com/google/fonts) repository:

| File | Family | License | SHA-256 |
| --- | --- | --- | --- |
| `src/fonts/Orbitron-Variable.ttf` | Orbitron (The Orbitron Project Authors) | SIL OFL 1.1, `Orbitron-OFL.txt`. Reserved Font Name "Orbitron" | `f42db2dd16e642258e35782916eceb1dcdbea06fb958d77ad71dc5963587e8fd` |
| `src/fonts/Exo2-Variable.ttf` | Exo 2 (The Exo 2 Project Authors) | SIL OFL 1.1, `Exo2-OFL.txt` | `205a448676a2586f9c57c25f3d5c58ca8db7e6cf5edf7506783a010c6fe2bfb5` |

Keep the OFL files beside the fonts and include them in release notices. Do not modify the fonts under these names.

Content that still comes from Spotify (the user's own playlist covers and the "petal" release card on Home) is data, not styling, and is unchanged.

## Verification

Prototype desktop build (`VITE_FYSPOTI_DESKTOP_MODE=prototype`), driven over DevTools:

- The `synthwave` class is present, and `document.fonts` confirms Orbitron and Exo 2 loaded. Body text renders in Exo 2 and headings in Orbitron.
- No CSP violations and no exceptions.
- These still worked: track context menu and Add to playlist submenu (focus in Find a playlist), playback (0:01 / 2:36), the Queue panel, and P4 search (14 songs, 6 cards).
- Fixed during review: Orbitron's wider caps wrapped "DATE ADDED" (now `nowrap` with tighter tracking), and the Queue header kept a near-black strip.
- Typecheck passed, 228 unit tests passed, plus P2's 6 and the contracts' 18.

Not verified: Windows high-contrast mode and DPI variants. Contrast was checked by eye only, not measured.
