const AVM_CHANNEL = "ruffle-memory-inspector:v1";
const avmResult = document.querySelector("#result");
const mockPlayer = document.querySelector("#mock-player");
let metadata = { isActionScript3: true };
let currentScenario = "avm2";
let currentInstance;

mockPlayer.ruffle = () => ({ get metadata() { return metadata; } });

function avmCommand(payload) {
  window.postMessage({ channel: AVM_CHANNEL, direction: "to-page", payload }, "*");
}

function failAvm(message) {
  avmResult.textContent = `FAIL: ${message}`;
}

async function createMemory(valueWriter) {
  const player = document.createElement("ruffle-player");
  const playerMetadata = { isActionScript3: currentScenario === "avm2" };
  player.ruffle = () => ({ metadata: playerMetadata });
  if (currentScenario !== "unknown") document.body.append(player);
  const name = [...new TextEncoder().encode("__wbg_setMetadata_fixture")];
  const imports = [1, 3, ...new TextEncoder().encode("wbg"), name.length, ...name, 0, 0];
  // The real wasm-bindgen metadata import dispatches a synchronous, non-bubbling
  // event on its player. Other players deliberately remain in the same frame.
  const module = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
    0x02, imports.length, ...imports,
    0x05, 0x03, 0x01, 0x00, 0x01,
    0x07, 0x0a, 0x01, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
    0x08, 0x01, 0x00,
  ]);
  const response = new Response(module, { headers: { "Content-Type": "application/wasm" } });
  Object.defineProperty(response, "url", { value: currentScenario === "unknown" ? "fixture.wasm" : "ruffle-fixture.wasm" });
  const { instance } = await WebAssembly.instantiateStreaming(response, {
    wbg: { __wbg_setMetadata_fixture() {
      if (currentScenario !== "unknown") player.dispatchEvent(new CustomEvent("loadedmetadata"));
    } },
  });
  currentInstance = instance;
  valueWriter(new DataView(instance.exports.memory.buffer));
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (
    event.source !== window ||
    message?.channel !== AVM_CHANNEL ||
    message?.direction !== "from-page"
  ) {
    return;
  }
  const payload = message.payload;
  if (payload?.kind === "instanceCaptured") {
    const expectedKind = currentScenario === "unknown" ? "unknown" : currentScenario;
    if (payload.instance.avmKind !== expectedKind) {
      failAvm(`reported ${payload.instance.avmKind} for ${currentScenario}.`);
      return;
    }
    const values = currentScenario === "avm2"
      ? { rawValue: "43210", expectedTypes: ["i32", "u32", "f64"] }
      : currentScenario === "avm1"
        ? { rawValue: "12345.5", expectedTypes: ["f64"] }
        : { rawValue: "1234", expectedTypes: ["i32", "u32", "f32", "f64"] };
    avmCommand({
      kind: "memoryScan",
      requestId: `smart-${currentScenario}`,
      instanceId: payload.instance.id,
      type: "smart",
      rawValue: values.rawValue,
      multiplier: 1,
      condition: "exact",
      alignment: "aligned",
      refine: false,
    });
  } else if (payload?.kind === "scanResults" && payload.requestId === `smart-${currentScenario}`) {
    const expectedTypes = currentScenario === "avm2"
      ? ["i32", "u32", "f64"]
      : currentScenario === "avm1"
        ? ["f64"]
        : ["i32", "u32", "f32", "f64"];
    if (JSON.stringify(payload.searchedTypes) !== JSON.stringify(expectedTypes)) {
      failAvm(`${currentScenario} searched ${JSON.stringify(payload.searchedTypes)}.`);
      return;
    }
    const expectedAddress = currentScenario === "avm2" ? 4096 : currentScenario === "avm1" ? 8192 : 12288;
    if (!payload.preview.some((candidate) => candidate.address === expectedAddress)) {
      failAvm(`${currentScenario} missed its expected candidate.`);
      return;
    }
    if (currentScenario === "avm2") {
      currentScenario = "avm1";
      metadata = { isActionScript3: false };
      createMemory((view) => view.setFloat64(8192, 12345.5, true));
    } else if (currentScenario === "avm1") {
      currentScenario = "unknown";
      mockPlayer.remove();
      createMemory((view) => view.setInt32(12288, 1234, true));
    } else {
      avmCommand({ kind: "memoryScan", requestId: "wasm-decimal", instanceId: payload.instanceId, type: "smart", rawValue: "12.5", condition: "exact", multiplier: 1, alignment: "aligned", refine: false });
    }
  } else if (payload?.kind === "scanResults" && payload.requestId === "wasm-decimal") {
    if (JSON.stringify(payload.searchedTypes) !== JSON.stringify(["f32", "f64"])) return failAvm("WebAssembly decimals must target float formats.");
    avmCommand({ kind: "memoryScan", requestId: "wasm-all", instanceId: payload.instanceId, type: "auto", rawValue: "1234", condition: "exact", multiplier: 1, alignment: "aligned", refine: false });
  } else if (payload?.kind === "scanResults" && payload.requestId === "wasm-all") {
    if (payload.searchedTypes.length !== 8 || !payload.preview.some((candidate) => candidate.type === "i16" && candidate.address === 12288)) return failAvm("All formats must retain smaller integer fallback.");
    avmResult.textContent = "PASS: AVM and WebAssembly targeted defaults, decimal formats and all-format fallback.";
  } else if (payload?.kind === "error") {
    failAvm(payload.message);
  }
});

createMemory((view) => view.setInt32(4096, 43210, true));
