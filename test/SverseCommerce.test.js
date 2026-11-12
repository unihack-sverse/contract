const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture } = require("./helpers/fixture");

describe("Sverse Store and Marketplace", function () {
  it("settles a primary purchase and mints atomically", async function () {
    const {
      admin,
      studio,
      buyer,
      treasury,
      paymentToken,
      items,
      store,
      standardDefinitionId,
    } = await loadFixture(deployFixture);
    const unitPrice = ethers.parseUnits("120", 6);
    const total = unitPrice * 2n;
    const fee = (total * 250n) / 10_000n;

    await store
      .connect(admin)
      .configureOffer(standardDefinitionId, unitPrice, 0, 0, 5, true);
    await paymentToken.connect(admin).mint(buyer.address, total);
    await paymentToken.connect(buyer).approve(await store.getAddress(), total);

    const orderRef = ethers.id("ord_primary_1");
    await expect(
      store
        .connect(buyer)
        .purchase(
          standardDefinitionId,
          2,
          buyer.address,
          orderRef,
        ),
    ).to.emit(store, "ItemPurchased");

    expect(await items.balanceOf(buyer.address, standardDefinitionId)).to.equal(2);
    expect(await paymentToken.balanceOf(treasury.address)).to.equal(fee);
    expect(await paymentToken.balanceOf(studio.address)).to.equal(total - fee);

    await expect(
      store
        .connect(buyer)
        .purchase(standardDefinitionId, 1, buyer.address, orderRef),
    ).to.be.revertedWithCustomError(store, "OrderRefAlreadyUsed");
  });

  it("escrows a listing and pays seller, royalty and protocol fee", async function () {
    const {
      admin,
      studio,
      buyer,
      marketBuyer,
      treasury,
      paymentToken,
      items,
      marketplace,
      standardDefinitionId,
    } = await loadFixture(deployFixture);
    const price = ethers.parseUnits("200", 6);
    const royalty = (price * 500n) / 10_000n;
    const fee = (price * 250n) / 10_000n;

    await items.connect(admin).mint(buyer.address, standardDefinitionId, 1);
    await items
      .connect(buyer)
      .setApprovalForAll(await marketplace.getAddress(), true);
    await marketplace
      .connect(buyer)
      .createListing(standardDefinitionId, 1, price);

    expect(
      await items.balanceOf(await marketplace.getAddress(), standardDefinitionId),
    ).to.equal(1);

    await paymentToken.connect(admin).mint(marketBuyer.address, price);
    await paymentToken
      .connect(marketBuyer)
      .approve(await marketplace.getAddress(), price);
    await marketplace.connect(marketBuyer).buy(1);

    expect(
      await items.balanceOf(marketBuyer.address, standardDefinitionId),
    ).to.equal(1);
    expect(await paymentToken.balanceOf(treasury.address)).to.equal(fee);
    expect(await paymentToken.balanceOf(studio.address)).to.equal(royalty);
    expect(await paymentToken.balanceOf(buyer.address)).to.equal(
      price - fee - royalty,
    );
  });

  it("cannot escrow a non-transferable item", async function () {
    const { admin, buyer, items, marketplace, boundDefinitionId } =
      await loadFixture(deployFixture);

    await items.connect(admin).mint(buyer.address, boundDefinitionId, 1);
    await items
      .connect(buyer)
      .setApprovalForAll(await marketplace.getAddress(), true);
    await expect(
      marketplace
        .connect(buyer)
        .createListing(boundDefinitionId, 1, ethers.parseUnits("10", 6)),
    ).to.be.revertedWithCustomError(items, "NonTransferable");
  });

  it("rejects ERC-1155 deposits that do not belong to a listing", async function () {
    const { admin, buyer, items, marketplace, standardDefinitionId } =
      await loadFixture(deployFixture);

    await items.connect(admin).mint(buyer.address, standardDefinitionId, 1);
    await expect(
      items
        .connect(buyer)
        .safeTransferFrom(
          buyer.address,
          await marketplace.getAddress(),
          standardDefinitionId,
          1,
          "0x",
        ),
    ).to.be.revertedWithCustomError(marketplace, "InvalidEscrowDeposit");
    expect(await items.balanceOf(buyer.address, standardDefinitionId)).to.equal(1);
  });

  it("lets only the seller cancel and returns escrowed inventory", async function () {
    const {
      admin,
      buyer,
      marketBuyer,
      items,
      marketplace,
      standardDefinitionId,
    } = await loadFixture(deployFixture);

    await items.connect(admin).mint(buyer.address, standardDefinitionId, 2);
    await items
      .connect(buyer)
      .setApprovalForAll(await marketplace.getAddress(), true);
    await marketplace
      .connect(buyer)
      .createListing(
        standardDefinitionId,
        2,
        ethers.parseUnits("50", 6),
      );

    await expect(
      marketplace.connect(marketBuyer).cancelListing(1),
    ).to.be.revertedWithCustomError(marketplace, "NotListingSeller");
    await expect(marketplace.connect(buyer).cancelListing(1)).to.emit(
      marketplace,
      "ListingCancelled",
    );
    expect(await items.balanceOf(buyer.address, standardDefinitionId)).to.equal(2);
  });

  it("enforces sale windows and per-wallet purchase limits", async function () {
    const {
      admin,
      buyer,
      paymentToken,
      store,
      standardDefinitionId,
    } = await loadFixture(deployFixture);
    const price = ethers.parseUnits("20", 6);
    const startsAt = (await ethers.provider.getBlock("latest")).timestamp + 100;

    await store
      .connect(admin)
      .configureOffer(standardDefinitionId, price, startsAt, 0, 1, true);
    await paymentToken.connect(admin).mint(buyer.address, price * 2n);
    await paymentToken
      .connect(buyer)
      .approve(await store.getAddress(), price * 2n);

    await expect(
      store
        .connect(buyer)
        .purchase(standardDefinitionId, 1, buyer.address, ethers.id("early")),
    ).to.be.revertedWithCustomError(store, "OfferNotStarted");

    await ethers.provider.send("evm_setNextBlockTimestamp", [startsAt]);
    await store
      .connect(buyer)
      .purchase(standardDefinitionId, 1, buyer.address, ethers.id("allowed"));
    await expect(
      store
        .connect(buyer)
        .purchase(standardDefinitionId, 1, buyer.address, ethers.id("limited")),
    ).to.be.revertedWithCustomError(store, "WalletLimitExceeded");
  });

  it("applies admin fee and treasury updates and emergency pause", async function () {
    const { admin, outsider, marketplace } = await loadFixture(deployFixture);

    await marketplace.connect(admin).setProtocolFee(300);
    await marketplace.connect(admin).setTreasury(outsider.address);
    expect(await marketplace.protocolFeeBps()).to.equal(300);
    expect(await marketplace.treasury()).to.equal(outsider.address);

    await marketplace.connect(admin).pause();
    await expect(
      marketplace.connect(outsider).createListing(1, 1, 1),
    ).to.be.revertedWithCustomError(marketplace, "EnforcedPause");
    await marketplace.connect(admin).unpause();
  });
});
