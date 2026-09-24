(async () => {
  window.hackEnginePracticeJS = { score: 100 };
  document.querySelector("#spend-js").addEventListener("click", () => { window.hackEnginePracticeJS.score -= 7; });
  setInterval(() => { document.querySelector("#score-js").textContent = window.hackEnginePracticeJS.score; }, 100);
  const bytes = new Uint8Array([0,97,115,109,1,0,0,0,5,3,1,0,1,7,10,1,6,109,101,109,111,114,121,2,0]);
  const { instance } = await WebAssembly.instantiate(bytes);
  const view = new DataView(instance.exports.memory.buffer);
  const address = 4096;
  view.setInt32(address, 100, true);
  document.querySelector("#spend").addEventListener("click", () => view.setInt32(address, view.getInt32(address, true) - 7, true));
  document.querySelector("#restart").addEventListener("click", () => location.reload());
  setInterval(() => { document.querySelector("#score").textContent = view.getInt32(address, true); }, 100);
  document.querySelector("#result").textContent = "Ready. Open Hack Engine to start.";
})().catch((error) => { document.querySelector("#result").textContent = error.message; });
