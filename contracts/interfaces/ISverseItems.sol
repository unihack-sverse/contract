// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";

interface ISverseItems is IERC1155, IERC2981 {
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

    function mint(address to, uint256 definitionId, uint256 amount) external returns (uint256 tokenId);

    function definitionOf(uint256 tokenId) external view returns (uint256);

    function getDefinition(uint256 definitionId) external view returns (ItemDefinition memory);

    function studioWalletForToken(uint256 tokenId) external view returns (address);

    function totalSupply(uint256 tokenId) external view returns (uint256);
}
