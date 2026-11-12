const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture } = require("./helpers/fixture");

function rewardLeaf(epoch, index, account, amount) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint256", "address", "uint128"],
    [epoch, index, account, amount],
  );
  return ethers.keccak256(ethers.keccak256(encoded));
}

function hashPair(a, b) {
  const [left, right] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([left, right]));
}

describe("SverseRewards", function () {
  it("publishes a funded epoch, verifies claims and reclaims expiry", async function () {
    const { admin, buyer, marketBuyer, treasury, paymentToken, rewards } =
      await loadFixture(deployFixture);
    const epoch = 812;
    const buyerAmount = ethers.parseUnits("100", 6);
    const marketBuyerAmount = ethers.parseUnits("200", 6);
    const total = buyerAmount + marketBuyerAmount;
    const buyerLeaf = rewardLeaf(epoch, 0, buyer.address, buyerAmount);
    const marketBuyerLeaf = rewardLeaf(
      epoch,
      1,
      marketBuyer.address,
      marketBuyerAmount,
    );
    const root = hashPair(buyerLeaf, marketBuyerLeaf);
    const deadline = (await time.latest()) + 7 * 24 * 60 * 60;

    await paymentToken.connect(admin).mint(admin.address, total);
    await paymentToken.connect(admin).approve(await rewards.getAddress(), total);
    await rewards
      .connect(admin)
      .publishEpoch(epoch, root, total, deadline);

    await expect(
      rewards
        .connect(buyer)
        .claim(epoch, 0, buyer.address, buyerAmount, []),
    ).to.be.revertedWithCustomError(rewards, "InvalidProof");

    await expect(
      rewards
        .connect(buyer)
        .claim(epoch, 0, buyer.address, buyerAmount, [marketBuyerLeaf]),
    ).to.emit(rewards, "RewardClaimed");
    expect(await paymentToken.balanceOf(buyer.address)).to.equal(buyerAmount);
    expect(await rewards.isClaimed(epoch, 0)).to.equal(true);

    await expect(
      rewards.claim(epoch, 0, buyer.address, buyerAmount, [marketBuyerLeaf]),
    ).to.be.revertedWithCustomError(rewards, "AlreadyClaimed");

    await time.increaseTo(deadline + 1);
    await rewards.connect(admin).reclaimExpired(epoch);
    expect(await paymentToken.balanceOf(treasury.address)).to.equal(
      marketBuyerAmount,
    );
  });

  it("pauses claims without changing an already-funded epoch", async function () {
    const { admin, buyer, paymentToken, rewards } =
      await loadFixture(deployFixture);
    const epoch = 900;
    const amount = ethers.parseUnits("10", 6);
    const leaf = rewardLeaf(epoch, 0, buyer.address, amount);
    const deadline = (await time.latest()) + 3600;

    await paymentToken.connect(admin).mint(admin.address, amount);
    await paymentToken.connect(admin).approve(await rewards.getAddress(), amount);
    await rewards.connect(admin).publishEpoch(epoch, leaf, amount, deadline);
    await rewards.connect(admin).pause();
    await expect(
      rewards.connect(buyer).claim(epoch, 0, buyer.address, amount, []),
    ).to.be.revertedWithCustomError(rewards, "EnforcedPause");
    await rewards.connect(admin).unpause();
    await rewards.connect(buyer).claim(epoch, 0, buyer.address, amount, []);
    expect(await paymentToken.balanceOf(buyer.address)).to.equal(amount);
  });
});
