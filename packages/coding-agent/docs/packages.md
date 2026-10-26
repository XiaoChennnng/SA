# SA Packages

SA packages install and distribute extensions, skills, prompt templates, and themes as one unit. Use a package when a customization should be shared through npm or git, or when several resources belong together.

A package is an ordinary directory or npm package. It can expose conventional resource directories, declare explicit paths under the `sa` key in `package.json`, and carry its own runtime dependencies.

## Install and manage packages

Install from npm, git, or a local path:

```bash
sa install npm:@example/sa-tools@1.0.0
sa install git:github.com/example/sa-tools@v1
sa install ./local-package
```

`sa list` shows configured packages. Use `sa remove <source>` to remove one and `sa update --extensions` to reconcile package installations. See [Command Line](cli.md#package-commands) for every package command and option.

If a configured package fails to install at startup, for example because npm cannot reach the registry, SA warns about it, skips that package's resources, and keeps running. SA tries to install it again on the next start or `/reload`. `sa install` and `sa update --extensions` still report the failure and exit non-zero.

Personal installs are written to `~/.sa/agent/settings.json`. Add `--local` or `-l` to write the package declaration to `.sa/settings.json`. SA reads declarations from that file only after project trust is granted.

Project packages are installed and loaded only after project trust is resolved. Packages can execute extension code and can include skills that instruct the model to run programs. Review third-party package source before installing it. Review project package declarations before granting project trust.

Use `--extension` or `-e` to try a package for one invocation without adding it to settings:

```bash
sa -e npm:@example/sa-tools
```

## Choose a source

| Source | Example | Behavior |
|---|---|---|
| npm | `npm:@example/sa-tools@1.0.0` | Installed under the SA npm directory |
| git | `git:github.com/example/sa-tools@v1` | Cloned and reconciled to the selected ref |
| URL | `https://github.com/example/sa-tools` | Treated as a git source |
| Local | `./sa-tools` | Loaded from the resolved path without copying |

Versioned npm specifications are pinned. Git tags and commits are also pinned; package updates reconcile the checkout but do not move a configured ref.

Relative local paths resolve from the settings file that contains them. A file path loads one extension. A directory follows normal package discovery rules.

## Create a package

The simplest package uses conventional directories:

```text
my-sa-package/
├── package.json
├── extensions/
├── skills/
├── prompts/
└── themes/
```

Without a `sa` manifest, SA discovers TypeScript and JavaScript extensions, skill directories, Markdown prompts, and JSON themes from those directories.

Use an explicit manifest when resources live elsewhere or need filtering:

```json
{
  "name": "my-sa-package",
  "keywords": ["sa-package"],
  "sa": {
    "extensions": ["./src/extension.ts"],
    "skills": ["./resources/skills"],
    "prompts": ["./resources/prompts/*.md"],
    "themes": ["./resources/themes/*.json"]
  }
}
```

Paths are relative to the package root. Arrays accept glob patterns and exclusions. List dot-prefixed or symlinked resource roots directly when traversal through a glob would not discover them.

The `sa-package` keyword marks an npm package as an SA package.

## Declare dependencies

Put runtime packages imported by extensions in `dependencies`. SA installs package dependencies when it installs an npm or git source.

SA supplies these packages to extensions and skills:

- `@sa/ai`
- `@sa/agent-core`
- `@sa/coding-agent`
- `@sa/tui`
- `typebox`

Declare the host-provided packages listed above in `peerDependencies` with a `"*"` range and do not bundle them. SA suppresses automatic peer installation for managed npm packages and git packages installed with npm, pnpm, or Bun. Local packages are not installed or modified, so their dependency tree remains the package author's responsibility.

Do not list host-provided packages in `dependencies`. A physical copy can bypass SA's extension module mapping in compiled ESM and create duplicate classes, registries, and initialization work. SA reports an extension warning when it detects this manifest configuration. Other SA packages used as dependencies must be included in the published tarball and referenced through their `node_modules` resource paths.

Installed packages load with separate module roots. Do not rely on two packages sharing one dependency instance or one package resolving another package’s undeclared dependency.

## Select package resources

The object form in settings narrows which resources load from a package:

```json
{
  "packages": [
    {
      "source": "npm:@example/sa-tools",
      "extensions": ["extensions/*.ts", "!extensions/legacy.ts"],
      "skills": [],
      "prompts": ["prompts/review.md"]
    }
  ]
}
```

For each resource type:

- Omit the property to load everything allowed by the package.
- Use `[]` to load none of that type.
- Use `!pattern` to exclude glob matches.
- Use `+path` to include one exact allowed path.
- Use `-path` to exclude one exact path.

Filters narrow the package manifest. They do not expose resources that the package itself did not declare.

Run `sa config` to enable or disable discovered resources and sa's built-in extensions. It starts with personal configuration; press Tab to switch scope, or run `sa config --local` to start with project overrides.

## Understand scope and identity

The same package can appear in personal and project settings. A project entry normally replaces the personal entry. With `autoload: false`, the project entry instead acts as a filtering delta over the personal package.

SA identifies npm packages by package name, git packages by repository URL without the ref, and local packages by resolved absolute path. This prevents the same package from loading twice through equivalent declarations.

Use [Extensions](extensions.md), [Skills](skills.md), [Prompt Templates](prompt-templates.md), and [Themes](themes.md) to design each resource before packaging it.
