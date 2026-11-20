<div align="center">

# OpenCode Vim Plugin

[![OpenCode v2](https://img.shields.io/npm/v/@leohenon/opencode-vim-plugin/latest?label=OpenCode%20v2&style=flat-square&logo=npm&logoColor=white&color=007ec6)](https://www.npmjs.com/package/@leohenon/opencode-vim-plugin?activeTab=versions) [![OpenCode v1](https://img.shields.io/badge/OpenCode%20v1-v0.1.6-007ec6?style=flat-square&logo=npm&logoColor=white)](https://github.com/leohenon/opencode-vim-plugin/tree/v1#installation) [![Website](https://img.shields.io/badge/website-opencode--vim-7fa6a3?style=flat-square)](https://leohenon.github.io/opencode-vim/)

Adds Vim editing to the OpenCode prompt, including motions, operators, text objects, registers, visual mode, counts, undo/redo, and dot repeat.

</div>

## Installation

For OpenCode 2.0.25 or newer:

```bash
opencode plugin add @leohenon/opencode-vim-plugin
```

> **OpenCode v1:** use plugin `0.1.6`. See the [v1](https://github.com/leohenon/opencode-vim-plugin/tree/v1#installation).

## Usage

Toggle via command palette > `Toggle vim mode` or slash command `/vim`.

## Prompt controls

> Unicode word boundaries are not supported.

| Category                       | Keys                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Character / word               | `h`, `j`, `k`, `l`, `w`, `b`, `e`, `W`, `B`, `E`                                                        |
| Line / buffer                  | `0`, `^`, `_`, `$`, `gg`, `G`                                                                           |
| Display line                   | `gj`, `gk`, `g<Down>`, `g<Up>`, `g0`, `g^`, `g$`                                                        |
| Matching / paragraph           | `%`, `{`, `}`                                                                                           |
| Find / till                    | `f`, `F`, `t`, `T`, `;`, `,`                                                                            |
| Scroll                         | `Ctrl+e`, `Ctrl+y`, `Ctrl+d`, `Ctrl+u`, `Ctrl+f`, `Ctrl+b`                                              |
| Insert / replace               | `i`, `I`, `a`, `A`, `o`, `O`, `R`                                                                       |
| Character / line edit          | `r`, `x`, `~`, `s`, `S`, `J`, `C`, `D`, `dd`, `cc`                                                      |
| Word changes                   | `cw`, `cb`, `ce`, `cW`, `cE`, `ciw`, `caw`, `ciW`, `caW`                                                |
| Word deletes                   | `dw`, `db`, `de`, `dW`, `dE`, `diw`, `daw`, `diW`, `daW`                                                |
| Quote changes                  | `ci"`, `ca"`, `ci'`, `ca'`, ``ci` ``, ``ca` ``                                                          |
| Quote deletes                  | `di"`, `da"`, `di'`, `da'`, ``di` ``, ``da` ``                                                          |
| Bracket changes                | `ci(`, `ca(`, `ci[`, `ca[`, `ci{`, `ca{`, `ci<`, `ca<`                                                  |
| Bracket deletes                | `di(`, `da(`, `di[`, `da[`, `di{`, `da{`, `di<`, `da<`                                                  |
| Find / till operators          | `cf`, `cF`, `ct`, `cT`, `df`, `dF`, `dt`, `dT`                                                          |
| Matching / paragraph operators | `c%`, `d%`, `c}`, `c{`, `d}`, `d{`                                                                      |
| Line boundary operators        | `c0`, `c^`, `c$`, `d0`, `d^`, `d$`, `y0`, `y^`, `y$`                                                    |
| Display line operators         | `cgj`, `cgk`, `cg0`, `cg^`, `cg$`, `dgj`, `dgk`, `dg0`, `dg^`, `dg$`, `ygj`, `ygk`, `yg0`, `yg^`, `yg$` |
| Line / word yanks              | `yy`, `yw`, `ye`, `yW`, `yE`, `yiw`, `yaw`, `yiW`, `yaW`                                                |
| Quote yanks                    | `yi"`, `ya"`, `yi'`, `ya'`, ``yi` ``, ``ya` ``                                                          |
| Bracket yanks                  | `yi(`, `ya(`, `yi[`, `ya[`, `yi{`, `ya{`, `yi<`, `ya<`                                                  |
| Matching / paragraph yanks     | `y%`, `y}`, `y{`                                                                                        |
| Any quote objects              | `ciq`, `caq`, `diq`, `daq`, `yiq`, `yaq`                                                                |
| Paragraph objects              | `cip`, `cap`, `dip`, `dap`, `yip`, `yap`                                                                |
| Whole buffer objects           | `cil`, `cal`, `dil`, `dal`, `yil`, `yal`                                                                |
| Put / undo / repeat            | `p`, `P`, `u`, `Ctrl+r`, `.`                                                                            |
| Visual selection               | `v`, `V`                                                                                                |
| Commands                       | `:` `:q`                                                                                                |

Numeric count prefixes are supported for motions and common operators.

> [!NOTE]
> `gg` and `G` move within the prompt when the prompt has text. On an empty prompt, they dispatch OpenCode's `session.first` and `session.last` commands.

> [!NOTE]
> As text objects, `p` is a blank-line-separated paragraph and `l` is the whole prompt buffer, matching nvim 0.13's `al`/`il`.

> [!NOTE]
> OpenCode v2 uses commas to separate alternative keybinds. Literal comma custom keybinds are unsupported; the plugin still handles Vim's `,` key.

## Configuration

Configure the plugin in `cli.json`, OpenCode v2's TUI configuration file:

```json
{
  "plugins": [
    {
      "package": "@leohenon/opencode-vim-plugin",
      "options": {
        "enabled": true,
        "toggle_key": "ctrl+shift+v",
        "indicator": true,
        "vim_enter_submit": false,
        "vim_insert_after_submit": false,
        "vim_system_clipboard_register": false
      }
    }
  ]
}
```

Unless marked as top-level `cli.json` settings, the examples below go inside the plugin's `options` object.

### Options

For options beginning with `vim_`, the prefix may be omitted in plugin configuration.

| Option                          | Purpose                                                    |
| ------------------------------- | ---------------------------------------------------------- |
| `enabled`                       | Start with Vim mode enabled                                |
| `vim_initial_mode`              | Start in `insert` (default) or `normal` mode               |
| `toggle_key`                    | Keybind for `Toggle vim mode`                              |
| `indicator`                     | Show the prompt Vim indicator                              |
| `vim_enter_submit`              | Submit with Enter from insert mode                         |
| `vim_insert_after_submit`       | Return to insert mode after submit                         |
| `vim_system_clipboard_register` | Use the system clipboard as Vim register                   |
| `vim_langmap`                   | Map non-English keys or simple aliases                     |
| `vim_normal_leader`             | Removed in v2. Configure the host `leader` keybind instead |
| `normal_keybinds`               | Extra keybinds active only in Vim normal mode              |
| `keybinds["vim.normal"]`        | Nested normal-mode keybind configuration                   |
| `vim_escape_sequence`           | Use a two-key escape sequence like jk                      |

> [!NOTE]
> Unsupported OCV options: `vim_line_motions`

### Initial mode

Vim mode starts in insert mode by default. To start in normal mode instead, use:

```json
{
  "vim_initial_mode": "normal"
}
```

### Mode-scoped keybinds

Bind existing OpenCode commands only in Vim normal mode:

```json
{
  "normal_keybinds": {
    "<leader>s": "session.list",
    "j": "session.line.down",
    "k": "session.line.up"
  }
}
```

`<leader>` in a keybind is resolved by OpenCode itself, so configure it in the top-level `keybinds` object in `cli.json`:

```json
{
  "keybinds": {
    "leader": "space"
  }
}
```

`normal_keybinds` values can be command strings or objects:

```json
{
  "normal_keybinds": {
    "j": {
      "command": "session.line.down"
    }
  }
}
```

Nested normal-mode keybind configuration is also accepted inside the plugin options:

```json
{
  "keybinds": {
    "vim.normal": {
      "session_list": "<leader>s",
      "messages_line_up": "<leader>k",
      "messages_line_down": "<leader>j"
    }
  }
}
```

### Submit behavior

By default, insert mode uses `Enter` for newlines and normal mode uses `Enter` to submit.

To submit from insert mode too:

```json
{
  "vim_enter_submit": true
}
```

To always default to insert mode after a prompt submission:

```json
{
  "vim_insert_after_submit": true
}
```

To keep newline available when `vim_enter_submit` is enabled, configure OpenCode's top-level `input_newline` keybind:

```json
{
  "keybinds": {
    "input_newline": "alt+return"
  }
}
```

Or configure a separate OpenCode submit key in top-level `cli.json` settings:

```json
{
  "keybinds": {
    "prompt_submit": "alt+return"
  }
}
```

`input_newline` and `prompt_submit` are OpenCode keybinds, not plugin options.

### System clipboard register

Use the system clipboard as Vim's register:

```json
{
  "vim_system_clipboard_register": true
}
```

Yank and delete operations sync to the system clipboard, `p` / `P` paste from it.

> [!NOTE]
> Clipboard sync uses `pbcopy` / `pbpaste` on macOS, PowerShell clipboard commands on Windows, and `wl-copy` / `wl-paste`, `xclip`, or `xsel` on Linux.

### Vim langmap

Map non-English keyboard layout characters to Vim command keys.

> Keys and values should be single characters.

```json
{
  "vim_langmap": {
    "р": "h",
    "о": "j",
    "л": "k",
    "д": "l"
  }
}
```

Or for simple aliases:

```json
{
  "vim_langmap": {
    "H": "^",
    "L": "$"
  }
}
```

### Vim escape sequence

Set a two-character sequence to leave insert mode without pressing Escape:

```json
{
  "vim_escape_sequence": "jk"
}
```

## Troubleshooting

If `Esc` feels delayed in tmux, add `set -s escape-time 10` to `~/.tmux.conf` to reduce tmux’s key-sequence timeout.

## Want more?

This plugin covers the prompt only. For Vim controls across the whole TUI - copy mode, session navigation - see [OpenCode Vim](https://github.com/leohenon/opencode-vim), a fork of OpenCode v1 that this plugin shares its Vim core with.

## Local development

```bash
bun install
bun run check
bun run dev
```
