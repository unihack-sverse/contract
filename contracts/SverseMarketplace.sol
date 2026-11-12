// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISverseItems} from "./interfaces/ISverseItems.sol";

contract SverseMarketplace is ERC1155Holder, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint96 public constant MAX_PROTOCOL_FEE_BPS = 1_000;
    uint256 private constant BPS_DENOMINATOR = 10_000;

    struct Listing {
        address seller;
        uint256 tokenId;
        uint128 amount;
        uint128 priceUnits;
        bool active;
    }

    IERC20 public immutable paymentToken;
    ISverseItems public immutable items;
    address public treasury;
    uint96 public protocolFeeBps;
    uint256 public nextListingId = 1;

    mapping(uint256 listingId => Listing listing) public listings;

    error ZeroAddress();
    error InvalidProtocolFee(uint96 feeBps);
    error InvalidAmount();
    error InvalidPrice();
    error ListingInactive(uint256 listingId);
    error NotListingSeller();
    error SelfPurchase();
    error FeeConfigurationInvalid(uint256 protocolFeeUnits, uint256 royaltyUnits);
    error UnsupportedCollection(address collection);
    error BatchDepositsNotSupported();
    error InvalidEscrowDeposit();

    event ListingCreated(
        uint256 indexed listingId,
        address indexed seller,
        uint256 indexed tokenId,
        uint256 amount,
        uint256 priceUnits
    );
    event ListingCancelled(uint256 indexed listingId, address indexed seller);
    event ListingSold(
        uint256 indexed listingId,
        address indexed seller,
        address indexed buyer,
        uint256 tokenId,
        uint256 amount,
        uint256 priceUnits,
        uint256 royaltyUnits,
        uint256 protocolFeeUnits
    );
    event TreasuryChanged(address indexed previousTreasury, address indexed newTreasury);
    event ProtocolFeeChanged(uint96 previousFeeBps, uint96 newFeeBps);

    constructor(
        address admin,
        address paymentTokenAddress,
        address itemsAddress,
        address treasuryAddress,
        uint96 initialProtocolFeeBps
    ) {
        if (
            admin == address(0) ||
            paymentTokenAddress == address(0) ||
            itemsAddress == address(0) ||
            treasuryAddress == address(0)
        ) revert ZeroAddress();
        if (initialProtocolFeeBps > MAX_PROTOCOL_FEE_BPS) {
            revert InvalidProtocolFee(initialProtocolFeeBps);
        }

        paymentToken = IERC20(paymentTokenAddress);
        items = ISverseItems(itemsAddress);
        treasury = treasuryAddress;
        protocolFeeBps = initialProtocolFeeBps;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    function createListing(
        uint256 tokenId,
        uint128 amount,
        uint128 priceUnits
    ) external nonReentrant whenNotPaused returns (uint256 listingId) {
        if (amount == 0) revert InvalidAmount();
        if (priceUnits == 0) revert InvalidPrice();

        listingId = nextListingId++;
        listings[listingId] = Listing({
            seller: msg.sender,
            tokenId: tokenId,
            amount: amount,
            priceUnits: priceUnits,
            active: true
        });

        items.safeTransferFrom(msg.sender, address(this), tokenId, amount, abi.encode(listingId));
        emit ListingCreated(listingId, msg.sender, tokenId, amount, priceUnits);
    }

    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        if (!listing.active) revert ListingInactive(listingId);
        if (listing.seller != msg.sender && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotListingSeller();
        }

        listing.active = false;
        items.safeTransferFrom(address(this), listing.seller, listing.tokenId, listing.amount, "");
        emit ListingCancelled(listingId, listing.seller);
    }

    function buy(uint256 listingId) external nonReentrant whenNotPaused {
        Listing storage listing = listings[listingId];
        if (!listing.active) revert ListingInactive(listingId);
        if (listing.seller == msg.sender) revert SelfPurchase();

        listing.active = false;
        uint256 priceUnits = listing.priceUnits;
        uint256 protocolFeeUnits = (priceUnits * protocolFeeBps) / BPS_DENOMINATOR;
        (address royaltyReceiver, uint256 royaltyUnits) = items.royaltyInfo(listing.tokenId, priceUnits);
        if (protocolFeeUnits + royaltyUnits > priceUnits) {
            revert FeeConfigurationInvalid(protocolFeeUnits, royaltyUnits);
        }
        uint256 sellerUnits = priceUnits - protocolFeeUnits - royaltyUnits;

        paymentToken.safeTransferFrom(msg.sender, address(this), priceUnits);
        if (protocolFeeUnits != 0) paymentToken.safeTransfer(treasury, protocolFeeUnits);
        if (royaltyUnits != 0) paymentToken.safeTransfer(royaltyReceiver, royaltyUnits);
        paymentToken.safeTransfer(listing.seller, sellerUnits);

        items.safeTransferFrom(address(this), msg.sender, listing.tokenId, listing.amount, "");
        emit ListingSold(
            listingId,
            listing.seller,
            msg.sender,
            listing.tokenId,
            listing.amount,
            priceUnits,
            royaltyUnits,
            protocolFeeUnits
        );
    }

    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        address previousTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryChanged(previousTreasury, newTreasury);
    }

    function setProtocolFee(uint96 newFeeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newFeeBps > MAX_PROTOCOL_FEE_BPS) revert InvalidProtocolFee(newFeeBps);
        uint96 previousFeeBps = protocolFeeBps;
        protocolFeeBps = newFeeBps;
        emit ProtocolFeeChanged(previousFeeBps, newFeeBps);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function onERC1155Received(
        address operator,
        address from,
        uint256 tokenId,
        uint256 amount,
        bytes memory data
    ) public view override returns (bytes4) {
        if (msg.sender != address(items)) revert UnsupportedCollection(msg.sender);
        if (operator != address(this) || data.length != 32) revert InvalidEscrowDeposit();

        uint256 listingId = abi.decode(data, (uint256));
        Listing memory listing = listings[listingId];
        if (
            !listing.active ||
            listing.seller != from ||
            listing.tokenId != tokenId ||
            listing.amount != amount
        ) revert InvalidEscrowDeposit();
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] memory,
        uint256[] memory,
        bytes memory
    ) public pure override returns (bytes4) {
        revert BatchDepositsNotSupported();
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC1155Holder, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
