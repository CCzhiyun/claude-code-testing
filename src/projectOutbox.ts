/** Recover metadata delivery only. Never retries a business operation, executes
 * a tool or replays an approval. Each producer retains its own snapshot lock. */
export async function recoverProjectOutboxes(cwd: string) {
  const plans = await import('./plans.js'), notifications = await import('./notifications.js');
  const result = [];
  for (const [producer, recover] of [['plans', plans.recoverPlanOutbox], ['notifications', notifications.recoverNotificationOutbox]] as const) {
    try { result.push({ producer, ok: true, ...await recover(cwd) }); }
    catch { result.push({ producer, ok: false, error: 'State/delivery validation failed; inspect local snapshot and event journal. No business operation was replayed.' }); }
  }
  try { const runtime = await (await import('./runtimeOutbox.js')).recoverRuntimeOutboxes(cwd); result.push({ producer: 'runtime', ok: runtime.failed === 0, ...runtime }); }
  catch { result.push({ producer: 'runtime', ok: false, error: 'Runtime recovery bounds/path validation failed; no business operation was replayed.' }); }
  return result;
}
