// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDT
 * @notice Test-only ERC-20 mimicking USDT's 6-decimal format.
 *         Used on localhost and testnet deployments.
 */
contract MockUSDT is ERC20, Ownable {
    constructor(address initialOwner) ERC20("Mock USD Tether", "USDT") Ownable(initialOwner) {
        // Mint 1,000,000 USDT to deployer for testing
        _mint(initialOwner, 1_000_000 * 10 ** decimals());
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Faucet — anyone can mint up to 10,000 USDT for testing
    function faucet(address to, uint256 amount) external {
        require(amount <= 10_000 * 10 ** decimals(), "MockUSDT: max faucet 10k");
        _mint(to, amount);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}