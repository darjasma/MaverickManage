//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8;

import "./helpers/SwapHelper.sol";
import "./helpers/Addresses.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "./interfaces/IveMAV.sol";
import "./interfaces/IMaverickPool.sol";
import "./interfaces/IMaverickRouter.sol";
import "./interfaces/IMaverickPosition.sol";
import "./interfaces/IMaverickReward.sol";


import "hardhat/console.sol";

contract maverickManage is IERC721Receiver {
    event AddLiquidity(uint256 receivingTokenId,
        uint256 tokenAAmount,
        uint256 tokenBAmount,
        IMaverickPool.BinDelta[] binDeltas);

    IERC20 public utilToken;
    constructor(address _utilToken){
        utilToken = IERC20(_utilToken);
    }
    function onERC721Received(address, address, uint256, bytes memory) public virtual override returns (bytes4) {
        return this.onERC721Received.selector;
    }

    receive() external payable {}

    function deposit(uint duration, bool doDelegation, bytes calldata _swapData) external {
        uint receivedMAV = SwapHelper.swapLifi(false, Addresses.wEthTokenAddress, _swapData);
        IERC20(Addresses.MAVTokenAddress).approve(Addresses.veMAVTokenAddress, receivedMAV);
        IveMAV(Addresses.veMAVTokenAddress).stake(receivedMAV, duration, doDelegation);
    }

    function withdraw(uint lockupId, bytes calldata _swapData) external {
        IveMAV(Addresses.veMAVTokenAddress).unstake(lockupId);
        SwapHelper.swapLifi(false, Addresses.MAVTokenAddress, _swapData);
    }

    //@Notice: If the pool belongs to eth-erc20 pass the swapData for swapping eth by _swapDataA
    function addLiquidity(
        bool ethPoolIncluded,
        IMaverickPool pool,
        uint256 tokenId,
        IMaverickPool.AddLiquidityParams[] calldata params,
        uint256 minTokenAAmount,
        uint256 minTokenBAmount,
        uint256 deadline,
        bytes calldata _swapDataA,
        bytes calldata _swapDataB
    ) external payable returns (
        uint256 receivingTokenId,
        uint256 tokenAAmount,
        uint256 tokenBAmount,
        IMaverickPool.BinDelta[] memory binDeltas
    ){
        uint receivedTokenAAmount = SwapHelper.swapLifi(false, address(utilToken), _swapDataA);
        uint receivedTokenBAmount = SwapHelper.swapLifi(false, address(utilToken), _swapDataB);
        uint sendEthAmount = ethPoolIncluded ? receivedTokenAAmount : 0;
        uint tokenARequiredAllowance;
        uint tokenBRequiredAllowance;
        for (uint i = 0; i < params.length; i++) {
            tokenARequiredAllowance += params[i].deltaA;
            tokenBRequiredAllowance += params[i].deltaB;
        }
        IERC20 tokenA = pool.tokenA();
        IERC20 tokenB = pool.tokenB();
        tokenA.approve(Addresses.maverickRouterAddress, receivedTokenAAmount);
        tokenB.approve(Addresses.maverickRouterAddress, receivedTokenBAmount);
        (receivingTokenId,
            tokenAAmount,
            tokenBAmount,
            binDeltas) = IMaverickRouter(Addresses.maverickRouterAddress).addLiquidityToPool{value: sendEthAmount}(
            pool, tokenId, params, minTokenAAmount, minTokenBAmount, deadline
        );
        emit AddLiquidity(receivingTokenId, tokenAAmount, tokenBAmount, binDeltas);
    }

    //@param: eth pool index : 0(tokenA), 1(tokenB), other(there is no eth in the pool)
    function removeLiquidity(
        uint ethPoolIndex,
        IMaverickPool pool,
        address recipient,
        uint256 tokenId,
        IMaverickPool.RemoveLiquidityParams[] calldata params,
        uint256 minTokenAAmount,
        uint256 minTokenBAmount,
        uint256 deadline,
        bytes calldata _swapDataA,
        bytes calldata _swapDataB
    ) external returns (uint256 tokenAAmount, uint256 tokenBAmount, IMaverickPool.BinDelta[] memory binDeltas, uint wethAmount){
        IMaverickPosition position = IMaverickRouter(Addresses.maverickRouterAddress).position();
        position.approve(Addresses.maverickRouterAddress, tokenId);
        (tokenAAmount, tokenBAmount, binDeltas) = IMaverickRouter(Addresses.maverickRouterAddress).removeLiquidity(
            pool, recipient, tokenId, params, minTokenAAmount, minTokenBAmount, deadline
        );
        IERC20 tokenA = pool.tokenA();
        IERC20 tokenB = pool.tokenB();
        if (ethPoolIndex != 0) wethAmount = SwapHelper.swapLifi(false, address(tokenA), _swapDataA);
        if (ethPoolIndex != 1) wethAmount += SwapHelper.swapLifi(false, address(tokenB), _swapDataB);
    }

    function claimBoostedPositionRewards(IMaverickReward rewardContract,
        bytes[] calldata _swapDatas, bool[] calldata swapIncludesETH, address[] calldata rewardTokens) external {
        IMaverickReward.EarnedInfo[] memory earnedInfo = rewardContract.earned(address(this));
        uint8 tokenIndex;
        for (uint i = 0; i < earnedInfo.length; i++) {
            if (earnedInfo[i].earned != 0) {
                tokenIndex = rewardContract.tokenIndex(address(earnedInfo[i].rewardToken));
            }
        }
        require(_swapDatas.length==swapIncludesETH.length && swapIncludesETH.length==rewardTokens.length,
            "All the swapIncludesETH, _swapDatas and rewardTokens array should have the same length");
        for(uint i = 0; i<_swapDatas.length; i++){
            SwapHelper.swapLifi(swapIncludesETH[i], rewardTokens[i], _swapDatas[i]);
        }
    }
}