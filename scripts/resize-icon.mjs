import sharp from "sharp";
await sharp("public/brand/gituas-icon.png")
  .resize(1024, 1024, { fit: "cover" })
  .png()
  .toFile("public/brand/gituas-icon-1024.png");
const meta = await sharp("public/brand/gituas-icon-1024.png").metadata();
console.log("created gituas-icon-1024.png", meta.width + "x" + meta.height);
