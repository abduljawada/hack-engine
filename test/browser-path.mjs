import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export function browserPath(browser) {
  const override = process.env[browser === "firefox" ? "FIREFOX_PATH" : "CHROME_PATH"];
  if (override) return override;
  const names = browser === "firefox" ? ["firefox"] : ["chromium", "chromium-browser", "google-chrome", "chrome"];
  const candidates = (process.env.PATH || "").split(delimiter)
    .flatMap((directory) => names.map((name) => join(directory, `${name}${process.platform === "win32" ? ".exe" : ""}`)));
  candidates.push(...(browser === "firefox" ? [
    "/Applications/Firefox.app/Contents/MacOS/firefox",
    join(process.env.PROGRAMFILES || "C:/Program Files", "Mozilla Firefox/firefox.exe"),
  ] : [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    join(process.env.PROGRAMFILES || "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
  ]));
  const found = candidates.find(existsSync);
  if (!found) throw new Error(`Install ${browser} or set ${browser === "firefox" ? "FIREFOX_PATH" : "CHROME_PATH"}.`);
  return found;
}
