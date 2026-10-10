import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ModalEditor } from "../index.js";
import { DEFAULT_INSERT_ESCAPE_SETTINGS } from "../settings.js";
import { sendKeys, stubKeybindings, stubTheme, stubTui } from "./harness.js";

/**
 * Intentional nvim divergence: insert-mode `jj` escapes to NORMAL.
 *
 * Neovim has no equivalent mapping out of the box — feeding `jj` to stock
 * nvim inserts two literal `j`s — so these cases assert pi-vim behavior
 * directly instead of going through the nvim oracle (`assertMatchesNvim`
 * would compare against that literal-`jj` outcome and fail by design).
 * The mapping is rollback-style: the first `j` inserts immediately with no
 * input delay, and a second lone `j` within `timeoutMs` deletes both `j`s
 * and lands in NORMAL exactly as `Esc` would (same cursor, same undo unit,
 * same `.` recording minus the escape letters).
 */

function createInsertEscapeEditor() {
  let now = 1_000_000;
  const editor = new ModalEditor(stubTui, stubTheme, stubKeybindings);
  editor.setClipboardFn(() => undefined);
  editor.setClipboardReadFn(() => null);
  editor.setInsertEscapeClock(() => now);
  return {
    editor,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("nvim parity divergence: insert-mode jj escape", () => {
  it("(a) jj within the timeout leaves insert mode with no jj in the buffer", () => {
    const { editor } = createInsertEscapeEditor();
    sendKeys(editor, ["a", "b", "j", "j"]);
    assert.equal(editor.getMode(), "normal");
    assert.equal(editor.getText(), "ab");
    // Same landing as Esc: cursor back one character onto the last typed char.
    assert.deepEqual(editor.getCursor(), { line: 0, col: 1 });
  });

  it("(b) j j spaced past the timeout both insert literally", () => {
    const { editor, advance } = createInsertEscapeEditor();
    sendKeys(editor, ["j"]);
    advance(DEFAULT_INSERT_ESCAPE_SETTINGS.timeoutMs + 100);
    sendKeys(editor, ["j"]);
    assert.equal(editor.getMode(), "insert");
    assert.equal(editor.getText(), "jj");
    assert.deepEqual(editor.getCursor(), { line: 0, col: 2 });
  });

  it("(c) a lone j always inserts normally", () => {
    const { editor } = createInsertEscapeEditor();
    sendKeys(editor, ["a", "j", "b"]);
    assert.equal(editor.getMode(), "insert");
    assert.equal(editor.getText(), "ajb");
  });

  it("(d) pasted jj in one bracketed-paste chunk stays literal", () => {
    const { editor } = createInsertEscapeEditor();
    sendKeys(editor, ["a", "\x1b[200~jj\x1b[201~"]);
    assert.equal(editor.getMode(), "insert");
    assert.equal(editor.getText(), "ajj");
  });

  it("(d) pasted jj split across chunks stays literal", () => {
    const { editor } = createInsertEscapeEditor();
    sendKeys(editor, ["\x1b[200~", "j", "j", "\x1b[201~"]);
    assert.equal(editor.getMode(), "insert");
    assert.equal(editor.getText(), "jj");
  });

  it("(e) disabling insertEscape passes every j through", () => {
    const { editor } = createInsertEscapeEditor();
    editor.setInsertEscapeSettings({
      ...DEFAULT_INSERT_ESCAPE_SETTINGS,
      enabled: false,
    });
    sendKeys(editor, ["a", "j", "j"]);
    assert.equal(editor.getMode(), "insert");
    assert.equal(editor.getText(), "ajj");
  });

  it("a custom timeoutMs applies to the escape window", () => {
    const { editor, advance } = createInsertEscapeEditor();
    editor.setInsertEscapeSettings({ enabled: true, timeoutMs: 50 });
    sendKeys(editor, ["j"]);
    advance(100);
    sendKeys(editor, ["j"]);
    assert.equal(editor.getMode(), "insert");
    assert.equal(editor.getText(), "jj");
  });

  it("a non-j keystroke cancels the pending sequence", () => {
    const { editor } = createInsertEscapeEditor();
    sendKeys(editor, ["j", "x"]);
    assert.equal(editor.getMode(), "insert");
    assert.equal(editor.getText(), "jx");
    // The cancelled arm does not linger: a later fast jj still escapes.
    sendKeys(editor, ["j", "j"]);
    assert.equal(editor.getMode(), "normal");
    assert.equal(editor.getText(), "jx");
  });

  it("Esc and kitty Ctrl+[ still leave insert mode", () => {
    const { editor } = createInsertEscapeEditor();
    sendKeys(editor, ["x", "\x1b"]);
    assert.equal(editor.getMode(), "normal");
    assert.equal(editor.getText(), "x");

    sendKeys(editor, ["a", "y", "\x1b[91;5u"]);
    assert.equal(editor.getMode(), "normal");
    assert.equal(editor.getText(), "xy");
  });

  it("jj from an explicit i session matches the Esc landing and undo unit", () => {
    const { editor } = createInsertEscapeEditor();
    sendKeys(editor, ["\x1b", "i", "x", "y", "j", "j"]);
    assert.equal(editor.getMode(), "normal");
    assert.equal(editor.getText(), "xy");
    sendKeys(editor, ["u"]);
    assert.equal(editor.getText(), "");
  });

  it("u after a jj escape reverts the whole insert session (no jj comes back)", () => {
    const { editor } = createInsertEscapeEditor();
    sendKeys(editor, ["a", "b", "j", "j"]);
    sendKeys(editor, ["u"]);
    assert.equal(editor.getText(), "");
    assert.equal(editor.getMode(), "normal");
    sendKeys(editor, ["\x12"]);
    assert.equal(editor.getText(), "ab");
  });

  it(". after a jj escape replays the insert text without the escape letters", () => {
    const { editor } = createInsertEscapeEditor();
    sendKeys(editor, ["a", "b", "j", "j"]);
    sendKeys(editor, ["."]);
    assert.equal(editor.getMode(), "normal");
    assert.equal(editor.getText(), "aabb");
    // The replay is its own undo unit, separate from the change it repeats.
    sendKeys(editor, ["u"]);
    assert.equal(editor.getText(), "ab");
  });

  it("the jj rollback leaves the unnamed register alone", () => {
    const { editor } = createInsertEscapeEditor();
    editor.setRegister("KEEP");
    sendKeys(editor, ["a", "b", "j", "j"]);
    assert.equal(editor.getText(), "ab");
    assert.equal(editor.getRegister(), "KEEP");
  });
});
