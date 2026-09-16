import fs from "node:fs";

const path = new URL("./src/App.jsx", import.meta.url);
const source = fs.readFileSync(path, "utf8");

const broken = 'onChange={(e) => e.target.files[0] && onAttachReceipt(e.target.files[0])}';
const fixed = 'onChange={(e) => e.target.files[0] && onAttachReceipt(order, e.target.files[0])}';

if (source.includes(fixed)) {
  console.log("Receipt upload fix already present.");
  process.exit(0);
}

if (!source.includes(broken)) {
  throw new Error("Receipt upload target was not found; build stopped to avoid changing unrelated code.");
}

fs.writeFileSync(path, source.replace(broken, fixed), "utf8");
console.log("Receipt upload argument fix applied.");
