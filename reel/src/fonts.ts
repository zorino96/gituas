import { continueRender, delayRender, staticFile } from "remotion";

export const FONT = "Vazirmatn";

// Loaded before the first frame renders.
const fontsReady = delayRender("fonts");
Promise.all(
  [
    new FontFace(FONT, `url(${staticFile("fonts/Vazirmatn-Regular.ttf")})`, { weight: "400" }),
    new FontFace(FONT, `url(${staticFile("fonts/Vazirmatn-Bold.ttf")})`, { weight: "700" }),
  ].map((f) => f.load()),
).then((faces) => {
  faces.forEach((f) => document.fonts.add(f));
  continueRender(fontsReady);
});
