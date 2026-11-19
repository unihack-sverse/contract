const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

const { ethers, network } = hre;

const ALL_CONTRACTS = [
  "MockSRV",
  "SverseItems",
  "SverseDeedRegistry",
  "SverseStore",
  "SverseMarketplace",
  "SverseRewards",
];

function resolveManifestPath() {
  if (process.env.DEPLOYMENT_FILE) {
    return path.resolve(process.env.DEPLOYMENT_FILE);
  }
  return path.join(__dirname, "..", "deployments", `${network.name}.json`);
}

function getRelayerAddress() {
  const raw = process.env.RELAYER_ADDRESS;
  if (!raw || !ethers.isAddress(raw)) {
    throw new Error(
      "RELAYER_ADDRESS must be set to a valid EVM address (e.g. RELAYER_ADDRESS=0x...)",
    );
  }
  return ethers.getAddress(raw);
}

function loadDeployment(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing deployment manifest: ${manifestPath}`);
  }
  const deployment = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!deployment || typeof deployment.contracts !== "object") {
    throw new Error(`Invalid deployment manifest (missing contracts): ${manifestPath}`);
  }
  for (const name of ALL_CONTRACTS) {
    const addr = deployment.contracts[name];
    if (!addr || !ethers.isAddress(addr)) {
      throw new Error(`Manifest missing valid address for ${name}: ${manifestPath}`);
    }
  }
  return deployment;
}

async function main() {
  const relayerAddress = getRelayerAddress();
  const manifestPath = resolveManifestPath();
  const deployment = loadDeployment(manifestPath);

  const [signer] = await ethers.getSigners();
  if (!signer) {
    throw new Error("No admin/deployer signer available. Set DEPLOYER_PRIVATE_KEY.");
  }

  const signerAddress = ethers.getAddress(await signer.getAddress());
  const manifestAdmin =
    deployment.admin && ethers.isAddress(deployment.admin)
      ? ethers.getAddress(deployment.admin)
      : null;

  const sameAsSigner = relayerAddress === signerAddress;
  const sameAsAdmin = manifestAdmin !== null && relayerAddress === manifestAdmin;
  if (sameAsSigner || sameAsAdmin) {
    if (process.env.ALLOW_SAME_ADMIN_RELAYER !== "true") {
      throw new Error(
        `Refusing to grant operational roles: RELAYER_ADDRESS (${relayerAddress}) equals ` +
          `admin/deployer address (${sameAsSigner ? signerAddress : manifestAdmin}). ` +
          `Use a dedicated relayer wallet, or set ALLOW_SAME_ADMIN_RELAYER=true to override in local dev.`,
      );
    }
    console.warn(
      `[WARN] RELAYER_ADDRESS (${relayerAddress}) matches admin/deployer address. ` +
        `Proceeding because ALLOW_SAME_ADMIN_RELAYER=true; always separate admin and relayer wallets in testnet/production.`,
    );
  }

  console.log(`Network: ${network.name} (${network.config.chainId})`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Admin signer: ${signerAddress}`);
  console.log(`Relayer target: ${relayerAddress}`);

  const contracts = {};
  for (const name of ALL_CONTRACTS) {
    contracts[name] = await ethers.getContractAt(name, deployment.contracts[name], signer);
  }

  const skipMockSrvMinter = process.env.SKIP_MOCKSRV_MINTER === "true";
  const operationalGrants = [
    { contractName: "SverseItems", roleName: "MINTER_ROLE", note: "mint items" },
    { contractName: "SverseItems", roleName: "PLATFORM_ROLE", note: "create item definitions" },
    { contractName: "SverseDeedRegistry", roleName: "WITNESS_ROLE", note: "co-sign deeds" },
    { contractName: "SverseRewards", roleName: "PUBLISHER_ROLE", note: "publish reward epochs" },
  ];

  if (skipMockSrvMinter) {
    console.log(
      "[skip] MockSRV.MINTER_ROLE skipped because SKIP_MOCKSRV_MINTER=true (non-mint settlement mode).",
    );
  } else {
    operationalGrants.push({
      contractName: "MockSRV",
      roleName: "MINTER_ROLE",
      note: "Fuji testnet settlement mode only (mint payouts)",
    });
  }

  for (const { contractName, roleName, note } of operationalGrants) {
    const contract = contracts[contractName];
    const roleId = await contract[roleName]();
    const alreadyGranted = await contract.hasRole(roleId, relayerAddress);
    if (alreadyGranted) {
      console.log(`[ok] ${contractName}.${roleName} already granted (${note})`);
      continue;
    }
    const tx = await contract.grantRole(roleId, relayerAddress);
    const receipt = await tx.wait();
    console.log(
      `[granted] ${contractName}.${roleName} -> ${relayerAddress} (${note}, tx: ${receipt.hash})`,
    );
  }

  console.log("\n--- Verification: Operational Roles ---");
  let allOperationalOk = true;
  for (const { contractName, roleName } of operationalGrants) {
    const contract = contracts[contractName];
    const roleId = await contract[roleName]();
    const has = await contract.hasRole(roleId, relayerAddress);
    console.log(`${contractName}.${roleName}: ${has}`);
    if (!has) allOperationalOk = false;
  }

  if (!allOperationalOk) {
    throw new Error("Verification failed: relayer is missing one or more required operational roles.");
  }

  console.log("\n--- Verification: Privileged Roles Must Be Absent ---");
  let privilegedWarnings = 0;
  for (const contractName of ALL_CONTRACTS) {
    const contract = contracts[contractName];
    const [defaultAdminRole, pauserRole] = await Promise.all([
      contract.DEFAULT_ADMIN_ROLE(),
      contract.PAUSER_ROLE(),
    ]);
    const [hasAdmin, hasPauser] = await Promise.all([
      contract.hasRole(defaultAdminRole, relayerAddress),
      contract.hasRole(pauserRole, relayerAddress),
    ]);
    console.log(`${contractName}: DEFAULT_ADMIN_ROLE=${hasAdmin}, PAUSER_ROLE=${hasPauser}`);
    if (hasAdmin || hasPauser) {
      privilegedWarnings += 1;
      console.warn(
        `[WARN] Relayer ${relayerAddress} holds privileged role(s) on ${contractName} ` +
          `(DEFAULT_ADMIN_ROLE=${hasAdmin}, PAUSER_ROLE=${hasPauser}). Revoke from relayer if unintended.`,
      );
    }
  }

  if (privilegedWarnings === 0) {
    console.log("\nLeast-privilege check passed: relayer holds operational roles only.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
