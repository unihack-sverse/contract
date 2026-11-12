// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {ERC1155Pausable} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Pausable.sol";
import {ERC1155URIStorage} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155URIStorage.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract SverseItems is
    ERC1155,
    ERC1155Supply,
    ERC1155Pausable,
    ERC1155URIStorage,
    ERC2981,
    AccessControl
{
    bytes32 public constant PLATFORM_ROLE = keccak256("PLATFORM_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint96 public constant MAX_ROYALTY_BPS = 2_000;

    struct ItemDefinition {
        bytes32 gameId;
        bytes32 studioId;
        address studioWallet;
        uint128 maxSupply;
        uint96 royaltyBps;
        bool transferable;
        bool living;
        bool active;
        bool metadataFrozen;
    }

    uint256 private _nextId = 1;

    mapping(bytes32 studioId => address wallet) public studioWallets;
    mapping(address wallet => bytes32 studioId) public studioIds;
    mapping(bytes32 gameId => bytes32 studioId) public gameStudios;
    mapping(uint256 definitionId => ItemDefinition definition) private _definitions;
    mapping(uint256 definitionId => string definitionURI) private _definitionURIs;
    mapping(uint256 definitionId => uint256 amount) public totalMinted;
    mapping(uint256 tokenId => uint256 definitionId) public definitionOf;

    error ZeroAddress();
    error EmptyId();
    error StudioAlreadyRegistered(bytes32 studioId);
    error WalletAlreadyRegistered(address wallet);
    error StudioNotRegistered(bytes32 studioId);
    error GameAlreadyRegistered(bytes32 gameId);
    error GameNotRegistered(bytes32 gameId);
    error NotStudioOrPlatform();
    error DefinitionNotFound(uint256 definitionId);
    error DefinitionInactive(uint256 definitionId);
    error InvalidSupply();
    error SupplyExceeded(uint256 definitionId, uint256 requested, uint256 remaining);
    error InvalidRoyalty(uint96 royaltyBps);
    error LivingItemAmountMustBeOne();
    error NonTransferable(uint256 tokenId);
    error MetadataIsFrozen(uint256 definitionId);

    event StudioRegistered(bytes32 indexed studioId, address indexed wallet);
    event GameRegistered(bytes32 indexed gameId, bytes32 indexed studioId);
    event ItemDefinitionCreated(
        uint256 indexed definitionId,
        bytes32 indexed gameId,
        bytes32 indexed studioId,
        bool living,
        uint128 maxSupply
    );
    event ItemDefinitionStatusChanged(uint256 indexed definitionId, bool active);
    event DefinitionURIChanged(uint256 indexed definitionId, string newURI);
    event DefinitionMetadataFrozen(uint256 indexed definitionId);
    event ItemMinted(
        address indexed to,
        uint256 indexed tokenId,
        uint256 indexed definitionId,
        uint256 amount
    );

    constructor(address admin) ERC1155("") {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PLATFORM_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    function registerStudio(bytes32 studioId, address wallet) external onlyRole(PLATFORM_ROLE) {
        if (studioId == bytes32(0)) revert EmptyId();
        if (wallet == address(0)) revert ZeroAddress();
        if (studioWallets[studioId] != address(0)) revert StudioAlreadyRegistered(studioId);
        if (studioIds[wallet] != bytes32(0)) revert WalletAlreadyRegistered(wallet);

        studioWallets[studioId] = wallet;
        studioIds[wallet] = studioId;
        emit StudioRegistered(studioId, wallet);
    }

    function registerGame(bytes32 gameId, bytes32 studioId) external onlyRole(PLATFORM_ROLE) {
        if (gameId == bytes32(0) || studioId == bytes32(0)) revert EmptyId();
        if (studioWallets[studioId] == address(0)) revert StudioNotRegistered(studioId);
        if (gameStudios[gameId] != bytes32(0)) revert GameAlreadyRegistered(gameId);

        gameStudios[gameId] = studioId;
        emit GameRegistered(gameId, studioId);
    }

    function createItemDefinition(
        bytes32 gameId,
        uint128 maxSupply,
        uint96 royaltyBps,
        bool transferable,
        bool living,
        string calldata definitionURI
    ) external returns (uint256 definitionId) {
        bytes32 studioId = gameStudios[gameId];
        if (studioId == bytes32(0)) revert GameNotRegistered(gameId);
        address studioWallet = studioWallets[studioId];
        if (msg.sender != studioWallet && !hasRole(PLATFORM_ROLE, msg.sender)) {
            revert NotStudioOrPlatform();
        }
        if (maxSupply == 0) revert InvalidSupply();
        if (royaltyBps > MAX_ROYALTY_BPS) revert InvalidRoyalty(royaltyBps);

        definitionId = _nextId++;
        _definitions[definitionId] = ItemDefinition({
            gameId: gameId,
            studioId: studioId,
            studioWallet: studioWallet,
            maxSupply: maxSupply,
            royaltyBps: royaltyBps,
            transferable: transferable,
            living: living,
            active: true,
            metadataFrozen: false
        });
        _definitionURIs[definitionId] = definitionURI;

        if (!living) {
            definitionOf[definitionId] = definitionId;
            _setTokenRoyalty(definitionId, studioWallet, royaltyBps);
        }

        emit ItemDefinitionCreated(definitionId, gameId, studioId, living, maxSupply);
        emit DefinitionURIChanged(definitionId, definitionURI);
    }

    function mint(
        address to,
        uint256 definitionId,
        uint256 amount
    ) external onlyRole(MINTER_ROLE) whenNotPaused returns (uint256 tokenId) {
        if (to == address(0)) revert ZeroAddress();
        ItemDefinition storage definition = _requireDefinition(definitionId);
        if (!definition.active) revert DefinitionInactive(definitionId);
        if (amount == 0) revert InvalidSupply();
        if (definition.living && amount != 1) revert LivingItemAmountMustBeOne();

        uint256 minted = totalMinted[definitionId];
        uint256 remaining = uint256(definition.maxSupply) - minted;
        if (amount > remaining) revert SupplyExceeded(definitionId, amount, remaining);

        totalMinted[definitionId] = minted + amount;
        if (definition.living) {
            tokenId = _nextId++;
            definitionOf[tokenId] = definitionId;
            _setTokenRoyalty(tokenId, definition.studioWallet, definition.royaltyBps);
        } else {
            tokenId = definitionId;
        }

        _mint(to, tokenId, amount, "");
        emit ItemMinted(to, tokenId, definitionId, amount);
    }

    function burn(address account, uint256 tokenId, uint256 amount) external {
        if (msg.sender != account && !isApprovedForAll(account, msg.sender)) {
            revert ERC1155MissingApprovalForAll(msg.sender, account);
        }
        _burn(account, tokenId, amount);
    }

    function setDefinitionActive(uint256 definitionId, bool active) external {
        ItemDefinition storage definition = _requireDefinition(definitionId);
        _requireStudioOrPlatform(definition.studioWallet);
        definition.active = active;
        emit ItemDefinitionStatusChanged(definitionId, active);
    }

    function setDefinitionURI(uint256 definitionId, string calldata newURI) external {
        ItemDefinition storage definition = _requireDefinition(definitionId);
        _requireStudioOrPlatform(definition.studioWallet);
        if (definition.metadataFrozen) revert MetadataIsFrozen(definitionId);
        _definitionURIs[definitionId] = newURI;
        emit DefinitionURIChanged(definitionId, newURI);
    }

    function freezeDefinitionMetadata(uint256 definitionId) external {
        ItemDefinition storage definition = _requireDefinition(definitionId);
        _requireStudioOrPlatform(definition.studioWallet);
        definition.metadataFrozen = true;
        emit DefinitionMetadataFrozen(definitionId);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function getDefinition(uint256 definitionId) external view returns (ItemDefinition memory) {
        ItemDefinition memory definition = _definitions[definitionId];
        if (definition.studioWallet == address(0)) revert DefinitionNotFound(definitionId);
        return definition;
    }

    function studioWalletForToken(uint256 tokenId) external view returns (address) {
        uint256 definitionId = definitionOf[tokenId];
        if (definitionId == 0) revert DefinitionNotFound(definitionId);
        return _definitions[definitionId].studioWallet;
    }

    function uri(uint256 tokenId) public view override(ERC1155, ERC1155URIStorage) returns (string memory) {
        uint256 definitionId = definitionOf[tokenId];
        if (definitionId == 0) return "";

        string memory storedURI = super.uri(tokenId);
        if (bytes(storedURI).length != 0) return storedURI;
        return _definitionURIs[definitionId];
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC1155, AccessControl, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _requireDefinition(uint256 definitionId) private view returns (ItemDefinition storage definition) {
        definition = _definitions[definitionId];
        if (definition.studioWallet == address(0)) revert DefinitionNotFound(definitionId);
    }

    function _requireStudioOrPlatform(address studioWallet) private view {
        if (msg.sender != studioWallet && !hasRole(PLATFORM_ROLE, msg.sender)) {
            revert NotStudioOrPlatform();
        }
    }

    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override(ERC1155, ERC1155Supply, ERC1155Pausable) {
        if (from != address(0) && to != address(0)) {
            for (uint256 i = 0; i < ids.length; ++i) {
                uint256 definitionId = definitionOf[ids[i]];
                if (!_definitions[definitionId].transferable) revert NonTransferable(ids[i]);
            }
        }
        super._update(from, to, ids, values);
    }
}
