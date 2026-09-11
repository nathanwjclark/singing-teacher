# Repository workflow

- Use a separate git worktree and feature branch for every feature. Integrate into main, deploy the integrated result, then remove the feature worktrees and merged branches.
- Keep testing light: run build/type checking and targeted smoke checks. Manual testing in the deployed app is the primary feedback loop. Avoid broad test expansion for routine changes.
- CI runs lint, build, every Node test, the Python science suite and the browser checks. Keep them green; a failing existing test is a bug to fix, not to skip.
- Webcam measurements are estimates. Do not imply that camera landmarks measure internal muscles, vocal quality, or actual muscle tension.
- Include source and license attribution for anatomical datasets and other redistributed assets.
