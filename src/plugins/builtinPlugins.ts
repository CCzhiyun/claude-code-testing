export interface BuiltinPlugin { name: string; description: string; enabledByDefault: boolean }
export const BUILTIN_PLUGINS: readonly BuiltinPlugin[] = Object.freeze([
  { name: 'foundation', description: 'Core engineering workflows and agent definitions.', enabledByDefault: true },
]);
export const findBuiltinPlugin = (name: string): BuiltinPlugin | undefined => BUILTIN_PLUGINS.find((plugin) => plugin.name === name);
