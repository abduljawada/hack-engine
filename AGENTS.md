# Project instructions

## Release tags

Whenever a version release receives a Git tag (for example, `v1.2.0`), push both the tagged commit's branch and that specific tag to the GitHub remote `origin` as part of the same release workflow. Do not leave a release tag only in the local repository.

- Verify that the remote tag resolves to the intended release commit before reporting completion.
- If a push fails, resolve the problem where possible and clearly report any remaining blocker.
- Never force-push or replace an existing release tag without explicit user approval.
