const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture } = require("./helpers/fixture");

describe("SverseItems and MockSRV", function () {
  it("registers catalog ownership and rejects an unrelated definition creator", async function () {
    const { items, outsider, gameId } = await loadFixture(deployFixture);

    await expect(
      items
        .connect(outsider)
        .createItemDefinition(gameId, 10, 500, true, false, "ipfs://bad"),
    ).to.be.revertedWithCustomError(items, "NotStudioOrPlatform");
  });

  it("mints fungible item types and unique Living Item token IDs", async function () {
    const {
      admin,
      buyer,
      items,
      standardDefinitionId,
      livingDefinitionId,
    } = await loadFixture(deployFixture);

    await items
      .connect(admin)
      .mint(buyer.address, standardDefinitionId, 3);
    expect(await items.balanceOf(buyer.address, standardDefinitionId)).to.equal(3);
    expect(await items.totalMinted(standardDefinitionId)).to.equal(3);

    const firstLivingToken = await items
      .connect(admin)
      .mint.staticCall(buyer.address, livingDefinitionId, 1);
    await items.connect(admin).mint(buyer.address, livingDefinitionId, 1);
    const secondLivingToken = await items
      .connect(admin)
      .mint.staticCall(buyer.address, livingDefinitionId, 1);
    await items.connect(admin).mint(buyer.address, livingDefinitionId, 1);

    expect(firstLivingToken).not.to.equal(secondLivingToken);
    expect(await items.definitionOf(firstLivingToken)).to.equal(
      livingDefinitionId,
    );
    expect(await items["totalSupply(uint256)"](firstLivingToken)).to.equal(1);
    expect(await items.uri(firstLivingToken)).to.equal(
      "ipfs://sverse/voidrunner/living/{id}.json",
    );

    await expect(
      items.connect(admin).mint(buyer.address, livingDefinitionId, 1),
    ).to.be.revertedWithCustomError(items, "SupplyExceeded");
  });

  it("enforces non-transferability while still allowing mint and burn", async function () {
    const { admin, buyer, outsider, items, boundDefinitionId } =
      await loadFixture(deployFixture);

    await items.connect(admin).mint(buyer.address, boundDefinitionId, 1);
    await expect(
      items
        .connect(buyer)
        .safeTransferFrom(
          buyer.address,
          outsider.address,
          boundDefinitionId,
          1,
          "0x",
        ),
    ).to.be.revertedWithCustomError(items, "NonTransferable");

    await items.connect(buyer).burn(buyer.address, boundDefinitionId, 1);
    expect(await items.balanceOf(buyer.address, boundDefinitionId)).to.equal(0);
  });

  it("freezes metadata permanently and pauses minting", async function () {
    const { admin, studio, buyer, items, standardDefinitionId } =
      await loadFixture(deployFixture);

    await items.connect(studio).freezeDefinitionMetadata(standardDefinitionId);
    await expect(
      items
        .connect(studio)
        .setDefinitionURI(standardDefinitionId, "ipfs://replacement"),
    ).to.be.revertedWithCustomError(items, "MetadataIsFrozen");

    await items.connect(admin).pause();
    await expect(
      items.connect(admin).mint(buyer.address, standardDefinitionId, 1),
    ).to.be.revertedWithCustomError(items, "EnforcedPause");
    await items.connect(admin).unpause();
    await items.connect(admin).mint(buyer.address, standardDefinitionId, 1);
    expect(await items.balanceOf(buyer.address, standardDefinitionId)).to.equal(1);
  });

  it("archives definitions and reports ERC-2981 royalties", async function () {
    const { admin, studio, buyer, items, standardDefinitionId } =
      await loadFixture(deployFixture);

    await items
      .connect(studio)
      .setDefinitionURI(standardDefinitionId, "ipfs://sverse/revised/{id}.json");
    expect(await items.uri(standardDefinitionId)).to.equal(
      "ipfs://sverse/revised/{id}.json",
    );

    await items.connect(studio).setDefinitionActive(standardDefinitionId, false);
    await expect(
      items.connect(admin).mint(buyer.address, standardDefinitionId, 1),
    ).to.be.revertedWithCustomError(items, "DefinitionInactive");

    await items.connect(studio).setDefinitionActive(standardDefinitionId, true);
    const [receiver, royalty] = await items.royaltyInfo(
      standardDefinitionId,
      ethers.parseUnits("100", 6),
    );
    expect(receiver).to.equal(studio.address);
    expect(royalty).to.equal(ethers.parseUnits("5", 6));
  });

  it("issues test SRV through a rate-limited faucet", async function () {
    const { buyer, paymentToken } = await loadFixture(deployFixture);

    await paymentToken.connect(buyer).faucet();
    expect(await paymentToken.balanceOf(buyer.address)).to.equal(
      ethers.parseUnits("1000", 6),
    );
    await expect(
      paymentToken.connect(buyer).faucet(),
    ).to.be.revertedWithCustomError(paymentToken, "FaucetCooldown");

    await time.increase(24 * 60 * 60);
    await paymentToken.connect(buyer).faucet();
    expect(await paymentToken.balanceOf(buyer.address)).to.equal(
      ethers.parseUnits("2000", 6),
    );
  });
});
