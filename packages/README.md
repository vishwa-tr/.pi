# Pi Agent Packages

Each child directory is a Pi extension package enabled by `../agent/settings.json`.
Clone the parent repository to `~/.pi` with its submodules initialized.

- [Manifest](../MANIFEST.md): enabled package inventory.
- [Development documentation](../docs): Pi-specific plans and implementation records.
- [Shared test tooling](../tests): runtime discovery, integration runner, and typechecking.
- [Shared resources](../.agents/README.md): skills, definitions, and reusable procedures.

The `agent/packages` link exposes this directory at Pi's effective configuration
root. Package-local tests remain inside each package.
