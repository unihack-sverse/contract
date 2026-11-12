const { ethers } = require("hardhat");

async function deployFixture() {
  const [admin, studio, buyer, marketBuyer, treasury, witness, outsider] =
    await ethers.getSigners();

  const MockSRV = await ethers.getContractFactory("MockSRV");
  const paymentToken = await MockSRV.deploy(admin.address);

  const SverseItems = await ethers.getContractFactory("SverseItems");
  const items = await SverseItems.deploy(admin.address);

  const SverseDeedRegistry = await ethers.getContractFactory(
    "SverseDeedRegistry",
  );
  const deeds = await SverseDeedRegistry.deploy(admin.address);

  const SverseStore = await ethers.getContractFactory("SverseStore");
  const store = await SverseStore.deploy(
    admin.address,
    await paymentToken.getAddress(),
    await items.getAddress(),
    treasury.address,
    250,
  );

  const SverseMarketplace = await ethers.getContractFactory(
    "SverseMarketplace",
  );
  const marketplace = await SverseMarketplace.deploy(
    admin.address,
    await paymentToken.getAddress(),
    await items.getAddress(),
    treasury.address,
    250,
  );

  const SverseRewards = await ethers.getContractFactory("SverseRewards");
  const rewards = await SverseRewards.deploy(
    admin.address,
    await paymentToken.getAddress(),
    treasury.address,
  );

  await items.grantRole(await items.MINTER_ROLE(), await store.getAddress());
  await deeds.setTrustedCollection(await items.getAddress(), true);
  await deeds.grantRole(await deeds.WITNESS_ROLE(), witness.address);

  const studioId = ethers.keccak256(ethers.toUtf8Bytes("std_kai_solo"));
  const gameId = ethers.keccak256(ethers.toUtf8Bytes("gam_voidrunner"));
  await items.registerStudio(studioId, studio.address);
  await items.registerGame(gameId, studioId);

  const standardDefinitionId = await items
    .connect(studio)
    .createItemDefinition.staticCall(
      gameId,
      100,
      500,
      true,
      false,
      "ipfs://sverse/voidrunner/cosmetic/{id}.json",
    );
  await items
    .connect(studio)
    .createItemDefinition(
      gameId,
      100,
      500,
      true,
      false,
      "ipfs://sverse/voidrunner/cosmetic/{id}.json",
    );

  const livingDefinitionId = await items
    .connect(studio)
    .createItemDefinition.staticCall(
      gameId,
      2,
      500,
      true,
      true,
      "ipfs://sverse/voidrunner/living/{id}.json",
    );
  await items
    .connect(studio)
    .createItemDefinition(
      gameId,
      2,
      500,
      true,
      true,
      "ipfs://sverse/voidrunner/living/{id}.json",
    );

  const boundDefinitionId = await items
    .connect(studio)
    .createItemDefinition.staticCall(
      gameId,
      10,
      0,
      false,
      false,
      "ipfs://sverse/voidrunner/bound/{id}.json",
    );
  await items
    .connect(studio)
    .createItemDefinition(
      gameId,
      10,
      0,
      false,
      false,
      "ipfs://sverse/voidrunner/bound/{id}.json",
    );

  return {
    admin,
    studio,
    buyer,
    marketBuyer,
    treasury,
    witness,
    outsider,
    paymentToken,
    items,
    deeds,
    store,
    marketplace,
    rewards,
    studioId,
    gameId,
    standardDefinitionId,
    livingDefinitionId,
    boundDefinitionId,
  };
}

module.exports = { deployFixture };
