// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract SverseRewards is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PUBLISHER_ROLE = keccak256("PUBLISHER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    struct Epoch {
        bytes32 merkleRoot;
        uint128 totalUnits;
        uint128 claimedUnits;
        uint64 claimDeadline;
        bool reclaimed;
    }

    IERC20 public immutable rewardToken;
    address public treasury;

    mapping(uint256 epochNumber => Epoch epoch) public epochs;
    mapping(uint256 epochNumber => mapping(uint256 wordIndex => uint256 bitmap)) private _claimedBitmaps;

    error ZeroAddress();
    error InvalidMerkleRoot();
    error InvalidEpochFunding();
    error InvalidClaimDeadline();
    error EpochAlreadyPublished(uint256 epochNumber);
    error EpochNotFound(uint256 epochNumber);
    error ClaimWindowClosed(uint256 epochNumber);
    error AlreadyClaimed(uint256 epochNumber, uint256 index);
    error InvalidProof();
    error ClaimExceedsEpochAllocation();
    error EpochStillActive(uint256 claimDeadline);
    error EpochAlreadyReclaimed(uint256 epochNumber);

    event EpochPublished(
        uint256 indexed epochNumber,
        bytes32 indexed merkleRoot,
        uint256 totalUnits,
        uint64 claimDeadline
    );
    event RewardClaimed(
        uint256 indexed epochNumber,
        uint256 indexed index,
        address indexed account,
        uint256 amountUnits
    );
    event EpochReclaimed(uint256 indexed epochNumber, uint256 amountUnits);
    event TreasuryChanged(address indexed previousTreasury, address indexed newTreasury);

    constructor(address admin, address rewardTokenAddress, address treasuryAddress) {
        if (admin == address(0) || rewardTokenAddress == address(0) || treasuryAddress == address(0)) {
            revert ZeroAddress();
        }
        rewardToken = IERC20(rewardTokenAddress);
        treasury = treasuryAddress;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PUBLISHER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    function publishEpoch(
        uint256 epochNumber,
        bytes32 merkleRoot,
        uint128 totalUnits,
        uint64 claimDeadline
    ) external onlyRole(PUBLISHER_ROLE) nonReentrant {
        if (epochs[epochNumber].merkleRoot != bytes32(0)) revert EpochAlreadyPublished(epochNumber);
        if (merkleRoot == bytes32(0)) revert InvalidMerkleRoot();
        if (totalUnits == 0) revert InvalidEpochFunding();
        if (claimDeadline <= block.timestamp) revert InvalidClaimDeadline();

        epochs[epochNumber] = Epoch({
            merkleRoot: merkleRoot,
            totalUnits: totalUnits,
            claimedUnits: 0,
            claimDeadline: claimDeadline,
            reclaimed: false
        });
        rewardToken.safeTransferFrom(msg.sender, address(this), totalUnits);
        emit EpochPublished(epochNumber, merkleRoot, totalUnits, claimDeadline);
    }

    function claim(
        uint256 epochNumber,
        uint256 index,
        address account,
        uint128 amountUnits,
        bytes32[] calldata merkleProof
    ) external nonReentrant whenNotPaused {
        Epoch storage epoch = epochs[epochNumber];
        if (epoch.merkleRoot == bytes32(0)) revert EpochNotFound(epochNumber);
        if (block.timestamp > epoch.claimDeadline || epoch.reclaimed) revert ClaimWindowClosed(epochNumber);
        if (isClaimed(epochNumber, index)) revert AlreadyClaimed(epochNumber, index);

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(epochNumber, index, account, amountUnits))));
        if (!MerkleProof.verifyCalldata(merkleProof, epoch.merkleRoot, leaf)) revert InvalidProof();
        if (uint256(epoch.claimedUnits) + amountUnits > epoch.totalUnits) {
            revert ClaimExceedsEpochAllocation();
        }

        _setClaimed(epochNumber, index);
        epoch.claimedUnits += amountUnits;
        rewardToken.safeTransfer(account, amountUnits);
        emit RewardClaimed(epochNumber, index, account, amountUnits);
    }

    function reclaimExpired(uint256 epochNumber) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        Epoch storage epoch = epochs[epochNumber];
        if (epoch.merkleRoot == bytes32(0)) revert EpochNotFound(epochNumber);
        if (block.timestamp <= epoch.claimDeadline) revert EpochStillActive(epoch.claimDeadline);
        if (epoch.reclaimed) revert EpochAlreadyReclaimed(epochNumber);

        epoch.reclaimed = true;
        uint256 remainingUnits = uint256(epoch.totalUnits) - uint256(epoch.claimedUnits);
        if (remainingUnits != 0) rewardToken.safeTransfer(treasury, remainingUnits);
        emit EpochReclaimed(epochNumber, remainingUnits);
    }

    function isClaimed(uint256 epochNumber, uint256 index) public view returns (bool) {
        uint256 wordIndex = index / 256;
        uint256 bitIndex = index % 256;
        uint256 word = _claimedBitmaps[epochNumber][wordIndex];
        uint256 mask = 1 << bitIndex;
        return word & mask == mask;
    }

    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        address previousTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryChanged(previousTreasury, newTreasury);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _setClaimed(uint256 epochNumber, uint256 index) private {
        uint256 wordIndex = index / 256;
        uint256 bitIndex = index % 256;
        _claimedBitmaps[epochNumber][wordIndex] |= 1 << bitIndex;
    }
}
