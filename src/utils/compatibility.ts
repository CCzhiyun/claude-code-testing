export type UtilityCompatibilityFamily = 'async' | 'collections' | 'text' | 'filesystem' | 'process' | 'shell' | 'git' | 'network' | 'security' | 'settings' | 'plugins' | 'model' | 'permissions' | 'hooks' | 'sessions' | 'agents' | 'tools' | 'telemetry' | 'media' | 'terminal' | 'integration' | 'core';
const rules: ReadonlyArray<[UtilityCompatibilityFamily, RegExp]> = [
  ['permissions', /permission|denial|classifier|yolo|autoMode/i], ['plugins', /plugin|marketplace|mcpb|dxt/i], ['settings', /setting|config|managedEnv|mdm/i], ['model', /model|token|thinking|effort|fastMode|beta/i],
  ['shell', /bash|shell|powershell|exec|command|ripgrep|which|binary/i], ['git', /git|worktree|commit|repository|diff|prStatus/i], ['network', /http|proxy|mtls|aws|apiPreconnect|webSocket/i],
  ['security', /auth|crypto|secure|fingerprint|sanit|privacy|ssrf|caCert/i], ['hooks', /hook/i], ['sessions', /session|conversation|transcript|teleport|resume/i], ['agents', /agent|swarm|team|teammate|mailbox|background/i],
  ['tools', /tool|task|queue|cron|planMode|processUserInput/i], ['telemetry', /telemetry|profil|trace|stats|activity|fps|heatmap|log/i], ['media', /image|pdf|screenshot|ansiTo|asciicast|clipboard/i],
  ['terminal', /terminal|ink|theme|render|fullscreen|cursor|highlight|keyboard|editor|paste/i], ['filesystem', /file|path|cwd|directory|glob|temp|xdg|lock/i], ['process', /process|signal|abort|timeout|sleep|subprocess|cleanup|installer/i],
  ['text', /markdown|frontmatter|xml|yaml|json|string|word|truncate|semantic|format|content|message/i], ['collections', /array|set|group|memoize|cache|circular|tree/i], ['async', /sequential|stream|deferred|resolver|buffered|concurrent|slowOperation/i], ['integration', /ide|chrome|computerUse|deepLink|desktop|browser|jetbrains|tmux/i],
];
export function classifyUtilityReference(path: string): UtilityCompatibilityFamily { for (const [family, pattern] of rules) if (pattern.test(path)) return family; return 'core'; }
