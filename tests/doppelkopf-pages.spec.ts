import { test, expect } from "@playwright/test";

test("doppelkopf hub links to dedicated mode routes", async ({ page }) => {
  await page.goto("/doppelkopf/");

  for (const href of [
    "/doppelkopf/oblivious/",
    "/doppelkopf/classic/",
    "/doppelkopf/tournament/",
  ]) {
    expect(await page.locator(`a[href="${href}"]`).count()).toBeGreaterThan(0);
  }

  await expect(page.locator(".classic-mode")).not.toBeVisible();
  await expect(page.locator(".oblivious-mode")).not.toBeVisible();
});

test("doppelkopf settings expose current Schweine options", async ({
  page,
}) => {
  await page.goto("/doppelkopf/");
  await expect(page.locator('#schweineRule option[value="off"]')).toHaveCount(
    1,
  );
  await expect(
    page.locator('#schweineRule option[value="no_solo"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('#schweineRule option[value="everywhere"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('#schweineRule option[value="announce_while_playing"]'),
  ).toHaveCount(0);
});

test("fresh-clone settings expose only shipped heuristic bots", async ({
  page,
}) => {
  await page.goto("/doppelkopf/");

  await expect(page.locator("#botType")).toHaveValue("heuristic-v2");
  await expect(page.locator("#botType option")).toHaveCount(2);
  await expect(page.locator('#botType option[value^="ml-"]')).toHaveCount(0);
  await expect(page.locator('#botType option[value="random-mix"]')).toHaveCount(
    0,
  );
});

test("legacy ML preference migrates to the shipped heuristic", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("dkhub_prefs", JSON.stringify({ botType: "ml-v2" }));
  });
  await page.goto("/doppelkopf/");

  await expect(page.locator("#botType")).toHaveValue("heuristic-v2");
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("dkhub_prefs") ?? "null"),
      ),
    )
    .toMatchObject({ botType: "heuristic-v2" });
});

test("classic mode renders on its own route", async ({ page }) => {
  await page.goto("/doppelkopf/classic/");
  await expect(page.locator(".classic-mode")).toHaveCount(1);
  await expect(page.locator(".dkhub")).toHaveCount(0);
});

test("oblivious mode renders on its own route", async ({ page }) => {
  await page.goto("/doppelkopf/oblivious/");
  await expect(page.locator(".oblivious-mode")).toHaveCount(1);
  await expect(page.locator(".dkhub")).toHaveCount(0);
});

test("tournament mode renders on its own route", async ({ page }) => {
  await page.goto("/doppelkopf/tournament/");
  await expect(page.locator(".tournament-mode")).toHaveCount(1);
  await expect(page.locator(".dkhub")).toHaveCount(0);
});
