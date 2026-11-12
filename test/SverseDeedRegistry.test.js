const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture } = require("./helpers/fixture");

async function signedDeed({
  signer,
  registry,
  collection,
  tokenId,
  deedType,
  payloadHash,
  payloadURI,
  nonce,
  deadline,
}) {
  const network = await ethers.provider.getNetwork();
  const domain = {
    name: "SverseDeedRegistry",
    version: "1",
    chainId: network.chainId,
    verifyingContract: await registry.getAddress(),
  };
  const types = {
    Deed: [
      { name: "collection", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "deedType", type: "bytes32" },
      { name: "payloadHash", type: "bytes32" },
      { name: "uriHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const value = {
    collection,
    tokenId,
    deedType,
    payloadHash,
    uriHash: ethers.keccak256(ethers.toUtf8Bytes(payloadURI)),
    nonce,
    deadline,
  };
  return signer.signTypedData(domain, types, value);
}

describe("SverseDeedRegistry", function () {
  async function deedFixture() {
    const fixture = await deployFixture();
    const tokenId = await fixture.items
      .connect(fixture.admin)
      .mint.staticCall(
        fixture.buyer.address,
        fixture.livingDefinitionId,
        1,
      );
    await fixture.items
      .connect(fixture.admin)
      .mint(fixture.buyer.address, fixture.livingDefinitionId, 1);
    return { ...fixture, tokenId };
  }

  it("records an append-only studio-signed deed and blocks replay", async function () {
    const { studio, outsider, items, deeds, tokenId } =
      await loadFixture(deedFixture);
    const collection = await items.getAddress();
    const deedType = ethers.id("boss_defeated");
    const payloadHash = ethers.id('{"boss":"Ashmaw","difficulty":"mythic"}');
    const payloadURI = "ipfs://sverse/deeds/boss-ashmaw.json";
    const nonce = 1;
    const deadline = (await time.latest()) + 3600;
    const signature = await signedDeed({
      signer: studio,
      registry: deeds,
      collection,
      tokenId,
      deedType,
      payloadHash,
      payloadURI,
      nonce,
      deadline,
    });

    await expect(
      deeds
        .connect(outsider)
        .recordDeed(
          collection,
          tokenId,
          deedType,
          payloadHash,
          payloadURI,
          nonce,
          deadline,
          signature,
          "0x",
        ),
    ).to.emit(deeds, "DeedRecorded");
    expect(await deeds.deedCount(collection, tokenId)).to.equal(1);

    await expect(
      deeds.recordDeed(
        collection,
        tokenId,
        deedType,
        payloadHash,
        payloadURI,
        nonce,
        deadline,
        signature,
        "0x",
      ),
    ).to.be.revertedWithCustomError(deeds, "NonceAlreadyUsed");
  });

  it("requires a platform witness for configured high-value deed types", async function () {
    const { admin, studio, witness, items, deeds, tokenId } =
      await loadFixture(deedFixture);
    const collection = await items.getAddress();
    const deedType = ethers.id("tournament_top8");
    const payloadHash = ethers.id("Ashfall Invitational");
    const payloadURI = "ipfs://sverse/deeds/ashfall-top8.json";
    const nonce = 7;
    const deadline = (await time.latest()) + 3600;
    await deeds.connect(admin).setWitnessRequired(deedType, true);

    const studioSignature = await signedDeed({
      signer: studio,
      registry: deeds,
      collection,
      tokenId,
      deedType,
      payloadHash,
      payloadURI,
      nonce,
      deadline,
    });
    await expect(
      deeds.recordDeed(
        collection,
        tokenId,
        deedType,
        payloadHash,
        payloadURI,
        nonce,
        deadline,
        studioSignature,
        "0x",
      ),
    ).to.be.revertedWithCustomError(deeds, "WitnessSignatureRequired");

    const witnessSignature = await signedDeed({
      signer: witness,
      registry: deeds,
      collection,
      tokenId,
      deedType,
      payloadHash,
      payloadURI,
      nonce,
      deadline,
    });
    await deeds.recordDeed(
      collection,
      tokenId,
      deedType,
      payloadHash,
      payloadURI,
      nonce,
      deadline,
      studioSignature,
      witnessSignature,
    );
    expect(await deeds.deedCount(collection, tokenId)).to.equal(1);
  });

  it("rejects a signature from anyone except the token's studio", async function () {
    const { admin, outsider, items, deeds, tokenId } =
      await loadFixture(deedFixture);
    const collection = await items.getAddress();
    const deedType = ethers.id("flawless_run");
    const payloadHash = ethers.id("41 rooms");
    const payloadURI = "ipfs://sverse/deeds/flawless.json";
    const deadline = (await time.latest()) + 3600;
    const badSignature = await signedDeed({
      signer: outsider,
      registry: deeds,
      collection,
      tokenId,
      deedType,
      payloadHash,
      payloadURI,
      nonce: 2,
      deadline,
    });

    await expect(
      deeds.recordDeed(
        collection,
        tokenId,
        deedType,
        payloadHash,
        payloadURI,
        2,
        deadline,
        badSignature,
        "0x",
      ),
    ).to.be.revertedWithCustomError(deeds, "InvalidStudioSignature");

    await deeds.connect(admin).pause();
    await expect(
      deeds.recordDeed(
        collection,
        tokenId,
        deedType,
        payloadHash,
        payloadURI,
        2,
        deadline,
        badSignature,
        "0x",
      ),
    ).to.be.revertedWithCustomError(deeds, "EnforcedPause");
    await deeds.connect(admin).unpause();
  });
});
