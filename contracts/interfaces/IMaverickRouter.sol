//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8;

import "./IMaverickPool.sol";
import "./IMaverickPosition.sol";

interface IMaverickRouter{
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        IMaverickRouter pool;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint256 sqrtPriceLimitD18;
    }
    function position() external view returns (IMaverickPosition);
    function removeLiquidity(
        IMaverickPool pool,
        address recipient,
        uint256 tokenId,
        IMaverickPool.RemoveLiquidityParams[] calldata params,
        uint256 minTokenAAmount,
        uint256 minTokenBAmount,
        uint256 deadline
    ) external returns (uint256 tokenAAmount, uint256 tokenBAmount, IMaverickPool.BinDelta[] memory binDeltas);
    function exactInputSingle(
        ExactInputSingleParams calldata params
    )external returns (uint256 amountOut);
    function addLiquidityToPool(
        IMaverickPool pool,
        uint256 tokenId,
        IMaverickPool.AddLiquidityParams[] calldata params,
        uint256 minTokenAAmount,
        uint256 minTokenBAmount,
        uint256 deadline
    ) external payable returns (uint256 receivingTokenId, uint256 tokenAAmount, uint256 tokenBAmount, IMaverickPool.BinDelta[] memory binDeltas);
}