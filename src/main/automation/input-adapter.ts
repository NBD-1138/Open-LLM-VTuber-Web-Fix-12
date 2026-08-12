import type { ValidKeyIdentifier, ValidModifierKey } from '../../shared/automation/schema';

export interface KeyboardInputAdapter {
  keyTap(key: ValidKeyIdentifier): Promise<void>;
  keyDown(key: ValidKeyIdentifier): Promise<void>;
  keyUp(key: ValidKeyIdentifier): Promise<void>;
  keyCombination(modifiers: ValidModifierKey[], key: ValidKeyIdentifier): Promise<void>;
  releaseAll(keys: Iterable<ValidKeyIdentifier>): Promise<void>;
}
