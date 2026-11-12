const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

const { ethers, network } = hre;

function envAddress(name, fallback) {
  const value = process.env[name] || fallback;
  if (!ethers.isAddress(value)) {
    throw new Error(`${name} must be a valid EVM address`);
  }
  return ethers.getAddress(value);
}

async function deployContract(name, args) {
  const factory = await ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  console.log(`${name}: ${await contract.getAddress()}`);
  return contract;
}

async function waitFor(txPromise) {
  const tx = await txPromise;
  return tx.wait();
}

async function handoffRoles(contract, roleNames, deployerAddress, adminAddress) {
  if (deployerAddress === adminAddress) return;

  const roles = [await contract.DEFAULT_ADMIN_ROLE()];
  for (const roleName of roleNames) roles.push(await contract[roleName]());

  for (const role of roles) await waitFor(contract.grantRole(role, adminAddress));
  for (const role of roles.slice().reverse()) {
    await waitFor(contract.renounceRole(role, deployerAddress));
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer signer. Set DEPLOYER_PRIVATE_KEY.");

  const deployerAddress = await deployer.getAddress();
  const adminAddress = envAddress("ADMIN_ADDRESS", deployerAddress);
  const treasuryAddress = envAddress("TREASURY_ADDRESS", adminAddress);
  const protocolFeeBps = Number(process.env.PROTOCOL_FEE_BPS || "250");

  if (!Number.isInteger(protocolFeeBps) || protocolFeeBps < 0 || protocolFeeBps > 1_000) {
    throw new Error("PROTOCOL_FEE_BPS must be an integer between 0 and 1000");
  }

  console.log(`Network: ${network.name} (${network.config.chainId})`);
  console.log(`Deployer: ${deployerAddress}`);
  console.log(`Admin: ${adminAddress}`);
  console.log(`Treasury: ${treasuryAddress}`);

  const mockSRV = await deployContract("MockSRV", [deployerAddress]);
  const items = await deployContract("SverseItems", [deployerAddress]);
  const deeds = await deployContract("SverseDeedRegistry", [deployerAddress]);
  const store = await deployContract("SverseStore", [
    deployerAddress,
    await mockSRV.getAddress(),
    await items.getAddress(),
    treasuryAddress,
    protocolFeeBps,
  ]);
  const marketplace = await deployContract("SverseMarketplace", [
    deployerAddress,
    await mockSRV.getAddress(),
    await items.getAddress(),
    treasuryAddress,
    protocolFeeBps,
  ]);
  const rewards = await deployContract("SverseRewards", [
    deployerAddress,
    await mockSRV.getAddress(),
    treasuryAddress,
  ]);

  await waitFor(items.grantRole(await items.MINTER_ROLE(), await store.getAddress()));
  await waitFor(deeds.setTrustedCollection(await items.getAddress(), true));

  await handoffRoles(
    mockSRV,
    ["MINTER_ROLE", "PAUSER_ROLE"],
    deployerAddress,
    adminAddress,
  );
  await handoffRoles(
    items,
    ["PLATFORM_ROLE", "MINTER_ROLE", "PAUSER_ROLE"],
    deployerAddress,
    adminAddress,
  );
  await handoffRoles(
    deeds,
    ["CONFIG_ROLE", "WITNESS_ROLE", "PAUSER_ROLE"],
    deployerAddress,
    adminAddress,
  );
  await handoffRoles(
    store,
    ["CATALOG_ROLE", "PAUSER_ROLE"],
    deployerAddress,
    adminAddress,
  );
  await handoffRoles(
    marketplace,
    ["PAUSER_ROLE"],
    deployerAddress,
    adminAddress,
  );
  await handoffRoles(
    rewards,
    ["PUBLISHER_ROLE", "PAUSER_ROLE"],
    deployerAddress,
    adminAddress,
  );

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const deployment = {
    network: network.name,
    chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployerAddress,
    admin: adminAddress,
    treasury: treasuryAddress,
    protocolFeeBps,
    contracts: {
      MockSRV: await mockSRV.getAddress(),
      SverseItems: await items.getAddress(),
      SverseDeedRegistry: await deeds.getAddress(),
      SverseStore: await store.getAddress(),
      SverseMarketplace: await marketplace.getAddress(),
      SverseRewards: await rewards.getAddress(),
    },
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(
    path.join(deploymentsDir, `${network.name}.json`),
    `${JSON.stringify(deployment, null, 2)}\n`,
  );
  console.log(`Deployment manifest: deployments/${network.name}.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
