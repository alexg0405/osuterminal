# Legal notes

This is **not legal advice**. It is what this project is, what it is not, and where
the official osu! documents live so you can read them yourself.

osuterminal is an **unofficial fan project**. It is not affiliated with, endorsed by,
or sponsored by ppy Pty Ltd or osu!. For trademark questions, ppy's contact is
[contact@ppy.sh](mailto:contact@ppy.sh).

## Name and branding

- The npm/bin name is `osuterminal` (no `!`). That is deliberate: osu!'s
  [brand identity guidelines](https://osu.ppy.sh/wiki/en/Brand_identity_guidelines)
  use `osu!direct`, `osu!stream`, and similar **without a space** for official
  products. This client should not look like one of those.
- We do **not** ship or draw the osu! cookie logo, pippi, or other official art.
- The wiki also notes that using the "osu!" or "ppy" names **in software** is a
  trademark matter and is not covered by the wiki's CC licence. If ppy asks for a
  rename or a clearer mark, do that.

## This program's code

The client (parser, renderer, audio mixer, installer) is original work under the
MIT licence in `LICENSE`. 100-hit windows follow osu!standard. 300s are 30ms
wider and 50s are 30ms tighter than stable so blues are easier and yellows are
rarer. Other gameplay values (stacking, grades) follow public osu!standard
behaviour; they are not a copy of the closed-source stable client. Default
hitsounds are **synthesized** here. We do not copy samples out of an osu! install.

## Maps and music

Beatmaps and their audio/art belong to the mappers and rights holders, not to this
project and not automatically to the person who downloads them.

- **Bundled maps** (Warmup, First Steps) use original audio written for this
  package, so they can ship on npm.
- **`osuterminal usesongs`** only *reads* `%LOCALAPPDATA%\osu!\Songs` (or the
  equivalent). It does not copy the library. Those files are ones you already
  obtained through osu!.
- **`--download` / `\`** fetches `.osz` files from **third-party mirrors**
  (osu.direct, nerinyan, sayobot), not from osu.ppy.sh and not through an official
  osu! API key. osu! does not grant this project a licence to those songs. Treat
  downloads as personal use, expect maps to disappear when a rights holder asks,
  and prefer `usesongs` if you already have osu!.

osu!'s own position on user-uploaded maps and DMCA is at
[osu.ppy.sh/legal/copyright](https://osu.ppy.sh/legal/en/Copyright). Their terms
of service are at [osu.ppy.sh/legal/terms](https://osu.ppy.sh/legal/en/Terms).

## What this client does not do

No online play, no ranking servers, no osu! account login, no shipping of osu!
client assets. It is a local, offline player for `.osu` charts in a terminal.

## Reporting a problem

Copyright complaints about maps on osu! itself go to copyright@ppy.sh (their
designated agent). Problems with *this* repository (wrong asset shipped, naming)
can be opened as a GitHub issue or sent to the maintainer listed on npm.
