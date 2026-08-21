# Non-root container volume permissions

## Goal

Deploy a container as a fixed unprivileged user while keeping persistent application state writable and preventing automatic ownership changes to large bind-mounted data sets.

## Requirements

1. Use a named volume as the zero-surprise default for small persistent application state.
2. State the effective permissions required for every bind mount rather than assuming host uid mapping.
3. Keep automatic ownership repair narrowly limited to application state, if it is needed at all.
4. Never recursively change ownership of a user data or media library from a container entrypoint.
5. Give stateless worker containers ephemeral or no config storage.

## Plan

1. **Inspect the image lifecycle.** Record the runtime uid/gid, mount-point ownership created in the image, `VOLUME` declarations, and the final entrypoint/user ordering.
2. **Classify each mount.** Separate small application state, large user data, shared worker data, and ephemeral scratch paths. Specify persistence and access requirements for each.
3. **Prefer named state volumes.** Create and own the application-state mount point in the image before switching to the unprivileged user.
4. **Document bind-mount contracts.** Require effective read/write/create/delete/rename access as appropriate. Note that rootless uid mapping and mandatory-access-control labels vary by host and engine; avoid presenting one host `chown` command as universal.
5. **Keep data ownership external.** The application may validate access and fail with an actionable message, but it must not recursively mutate ownership of a large host data set.
6. **Use ephemeral worker config.** Omit persistent config mounts from stateless workers; use tmpfs when the image declares a config volume and an explicit ephemeral mount prevents accidental persistence.
7. **Add a root entrypoint only with evidence.** If supported-engine testing proves named state volumes cannot initialize, scope repair to the application-state directory, reject unsafe paths, drop privileges immediately, and leave user data untouched.

## Risks

- Rootful and rootless engines map ids differently; verify each supported mode.
- SELinux, AppArmor, NFS, and ACL policy can deny access despite apparent Unix mode bits.
- Recursive ownership changes can be slow and destructive on large data sets.
- Image `VOLUME` declarations can create anonymous volumes unless deployments override them explicitly.

## Verification checklist

1. Start with a fresh named state volume and confirm initialization.
2. Recreate the container and confirm persistence and ownership remain valid.
3. Exercise bind-mounted state with the documented host access policy.
4. Exercise create, rename, and delete operations on representative shared data.
5. Confirm stateless workers share required data paths but retain no config state.
6. Repeat on every supported rootful/rootless engine and mandatory-access-control mode.
