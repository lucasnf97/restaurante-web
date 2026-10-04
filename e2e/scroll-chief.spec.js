// Barras de desplazamiento con el logo de Chief Point (js/scroll-chief.js).
// Pagina publica, sin API: no toca datos.
const { test, expect } = require("@playwright/test");

const SALIDA = process.env.SCROLL_CHIEF_SALIDA || "test-results";

async function anillos(page, sel) {
  return page.$eval(sel, (b) => {
    const pos = (n) => { const r = n.getBoundingClientRect(); return r.top + r.height / 2; };
    return { c: pos(b.querySelector(".cp-a.c")), r2: pos(b.querySelector(".cp-a.r2")), r4: pos(b.querySelector(".cp-a.r4")) };
  });
}

test("la barra de la ventana reemplaza a la nativa y los anillos llegan despues del centro", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.goto("/terminos.html");
  await page.waitForSelector("#cp-capa .cp-b.doc");

  // La nativa no ocupa lugar: el ancho del documento es el de la ventana.
  const anchoNativa = await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth);
  expect(anchoNativa).toBe(0);
  await page.screenshot({ path: `${SALIDA}/scroll-reposo.png` });

  // Salto grande: el centro llega YA, los anillos todavia no.
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight * 0.6, behavior: "instant" }));
  await page.waitForTimeout(40);
  const enVuelo = await anillos(page, ".cp-b.doc");
  await page.screenshot({ path: `${SALIDA}/scroll-resorte.png` });
  expect(Math.abs(enVuelo.r4 - enVuelo.c)).toBeGreaterThan(10);

  await page.waitForTimeout(1200);
  const quieto = await anillos(page, ".cp-b.doc");
  expect(Math.abs(quieto.r4 - quieto.c)).toBeLessThan(1);
  expect(Math.abs(quieto.r2 - quieto.c)).toBeLessThan(1);

  // Arrastrar el logo hacia arriba desplaza la pagina.
  const antes = await page.evaluate(() => window.scrollY);
  const x = 1100 - 7;
  await page.mouse.move(x, quieto.c);
  await page.mouse.down();
  await page.mouse.move(x, quieto.c - 200, { steps: 8 });
  await page.mouse.up();
  const despues = await page.evaluate(() => window.scrollY);
  expect(despues).toBeLessThan(antes - 100);
});

test("un panel con desplazamiento propio recibe barra vertical y horizontal al pasar el mouse", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.goto("/terminos.html");
  await page.evaluate(() => {
    const p = document.createElement("div");
    p.id = "panel";
    p.style.cssText = "position:fixed;left:40px;top:40px;width:360px;height:220px;overflow:auto;background:#fff;border:1px solid #ccc;z-index:5";
    p.innerHTML = Array.from({ length: 40 }, (_, i) =>
      `<div style="white-space:nowrap;padding:4px 8px">Mesa ${i + 1} · 2× Galette complète, 1× Crêpe Suzette, 1× Cidre brut, 1× Café crème</div>`).join("");
    document.body.appendChild(p);
  });
  await page.mouse.move(200, 150);
  await page.waitForTimeout(400);
  const n = await page.$$eval("#cp-capa .cp-b.vis:not(.doc)", (bs) => bs.length);
  expect(n).toBe(2);
  await page.screenshot({ path: `${SALIDA}/scroll-panel.png`, clip: { x: 20, y: 20, width: 420, height: 270 } });

  // La rueda dentro del panel lo desplaza y la barra lo sigue.
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(600);
  expect(await page.$eval("#panel", (p) => p.scrollTop)).toBeGreaterThan(200);
});
