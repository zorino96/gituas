import { readFileSync, writeFileSync } from "node:fs";
import { PDFParse } from "pdf-parse";

const pdf = "C:\\Users\\Zorin\\Downloads\\Gituas.pdf";
const parser = new PDFParse({ data: readFileSync(pdf) });
const result = await parser.getText();

console.log("PAGES:", result.total);
console.log("=====");
writeFileSync("C:\\Users\\Zorin\\Desktop\\gituas\\scripts\\gituas-pdf.txt", result.text);
console.log("Wrote text to scripts/gituas-pdf.txt");
console.log("Total chars:", result.text.length);
console.log("First 1000 chars:");
console.log(result.text.slice(0, 1000));
