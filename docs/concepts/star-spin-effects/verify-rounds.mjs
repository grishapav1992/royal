import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";

const preview = path.resolve(process.argv[2] ?? "artifacts/previews/star-spin-effects.html");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(preview).href);
  await page.locator("#views [data-view=new]").click();
  const scene = page.locator(".gn.nx");
  const field = name => scene.locator(`[data-gn="${name}"]`);
  const play = name => page.locator(`[data-scene="${name}"]`).click();

  // Dispatch in one task so slow test hardware cannot consume the simulated reply window.
  const requestState = await page.evaluate(() => {
    document.querySelector("[data-scene=o_large]").click();
    document.querySelector("#fast").click();
    document.querySelector("#reduce").click();
    return {
      phase: document.querySelector(".gn.nx").dataset.phase,
      payout: document.querySelector(".nx [data-gn=payout]").textContent,
      skipDisabled: document.querySelector("#finish").disabled,
    };
  });
  assert.deepEqual(requestState, {
    phase: "request", payout: "0,00", skipDisabled: true,
  });
  await expect(field("payout")).toHaveText("2,26");
  for (const [index, number] of [1, 5, 7, 8, 11, 12, 13, 16].entries()) {
    await expect(field("selected-line")).toHaveText(`Линия № ${number} · ${index + 1} из 8`);
    await expect(field("payline").locator("polyline")).toHaveCount(1);
    await field("next-line").press("Enter");
  }

  await play("bonusEnter");
  await expect(field("remaining")).toHaveText("8");
  for (let remaining = 7; remaining >= 0; remaining--) {
    await field("spin").click();
    await expect(field("remaining")).toHaveText(String(remaining));
    await expect(field("balance")).toHaveText(remaining ? "99,90" : "99,92");
    await expect(field("payout")).toHaveText("0,02");
  }
  await expect(field("net")).toHaveText("-0,08");
} finally {
  await browser.close();
}
