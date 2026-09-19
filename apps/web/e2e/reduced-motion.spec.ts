import { expect, test } from "@playwright/test";

test("disables decorative motion when reduced motion is requested", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const motion = await page.evaluate(() => {
    const seconds = (value: string): number =>
      value.endsWith("ms") ? Number.parseFloat(value) / 1_000 : Number.parseFloat(value);

    const spinner = document.createElement("span");
    spinner.className = "spinner";
    document.body.append(spinner);

    const spinnerStyle = window.getComputedStyle(spinner);
    const chevron = document.querySelector<HTMLElement>(".section-chevron");
    if (!chevron) throw new Error("Sidebar chevron is missing");
    const chevronStyle = window.getComputedStyle(chevron);

    const result = {
      reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      animationDuration: seconds(spinnerStyle.animationDuration),
      animationIterations: spinnerStyle.animationIterationCount,
      transitionDuration: seconds(chevronStyle.transitionDuration),
      transitionDelay: seconds(chevronStyle.transitionDelay)
    };
    spinner.remove();
    return result;
  });

  expect(motion.reduced).toBe(true);
  expect(motion.animationDuration).toBeLessThanOrEqual(0.00001);
  expect(motion.animationIterations).toBe("1");
  expect(motion.transitionDuration).toBeLessThanOrEqual(0.00001);
  expect(motion.transitionDelay).toBe(0);
});
