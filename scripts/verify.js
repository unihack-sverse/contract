const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

async function verify(address, constructorArguments) {
  try {
    await hre.run("verify:verify", { address, constructorArguments });
  } catch (error) {
    const message = String(error.message || error);
    if (/already verified/i.test(message)) {
      console.log(`${address} is already verified`);
      return;
    }
    throw error;
  }
}

async function main() {
  const manifestPath = path.join(
    __dirname,
    "..",
    "deployments",
    `${hre.network.name}.json`,
  );
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing deployment manifest: ${manifestPath}`);
  }

  const deployment = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const contracts = deployment.contracts;
  const deployer = deployment.deployer;

  await verify(contracts.MockSRV, [deployer]);
  await verify(contracts.SverseItems, [deployer]);
  await verify(contracts.SverseDeedRegistry, [deployer]);
  await verify(contracts.SverseStore, [
    deployer,
    contracts.MockSRV,
    contracts.SverseItems,
    deployment.treasury,
    deployment.protocolFeeBps,
  ]);
  await verify(contracts.SverseMarketplace, [
    deployer,
    contracts.MockSRV,
    contracts.SverseItems,
    deployment.treasury,
    deployment.protocolFeeBps,
  ]);
  await verify(contracts.SverseRewards, [
    deployer,
    contracts.MockSRV,
    deployment.treasury,
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
