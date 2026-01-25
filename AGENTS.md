<INSTRUCTIONS>
## Scope
- This file applies to work inside `external_plugins/gridworld`.

## Repo conventions
- Use tabs for indentation in JSON and TypeScript files (match existing Clusterio style).
- Target TypeScript `module: nodenext` and Node >= 18.
- Prefer async/await; avoid new dependencies unless justified.

## Plugin behavior
- Gridworld only configures the Universal Edges plugin; it does not implement transfers.
- Tile creation is driven by controller-side logic and player joins.
- All tiles use the same map exchange string with per-tile coordinate offsets.

## Data and persistence
- Tile metadata is stored in `database/gridworld_tiles.json` via `controller.database_directory`.
- Do not change this file format without a migration note in the plugin code.

## Edge configuration
- Make sure to think carefully about edge coordinates and directions. The receiving edge needs a different set of coordinates than the sending edge to match up

## Logging
- Use `this.logger` and keep log lines action-oriented and concise.
</INSTRUCTIONS>
