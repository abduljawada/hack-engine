const migrationState = {
  watches: [], selectedKey: null, frozenKeys: [], diagnostics: {},
  failReads: false, holdReads: false, heldReads: [],
  stalledCallbacks: [],
};
const migrationNativeTimeout = window.setTimeout;
window.setTimeout = (callback, ms, ...args) => {
  if (ms === 15000) {
    migrationState.stalledCallbacks.push(() => callback(...args));
    return migrationNativeTimeout(() => {}, 30000);
  }
  return migrationNativeTimeout(callback, ms, ...args);
};
const migrationKey = (watch) => `${watch.frameId}:${watch.instanceId}:${watch.type}:${watch.address}`;
const publishMigrationWorkspace = () => popupHarnessState.emitMessage({ kind: "workspaceState", workspace: {
  watches: migrationState.watches, selectedKey: migrationState.selectedKey,
  frozenKeys: migrationState.frozenKeys, diagnostics: migrationState.diagnostics,
} });
popupHarnessState.interceptCommand = (message, emitPage, onMessage) => {
  const payload = message.payload || {};
  if (message.kind === "workspaceCommand") {
    let accepted = 0, skipped = 0;
    const incoming = message.action === "upsertWatch" ? [message.watch] : message.action === "mergeWatches" ? message.watches : [];
    for (const watch of incoming || []) {
      const key = migrationKey(watch);
      const index = migrationState.watches.findIndex((entry) => migrationKey(entry) === key);
      if (index < 0 && migrationState.watches.length >= 256) { skipped++; continue; }
      if (index >= 0) migrationState.watches[index] = { ...watch, key };
      else migrationState.watches.push({ ...watch, key });
      if (message.select) migrationState.selectedKey = key;
      accepted++;
    }
    if (message.action === "select") migrationState.selectedKey = message.key;
    queueMicrotask(() => {
      publishMigrationWorkspace();
      onMessage.emit({ kind: "workspaceCommandResult", requestId: message.requestId, accepted, skipped });
    });
    return true;
  }
  if (payload.kind === "readValues") {
    const respond = () => emitPage({ kind: "watchValues", requestId: payload.requestId,
      instanceId: payload.instanceId, values: payload.entries.map((entry) => ({ ...entry,
        ...(migrationState.failReads ? { error: "Memory unavailable" } : { value: 36 }),
      })),
    });
    if (migrationState.holdReads) migrationState.heldReads.push(respond);
    else queueMicrotask(respond);
    return true;
  }
  return false;
};
