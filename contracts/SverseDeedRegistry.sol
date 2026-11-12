// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ISverseItems} from "./interfaces/ISverseItems.sol";

contract SverseDeedRegistry is AccessControl, Pausable, EIP712 {
    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 public constant WITNESS_ROLE = keccak256("WITNESS_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    bytes32 public constant DEED_TYPEHASH = keccak256(
        "Deed(address collection,uint256 tokenId,bytes32 deedType,bytes32 payloadHash,bytes32 uriHash,uint256 nonce,uint256 deadline)"
    );

    struct Deed {
        address collection;
        uint256 tokenId;
        bytes32 deedType;
        bytes32 payloadHash;
        bytes32 uriHash;
        uint64 recordedAt;
        address studioSigner;
        address witnessSigner;
    }

    mapping(address collection => bool trusted) public trustedCollections;
    mapping(bytes32 deedType => bool required) public witnessRequired;
    mapping(address collection => mapping(uint256 tokenId => mapping(uint256 nonce => bool used)))
        public usedNonces;
    mapping(address collection => mapping(uint256 tokenId => uint256 count)) public deedCount;
    mapping(bytes32 deedId => Deed deed) public deeds;

    error ZeroAddress();
    error UntrustedCollection(address collection);
    error TokenDoesNotExist(uint256 tokenId);
    error SignatureExpired(uint256 deadline);
    error NonceAlreadyUsed(uint256 nonce);
    error InvalidStudioSignature(address recovered, address expected);
    error WitnessSignatureRequired(bytes32 deedType);
    error InvalidWitnessSignature(address recovered);

    event TrustedCollectionSet(address indexed collection, bool trusted);
    event WitnessRequirementSet(bytes32 indexed deedType, bool required);
    event DeedRecorded(
        bytes32 indexed deedId,
        address indexed collection,
        uint256 indexed tokenId,
        bytes32 deedType,
        bytes32 payloadHash,
        string payloadURI,
        uint256 nonce,
        address studioSigner,
        address witnessSigner
    );

    constructor(address admin) EIP712("SverseDeedRegistry", "1") {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);
        _grantRole(WITNESS_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    function setTrustedCollection(address collection, bool trusted) external onlyRole(CONFIG_ROLE) {
        if (collection == address(0)) revert ZeroAddress();
        trustedCollections[collection] = trusted;
        emit TrustedCollectionSet(collection, trusted);
    }

    function setWitnessRequired(bytes32 deedType, bool required) external onlyRole(CONFIG_ROLE) {
        witnessRequired[deedType] = required;
        emit WitnessRequirementSet(deedType, required);
    }

    function recordDeed(
        address collection,
        uint256 tokenId,
        bytes32 deedType,
        bytes32 payloadHash,
        string calldata payloadURI,
        uint256 nonce,
        uint256 deadline,
        bytes calldata studioSignature,
        bytes calldata witnessSignature
    ) external whenNotPaused returns (bytes32 deedId) {
        if (!trustedCollections[collection]) revert UntrustedCollection(collection);
        if (ISverseItems(collection).totalSupply(tokenId) == 0) revert TokenDoesNotExist(tokenId);
        if (deadline != 0 && block.timestamp > deadline) revert SignatureExpired(deadline);
        if (usedNonces[collection][tokenId][nonce]) revert NonceAlreadyUsed(nonce);

        bytes32 uriHash = keccak256(bytes(payloadURI));
        bytes32 digest = deedDigest(
            collection,
            tokenId,
            deedType,
            payloadHash,
            uriHash,
            nonce,
            deadline
        );

        address expectedStudio = ISverseItems(collection).studioWalletForToken(tokenId);
        address studioSigner = ECDSA.recover(digest, studioSignature);
        if (studioSigner != expectedStudio) {
            revert InvalidStudioSignature(studioSigner, expectedStudio);
        }

        address witnessSigner;
        if (witnessRequired[deedType]) {
            if (witnessSignature.length == 0) revert WitnessSignatureRequired(deedType);
            witnessSigner = ECDSA.recover(digest, witnessSignature);
            if (!hasRole(WITNESS_ROLE, witnessSigner)) {
                revert InvalidWitnessSignature(witnessSigner);
            }
        } else if (witnessSignature.length != 0) {
            witnessSigner = ECDSA.recover(digest, witnessSignature);
            if (!hasRole(WITNESS_ROLE, witnessSigner)) {
                revert InvalidWitnessSignature(witnessSigner);
            }
        }

        usedNonces[collection][tokenId][nonce] = true;
        deedCount[collection][tokenId] += 1;
        deedId = keccak256(abi.encode(block.chainid, address(this), collection, tokenId, nonce));
        deeds[deedId] = Deed({
            collection: collection,
            tokenId: tokenId,
            deedType: deedType,
            payloadHash: payloadHash,
            uriHash: uriHash,
            recordedAt: uint64(block.timestamp),
            studioSigner: studioSigner,
            witnessSigner: witnessSigner
        });

        emit DeedRecorded(
            deedId,
            collection,
            tokenId,
            deedType,
            payloadHash,
            payloadURI,
            nonce,
            studioSigner,
            witnessSigner
        );
    }

    function deedDigest(
        address collection,
        uint256 tokenId,
        bytes32 deedType,
        bytes32 payloadHash,
        bytes32 uriHash,
        uint256 nonce,
        uint256 deadline
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                DEED_TYPEHASH,
                collection,
                tokenId,
                deedType,
                payloadHash,
                uriHash,
                nonce,
                deadline
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
