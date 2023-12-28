pragma solidity ^0.8;

import "./helpers/SwapHelper.sol";
import "./helpers/Addresses.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IveMAV.sol";

contract maverickManage {
    function deposit(uint duration, bool doDelegation, bytes calldata _swapData) external{
        uint receivedMAV = SwapHelper.swapLifi(false, Addresses.wEthTokenAddress, _swapData);
        IERC20(Addresses.MAVTokenAddress).approve(Addresses.veMAVTokenAddress, receivedMAV);
        IveMAV(Addresses.veMAVTokenAddress).stake(receivedMAV, duration, doDelegation);
    }

    function withdraw(uint lockupId, bytes calldata _swapData) external{
        IveMAV(Addresses.veMAVTokenAddress).unstake(lockupId);
        SwapHelper.swapLifi(false, Addresses.MAVTokenAddress, _swapData);
    }
}