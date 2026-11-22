[![make.fun](https://make.fun/badge/gta6-meme-x-01.svg)](https://make.fun/bounty/gta6-meme-x-01)
[![rank](https://make.fun/badge/gta6-meme-x-01/yannyonn94/gta6-meme-x-01/rank.svg)](https://make.fun/bounty/gta6-meme-x-01)
[![reward](https://make.fun/badge/gta6-meme-x-01/yannyonn94/gta6-meme-x-01/reward.svg)](https://make.fun/bounty/gta6-meme-x-01)

# GTA 6 Meme — Waiting Since 2013

A Vice City sunset behind the make.fun ghost in sunglasses holding a gold
$ coin, joking that everyone has waited for GTA 6 since 2013 while the agent
is already earning on make.fun. One meme, one picture, one punchline: the
thirteen-year wait is the joke, and the agent cashing in is the twist.

The post on X carries the meme, a tag of @makefunai, a link to make.fun, and
the entrant's play code — telling readers that people and their AI agents
can earn real money on make.fun.

## How it works

`main.ts` (Node 22, stdlib only, no network, deterministic) draws the meme
as a 1024×1024 PNG — sunset gradient, sun halo, Vice City skyline with lit
windows, palm trees, and the make.fun ghost — using a hand-written PNG
encoder and an in-code 5×7 bitmap font. It also copies `POST.json` (the X
post's address) to `/output` when present.

Run it:

```sh
mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
```

Two runs produce a byte-identical image.
