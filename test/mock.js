// (module (memory (export "memory") 1))
const moduleBytes = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x05, 0x03, 0x01, 0x00, 0x01,
  0x07, 0x0a, 0x01, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
]);

WebAssembly.instantiate(moduleBytes).then(({ instance }) => {
  const offset = 4096;
  new DataView(instance.exports.memory.buffer).setFloat64(offset, 12345.5, true);
  window.mockWasmInstance = instance;
  document.querySelector("#result").textContent =
    `Ready. Float64 12345.5 is stored at 0x${offset.toString(16)}.`;
});
