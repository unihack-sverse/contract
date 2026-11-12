const fs = require("node:fs");
const path = require("node:path");
const { Wallet } = require("ethers");

const envPath = path.join(__dirname, "..", ".env");

if (fs.existsSync(envPath)) {
  throw new Error(`Refusing to overwrite existing file: ${envPath}`);
}

const wallet = Wallet.createRandom();
const contents = [
  "FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc",
  `DEPLOYER_PRIVATE_KEY=${wallet.privateKey}`,
  `ADMIN_ADDRESS=${wallet.address}`,
  `TREASURY_ADDRESS=${wallet.address}`,
  "PROTOCOL_FEE_BPS=250",
  "",
].join("\n");

fs.writeFileSync(envPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
console.log(`Fuji wallet created: ${wallet.address}`);
console.log("Private key saved only in .env (mode 0600). Do not commit or share it.");
