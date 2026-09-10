# INT-01: lightweight integration and local deployment

Lead B owns repository integration. Each feature has one writer, its own branch and worktree, and a small reviewable commit. The [task board](task-board.md) records the queue. A reviews physical meanings and scientific claims; successful compilation does not establish anatomical recovery.

## Checks

GitHub Actions runs one job on pull requests and pushes to `main`: Node 24, `npm ci`, `npm run lint`, and `npm run build`. The build already includes TypeScript checking (`tsc -b`). There is no deployment job, browser matrix, or broad test suite in CI. Routine changes need only these checks and a focused manual smoke check in the local app. Run a targeted existing test when the change warrants it.

Run the same checks locally from the feature worktree:

```sh
npm ci
npm run lint
npm run build
npm run preview -- --host 127.0.0.1 --port 5174 --strictPort
```

Open `http://127.0.0.1:5174/` to inspect the feature without replacing the current local deployment. Live camera, microphone and phone checks require actual device permission and remain manual. Development can use `npm run dev -- --host 127.0.0.1`.

The workflow uses the documented [setup-node/npm cache pattern](https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md). Dependencies come from the committed npm lockfile.

## Handoff and integration

1. Record the ticket, starting commit, owned paths, contract version (or pending), branch and prerequisite limitations on the board before editing. Coordinate shared-file changes through the integration owner.
2. Return a commit with the exact commands run, their results, a short manual acceptance procedure and any missing producer/device evidence. A feature can finish its scaffold while its scientific acceptance remains blocked.
3. Lead B reviews and integrates in dependency order, preserving the last working state. Resolve shared contracts with their owner; do not silently change units or fabricate producer outputs to make consumers pass.
4. On the integrated checkout, run the light checks and build the deployable `dist/`. Stop the existing local preview process deliberately, then start the command below and inspect the changed flow.
5. Push the integrated branch. After successful local deployment, remove merged feature worktrees and delete their merged branches. Update the board with the actual integrated commit and remaining evidence limitations.

```sh
npm run preview -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://127.0.0.1:5173/`. Deployment is local and manual. CI does not publish the site or open network tunnels. A phone needs a reachable secure origin for browser camera/microphone capture; pairing and hosting decisions belong to CAP-01.

## Cross-service evidence

As producers land, keep one small replay using KIT-01 contracts and real artifact references: capture → canonical audio extraction → frozen prediction → independent scoring → report. Record incompatible-version, stale-prediction or missing-input failures in the relevant ticket's focused checks. Do not add a large integration framework ahead of executable producers. Synthetic examples, webcam estimates and human sensor observations must remain distinguishable. Missing native depth is an explicit capability limitation, not a successful depth experiment.
