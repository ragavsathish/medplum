# Agent workflow

- Treat each bounded context as an independent change boundary; read its `CONTEXT.md` before editing it.
- Use one Git worktree and one Gondolin VM per PR or parallel task.
- Run dependencies, Compose, and tests inside the VM; keep ports and data inside that VM.
- Follow [`tools/gondolin/README.md`](tools/gondolin/README.md) for setup and lockfile-specific checkpoints.
- Preserve unrelated worktree changes and rebase dependent PRs in stack order.
- Finish by reporting the relevant test results and timing.
