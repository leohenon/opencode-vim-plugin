#!/usr/bin/env bun

import { EventEmitter } from "node:events"
import { CliRenderEvents, InternalKeyHandler, KeyEvent, parseKeypress } from "@opentui/core"
import { RendererContext } from "@opentui/solid"
import { createComponent, createRoot, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"

export {}

// Minimal stand-in for the host CliRenderer. Element construction and tree
// wiring only need a handful of members; anything else is a no-op since the
// harness never renders pixels.
const FAKE_RENDERER_TARGET: Record<string, unknown> = { width: 80, height: 24 }
const FAKE_RENDERER = new Proxy(FAKE_RENDERER_TARGET, {
  get(target, prop) {
    if (typeof prop === "symbol") return Reflect.get(target, prop)
    if (prop in target) return target[prop]
    return () => {}
  },
}) as unknown as import("@opentui/core").CliRenderer

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

// Match the host's binding syntax, including comma-separated alternatives.
const NAMED_KEYS = new Set([
  "up",
  "down",
  "left",
  "right",
  "clear",
  "escape",
  "return",
  "linefeed",
  "enter",
  "tab",
  "backspace",
  "delete",
  "insert",
  "home",
  "end",
  "pageup",
  "pagedown",
  "space",
  "lt",
  "gt",
  "plus",
  "minus",
  "equal",
  "comma",
  "period",
  "slash",
  "backslash",
  "semicolon",
  "quote",
  "backquote",
  "leftbracket",
  "rightbracket",
  "capslock",
  "numlock",
  "scrolllock",
  "printscreen",
  "pause",
  "menu",
  "apps",
  "kp0",
  "kp1",
  "kp2",
  "kp3",
  "kp4",
  "kp5",
  "kp6",
  "kp7",
  "kp8",
  "kp9",
  "kpdecimal",
  "kpdivide",
  "kpmultiply",
  "kpminus",
  "kpplus",
  "kpenter",
  "kpequal",
  "kpseparator",
  "kpleft",
  "kpright",
  "kpup",
  "kpdown",
  "kppageup",
  "kppagedown",
  "kphome",
  "kpend",
  "kpinsert",
  "kpdelete",
  "mediaplay",
  "mediapause",
  "mediaplaypause",
  "mediareverse",
  "mediastop",
  "mediafastforward",
  "mediarewind",
  "medianext",
  "mediaprev",
  "mediarecord",
  "volumedown",
  "volumeup",
  "mute",
  "leftshift",
  "leftctrl",
  "leftalt",
  "leftsuper",
  "lefthyper",
  "leftmeta",
  "rightshift",
  "rightctrl",
  "rightalt",
  "rightsuper",
  "righthyper",
  "rightmeta",
  "iso_level3_shift",
  "iso_level5_shift",
  "option",
  "alt",
  "meta",
  "super",
  "hyper",
  "control",
  "ctrl",
  "shift",
])
const MODIFIERS = new Set(["ctrl", "control", "shift", "meta", "alt", "option", "super", "hyper"])

function parseKeyEntry(entry: string) {
  let rest = entry
  for (;;) {
    if (rest.startsWith("<")) {
      const end = rest.indexOf(">")
      if (end === -1) {
        rest = rest.slice(1)
        break
      }
      rest = rest.slice(end + 1)
      continue
    }
    if (rest.startsWith("{")) {
      const end = rest.indexOf("}")
      if (end === -1) {
        rest = rest.slice(1)
        break
      }
      rest = rest.slice(end + 1)
      continue
    }
    break
  }
  if (rest === "" || rest === "+" || rest === " ") return
  let name = ""
  for (const raw of rest.split("+")) {
    const part = raw.trim()
    if (!part) continue
    if (MODIFIERS.has(part.toLowerCase())) continue
    if (name) throw new Error(`Invalid key "${entry}": multiple key names are not supported`)
    name = part
  }
  if (!name) throw new Error(`Invalid key "${entry}": missing key name`)
  const lower = name.toLowerCase()
  if (name.length !== 1 && !NAMED_KEYS.has(lower) && !/^f\d{1,2}$/.test(lower) && !/^[a-zA-Z0-9]+$/.test(name)) {
    throw new Error(`Invalid key "${entry}": unknown key "${name}"`)
  }
}

function parseBind(bind: string) {
  for (const part of bind.split(",")) {
    if (!part) throw new Error("comma-separated bindings cannot contain empty entries")
    parseKeyEntry(part)
  }
}

function fakeTextarea() {
  return {
    plainText: "",
    cursorOffset: 0,
    focused: true,
    editBuffer: {
      offsetToPosition(offset: number) {
        return { row: 0, col: offset }
      },
    },
    editorView: {
      selection: null as { start: number; end: number } | null,
      getSelection() {
        return this.selection
      },
      setSelection(start: number, end: number) {
        this.selection = { start, end }
      },
      resetSelection() {
        this.selection = null
      },
    },
    visualCursor: { visualRow: 0, visualCol: 0 },
    height: 1,
    width: 80,
    y: 0,
    x: 0,
    selectionBg: undefined,
    selectionFg: undefined,
    showCursor: true,
    cursorStyle: undefined,
    onPaste: undefined as ((event: any) => void) | undefined,
    insertText(text: string) {
      this.plainText = this.plainText.slice(0, this.cursorOffset) + text + this.plainText.slice(this.cursorOffset)
      this.cursorOffset += text.length
    },
    deleteRange(_startRow: number, startCol: number, _endRow: number, endCol: number) {
      this.plainText = this.plainText.slice(0, startCol) + this.plainText.slice(endCol)
      this.cursorOffset = startCol
    },
    setText(text: string) {
      this.plainText = text
      this.cursorOffset = text.length
    },
    clear() {
      this.setText("")
    },
    submit() {},
    gotoBufferHome() {
      this.cursorOffset = 0
    },
    gotoBufferEnd() {
      this.cursorOffset = this.plainText.length
    },
    moveCursorUp() {
      if (this.visualCursor.visualRow <= 0) return false
      this.visualCursor.visualRow--
      this.cursorOffset--
      return true
    },
    moveCursorDown() {
      if (this.visualCursor.visualRow >= this.height - 1) return false
      this.visualCursor.visualRow++
      this.cursorOffset++
      return true
    },
    render() {},
    getLayoutNode() {
      return { markDirty() {} }
    },
    requestRender() {},
    updateSelectionForMovement() {},
    clearSelection() {
      this.editorView.resetSelection()
    },
  }
}

function fakeEvent(name: string, opts: { shift?: boolean; sequence?: string } = {}) {
  return {
    name,
    sequence: opts.sequence ?? name,
    raw: opts.sequence ?? name,
    ctrl: false,
    meta: false,
    super: false,
    shift: opts.shift ?? false,
    preventDefault() {},
    stopPropagation() {},
  }
}

function fakeContext(options: unknown) {
  const layers: any[] = []
  const slots: any[] = []
  const dispatched: string[] = []
  const toasts: any[] = []
  const storageSetters: Array<(mutate: (draft: any) => void) => void> = []
  const context: any = {
    options,
    location: undefined,
    app: { version: "test", channel: "test" },
    renderer: Object.assign(new EventEmitter(), { currentFocusedEditor: null, keyInput: new InternalKeyHandler(), requestRender() {} }),
    client: {},
    data: {},
    attention: { notify: async () => ({ ok: true, notification: false, sound: false }) },
    theme: {
      text: {
        base: { r: 255, g: 255, b: 255, a: 1, buffer: new Uint16Array(4) },
        muted: { r: 128, g: 128, b: 128, a: 1, buffer: new Uint16Array(4) },
      },
      background: { base: { r: 0, g: 0, b: 0, a: 1, buffer: new Uint16Array(4) } },
      hue: { accent: { 300: { r: 100, g: 150, b: 200, a: 1, buffer: new Uint16Array(4) } } },
    },
    themeMode: "dark",
    markdown: { registerCodeBlockRenderer: () => () => {} },
    keymap: {
      layer(input: () => any) {
        const layer = input()
        for (const command of layer.commands ?? []) if (command.bind) parseBind(command.bind)
        layers.push(layer)
        const release = () => {
          const index = layers.indexOf(layer)
          if (index !== -1) layers.splice(index, 1)
        }
        onCleanup(release)
        return release
      },
      dispatch(id: string) {
        dispatched.push(id)
      },
      shortcuts: () => [],
      commands: () => [],
      pending: () => [],
      active: () => [],
      mode: { current: () => "base", push: () => () => {} },
    },
    storage: {
      store(_key: string, { initial }: { initial: any }) {
        const [state, setState] = createStore(initial)
        storageSetters.push((mutate) => setState(produce(mutate)))
        return [state, async (mutate: (draft: any) => void) => {
          await Promise.resolve()
          setState(produce(mutate))
        }]
      },
      memory(_key: string, { initial }: { initial: any }) {
        const state: any = { ...initial }
        return [state, (mutate: (draft: any) => void) => mutate(state)]
      },
    },
    ui: {
      dialog: { show() {}, set() {}, clear() {} },
      toast: { show(toast: any) { toasts.push(toast) } },
      format: { path: (value: string) => value },
      router: { register: () => () => {}, navigate() {}, current: () => ({ type: "home" }) },
      tabs: { enabled: () => false, list: () => [], open: () => false, focus: () => false, close: () => false },
      slot(claim: any) {
        const mounts: Array<{ tree: any; dispose: () => void }> = []
        const mount = () => {
          const rendered = createRoot((dispose) => ({
            dispose,
            tree: createComponent(RendererContext.Provider, {
              value: FAKE_RENDERER,
              get children() {
                return claim.render()
              },
            }),
          }))
          mounts.push(rendered)
          return rendered
        }
        slots.push({ ...claim, ...mount(), mount })
        return () => mounts.forEach((item) => item.dispose())
      },
    },
  }
  return { context, layers, slots, dispatched, toasts, storageSetters }
}

async function setup(options: unknown = { initial_mode: "normal" }) {
  const plugin = ((await import("../dist/tui.js" as string)) as any).default
  const result = fakeContext(options)
  const cleanup = await plugin.setup(result.context)
  return { ...result, cleanup }
}

function vimKey(layers: any[], bind: string) {
  const command = layers
    .filter((layer) => layer.mode === "base" && layer.priority === 100)
    .flatMap((layer) => layer.commands ?? [])
    .find((command: any) => command.bind?.split(",").includes(bind))
  assert(command, `vim key command for "${bind}" was not registered`)
  return (event?: any) => {
    const parts = bind === "+" ? [bind] : bind.split("+")
    const name = parts.at(-1)!
    const shift = parts.includes("shift")
    const symbols: Record<string, string> = { "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", "8": "*", "9": "(", "0": ")", "-": "_", "=": "+", "[": "{", "]": "}", "\\": "|", ";": ":", "'": '"', ",": "<", ".": ">", "/": "?", "`": "~" }
    const typed = shift ? (symbols[name] ?? (name.length === 1 ? name.toUpperCase() : name)) : name
    const key = event ?? { ...fakeEvent(name, { shift, sequence: typed }), ctrl: parts.includes("ctrl"), meta: parts.includes("meta"), super: parts.includes("super") }
    return command.run(undefined, key)
  }
}

{
  const { context, layers, cleanup } = await setup()
  const editor: any = fakeTextarea()
  editor.plainText = "abc"
  context.renderer.currentFocusedEditor = editor
  vimKey(layers, "shift+r")()
  vimKey(layers, "z")({ ...fakeEvent("я"), baseCode: 122, source: "kitty" })
  assert(editor.plainText === "яbc", "base-layout fallback must preserve the actual typed character in replace mode")
  await cleanup?.()
}

for (const [name, symbol] of [["1", "!"], ["=", "+"], ["`", "~"]]) {
  const { context, layers, cleanup } = await setup()
  const editor: any = fakeTextarea()
  editor.plainText = "abc"
  context.renderer.currentFocusedEditor = editor
  vimKey(layers, "r")()
  const raw = `\x1b[${name.charCodeAt(0)};2u`
  const parsed = parseKeypress(raw, { useKittyKeyboard: true })
  assert(parsed?.shift && parsed.sequence === name, "Kitty parsing should expose the unshifted printable sequence")
  vimKey(layers, `shift+${name}`)(new KeyEvent(parsed))
  assert(editor.plainText === symbol + "bc", "parsed Kitty events should retain shifted punctuation")
  editor.plainText = "abc"
  editor.cursorOffset = 0
  vimKey(layers, "r")()
  vimKey(layers, "shift+1")({ ...fakeEvent("1", { shift: true, sequence: "é" }), source: "kitty" })
  assert(editor.plainText === "ébc", "an actual non-US character should take precedence over shifted-symbol fallback")
  await cleanup?.()
}

{
  const { context, layers, cleanup } = await setup()
  const editor: any = fakeTextarea()
  editor.plainText = "(x)"
  context.renderer.currentFocusedEditor = editor
  const parsed = parseKeypress("\x1b[53;2u", { useKittyKeyboard: true })
  assert(parsed?.shift && parsed.sequence === "5", "Kitty Shift+5 should parse as an unshifted 5")
  vimKey(layers, "shift+5")(new KeyEvent(parsed))
  assert(editor.cursorOffset === 2, "parsed Kitty Shift+5 should perform % bracket matching")
  await cleanup?.()
}

for (const options of [{ initial_mode: "insert" }, { initial_mode: "normal", enabled: false }]) {
  const { context, layers, cleanup } = await setup({ ...options, normal_keybinds: { gg: "session.first" } })
  context.renderer.currentFocusedEditor = fakeTextarea()
  const layer = layers.find((item) => item.priority === 200)
  assert(layer, "normal-only sequence layer should register")
  assert(layer.enabled?.() === false, "normal-only prefixes must be disabled before matching insert or disabled-Vim input")
  await cleanup?.()
}

for (const indicator of [true, false]) {
  const plugin = ((await import("../dist/tui.js" as string)) as any).default
  const { context } = fakeContext({ initial_mode: "normal", indicator })
  let nativePastes = 0
  const editors: any[] = [fakeTextarea(), fakeTextarea()]
  const nativePaste = () => { nativePastes++ }
  for (const editor of editors) editor.onPaste = nativePaste
  context.renderer.currentFocusedEditor = editors[0]
  const cleanup = await plugin.setup(context)
  for (const [index, editor] of editors.entries()) {
    if (index > 0) {
      editors[0].focused = false
      context.renderer.currentFocusedEditor = editor
      context.renderer.emit(CliRenderEvents.FOCUSED_EDITOR, editor, editors[0])
    }
    assert(editor.showCursor === true && editor.cursorStyle?.style === "block", "initial and newly focused normal prompts should show a block cursor before a keypress")
    assert(editor.onPaste !== nativePaste, "initial and newly focused prompts should install paste protection before a keypress")
    let prevented = false
    editor.onPaste?.({ preventDefault() { prevented = true }, stopPropagation() {} })
    assert(prevented && nativePastes === 0, "normal-mode paste should not reach the host before the first Vim key")
  }
  await cleanup?.()
  assert(context.renderer.listenerCount(CliRenderEvents.FOCUSED_EDITOR) === 0, "cleanup should remove the editor focus listener")
  assert(editors.every((editor) => editor.showCursor === true && editor.onPaste === nativePaste), "cleanup should restore editors initialized without keypresses")
}

{
  const { context, layers, slots, dispatched, cleanup } = await setup()
  const app = slots.find((claim) => claim.append === "app")
  assert(app, "persistent global commands should claim the app slot")
  const commands = layers.find((layer) => layer.commands?.some((command: any) => command.id === "ocv-plugin.toggle"))
  const footer = slots.find((claim) => claim.append === "prompt.footer.status")
  footer.dispose()
  context.ui.router.current = () => ({ type: "plugin", id: "opencode.stats" })
  assert(layers.includes(commands), "global commands should survive prompt footer unmount")
  assert(!layers.some((layer) => layer.priority === 100), "prompt editing bindings should remain footer-scoped")
  commands.commands.find((command: any) => command.id === "ocv-plugin.toggle").run()
  commands.commands.find((command: any) => command.id === "ocv-plugin.quit").run()
  assert(dispatched.at(-1) === "app.exit", "persistent Quit should dispatch outside prompt routes")
  await cleanup?.()
  assert(!layers.includes(commands), "plugin cleanup should release persistent commands")
}

for (const indicator of [true, false]) {
  const { context, slots, cleanup } = await setup({ initial_mode: "normal", indicator })
  const editor: any = fakeTextarea()
  let nativePastes = 0
  editor.onPaste = () => nativePastes++
  context.renderer.currentFocusedEditor = editor
  slots[0].mount()
  assert(editor.showCursor === true && editor.cursorStyle?.style === "block", "mounting a normal prompt should show a block cursor before any keypress")
  let prevented = false
  editor.onPaste({ preventDefault() { prevented = true }, stopPropagation() {} })
  assert(prevented && nativePastes === 0, "mounting a normal prompt should install paste protection without relying on its indicator")
  await cleanup?.()
}

{
  const { context, layers, slots, cleanup } = await setup({ initial_mode: "insert", indicator: false })
  const editor: any = fakeTextarea()
  const originalInsertText = editor.insertText
  context.renderer.currentFocusedEditor = editor
  slots[0].mount()
  assert(editor.insertText !== originalInsertText, "mounting an insert prompt should start its recorder before a bound key")
  editor.plainText = "漢字"
  editor.cursorOffset = editor.plainText.length
  vimKey(layers, "escape")()
  vimKey(layers, "u")()
  assert(editor.plainText === "", "initial IME-style input should be undoable after prompt mount")
  await cleanup?.()
}

{
  const { layers, context, dispatched } = await setup({
    initial_mode: "normal",
    normal_keybinds: {
      "<leader>s": "session.list",
      "x,y": "session.list",
      y: "messages_line_up",
      u: "messages_undo",
      r: "messages_redo",
      m: "messages_last_user",
      t: "tool_details",
      n: "session_child_cycle",
      p: "session_child_cycle_reverse",
      j: { command: "session.line.down", desc: "Scroll down", preventDefault: false },
    },
  })
  const normalLayer = layers.find((layer) => layer.priority === 200)
  assert(normalLayer, "normal-mode keybind layer was not registered")
  assert(normalLayer.mode === "base", "normal keybind layer should be base-mode only")
  const byBind = (bind: string) => normalLayer.commands.find((command: any) => command.bind === bind)
  assert(byBind("<leader>s"), "leader bindings should keep the host <leader> token")
  assert(byBind("x,y"), "comma-separated alternative bindings should be passed to the host")
  assert(byBind("y").run() === false, "normal keybinds should fall through without a focused prompt")
  assert(dispatched.length === 0, "normal keybinds should not dispatch without a focused prompt")
  context.renderer.currentFocusedEditor = fakeTextarea()
  for (const [bind, command] of Object.entries({
    "<leader>s": "session.list",
    "x,y": "session.list",
    y: "session.line.up",
    u: "session.undo",
    r: "session.redo",
    m: "session.messages_last_user",
    t: "session.toggle.actions",
    n: "session.child.next",
    p: "session.child.previous",
    j: "session.line.down",
  })) {
    dispatched.length = 0
    byBind(bind).run()
    assert(dispatched.at(-1) === command, `OCV-style command alias ${command} was not resolved for ${bind}`)
  }
}

for (const bind of [",", " , ", "ctrl+,", "ctrl+, ", "x,,y", "x, ,y"]) {
  const { layers, context, dispatched, toasts } = await setup({
    initial_mode: "normal",
    normal_keybinds: {
      [bind]: "session.list",
      j: "session.line.down",
      "x,y": "session.list",
    },
  })
  const normalLayer = layers.find((layer) => layer.priority === 200)
  assert(normalLayer, `skipping "${bind}" should preserve valid normal bindings`)
  assert(!normalLayer.commands.some((command: any) => command.bind === bind), `"${bind}" should be skipped`)
  assert(!toasts.some((toast) => toast.variant === "error"), `"${bind}" should not cause layer registration to fail`)
  assert(toasts.some((toast) => toast.variant === "warning"), `skipping "${bind}" should show a warning`)
  context.renderer.currentFocusedEditor = fakeTextarea()
  for (const [validBind, command] of Object.entries({ j: "session.line.down", "x,y": "session.list" })) {
    dispatched.length = 0
    normalLayer.commands.find((item: any) => item.bind === validBind).run()
    assert(dispatched.at(-1) === command, `"${validBind}" should still dispatch after skipping "${bind}"`)
  }
}

{
  const { layers, context } = await setup({
    enabled: true,
    normal_keybinds: { q: "session.list" },
  })
  const normalLayer = layers.find((layer) => layer.priority === 200)
  assert(normalLayer, "normal-mode keybind layer was not registered")
  const editor: any = fakeTextarea()
  const originalInsertText = editor.insertText
  context.renderer.currentFocusedEditor = editor
  const q = normalLayer.commands.find((command: any) => command.bind === "q")
  assert(q.run() === false, "Vim should start in insert mode by default")
  assert(editor.insertText !== originalInsertText, "initial insert mode should start the repeat recorder")
  editor.insertText("abc")
  vimKey(layers, "escape")()
  vimKey(layers, "u")()
  assert(editor.plainText === "", "initial insert text should be undoable")
  vimKey(layers, ".")()
  assert(editor.plainText === "abc", "initial insert text should be repeatable")
}

{
  const { layers, context } = await setup({
    enabled: true,
    vim_initial_mode: "normal",
    normal_keybinds: { q: "session.list" },
  })
  const normalLayer = layers.find((layer) => layer.priority === 200)
  assert(normalLayer, "normal-mode keybind layer was not registered")
  context.renderer.currentFocusedEditor = fakeTextarea()
  const q = normalLayer.commands.find((command: any) => command.bind === "q")
  assert(q.run() !== false, "vim_initial_mode normal should start Vim in normal mode")
}

{
  const { layers, context, dispatched, cleanup, slots } = await setup()
  const commandLayer = layers.find((layer) => layer.commands?.some((command: any) => command.id === "ocv-plugin.toggle"))
  assert(commandLayer?.mode === "global", "vim palette commands must explicitly remain global while autocomplete is open")
  const vimLayer = layers.find((layer) => layer.priority === 100 && layer.commands?.some((command: any) => command.bind?.split(",").includes("h")))
  assert(vimLayer?.mode === "base", "vim key bindings should be inactive while autocomplete is open")
  const toggle = commandLayer?.commands.find((command: any) => command.id === "ocv-plugin.toggle")
  assert(toggle?.slash?.name === "vim", "toggle command should expose /vim")
  assert(toggle?.palette === true, "the toggle command should be reachable from OpenCode's command palette")
  const quit = commandLayer?.commands.find((command: any) => command.id === "ocv-plugin.quit")
  assert(quit?.title === "Quit" && quit.group === "System", "the command palette should expose the OCV-style Quit command")
  assert(quit?.slash === undefined, "the plugin should leave OpenCode's /q slash alias unchanged")
  assert(quit?.palette === true, "the plugin Quit command should be reachable from OpenCode's command palette")
  assert(slots.some((claim) => claim.append === "prompt.footer.status"), "the status indicator should claim the prompt footer status slot")

  const editor: any = fakeTextarea()
  const defaultCursorStyle = { style: "block", blinking: false }
  const defaultSelectionBg = { name: "default-selection-bg" }
  const defaultSelectionFg = { name: "default-selection-fg" }
  editor.cursorStyle = defaultCursorStyle
  editor.selectionBg = defaultSelectionBg
  editor.selectionFg = defaultSelectionFg
  const originalClear = editor.clear
  const originalSubmit = editor.submit
  const originalPaste = editor.onPaste
  const originalInsertText = editor.insertText
  const originalDeleteRange = editor.deleteRange
  const originalSetText = editor.setText
  context.renderer.currentFocusedEditor = editor
  // Consumption is asserted via the run return value: void = consumed by the
  // plugin layer, false = fell through to the host.
  const colonHandled = vimKey(layers, "shift+;")()
  assert(colonHandled !== false, "shift+; should be handled as :")
  assert(dispatched.at(-1) === "command.palette.show", "plain : should open the command palette")
  const paletteDispatches = dispatched.length

  editor.plainText = "a:b"
  editor.cursorOffset = 0
  vimKey(layers, "f")()
  vimKey(layers, "shift+;")()
  assert(editor.cursorOffset === 1, "f: should find the next colon")
  assert(dispatched.length === paletteDispatches, "f: should not open the command palette")

  editor.plainText = "ab:c"
  editor.cursorOffset = 0
  vimKey(layers, "t")()
  vimKey(layers, "shift+;")()
  assert(editor.cursorOffset === 1, "t: should move until the next colon")

  editor.plainText = "abc"
  editor.cursorOffset = 1
  vimKey(layers, "r")()
  vimKey(layers, "shift+;")()
  assert(editor.plainText === "a:c", "r: should replace the current character with a colon")

  editor.plainText = "ab:cd"
  editor.cursorOffset = 0
  vimKey(layers, "d")()
  vimKey(layers, "f")()
  vimKey(layers, "shift+;")()
  assert(editor.plainText === "cd", "df: should delete through the next colon")

  editor.plainText = "word"
  editor.cursorOffset = 0
  vimKey(layers, "d")()
  vimKey(layers, "shift+;")()
  vimKey(layers, "w")()
  assert(editor.plainText === "word" && editor.cursorOffset === 4, "an invalid d: should not leave a pending delete")
  assert(dispatched.length === paletteDispatches, "an operator-pending : should not open the command palette")

  editor.plainText = "abc"
  editor.cursorOffset = 0
  vimKey(layers, "r")()
  vimKey(layers, "shift+1")()
  assert(editor.plainText === "!bc", "r with Shift+1 should replace with !, not 1")
  editor.plainText = "(x)"
  editor.cursorOffset = 0
  vimKey(layers, "shift+5")()
  assert(editor.cursorOffset === 2, "Shift+5 should match brackets as %")
  editor.plainText = "abc"
  editor.cursorOffset = 0
  vimKey(layers, "shift+`")()
  assert(editor.plainText === "Abc", "shifted backtick should toggle case as ~")
  vimKey(layers, "shift+r")()
  vimKey(layers, "+")()
  assert(editor.plainText === "A+c", "literal + should work in replace mode")
  vimKey(layers, "escape")()

  editor.plainText = ""
  editor.cursorOffset = 0

  const handled = vimKey(layers, "/")()
  assert(handled !== false, "empty slash should be handled")
  assert(editor.plainText === "/", "slash should enter insert mode and start host autocomplete")
  vimKey(layers, "escape")()
  editor.clear()
  assert(vimKey(layers, "@")() !== false, "empty @ should be handled")
  assert(editor.plainText === "@", "@ should enter insert mode and start host autocomplete")
  vimKey(layers, "escape")()
  const insertTextBeforeRecording = editor.insertText
  vimKey(layers, "i")()
  assert(editor.insertText !== insertTextBeforeRecording, "insert mode should install the repeat recorder")
  assert(editor.cursorStyle?.style === "line", "enabled insert mode should use the Vim cursor style")
  toggle.run()
  assert(editor.showCursor === true, "disabling Vim should restore the prompt cursor visibility")
  assert(editor.cursorStyle === defaultCursorStyle, "disabling Vim should restore the prompt cursor style")
  assert(editor.selectionBg === defaultSelectionBg, "disabling Vim should restore the prompt selection background")
  assert(editor.selectionFg === defaultSelectionFg, "disabling Vim should restore the prompt selection foreground")
  await cleanup?.()
  assert(editor.clear === originalClear, "prompt cleanup should restore patched clear")
  assert(editor.submit === originalSubmit, "prompt patching should leave submit unchanged")
  assert(editor.onPaste === originalPaste, "prompt cleanup should restore patched paste")
  assert(editor.insertText === originalInsertText, "prompt cleanup should restore insertText")
  assert(editor.deleteRange === originalDeleteRange, "prompt cleanup should restore deleteRange")
  assert(editor.setText === originalSetText, "prompt cleanup should restore setText")
}

{
  const { layers, context, cleanup } = await setup()
  const editor: any = fakeTextarea()
  context.renderer.currentFocusedEditor = editor
  const keyInput = context.renderer.keyInput as InternalKeyHandler
  keyInput.onInternal("keypress", (event) => editor.insertText(event.shift ? "<" : ","))
  const comma = (shift = false) => {
    const event = new KeyEvent({
      name: ",", sequence: ",", raw: shift ? "\x1b[44;2u" : ",", ctrl: false, meta: false, shift,
      option: false, number: false, eventType: "press", source: shift ? "kitty" : "raw",
    })
    keyInput.emit("keypress", event)
    return event
  }
  editor.plainText = "abc"
  assert(comma().defaultPrevented && editor.plainText === "abc", "normal comma should not reach native insertion")
  assert(comma(true).defaultPrevented && editor.plainText === "abc", "normal shifted comma should not reach native insertion")
  vimKey(layers, "r")()
  assert(comma(true).defaultPrevented && editor.plainText === "<bc", "r followed by shifted comma should replace with <")
  editor.plainText = "a<bc>"
  editor.cursorOffset = 2
  vimKey(layers, "d")()
  vimKey(layers, "i")()
  assert(comma(true).defaultPrevented && editor.plainText === "a<>", "di followed by shifted comma should resolve the angle-bracket object")
  editor.plainText = "abc"
  editor.cursorOffset = 0
  vimKey(layers, "r")()
  comma()
  assert(editor.plainText === ",bc", "r, should replace rather than insert")
  editor.plainText = "a,b,c"
  editor.cursorOffset = 0
  vimKey(layers, "f")()
  comma()
  assert(editor.cursorOffset === 1, "f, should find the comma")
  vimKey(layers, ";")()
  comma()
  assert(editor.cursorOffset === 1, "comma should repeat find in reverse")
  vimKey(layers, "i")()
  const beforeInsert = editor.plainText
  assert(!comma().defaultPrevented && editor.plainText.length === beforeInsert.length + 1, "insert comma should use native insertion once")
  assert(!comma(true).defaultPrevented && editor.plainText.length === beforeInsert.length + 2, "insert shifted comma should use native insertion once")
  vimKey(layers, "escape")()
  context.keymap.mode.current = () => "autocomplete"
  assert(!comma().defaultPrevented && !comma(true).defaultPrevented, "comma and shifted comma should fall through outside the host base mode")
  context.keymap.mode.current = () => "base"
  const toggle = layers.flatMap((layer) => layer.commands ?? []).find((command: any) => command.id === "ocv-plugin.toggle")
  toggle.run()
  assert(!comma().defaultPrevented && !comma(true).defaultPrevented, "disabled Vim should leave comma and shifted comma to the host")
  await cleanup?.()
  assert(keyInput.listenerCount("keypress") === 0, "cleanup should remove the comma interceptor")
}

{
  const { layers, context } = await setup()
  const toggle = layers
    .flatMap((layer) => layer.commands ?? [])
    .find((command: any) => command.id === "ocv-plugin.toggle")
  const editor = fakeTextarea()
  editor.plainText = "a\nb"
  context.renderer.currentFocusedEditor = editor

  vimKey(layers, "d")()
  vimKey(layers, "g")()
  toggle.run()
  toggle.run()
  vimKey(layers, "g")()
  vimKey(layers, "j")()
  assert(editor.plainText === "a\nb", "toggling Vim should clear handler-private pending operator state")
  await new Promise((resolve) => setTimeout(resolve, 0))
  editor.plainText = "abc"
  editor.cursorOffset = 0
  vimKey(layers, "x")()
  assert(editor.plainText === "bc", "rapid toggles should leave Vim enabled after persistence finishes")
}

{
  const { layers, context, slots, storageSetters, cleanup } = await setup()
  const editor: any = fakeTextarea()
  const defaultCursorStyle = { style: "block", blinking: false }
  editor.cursorStyle = defaultCursorStyle
  context.renderer.currentFocusedEditor = editor
  const first = slots[0].tree()[1].getChildren()[0]
  const second = slots[0].mount().tree()[1].getChildren()[0]
  vimKey(layers, "i")()
  assert(first.plainText === "-- INSERT --" && second.plainText === first.plainText, "every mounted footer should show insert mode")
  slots[0].dispose()
  const remounted = slots[0].mount().tree()[1].getChildren()[0]
  vimKey(layers, "escape")()
  assert(remounted.plainText === "", "remounted footer should update back to normal mode")
  storageSetters[0]((draft) => { draft.enabled = false })
  assert(editor.showCursor === true && editor.cursorStyle === defaultCursorStyle, "external stored state should restore the native cursor")
  await cleanup?.()
}

{
  const plugin = ((await import("../dist/tui.js" as string)) as any).default
  const { context, layers, toasts } = fakeContext({ initial_mode: "normal" })
  context.storage.store = (_key: string, { initial }: any) => [initial, async () => { throw new Error("write failed") }]
  const cleanup = await plugin.setup(context)
  layers.flatMap((layer) => layer.commands ?? []).find((command: any) => command.id === "ocv-plugin.toggle").run()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert(toasts.some((toast) => toast.variant === "error" && String(toast.message).includes("save")), "storage failure should be reported without an unhandled rejection")
  await cleanup?.()
}

{
  const { layers, context, dispatched } = await setup()
  context.renderer.currentFocusedEditor = fakeTextarea()

  vimKey(layers, "shift+g")(fakeEvent("g", { shift: true, sequence: "G" }))
  assert(dispatched.at(-1) === "session.last", "G on an empty prompt should jump to the last session message")

  vimKey(layers, "g")()
  vimKey(layers, "g")()
  assert(dispatched.at(-1) === "session.first", "gg on an empty prompt should jump to the first session message")
}

{
  const { layers, context } = await setup()
  const editor: any = fakeTextarea()
  editor.height = 5
  editor.visualCursor.visualRow = 2
  editor.cursorOffset = 2
  context.renderer.currentFocusedEditor = editor

  const shifted = (name: string, sequence: string) => fakeEvent(name, { shift: true, sequence })

  vimKey(layers, "shift+h")(shifted("h", "H"))
  assert(editor.visualCursor.visualRow === 0, "H should jump to the top prompt viewport row")
  vimKey(layers, "shift+l")(shifted("l", "L"))
  assert(editor.visualCursor.visualRow === 4, "L should jump to the bottom prompt viewport row")
  vimKey(layers, "shift+m")(shifted("m", "M"))
  assert(editor.visualCursor.visualRow === 2, "M should jump to the middle prompt viewport row")
}

{
  const { layers, context } = await setup()
  const editor: any = fakeTextarea()
  editor.plainText = "draft"
  editor.submit = () => {
    editor.clear()
    return true
  }
  context.renderer.currentFocusedEditor = editor

  vimKey(layers, "x")()
  vimKey(layers, "return")(fakeEvent("return"))
  vimKey(layers, "u")()
  assert(editor.plainText === "", "submitting should clear Vim undo history from the previous prompt")
}

{
  const { layers, context } = await setup({ initial_mode: "normal", insert_after_submit: true })
  const editor: any = fakeTextarea()
  const originalInsertText = editor.insertText
  context.renderer.currentFocusedEditor = editor

  vimKey(layers, "i")()
  editor.insertText("draft")
  editor.clear()
  assert(editor.insertText !== originalInsertText, "insert_after_submit should restart the repeat recorder")
  editor.insertText("abc")
  vimKey(layers, "escape")()
  vimKey(layers, "u")()
  assert(editor.plainText === "", "insert_after_submit text should be undoable without restoring prior prompt history")
  vimKey(layers, ".")()
  assert(editor.plainText === "abc", "insert_after_submit text should be repeatable")
}

{
  const { layers, context } = await setup()
  const editor: any = fakeTextarea()
  editor.plainText = "draft"
  editor.submit = () => true
  const originalInsertText = editor.insertText
  context.renderer.currentFocusedEditor = editor

  vimKey(layers, "x")()
  editor.submit()
  vimKey(layers, "u")()
  assert(editor.plainText === "draft", "a rejected submission should preserve Vim undo history")

  vimKey(layers, "i")()
  editor.insertText("!")
  editor.submit()
  assert(editor.insertText !== originalInsertText, "a rejected submission should keep the repeat recorder active")
}

{
  const { layers, context } = await setup()
  const editor: any = fakeTextarea()
  const stats: { nativePastes: number } = { nativePastes: 0 }
  editor.onPaste = () => stats.nativePastes++
  context.renderer.currentFocusedEditor = editor
  let prevented = false
  const pasteEvent = {
    preventDefault() {
      prevented = true
    },
    stopPropagation() {},
  }

  vimKey(layers, "h")()
  editor.onPaste(pasteEvent)
  assert(prevented && stats.nativePastes === 0, "bracketed paste should be blocked in normal mode")
  vimKey(layers, "i")()
  editor.onPaste(pasteEvent)
  assert(Boolean(stats.nativePastes), "bracketed paste should reach the editor in insert mode")
}

for (const [label, key, height, startRow, startOffset, expectedOffset] of [
  ["Down multi-line", "down", 2, 0, 0, 1],
  ["Down single line", "down", 1, 0, 0, 0],
  ["Up multi-line", "up", 2, 1, 3, 2],
  ["Up first line", "up", 2, 0, 0, 0],
] as const) {
  const { layers, context, cleanup } = await setup({ initial_mode: "insert" })
  const editor: any = fakeTextarea()
  editor.plainText = "ab\ncd"
  editor.height = height
  editor.visualCursor = { visualRow: startRow, visualCol: 0 }
  editor.cursorOffset = startOffset
  context.renderer.currentFocusedEditor = editor
  const handled = vimKey(layers, key)()
  assert(handled !== false, `${label} must be consumed in insert mode, never fall through to subagent navigation`)
  assert(editor.cursorOffset === expectedOffset, `${label} should move the caret and nothing else`)
  await cleanup?.()
}

{
  // A two-key escape sequence (e.g. "jk") must be reset by an intervening
  // Up/Down. Without the reset, typing j, Down, k within the escape window
  // would complete the escape at the moved caret and delete unrelated text.
  const { layers, context, cleanup } = await setup({ initial_mode: "insert", vim_escape_sequence: "jk" })
  const editor: any = fakeTextarea()
  editor.plainText = "abcd"
  editor.height = 2
  editor.visualCursor = { visualRow: 0, visualCol: 0 }
  editor.cursorOffset = 1
  context.renderer.currentFocusedEditor = editor
  vimKey(layers, "j")()
  assert(vimKey(layers, "down")() !== false, "Down should stay consumed while an escape sequence is pending")
  assert(editor.cursorOffset === 2, "Down should move the caret while an escape sequence is pending")
  assert(vimKey(layers, "k")() === false, "k after an interrupted escape sequence should insert, not complete the escape")
  assert(editor.plainText === "abcd", "an interrupted escape sequence must not delete text at the moved caret")
  assert(editor.cursorStyle?.style === "line", "an interrupted escape sequence should stay in insert mode")
  await cleanup?.()
}

{
  const { layers, context } = await setup()
  const editor: any = fakeTextarea()
  const stats = { renderRequests: 0 }
  const renderRequests = () => stats.renderRequests
  let resolveHostPaste: (() => void) | undefined
  editor.onPaste = () =>
    new Promise<void>((resolve) => {
      resolveHostPaste = resolve
    })
  context.renderer.currentFocusedEditor = editor
  context.renderer.requestRender = () => stats.renderRequests++

  vimKey(layers, "i")()
  editor.onPaste({ preventDefault() {}, stopPropagation() {} })
  await new Promise((resolve) => setTimeout(resolve, 0))
  // The indicator's imperative sync already requested frames for the mode
  // change; the paste path must add exactly one of its own, and only once the
  // host paste handler settles.
  const rendersBeforePaste = renderRequests()
  resolveHostPaste?.()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert(renderRequests() === rendersBeforePaste + 1, "completed pastes should request exactly one render")
}

for (const scheduling of ["sync", "promise", "queued"]) {
  for (const [before, after, history] of [
    ["foo", "", ["", "foo", "fooBAR"]],
    ["foo", "baz", ["", "foo", "fooBAR", "fooBARbaz"]],
    ["", "", ["", "BAR"]],
  ] as const) {
    const { layers, context, cleanup } = await setup()
    const editor: any = fakeTextarea()
    let pasteQueue = Promise.resolve()
    editor.onPaste = () => {
      if (scheduling === "sync") editor.insertText("BAR")
      else {
        pasteQueue = pasteQueue.then(async () => {
          await Promise.resolve()
          editor.insertText("BAR")
        })
        if (scheduling === "promise") return pasteQueue
      }
    }
    context.renderer.currentFocusedEditor = editor

    vimKey(layers, "i")()
    if (before) editor.insertText(before)
    editor.onPaste({ preventDefault() {}, stopPropagation() {} })
    if (scheduling !== "sync") await pasteQueue
    if (after) editor.insertText(after)
    vimKey(layers, "escape")()
    assert(editor.plainText === history.at(-1), `${scheduling} paste should preserve surrounding typing`)
    for (const expected of history.slice(0, -1).reverse()) {
      vimKey(layers, "u")()
      assert(editor.plainText === expected, `${scheduling} paste undo should restore ${JSON.stringify(expected)}`)
    }
    vimKey(layers, "u")()
    assert(editor.plainText === "", `${scheduling} paste must not create extra undo entries`)
    for (const expected of history.slice(1)) {
      vimKey(layers, "ctrl+r")()
      assert(editor.plainText === expected, `${scheduling} paste redo should restore ${JSON.stringify(expected)}`)
    }
    for (const _ of history.slice(1)) vimKey(layers, "u")()
    vimKey(layers, ".")()
    assert(editor.plainText === history.at(-1), `${scheduling} paste dot repeat should replay the full session`)
    await cleanup?.()
  }
}

{
  const { layers, context, cleanup } = await setup()
  const editor: any = fakeTextarea()
  let resolveHostPaste: (() => void) | undefined
  editor.onPaste = async () => {
    await new Promise<void>((resolve) => {
      resolveHostPaste = resolve
    })
    editor.insertText("BAR")
  }
  context.renderer.currentFocusedEditor = editor

  vimKey(layers, "i")()
  editor.insertText("foo")
  editor.onPaste({ preventDefault() {}, stopPropagation() {} })
  vimKey(layers, "escape")()
  vimKey(layers, "u")()
  assert(editor.plainText === "", "undo before the host paste settles should remove the earlier typing")
  resolveHostPaste?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert(editor.plainText === "BAR", "the settled host paste should land in the prompt")
  vimKey(layers, "u")()
  assert(editor.plainText === "", "the settled paste should be its own undo entry")
  await cleanup?.()
}

for (const queued of [false, true]) {
  const { layers, context, cleanup } = await setup()
  const editor: any = fakeTextarea()
  let pasteQueue = Promise.resolve()
  let pasteText = "XY"
  editor.onPaste = () => {
    const text = pasteText
    const insert = () => { for (const char of text) editor.insertText(char) }
    if (queued) void (pasteQueue = pasteQueue.then(insert))
    else insert()
  }
  context.renderer.currentFocusedEditor = editor

  vimKey(layers, "i")()
  editor.onPaste({ preventDefault() {}, stopPropagation() {} })
  pasteText = "Z"
  editor.onPaste({ preventDefault() {}, stopPropagation() {} })
  if (queued) await pasteQueue
  vimKey(layers, "escape")()
  vimKey(layers, "u")()
  assert(editor.plainText === "XY", "consecutive pastes should each undo separately")
  vimKey(layers, "u")()
  assert(editor.plainText === "", "multiple insertions within one paste should undo together")
  vimKey(layers, "ctrl+r")()
  assert(editor.plainText === "XY", "redo should restore every insertion within a paste")
  await cleanup?.()
}

for (const initialMode of ["normal", "insert"]) {
  const { layers, context, cleanup } = await setup({ initial_mode: initialMode })
  const editor: any = fakeTextarea()
  const originalInsertText = editor.insertText
  const originalDeleteRange = editor.deleteRange
  const originalSetText = editor.setText
  let pasteQueue = Promise.resolve()
  editor.onPaste = () => {
    void (pasteQueue = pasteQueue.then(() => { editor.insertText("BAR") }))
  }
  context.renderer.currentFocusedEditor = editor
  context.renderer.emit(CliRenderEvents.FOCUSED_EDITOR)
  if (initialMode === "normal") vimKey(layers, "i")()
  editor.insertText("foo")
  editor.onPaste({ preventDefault() {}, stopPropagation() {} })
  await pasteQueue
  vimKey(layers, "backspace")()
  editor.plainText = editor.plainText.slice(0, -1)
  editor.cursorOffset--
  vimKey(layers, "escape")()
  vimKey(layers, "u")()
  assert(editor.plainText === "fooBAR", "native deletion after paste should undo independently")
  vimKey(layers, "u")()
  assert(editor.plainText === "foo", "undo after native deletion should still isolate the paste")
  await cleanup?.()
  assert(editor.insertText === originalInsertText, "cleanup should restore insertText in either initial mode")
  assert(editor.deleteRange === originalDeleteRange, "cleanup should restore deleteRange in either initial mode")
  assert(editor.setText === originalSetText, "cleanup should restore setText in either initial mode")
}

for (const reject of [false, true]) {
  const { layers, context, cleanup } = await setup()
  const editor: any = fakeTextarea()
  editor.onPaste = async () => {
    await Promise.resolve()
    if (reject) throw new Error("paste failed")
  }
  context.renderer.currentFocusedEditor = editor

  vimKey(layers, "i")()
  editor.insertText("foo")
  editor.onPaste({ preventDefault() {}, stopPropagation() {} })
  await new Promise((resolve) => setTimeout(resolve, 0))
  editor.insertText("bar")
  vimKey(layers, "escape")()
  vimKey(layers, "u")()
  assert(editor.plainText === "", "a non-mutating paste must not split the surrounding typing")
  await cleanup?.()
}

for (const queued of [false, true]) {
  const { layers, context, cleanup } = await setup()
  const editor: any = fakeTextarea()
  editor.setText("abcd")
  editor.cursorOffset = 0
  let pasteQueue = Promise.resolve()
  editor.onPaste = () => {
    if (queued) void (pasteQueue = pasteQueue.then(() => { editor.insertText("PASTE") }))
    else editor.insertText("PASTE")
  }
  context.renderer.currentFocusedEditor = editor

  vimKey(layers, "shift+r")()
  vimKey(layers, "x")()
  editor.onPaste({ preventDefault() {}, stopPropagation() {} })
  await pasteQueue
  vimKey(layers, "escape")()
  vimKey(layers, "u")()
  assert(editor.plainText === "xbcd", "replace-mode Escape after paste must not add a cursor-only undo entry")
  vimKey(layers, "u")()
  assert(editor.plainText === "abcd", "replacement typing before paste should retain its own undo entry")
  await cleanup?.()
}

{
  const { layers, context, cleanup } = await setup()
  const first: any = fakeTextarea()
  let resolveHostPaste: (() => void) | undefined
  first.onPaste = async () => {
    await new Promise<void>((resolve) => { resolveHostPaste = resolve })
    first.insertText("BAR")
  }
  context.renderer.currentFocusedEditor = first
  vimKey(layers, "i")()
  first.insertText("foo")
  first.onPaste({ preventDefault() {}, stopPropagation() {} })

  const second: any = fakeTextarea()
  second.setText("new draft")
  context.renderer.currentFocusedEditor = second
  context.renderer.emit(CliRenderEvents.FOCUSED_EDITOR)
  vimKey(layers, "escape")()
  resolveHostPaste?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  vimKey(layers, "u")()
  assert(second.plainText === "new draft", "an old editor's pending paste must not write to the new editor's history")
  await cleanup?.()
}

{
  const { layers, context, cleanup } = await setup()
  const editor: any = fakeTextarea()
  let resolveHostPaste: (() => void) | undefined
  editor.onPaste = () => new Promise<void>((resolve) => { resolveHostPaste = resolve })
  context.renderer.currentFocusedEditor = editor
  vimKey(layers, "i")()
  editor.onPaste({ preventDefault() {}, stopPropagation() {} })
  await cleanup?.()
  let renders = 0
  context.renderer.requestRender = () => renders++
  resolveHostPaste?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert(renders === 0, "a pending paste must not request renders after cleanup")
}


{
  const { layers, context } = await setup({ initial_mode: "normal", vim_langmap: { р: "h" } })
  const editor: any = fakeTextarea()
  editor.plainText = "word"
  editor.cursorOffset = 2
  context.renderer.currentFocusedEditor = editor

  vimKey(layers, "р")(fakeEvent("р"))
  assert(editor.cursorOffset === 1, "non-ASCII langmap keys should reach the Vim handler")
}

{
  const { layers, context } = await setup()
  const first: any = fakeTextarea()
  first.plainText = "old"
  const second: any = fakeTextarea()
  second.plainText = "new"

  context.renderer.currentFocusedEditor = first
  vimKey(layers, "x")()
  context.renderer.currentFocusedEditor = second
  vimKey(layers, "u")()
  assert(second.plainText === "new", "switching prompt editors should isolate Vim undo history")
}

for (const dialogOpen of [false, true]) {
  const { layers, context, cleanup } = await setup()
  const editors: any[] = [fakeTextarea(), fakeTextarea()]
  const styles = [{ style: "line", blinking: true }, { style: "block", blinking: false }]
  for (const [index, editor] of editors.entries()) {
    editor.cursorStyle = styles[index]
    context.renderer.currentFocusedEditor = editor
    vimKey(layers, "h")()
    assert(editor.showCursor === true && editor.cursorStyle?.style === "block", "normal mode should show a block prompt cursor")
  }
  editors[0].focused = false
  if (dialogOpen) {
    context.keymap.mode.current = () => "dialog"
    context.renderer.currentFocusedEditor = fakeTextarea()
  }
  const toggle = layers.flatMap((layer) => layer.commands ?? []).find((command: any) => command.id === "ocv-plugin.toggle")
  toggle.run()
  for (const [index, editor] of editors.entries()) {
    assert(editor.showCursor === true, `disabling Vim should restore every prompt cursor (dialog: ${dialogOpen})`)
    assert(editor.cursorStyle === styles[index], "disabling Vim should restore each prompt's original cursor style")
  }
  context.keymap.mode.current = () => "base"
  editors[0].focused = true
  context.renderer.currentFocusedEditor = editors[0]
  assert(vimKey(layers, "q")() === false && editors[0].showCursor === true, "refocusing a disabled prompt should preserve its native cursor")
  await cleanup?.()
}

{
  const { layers, context, cleanup } = await setup()
  const first: any = fakeTextarea()
  const firstPaste = first.onPaste
  const second: any = fakeTextarea()
  const secondPaste = second.onPaste

  context.renderer.currentFocusedEditor = first
  vimKey(layers, "x")()
  assert(first.onPaste !== firstPaste, "first prompt editor should be patched")
  first.isDestroyed = true
  context.renderer.currentFocusedEditor = second
  vimKey(layers, "x")()
  assert(second.onPaste !== secondPaste, "second prompt editor should be patched")
  await cleanup?.()
  assert(first.onPaste !== firstPaste, "destroyed prompt editors should be pruned before cleanup")
  assert(second.onPaste === secondPaste, "live prompt editors should still be restored on cleanup")
}

{
  const { layers, context } = await setup()

  const visualFirst: any = fakeTextarea()
  visualFirst.plainText = "old"
  const visualSecond: any = fakeTextarea()
  visualSecond.plainText = "new"
  visualSecond.cursorOffset = 1
  context.renderer.currentFocusedEditor = visualFirst
  vimKey(layers, "v")()
  vimKey(layers, "l")()
  assert(visualFirst.editorView.getSelection(), "visual mode should select text in the first editor")
  context.renderer.currentFocusedEditor = visualSecond
  vimKey(layers, "x")()
  assert(!visualFirst.editorView.getSelection(), "switching editors should clear the previous visual selection")
  assert(visualSecond.plainText === "nw", "switching editors should leave visual mode before handling the next key")

  const replaceFirst: any = fakeTextarea()
  replaceFirst.plainText = "old"
  const replaceSecond: any = fakeTextarea()
  replaceSecond.plainText = "new"
  replaceSecond.cursorOffset = 1
  context.renderer.currentFocusedEditor = replaceFirst
  vimKey(layers, "shift+r")(fakeEvent("r", { shift: true, sequence: "R" }))
  vimKey(layers, "x")()
  context.renderer.currentFocusedEditor = replaceSecond
  vimKey(layers, "z")()
  assert(replaceSecond.plainText === "new", "switching editors should leave replace mode before handling the next key")
}

{
  const plugin = ((await import("../dist/tui.js" as string)) as any).default
  const { context, layers, toasts } = fakeContext({ toggle_key: "ctrl+", normal_leader: "space", normal_keybinds: { "ctrl+": "session.list" } })
  await plugin.setup(context)
  assert(
    layers.some((layer) => layer.commands?.some((command: any) => command.bind?.split(",").includes("h"))),
    "invalid user keybind config should not prevent core vim bindings from registering",
  )
  assert(
    layers.some((layer) => layer.commands?.some((command: any) => command.id === "ocv-plugin.toggle")),
    "invalid user keybind config should not prevent command registration",
  )
  const errors = toasts.filter((toast) => toast.variant === "error")
  assert(errors.length === 2, "each invalid user keybind option should surface an error toast")
  assert(toasts.some((toast) => String(toast.message).includes("toggle_key")), "the toggle_key error toast should name the option")
  assert(toasts.some((toast) => String(toast.message).includes("normal_keybinds")), "the normal_keybinds error toast should name the option")
  assert(
    toasts.some((toast) => toast.variant === "warning" && String(toast.message).includes("normal_leader")),
    "normal_leader should surface a v2 deprecation warning",
  )
}

console.log("ok: adapter behavior checks passed")
