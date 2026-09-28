// Revisions and primary hashes are established in COMPATIBILITY.md.
export const BROWSERS = ["firefox", "chrome"];
export const GAME_CATALOG = [
  { id: "J1", name: "HTML5-Asteroids", siteUrl: "http://www.dougmcinnes.com/html-5-asteroids/", runtime: "javascript", targets: ["Score"], required: true, repository: "dmcinnes/HTML5-Asteroids", revision: "930301cbda83ed3b120f64b801d937d077ee2da0", entry: "index.html", expectedHashes: { "game.js": "e43597fb5325f1b043429b978bc2828b15ae2427d4e1176f24d54fc4395a370f" } },
  { id: "W1", name: "Breakout.Rust.Web", siteUrl: "https://lostsidedead.biz/breakout/", runtime: "wasm", targets: ["Lives"], required: true, repository: "lostjared/Breakout.Rust.Web", revision: "1ed2d5317eb868060af0886275c076f1465ca933", entry: "index.html", expectedHashes: { "web/breakout_bg.wasm": "ca232eeb089117428539905a17f47b8235c6414373ec24d922181f07b1b81680" } },
  { id: "F1", downloadArtifact: { url: "https://uploads.ungrounded.net/526000/526470_beastgame_ng.swf?1381183836", sha256: "3515b99bba4a0563d5b2849f8242b8550901054cc49de861fd2be39f943dce9b" }, name: "Chibi Knight", runtime: "ruffle", expectedAvm: "AVM1", targets: ["Health", "Experience"], siteUrl: "https://www.newgrounds.com/portal/view/526470", source: "https://www.newgrounds.com/portal/view/526470" },
  { id: "F2", required: true, downloadArtifact: { url: "https://uploads.ungrounded.net/438000/438241_xenotactic2.swf?1210081268", sha256: "aadbc86d0457f1e095cb5aa63ae0e951ff03f077cd8b3cdfe74fffc1347a6d61" }, name: "Xeno Tactic 2", runtime: "ruffle", expectedAvm: "AVM1", targets: ["Money", "Lives"], siteUrl: "https://www.newgrounds.com/portal/view/438241", source: "https://www.newgrounds.com/portal/view/438241" },
  { id: "F3", downloadArtifact: { url: "https://uploads.ungrounded.net/507000/507205_CubeColossusRelease.swf?1250266426", sha256: "9aaeeb8d2fc20bd2d2db5e0a8c6bd1b953147936f3f18a451cc204436b52065d" }, name: "Cube Colossus", runtime: "ruffle", expectedAvm: "AVM1", targets: ["Heat", "Upgrade currency"], siteUrl: "https://www.newgrounds.com/portal/view/507205", source: "https://www.newgrounds.com/portal/view/507205" },
  { id: "F4", required: true, downloadArtifact: { url: "https://uploads.ungrounded.net/463000/463445_bloonstd3.swf?1223339004", sha256: "e2153bc68d0742fe83f7757fe67ab51a80cb3f69ab7d2a8cb28a97cd72b257cb" }, name: "Bloons Tower Defense 3", runtime: "ruffle", expectedAvm: "AVM2", targets: ["Cash", "Lives"], siteUrl: "https://www.newgrounds.com/portal/view/463445", source: "https://www.newgrounds.com/portal/view/463445" },
  { id: "F5", name: "Diggy", runtime: "ruffle", expectedAvm: "AVM2", targets: ["Energy", "Money"], siteUrl: "https://www.kongregate.com/en/games/vogd/diggy", source: "https://www.kongregate.com/en/games/vogd/diggy" },
  { id: "F6", name: "Canabalt", runtime: "ruffle", expectedAvm: "AVM2", targets: ["Distance"], siteUrl: "https://www.newgrounds.com/portal/view/510303", source: "https://www.newgrounds.com/portal/view/510303" },
  { id: "F7", name: "Interactive Buddy v1.01", runtime: "ruffle", expectedAvm: "AVM1", targets: ["Money"], viewport: {width:550,height:400}, siteUrl: "https://www.newgrounds.com/portal/view/218014", source: "https://www.newgrounds.com/portal/view/218014", downloadArtifact: {url:"https://uploads.ungrounded.net/218000/218014_DAbuddy_latest.swf",sha256:"76da8a05bfe3472afe4a2bca2c09486b5be614881d45621489fa2f2686d16b0f"} },
];
export const ADDITIONAL_TARGETS = { F1: ["experience"], F2: ["lives"], F3: ["currency"], F4: ["lives"], F5: ["money"] };
export const TARGET_SCENARIOS = ["discovery", "refine", "undo-scan", "watch", "write", "undo", "guarded-undo", "freeze", "stop"];
export const REQUIRED_SCENARIOS = ["baseline", "discovery", "refine", "watch", "write", "undo", "freeze", "stop", "reload", "reopen", "tab-binding"];

export const RUFFLE_BUILD = { version: "0.6.0", source: "https://registry.npmjs.org/@ruffle-rs/ruffle/-/ruffle-0.6.0.tgz", integrity: "sha512-P2X1zDENBoiLt2ZjPcsUzaDxoR7fVF2e1U/bi7hbIAQEjkykxljSoG8AgbywHvlVVzL9Y5tIZMRqDwIm31jgPA==", expectedHashes: {
  "LICENSE_APACHE": "62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a",
  "LICENSE_MIT": "4de9338a7879c68e911742a7d691f0797ff1ef8d8a6fb978b0c711e258fe959c",
  "core.ruffle.c80159b526e567babaf5.js": "624b0b23bc4460d73e789e608fd1274546a5a411f71f7e873414aca94bc5bc4f",
  "core.ruffle.f000070ea72f8ae4fe3a.js": "08ce4ff032b61d2014ba52bdc6f5d8f6adb0aacdc1e6e3fd5e68281c958bd90d",
  "ruffle.js": "a686a305345b06542dddedada71869104916a61e393f174687571528ac4225f5",
  "package.json": "acd3bbc02b675d971d5b0218572cdb57727079f8b4bd1a7e5eb9ec433e53aa49",
  "core.ruffle.c80159b526e567babaf5.js.map": "61a9d62a7cb726c18ddf19528da37ef6952e508e37ae859b9a4bcc02ffd1dea6",
  "core.ruffle.f000070ea72f8ae4fe3a.js.map": "92d87318e15784a740448b32edb7fbca6c2824c8b8eecaf927283a01f811a699",
  "ruffle.js.map": "031fe55d7f17dde1f9628110c6c78d2ad487e2dec1d3fdb42ec0a5d74cdf3d86",
  "README.md": "cdbeefd04e27a2fe80f735210fa4c054e376802eb43a16d9b6eeae78500f2bde",
  "72a20ef1c0b8ceb37720.wasm": "adabc1696a2f1f95715ede6be0ac00a73364895c8e599039e60fef3b2f52efa4",
  "826bb0938097485a2c9d.wasm": "e4ba64aa1dc9f7f2368602dd0fc2c51046f3e35baba8116d6cf3ae930a63aa02"
} };

// Release coverage: JavaScript, WebAssembly, AVM1, and AVM2.
export const RELEASE_GAME_IDS = Object.freeze(["J1", "W1", "F2", "F4"]);
