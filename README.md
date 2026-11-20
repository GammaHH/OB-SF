# OB-SF worktree backup · 2026-11-21

This independent backup branch contains selected untracked and ignored project files. The tracked project history is available on main at the commit listed in backup-manifest.json.

- local/ is the original OB-SF vault.
- codex-worktree/ is the Codex worktree.
- Paths after each prefix match paths in the source vault. Restore into a different directory first and compare SHA-256 before copying to an active vault.
- backup-manifest.json lists the source commit, original file path, byte count and SHA-256 of every backed-up file.
- Local workspace state, credential-bearing or personal material, reinstallable plugins and redundant indexes stay on the original machine. Exclusion counts are listed in the manifest.