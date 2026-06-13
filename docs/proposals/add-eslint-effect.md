3. The effect plugin: yes, but the false-positive strategy matters more than the plugin

Installing it as warnings is the easy part. The thing that decides whether it helps or hurts a weaker model is the baseline. A lint output that
permanently contains 15 known-false warnings trains the model to ignore lint output entirely — that's how you get goose chases and missed real issues.
The discipline that works:

- One triage pass now, while you have a strong model: run it across the repo, fix the true positives, and suppress each false positive with //
  eslint-disable-next-line react-you-might-not-need-an-effect/<rule> -- <why this effect is genuinely needed>. The -- reason is doing double duty: lint
  output stays clean, and the justification sits in the code right where a model would otherwise "fix" it.
- Enforce that suppressions carry reasons (@eslint-community/eslint-plugin-eslint-comments's require-description) and set reportUnusedDisableDirectives
  so stale suppressions get cleaned up.
- After triage, the steady-state signal is: any warning is new and worth investigating. That's the same property that makes your extension typecheck gate
  useful. If a specific rule proves chronically noisy for your patterns, disable that one rule rather than tolerating its noise.
- Tradeoff to consider: once you're at zero, --max-warnings 0 in CI keeps you there. "Warnings not errors" is fine for the editor experience, but a
  warning count that's allowed to drift up quietly decays back into wallpaper.