# Third-party notices

## asbplayer

`packages/extension/` and `packages/asbplayer-common/` are forks of
[asbplayer](https://github.com/killergerbah/asbplayer) by killergerbah, licensed
under the MIT License. See `packages/extension/LICENSE.md` and
`packages/asbplayer-common/LICENSE.md` for the full license text.

The fork has been integrated into the Flicktionary monorepo so that selected
words and chunks from YouTube subtitles flow into Flicktionary highlights and
study sessions. All upstream asbplayer features that ride along (Anki export,
copy history, dictionary, audio recording, etc.) remain available unchanged.

## lamejs patch

`patches/lamejs@1.2.0.patch` is the upstream asbplayer patch to lamejs 1.2.0,
also covered by the LAME LGPL license. The original patch lived in
`asbplayer/.yarn/patches/lamejs-npm-1.2.0-b0315d05aa.patch`.
