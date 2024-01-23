//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMaverickReward{
    struct EarnedInfo {
        // account
        address account;
        // earned
        uint256 earned;
        // reward token
        IERC20 rewardToken;
    }
    function earned(address account) external view returns (EarnedInfo[] memory earnedInfo);
    function tokenIndex(address tokenAddress) external view returns (uint8);
    function getReward(address recipient, uint8 rewardTokenIndex) external returns (uint256);
}