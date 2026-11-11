import { AsyncLocalStorage } from "node:async_hooks"
import { spawnSync } from "node:child_process"
import type { Context, KeymapCommand } from "@opencode/plugin/tui/context"
import { CliRenderEvents, RGBA, type KeyEvent, type TextareaRenderable } from "@opentui/core"
import { createVimHandler, type VimEvent } from "./vim/handler"
import { useVimIndicator } from "./vim/indicator"
import { createVimState, type VimMode, type VimRegister } from "./vim/state"

const PROMPT_RENDER_PATCH = Symbol("ocv-plugin.prompt.render.patch")

type PromptRenderPatch = {
  originalInsertText: TextareaLike["insertText"]
  patchedInsertText: TextareaLike["insertText"]
  originalClear: TextareaLike["clear"]
  patchedClear: TextareaLike["clear"]
  originalPaste: TextareaLike["onPaste"]
  patchedPaste: NonNullable<TextareaLike["onPaste"]>
  originalShowCursor: TextareaLike["showCursor"]
  originalCursorStyle: TextareaLike["cursorStyle"]
  originalSelectionBg: TextareaLike["selectionBg"]
  originalSelectionFg: TextareaLike["selectionFg"]
}

type TextareaLike = TextareaRenderable & {
  focused?: boolean
  [PROMPT_RENDER_PATCH]?: PromptRenderPatch
}

const COMMAND_PALETTE = "command.palette.show"
const COMMAND_KEY = "ocv-plugin.key"
const YANK_FLASH_MS = 70
// Clipboard tools answer in single-digit milliseconds when they work; a short
// timeout only caps the stall when they don't (spawnSync blocks the render loop).
const CLIPBOARD_TIMEOUT_MS = 300

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isTextareaLike(value: unknown): value is TextareaLike {
  if (!isRecord(value)) return false
  return (
    typeof value.plainText === "string" &&
    typeof value.cursorOffset === "number" &&
    typeof value.insertText === "function" &&
    typeof value.deleteRange === "function" &&
    typeof value.setText === "function" &&
    typeof value.editBuffer === "object"
  )
}

const shiftedSymbols: Record<string, string> = {
  "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", "8": "*", "9": "(", "0": ")",
  "-": "_", "=": "+", "[": "{", "]": "}", "\\": "|", ";": ":", "'": '"', ",": "<", ".": ">", "/": "?", "`": "~",
}

function vimEvent(event: KeyEvent): VimEvent {
  if (hasModifier(event)) return event
  const typed = event.sequence?.length === 1 ? event.sequence : event.raw?.length === 1 ? event.raw : undefined
  const shifted = event.shift ? shiftedSymbols[event.name] : undefined
  const text = shifted && typed === event.name
    ? shifted
    : typed && typed.charCodeAt(0) > 32 && typed.charCodeAt(0) !== 127 ? typed : shifted
  if (!text) return event
  return { ...event, name: text, sequence: text, preventDefault: () => event.preventDefault() }
}

function hasModifier(event: { ctrl?: boolean; meta?: boolean; super?: boolean }) {
  return !!event.ctrl || !!event.meta || !!event.super
}

function selectedForeground(context: Context, bg: RGBA) {
  if (context.theme.background.base.a > 0) return context.theme.background.base
  return 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
}

function clipboardRead() {
  const command =
    process.platform === "darwin"
      ? ["pbpaste"]
      : process.platform === "win32"
        ? ["powershell.exe", "-NoProfile", "-Command", "Get-Clipboard -Raw"]
        : ["sh", "-c", "wl-paste -n 2>/dev/null || xclip -selection clipboard -out 2>/dev/null || xsel --clipboard --output 2>/dev/null"]
  const result = spawnSync(command[0]!, command.slice(1), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: CLIPBOARD_TIMEOUT_MS,
    windowsHide: true,
  })
  if (result.status !== 0 || result.error) return
  return result.stdout
}

function clipboardWrite(text: string): "ok" | "missing" | "failed" {
  const command =
    process.platform === "darwin"
      ? ["pbcopy"]
      : process.platform === "win32"
        ? ["powershell.exe", "-NoProfile", "-Command", "[Console]::In.ReadToEnd() | Set-Clipboard"]
        : ["sh", "-c", "wl-copy 2>/dev/null || xclip -selection clipboard -in 2>/dev/null || xsel --clipboard --input 2>/dev/null"]
  const result = spawnSync(command[0]!, command.slice(1), {
    input: text,
    encoding: "utf8",
    stdio: ["pipe", "ignore", "ignore"],
    timeout: CLIPBOARD_TIMEOUT_MS,
    windowsHide: true,
  })
  if (result.error) return (result.error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "failed"
  return result.status === 0 ? "ok" : "failed"
}

const normalKeys: string[] = [
  "escape",
  "return",
  "space",
  "backspace",
  "delete",
  "left",
  "right",
  "up",
  "down",
  "h",
  "j",
  "k",
  "l",
  "shift+h",
  "shift+m",
  "shift+l",
  "w",
  "b",
  "e",
  "shift+w",
  "shift+b",
  "shift+e",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "shift+4",
  "shift+6",
  "shift+-",
  "$",
  "^",
  "_",
  "g",
  "shift+g",
  "f",
  "shift+f",
  "t",
  "shift+t",
  ";",
  "i",
  "shift+i",
  "a",
  "shift+a",
  "o",
  "shift+o",
  "r",
  "shift+r",
  "x",
  "shift+x",
  "s",
  "shift+s",
  "c",
  "shift+c",
  "d",
  "y",
  "p",
  "shift+p",
  "q",
  "u",
  "ctrl+r",
  ".",
  "v",
  "shift+v",
  "shift+j",
  "z",
  "/",
  "shift+/",
  "shift+;",
  "shift+'",
  "shift+`",
  ":",
  "\"",
  "'",
  "`",
  "shift+9",
  "shift+0",
  "(",
  ")",
  "[",
  "]",
  "shift+[",
  "shift+]",
  "shift+.",
  "%",
  "<",
  ">",
  "shift+5",
  "ctrl+e",
  "ctrl+y",
  "ctrl+d",
  "ctrl+u",
  "ctrl+f",
  "ctrl+b",
  "ctrl+w",
  "ctrl+v",
]

const insertPrintableKeys: string[] = [
  ..."abcdefghijklmnopqrstuvwxyz".split(""),
  ..."0123456789".split(""),
  "space",
  "-",
  "=",
  "[",
  "]",
  "\\",
  ";",
  "'",
  ".",
  "/",
  "`",
  "shift+a",
  "shift+b",
  "shift+c",
  "shift+d",
  "shift+e",
  "shift+f",
  "shift+g",
  "shift+h",
  "shift+i",
  "shift+j",
  "shift+k",
  "shift+l",
  "shift+m",
  "shift+n",
  "shift+o",
  "shift+p",
  "shift+q",
  "shift+r",
  "shift+s",
  "shift+t",
  "shift+u",
  "shift+v",
  "shift+w",
  "shift+x",
  "shift+y",
  "shift+z",
  "!",
  "@",
  "#",
  "$",
  "%",
  "^",
  "&",
  "*",
  "(",
  ")",
  "_",
  "+",
  "shift+1",
  "shift+2",
  "shift+3",
  "shift+4",
  "shift+5",
  "shift+6",
  "shift+7",
  "shift+8",
  "shift+9",
  "shift+0",
  "shift+-",
  "shift+=",
  "shift+[",
  "shift+]",
  "shift+\\",
  "{",
  "}",
  "|",
  ":",
  "\"",
  "<",
  ">",
  "?",
  "shift+.",
  "shift+/",
  "shift+;",
  "shift+'",
  "shift+`",
  "~",
]

function unique<Value>(items: readonly Value[]) {
  return [...new Set(items)]
}

export function createPromptVim(
  context: Context,
  input: {
    enabled: () => boolean
    initialMode?: VimMode
    enterSubmit?: boolean
    insertAfterSubmit?: boolean
    systemClipboardRegister?: boolean
    langmap?: () => Record<string, string> | undefined
    vimEscapeSequence?: string
  },
) {
  let lastPromptEditor: TextareaLike | undefined
  let lastPromptKey: string | undefined
  let refocusingPrompt = false
  let onPromptEditorChange = (_previous: TextareaLike | undefined) => {}
  let onPromptClear = () => {}
  let disposed = false
  let pasteGeneration = 0
  const pasteEdits = new AsyncLocalStorage<{ editor: TextareaLike; generation: number } | undefined>()
  let lastPaste: ReturnType<typeof pasteEdits.getStore>
  let pasteTail: { text: string; cursor: number } | undefined

  function cancelPasteEdits() {
    pasteGeneration++
    lastPaste = undefined
    pasteTail = undefined
  }

  // Workaround for https://github.com/anomalyco/opencode/issues/63267.
  //
  // The host pushes an "autocomplete" keymap mode while the @ or / popup is open
  // and pops it when the popup closes. Switching session tabs with the popup open
  // unmounts the popup but leaves the mode pushed, so coming back to the home
  // route restores a mode with no popup behind it. The plugin's Vim commands live
  // in the "base" layer and the host scopes base layers out whenever a non-base
  // mode is current, so that stale mode silently locks Vim out of every key:
  // typing falls through to the host and escape never reaches the Vim handler,
  // while the plugin still believes it is in normal mode. Escape cannot recover
  // it, and dispatching the host's own hide command does not pop the mode either.
  //
  // The fix is to trust the mode only while the popup's own commands are actually
  // reachable, and register the Vim commands in the stale mode so the keys keep
  // arriving. Once the host pops the mode this could go back to a plain "base"
  // check, but the reachability test is also the more defensive reading of the
  // keymap API, so it is worth keeping either way.
  //
  // That reachability check must not run inside the FOCUSED_EDITOR emit or the key
  // handler: reading the reachable command list there re-enters the host's keymap
  // mid-transition and the popup never mounts. So keymapMode(), which only the
  // keymap layer factory runs in, publishes the answer and the guards read the
  // cached value. The default assumes the host owns the keys, matching the old
  // behavior, so a factory that has not run yet can never hand the keys back.
  let autocompleteStale = false

  function autocompleteCommandsReachable() {
    try {
      return context.keymap
        .commands()
        .some((command) => String(command.id ?? "").startsWith("prompt.autocomplete"))
    } catch {
      return true
    }
  }

  /**
   * The keymap mode the plugin's Vim commands should be registered in. Reads the
   * host's reachable command list, so only the keymap layer factory may call it.
   */
  function keymapMode() {
    autocompleteStale = context.keymap.mode.current() === "autocomplete" && !autocompleteCommandsReachable()
    return autocompleteStale ? "autocomplete" : "base"
  }

  function hostOwnsKeys() {
    const mode = context.keymap.mode.current()
    if (mode === "base") return false
    if (mode === "autocomplete") return !autocompleteStale
    return true
  }

  function currentPromptEditor() {
    // Dialogs and menus push non-base keymap modes.
    if (hostOwnsKeys()) return
    const route = context.ui.router.current()
    if (route.type !== "home" && route.type !== "session") return
    const key = route.type === "session" ? `session:${route.sessionID}` : "home"
    let editor = context.renderer.currentFocusedEditor
    if (!isTextareaLike(editor)) return
    if (editor.focused === false) return
    // OpenCode can mount two prompt renderables for the same prompt (seen on the
    // new-session route) and flap focus onto the collapsed, zero-size duplicate.
    // The native block cursor follows the focused renderable, so it lands on the
    // invisible one and disappears; the switches also churn Vim state. When focus
    // is on a collapsed renderable but the laid-out one for this same prompt is
    // known, keep using it and pull focus back so the cursor and Vim stay put.
    if (
      !refocusingPrompt &&
      (editor.width <= 0 || editor.height <= 0) &&
      key === lastPromptKey &&
      lastPromptEditor &&
      lastPromptEditor !== editor &&
      !lastPromptEditor.isDestroyed &&
      lastPromptEditor.width > 0 &&
      lastPromptEditor.height > 0
    ) {
      refocusingPrompt = true
      try {
        lastPromptEditor.focus()
      } finally {
        refocusingPrompt = false
      }
      return lastPromptEditor
    }
    if (editor !== lastPromptEditor) {
      const previous = lastPromptEditor
      lastPromptEditor = editor
      lastPromptKey = key
      patchPromptEditor(editor)
      onPromptEditorChange(previous)
    }
    return editor
  }

  function promptEditor() {
    if (!input.enabled()) return
    return currentPromptEditor()
  }

  const patchedEditors = new Set<TextareaLike>()
  const pasteLayoutTimers = new Set<ReturnType<typeof setTimeout>>()

  function refreshPasteLayout(editor: TextareaLike) {
    if (disposed) return
    const timer = setTimeout(() => {
      pasteLayoutTimers.delete(timer)
      if (editor.isDestroyed) return
      context.renderer.requestRender()
    }, 0)
    pasteLayoutTimers.add(timer)
  }

  function prunePatchedEditors() {
    for (const patched of patchedEditors) {
      if (patched.isDestroyed) patchedEditors.delete(patched)
    }
  }

  function restorePromptAppearance(editor: TextareaLike, patch: PromptRenderPatch) {
    editor.showCursor = patch.originalShowCursor
    editor.cursorStyle = patch.originalCursorStyle
    editor.selectionBg = patch.originalSelectionBg
    editor.selectionFg = patch.originalSelectionFg
    editor.requestRender()
  }

  function patchPromptEditor(editor: TextareaLike) {
    if (editor[PROMPT_RENDER_PATCH]) return
    prunePatchedEditors()
    const originalInsertText = editor.insertText
    let inserting = false
    const patchedInsertText: TextareaLike["insertText"] = (...args) => {
      const paste = pasteEdits.getStore()
      if (!paste) lastPaste = undefined
      if (
        !paste || inserting || disposed || !input.enabled() || editor.isDestroyed ||
        paste.editor !== editor || paste.generation !== pasteGeneration ||
        editor !== lastPromptEditor || editor !== context.renderer.currentFocusedEditor
      ) return originalInsertText.apply(editor, args)
      const pre = { text: editor.plainText, cursor: editor.cursorOffset }
      inserting = true
      try {
        return originalInsertText.apply(editor, args)
      } finally {
        inserting = false
        if (paste.generation === pasteGeneration && !disposed) {
          const post = { text: editor.plainText, cursor: editor.cursorOffset }
          if (pre.text !== post.text) {
            if (lastPaste !== paste || pasteTail?.text !== pre.text) {
              state.commitEdit(pasteTail?.text === pre.text ? pasteTail : pre)
              state.push(pre, post)
            }
            lastPaste = paste
            pasteTail = post
            if (state.isInsert() || state.isReplace()) state.beginEdit(post)
          }
        }
      }
    }
    const originalClear = editor.clear
    const patchedClear: TextareaLike["clear"] = (...args) => {
      originalClear.apply(editor, args)
      onPromptClear()
    }
    const originalPaste = editor.onPaste
    const patchedPaste: NonNullable<TextareaLike["onPaste"]> = (event) => {
      if (input.enabled() && state.mode() !== "insert" && state.mode() !== "replace") {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      const result = pasteEdits.run(
        input.enabled() ? { editor, generation: pasteGeneration } : undefined,
        () => originalPaste?.call(editor, event) as unknown,
      )
      if (typeof (result as PromiseLike<unknown> | undefined)?.then === "function") {
        void Promise.resolve(result).then(
          () => refreshPasteLayout(editor),
          () => refreshPasteLayout(editor),
        )
      } else {
        refreshPasteLayout(editor)
      }
    }
    editor[PROMPT_RENDER_PATCH] = {
      originalInsertText,
      patchedInsertText,
      originalClear,
      patchedClear,
      originalPaste,
      patchedPaste,
      originalShowCursor: editor.showCursor,
      originalCursorStyle: editor.cursorStyle,
      originalSelectionBg: editor.selectionBg,
      originalSelectionFg: editor.selectionFg,
    }
    editor.insertText = patchedInsertText
    editor.clear = patchedClear
    editor.onPaste = patchedPaste
    patchedEditors.add(editor)
  }

  function applyCursorStyle() {
    if (!input.enabled()) {
      cancelPasteEdits()
      prunePatchedEditors()
      for (const editor of patchedEditors) {
        const patch = editor[PROMPT_RENDER_PATCH]
        if (patch) restorePromptAppearance(editor, patch)
      }
      return
    }
    const editor = currentPromptEditor()
    if (!editor) return
    patchPromptEditor(editor)
    const visual = state.isVisual()
    editor.selectionBg = visual ? context.theme.hue.accent[300] : undefined
    editor.selectionFg = visual ? selectedForeground(context, context.theme.hue.accent[300]) : undefined
    if (state.isInsert()) {
      editor.showCursor = true
      editor.cursorStyle = { style: "line", blinking: true }
      return
    }
    if (state.isReplace()) {
      editor.showCursor = true
      editor.cursorStyle = { style: "underline", blinking: false }
      return
    }
    editor.cursorStyle = { style: "block", blinking: false }
    editor.showCursor = true
    editor.requestRender()
  }

  // The v2 TUI renders the plugin slot tree once and caches it: Solid
  // effects and Show re-reads inside that tree never run on the host. The
  // indicator is a plugin-owned element, so it is updated imperatively from
  // the same call sites that restyle the cursor (every mode change goes
  // through one of them).
  let styleSync: (() => void) | undefined
  function syncStyle() {
    applyCursorStyle()
    styleSync?.()
  }
  function setStyleSync(fn: () => void) {
    styleSync = fn
  }

  function textarea() {
    const editor = promptEditor()
    if (!editor) throw new Error("No focused OpenCode prompt textarea")
    return editor
  }

  const state = createVimState({
    enabled: input.enabled,
    initial: () => input.initialMode,
  })
  let clipboardRegister: VimRegister = null
  let clipboardText: string | undefined
  let clipboardUnavailable = false
  let clipboardFailures = 0

  // Fail fast: stop shelling out once the clipboard tool is known to be dead so
  // every yank/delete/paste doesn't block on it (spawnSync stalls the render
  // loop). A missing binary latches immediately; ambiguous failures (timeout,
  // nonzero exit) only latch after a few in a row, so a slow-but-working tool
  // (PowerShell cold start, X11 over SSH) isn't disabled by one hiccup.
  // Reads are not latched because an empty Wayland clipboard also exits non-zero.
  const CLIPBOARD_MAX_FAILURES = 3

  function clipboardFailed(kind: "missing" | "failed") {
    clipboardFailures = kind === "missing" ? CLIPBOARD_MAX_FAILURES : clipboardFailures + 1
    if (clipboardFailures < CLIPBOARD_MAX_FAILURES || clipboardUnavailable) return
    clipboardUnavailable = true
    context.ui.toast.show({ variant: "warning", message: "System clipboard unavailable, using the internal Vim register" })
  }
  let flash = 0
  let flashSpan: { start: number; end: number } | undefined
  let flashTimer: ReturnType<typeof setTimeout> | undefined

  function register() {
    if (!input.systemClipboardRegister || clipboardUnavailable) return state.register()
    const text = clipboardRead()
    if (text === undefined) return clipboardRegister ?? state.register()
    if (clipboardRegister && text === clipboardText) return clipboardRegister
    return { text, linewise: false }
  }

  function setRegister(next: VimRegister, notify = false) {
    state.setRegister(next)
    if (!input.systemClipboardRegister || !next || clipboardUnavailable) return
    clipboardRegister = next
    clipboardText = next.text
    const copied = clipboardWrite(next.text)
    if (copied !== "ok") {
      clipboardFailed(copied)
      return
    }
    clipboardFailures = 0
    if (notify) context.ui.toast.show({ message: "Copied to clipboard", variant: "info" })
  }

  function submitPrompt() {
    const editor = textarea()
    patchPromptEditor(editor)
    editor.submit()
  }

  function flashYank(span: { start: number; end: number }) {
    const editor = promptEditor()
    if (!editor || span.end <= span.start) return
    flash++
    flashSpan = span
    const id = flash
    const cursor = editor.cursorOffset
    editor.editorView.setSelection(span.start, span.end, editor.selectionBg, editor.selectionFg)
    editor.cursorOffset = cursor
    context.renderer.requestRender()
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      if (editor.isDestroyed) return
      if (id !== flash) return
      if (state.isVisual()) {
        flashSpan = undefined
        return
      }
      const selection = editor.editorView.getSelection()
      if (!selection) {
        flashSpan = undefined
        return
      }
      if (selection.start !== span.start || selection.end !== span.end) {
        flashSpan = undefined
        return
      }
      flashSpan = undefined
      editor.clearSelection()
      context.renderer.requestRender()
    }, YANK_FLASH_MS)
  }

  function jumpPromptViewport(action: "high" | "middle" | "low") {
    const editor = textarea()
    const row = action === "high" ? 0 : action === "middle" ? Math.max(0, Math.floor((editor.height - 1) / 2)) : editor.height - 1

    let prev = -1
    while (editor.visualCursor.visualRow > row && editor.cursorOffset !== prev) {
      prev = editor.cursorOffset
      editor.moveCursorUp()
    }

    prev = -1
    while (editor.visualCursor.visualRow < row && editor.cursorOffset !== prev) {
      prev = editor.cursorOffset
      editor.moveCursorDown()
    }
  }

  const handler = createVimHandler({
    enabled: () => Boolean(promptEditor()),
    state,
    textarea,
    register,
    setRegister,
    pasteOverSelection() {
      const selection = textarea().editorView.getSelection()
      if (!selection) return false
      return !flashSpan || selection.start !== flashSpan.start || selection.end !== flashSpan.end
    },
    submit: submitPrompt,
    commandPalette() {
      context.keymap.dispatch(COMMAND_PALETTE)
    },
    flash: flashYank,
    scroll(action) {
      if (action === "line-down") context.keymap.dispatch("session.line.down")
      if (action === "line-up") context.keymap.dispatch("session.line.up")
      if (action === "half-down") context.keymap.dispatch("session.half.page.down")
      if (action === "half-up") context.keymap.dispatch("session.half.page.up")
      if (action === "page-down") context.keymap.dispatch("session.page.down")
      if (action === "page-up") context.keymap.dispatch("session.page.up")
    },
    jump(action) {
      if (action === "high" || action === "middle" || action === "low") {
        jumpPromptViewport(action)
        return
      }
      const editor = textarea()
      if (editor.plainText.length > 0) {
        if (action === "top") editor.gotoBufferHome()
        if (action === "bottom") editor.gotoBufferEnd()
        return
      }
      if (action === "top") context.keymap.dispatch("session.first")
      if (action === "bottom") context.keymap.dispatch("session.last")
    },
    copySearchStart: () => false,
    autocomplete: (trigger) => trigger,
    langmap: input.langmap,
    vimEscapeSequence: input.vimEscapeSequence,
  })

  onPromptEditorChange = (previous) => {
    cancelPasteEdits()
    const mode = state.mode()
    if (previous && (mode === "visual" || mode === "visual-line") && !previous.isDestroyed) previous.clearSelection()
    handler.cancelPending()
    state.resetHistory()
    if (mode === "visual" || mode === "visual-line" || mode === "replace") state.setMode("normal")
    else if (input.enabled() && mode === "insert") handler.beginInsertEdit()
    syncStyle()
  }
  onPromptClear = () => {
    cancelPasteEdits()
    handler.cancelPending()
    state.resetHistory()
    state.setMode(input.insertAfterSubmit ? "insert" : "normal")
    if (input.enabled() && input.insertAfterSubmit) handler.beginInsertEdit()
    syncStyle()
  }

  const indicator = useVimIndicator({
    enabled: input.enabled,
    active: () => {
      const route = context.ui.router.current().type
      return route === "home" || route === "session"
    },
    state,
  })

  function runVimKey(event: KeyEvent) {
    const editor = promptEditor()
    if (!editor) return false
    lastPaste = undefined
    const keyEvent = vimEvent(event)
    if (state.isReplace() && keyEvent.name === "escape" && pasteTail?.text === editor.plainText) {
      state.commitEdit(pasteTail)
    }
    if (!state.isInsert() && !state.isReplace()) pasteTail = undefined
    if ((state.isInsert() || state.isReplace()) && keyEvent.name === "return" && !hasModifier(keyEvent)) {
      if (input.enterSubmit) submitPrompt()
      else {
        if (state.isReplace()) handler.recordInsertText("\n")
        textarea().insertText("\n")
      }
      syncStyle()
      return
    }
    // While typing, the prompt owns the arrow keys: Up/Down always move the
    // caret and must never fall through to the host (e.g. subagent cycling).
    // Let the handler run first so a pending two-key escape sequence (e.g.
    // "jk") is reset; otherwise a later escape-second would delete text at the
    // moved caret. The handler never moves the caret for arrows in insert or
    // replace mode, so perform the native move here, then consume so the host
    // never sees the key.
    if ((state.isInsert() || state.isReplace()) && (keyEvent.name === "down" || keyEvent.name === "up") && !hasModifier(keyEvent)) {
      if (!handler.handleKey(keyEvent)) {
        if (keyEvent.name === "down") editor.moveCursorDown()
        else editor.moveCursorUp()
      }
      syncStyle()
      return
    }
    const handled = handler.handleKey(keyEvent)
    syncStyle()
    if (!handled) return false
  }

  function onComma(event: KeyEvent) {
    if (event.name !== "," || hasModifier(event)) return
    if (runVimKey(event) === false) return
    event.preventDefault()
    event.stopPropagation()
  }
  context.renderer.keyInput.prependListener("keypress", onComma)

  const keys = unique([
    ...normalKeys,
    ...insertPrintableKeys,
    ...Object.keys(input.langmap?.() ?? {}).map((key) => key === " " ? "space" : key),
  ]).filter((key) => !key.includes(","))
  const vimCommands: KeymapCommand[] = [{
    id: COMMAND_KEY,
    bind: keys.join(","),
    run: (_input, event) => event ? runVimKey(event) : false,
  }]

  context.renderer.on(CliRenderEvents.FOCUSED_EDITOR, syncStyle)
  syncStyle()

  function dispose() {
    disposed = true
    cancelPasteEdits()
    pasteEdits.disable()
    context.renderer.off(CliRenderEvents.FOCUSED_EDITOR, syncStyle)
    context.renderer.keyInput.off("keypress", onComma)
    handler.cancelPending()
    state.cancelEdit()
    for (const timer of pasteLayoutTimers) clearTimeout(timer)
    pasteLayoutTimers.clear()
    if (flashTimer) {
      clearTimeout(flashTimer)
      flashTimer = undefined
    }
    flash++
    for (const editor of patchedEditors) {
      const patch = editor[PROMPT_RENDER_PATCH]
      if (!patch) continue
      if (editor.insertText === patch.patchedInsertText) editor.insertText = patch.originalInsertText
      if (editor.clear === patch.patchedClear) editor.clear = patch.originalClear
      if (editor.onPaste === patch.patchedPaste) editor.onPaste = patch.originalPaste
      delete editor[PROMPT_RENDER_PATCH]
      if (!editor.isDestroyed) {
        if (flashSpan) {
          const selection = editor.editorView.getSelection()
          if (selection?.start === flashSpan.start && selection.end === flashSpan.end) editor.clearSelection()
        }
        restorePromptAppearance(editor, patch)
      }
    }
    patchedEditors.clear()
    flashSpan = undefined
    context.renderer.requestRender()
  }

  return {
    dispose,
    cancelPending: handler.cancelPending,
    applyCursorStyle: syncStyle,
    setStyleSync,
    active: () => Boolean(promptEditor()),
    indicator,
    pending: state.pending,
    isVisual: state.isVisual,
    isVisualLine: state.isVisualLine,
    mode: state.mode,
    setMode: state.setMode,
    keymapMode,
    vimCommands,
  }
}
