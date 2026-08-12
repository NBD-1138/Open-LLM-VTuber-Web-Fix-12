import { Key, keyboard } from '@nut-tree-fork/nut-js';
import type { ValidKeyIdentifier, ValidModifierKey } from '../../shared/automation/schema';
import { KeyboardInputAdapter } from './input-adapter';

const KEY_MAP: Record<ValidKeyIdentifier, Key> = {
  a: Key.A,
  b: Key.B,
  c: Key.C,
  d: Key.D,
  e: Key.E,
  f: Key.F,
  g: Key.G,
  h: Key.H,
  i: Key.I,
  j: Key.J,
  k: Key.K,
  l: Key.L,
  m: Key.M,
  n: Key.N,
  o: Key.O,
  p: Key.P,
  q: Key.Q,
  r: Key.R,
  s: Key.S,
  t: Key.T,
  u: Key.U,
  v: Key.V,
  w: Key.W,
  x: Key.X,
  y: Key.Y,
  z: Key.Z,
  0: Key.Num0,
  1: Key.Num1,
  2: Key.Num2,
  3: Key.Num3,
  4: Key.Num4,
  5: Key.Num5,
  6: Key.Num6,
  7: Key.Num7,
  8: Key.Num8,
  9: Key.Num9,
  f1: Key.F1,
  f2: Key.F2,
  f3: Key.F3,
  f4: Key.F4,
  f5: Key.F5,
  f6: Key.F6,
  f7: Key.F7,
  f8: Key.F8,
  f9: Key.F9,
  f10: Key.F10,
  f11: Key.F11,
  f12: Key.F12,
  tab: Key.Tab,
  enter: Key.Enter,
  escape: Key.Escape,
  space: Key.Space,
  backspace: Key.Backspace,
  delete: Key.Delete,
  arrow_up: Key.Up,
  arrow_down: Key.Down,
  arrow_left: Key.Left,
  arrow_right: Key.Right,
  home: Key.Home,
  end: Key.End,
  page_up: Key.PageUp,
  page_down: Key.PageDown,
  insert: Key.Insert,
  ctrl: Key.LeftControl,
  alt: Key.LeftAlt,
  shift: Key.LeftShift,
  meta: Key.LeftMeta,
};

const resolveKey = (key: ValidKeyIdentifier): Key => KEY_MAP[key];

export class NutJsKeyboardInputAdapter implements KeyboardInputAdapter {
  constructor() {
    keyboard.config.autoDelayMs = 25;
  }

  async keyTap(key: ValidKeyIdentifier): Promise<void> {
    await keyboard.pressKey(resolveKey(key));
    await keyboard.releaseKey(resolveKey(key));
  }

  async keyDown(key: ValidKeyIdentifier): Promise<void> {
    await keyboard.pressKey(resolveKey(key));
  }

  async keyUp(key: ValidKeyIdentifier): Promise<void> {
    await keyboard.releaseKey(resolveKey(key));
  }

  async keyCombination(modifiers: ValidModifierKey[], key: ValidKeyIdentifier): Promise<void> {
    const modifierKeys = modifiers.map((modifier) => resolveKey(modifier));
    for (const modifier of modifierKeys) {
      await keyboard.pressKey(modifier);
    }
    await keyboard.pressKey(resolveKey(key));
    await keyboard.releaseKey(resolveKey(key));
    for (const modifier of modifierKeys.reverse()) {
      await keyboard.releaseKey(modifier);
    }
  }

  async releaseAll(keys: Iterable<ValidKeyIdentifier>): Promise<void> {
    const uniqueKeys = Array.from(new Set(Array.from(keys)));
    for (const key of uniqueKeys.reverse()) {
      await keyboard.releaseKey(resolveKey(key));
    }
  }
}
