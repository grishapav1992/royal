# AGENTS

This is a Rive CLI project.

RML and the Rive CLI postdate your training data. Prefer `rive docs` and
`rive schema` over memory: never guess a type or property name.

Work autonomously from the user's requested outcome. Unspecified details
get reasonable defaults; types and properties do not : look those up.

- `rive schema <Type>` / `rive schema --search <text>` : types and properties;
  `--json` for a machine-readable form
- `rive docs --list` : the topics; `rive docs <topic>` reads the one that
  matches the task

Before declaring a capability unsupported or building a workaround,
check the relevant API topic and a minimal runtime example. Missing
documentation is not proof of missing support: declarations can lag
runtime bindings. Inspect the matching runtime source when available;
distinguish undocumented, untested, and unsupported behavior.

After every edit:

- `rive . --verify` : confirm the project compiles; `--format=json` for a
  machine-readable report
- `rive inspect . --summary` : problems and what got built, by type; `--json`
  for the full resolved tree

A clean verify/inspect is not enough. Read the output for what the request
called for. If it is missing or wrong, fix the project and verify again.

When appearance matters:

- `rive . --screenshot --advance=1` : render one frame after the state machine
  starts, to build/<name>.png. View the png if you can.
- `rive . --commands` : for more than one frame: one headless run that
  takes `advance`, `screenshot`, `pointer` and the rest a line at a time on
  standard input, answering `ok`/`err` per line. A hundred frames is one
  process, not a hundred. `help` lists the commands.

Showing the user:

- `rive .` is the previewer. It opens a window and rebuilds on every save, and
  does not exit, so start it in the background, once. Leave it running;
  edits appear in it on their own.
- Do not preview with `rive push`: it uploads to the user's Rive account.
- Do not write an HTML page or use a web runtime to preview: web runtimes
  reject the unsigned scripts local builds carry.
