// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Demo-only ERC-721 with open mint and burn, used by the local indexer demo to exercise
/// the pre-mint collection window and the post-burn reopening. Not part of the adapter test suite.
contract DemoPunks is ERC721 {
    constructor() ERC721("DemoPunks", "DPUNK") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function burn(uint256 tokenId) external {
        _burn(tokenId);
    }
}
