# Changes in the 27 November 2026 release (console)

What changed in this repository. What it means for a pipeline is in [`../../UPGRADE.md`](../../UPGRADE.md).

| File | What it is |
|---|---|
| `console-files-since-2026-11-24.txt` | every file changed since the code pushed on 24 November (`e36228b`): `A` added, `M` modified, `D` deleted (none) |
| `console-since-2026-11-24.patch` | the full diff since `e36228b` (`git apply` can replay it) |

The same diff from Git: `git diff e36228b origin/abb-platform`.

For a pipeline that still builds branch `abb-brand` (the console-only build of 17 November): list what changed with
`git diff --name-status origin/abb-brand origin/abb-platform` (92 files deleted), and build from `abb-platform`.
