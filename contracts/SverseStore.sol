// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISverseItems} from "./interfaces/ISverseItems.sol";

contract SverseStore is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant CATALOG_ROLE = keccak256("CATALOG_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint96 public constant MAX_PROTOCOL_FEE_BPS = 1_000;
    uint256 private constant BPS_DENOMINATOR = 10_000;

    struct Offer {
        uint128 priceUnits;
        uint64 startsAt;
        uint64 endsAt;
        uint32 maxPerWallet;
        bool active;
    }

    IERC20 public immutable paymentToken;
    ISverseItems public immutable items;
    address public treasury;
    uint96 public protocolFeeBps;

    mapping(uint256 definitionId => Offer offer) public offers;
    mapping(uint256 definitionId => mapping(address buyer => uint256 amount)) public purchased;
    mapping(bytes32 orderRef => bool used) public usedOrderRefs;

    error ZeroAddress();
    error InvalidProtocolFee(uint96 feeBps);
    error InvalidPrice();
    error InvalidOfferWindow();
    error OfferInactive(uint256 definitionId);
    error OfferNotStarted(uint256 startsAt);
    error OfferEnded(uint256 endsAt);
    error InvalidQuantity();
    error WalletLimitExceeded(uint256 limit);
    error EmptyOrderRef();
    error OrderRefAlreadyUsed(bytes32 orderRef);

    event OfferConfigured(
        uint256 indexed definitionId,
        uint128 priceUnits,
        uint64 startsAt,
        uint64 endsAt,
        uint32 maxPerWallet,
        bool active
    );
    event ItemPurchased(
        bytes32 indexed orderRef,
        address indexed buyer,
        address indexed recipient,
        uint256 definitionId,
        uint256 tokenId,
        uint256 quantity,
        uint256 totalUnits,
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
        _grantRole(CATALOG_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    function configureOffer(
        uint256 definitionId,
        uint128 priceUnits,
        uint64 startsAt,
        uint64 endsAt,
        uint32 maxPerWallet,
        bool active
    ) external onlyRole(CATALOG_ROLE) {
        items.getDefinition(definitionId);
        if (priceUnits == 0) revert InvalidPrice();
        if (endsAt != 0 && endsAt <= startsAt) revert InvalidOfferWindow();

        offers[definitionId] = Offer({
            priceUnits: priceUnits,
            startsAt: startsAt,
            endsAt: endsAt,
            maxPerWallet: maxPerWallet,
            active: active
        });
        emit OfferConfigured(definitionId, priceUnits, startsAt, endsAt, maxPerWallet, active);
    }

    function purchase(
        uint256 definitionId,
        uint256 quantity,
        address recipient,
        bytes32 orderRef
    ) external nonReentrant whenNotPaused returns (uint256 tokenId) {
        if (recipient == address(0)) revert ZeroAddress();
        if (quantity == 0) revert InvalidQuantity();
        if (orderRef == bytes32(0)) revert EmptyOrderRef();
        if (usedOrderRefs[orderRef]) revert OrderRefAlreadyUsed(orderRef);

        Offer memory offer = offers[definitionId];
        if (!offer.active) revert OfferInactive(definitionId);
        if (block.timestamp < offer.startsAt) revert OfferNotStarted(offer.startsAt);
        if (offer.endsAt != 0 && block.timestamp > offer.endsAt) revert OfferEnded(offer.endsAt);

        uint256 bought = purchased[definitionId][msg.sender];
        if (offer.maxPerWallet != 0 && bought + quantity > offer.maxPerWallet) {
            revert WalletLimitExceeded(offer.maxPerWallet);
        }
        usedOrderRefs[orderRef] = true;
        purchased[definitionId][msg.sender] = bought + quantity;

        ISverseItems.ItemDefinition memory definition = items.getDefinition(definitionId);
        uint256 totalUnits = uint256(offer.priceUnits) * quantity;
        uint256 protocolFeeUnits = (totalUnits * protocolFeeBps) / BPS_DENOMINATOR;
        uint256 studioUnits = totalUnits - protocolFeeUnits;

        paymentToken.safeTransferFrom(msg.sender, address(this), totalUnits);
        if (protocolFeeUnits != 0) paymentToken.safeTransfer(treasury, protocolFeeUnits);
        paymentToken.safeTransfer(definition.studioWallet, studioUnits);

        tokenId = items.mint(recipient, definitionId, quantity);
        emit ItemPurchased(
            orderRef,
            msg.sender,
            recipient,
            definitionId,
            tokenId,
            quantity,
            totalUnits,
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
}
