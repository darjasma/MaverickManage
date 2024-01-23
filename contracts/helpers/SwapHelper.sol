// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./Addresses.sol";
import "../interfaces/ILifi.sol";

library SwapHelper {


    function swapLifi(bool sendsEth, address sendingAssetId, bytes calldata _swapData) internal returns (uint){
        return _swapLifi(sendsEth, sendingAssetId, _swapData);
    }

    function _swapLifi(bool sendsEth, address sendingAssetId, bytes calldata _swapData) internal returns (uint changedAmount){
        (
            bytes32 _transactionId,
            string memory _integrator,
            string memory _referrer,
            address payable _receiver,
            uint256 _minAmount,
            ILifi.SwapData[] memory _swapsData
        ) = abi.decode(
            _swapData,
            (
                bytes32,
                string,
                string,
                address,
                uint256,
                ILifi.SwapData[]
            )
        );
        uint lastIndex = _swapsData.length - 1;
        address receivingAssetId = _swapsData[lastIndex].receivingAssetId;
        uint dstBalanceBefore;
        uint dstBalanceAfter;
        uint sendEthAmount;
        if (receivingAssetId == address(0x0)) //if it is receiving ETH
            dstBalanceBefore = _receiver.balance;
        else
            dstBalanceBefore = IERC20(receivingAssetId).balanceOf(address(_receiver));
        if (sendsEth == true) {
            sendEthAmount = _swapsData[0].fromAmount;
            require(address(this).balance >= sendEthAmount, "Not enough Eth in the contract");
        }
        else {
            IERC20(sendingAssetId).approve(Addresses.lifiDiamondAddress, _swapsData[0].fromAmount);
            sendEthAmount = 0;
        }

        ILifi(Addresses.lifiDiamondAddress).swapTokensGeneric{value: sendEthAmount}(
            _transactionId,
            _integrator,
            _referrer,
            _receiver,
            _minAmount,
            _swapsData
        );
        if (receivingAssetId == address(0x0))
            dstBalanceAfter = _receiver.balance;
        else
            dstBalanceAfter = IERC20(receivingAssetId).balanceOf(address(_receiver));
        return dstBalanceAfter - dstBalanceBefore;
    }
}