//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8;

import "./helpers/SwapHelper.sol";
import "./helpers/Addresses.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IveMAV.sol";
import "./interfaces/IMaverickPool.sol";
import "./interfaces/IMaverickRouter.sol";
import "./interfaces/IMaverickPosition.sol";
import "./interfaces/IMaverickReward.sol";


import "hardhat/console.sol";

contract maverickManage is IERC721Receiver, AccessControl {
    IERC20 public utilToken;
    bytes32 public constant CREATOR_ROLE = keccak256("MINTER_ROLE");

    receive() external payable {}

    constructor(address _utilToken){
        utilToken = IERC20(_utilToken);
        _grantRole(CREATOR_ROLE, msg.sender);
    }

    event AddLiquidity(
        uint256 receivingTokenId,
        uint256 tokenAAmount,
        uint256 tokenBAmount,
        IMaverickPool.BinDelta[] binDeltas
    );

    function onERC721Received(address, address, uint256, bytes memory) public virtual override returns (bytes4) {
        return this.onERC721Received.selector;
    }

    //@Notice: increasing util token amount in the contract
    //@Param _amount: the amount sender wants to add to the contract
    function sendUtil(uint _amount) external onlyRole(CREATOR_ROLE){
        utilToken.transferFrom(msg.sender, address(this), _amount);
    }

    //@Notice: Decreasing util token amount in the contract
    //@Param _amount: The amount to send to the _receiver
    function receiveUtil(uint _amount) external onlyRole(CREATOR_ROLE){
        utilToken.transfer(msg.sender, _amount);
    }

    function swap(bool[] calldata sendsETH, address[] calldata sendingToken, bytes[] calldata _swapsData)
        external
        onlyRole(CREATOR_ROLE)
        returns(uint[] memory)
    {
        require(
            sendsETH.length == _swapsData.length && _swapsData.length==sendingToken.length,
            "sendsETH, _swapsData, sendingTokens arrays, all should have the same length"
        );
        uint [] memory receivedAmounts = new uint[](sendsETH.length);
        for(uint i=0; i<sendsETH.length; i++){
            receivedAmounts[i] = SwapHelper.swapLifi(sendsETH[i], sendingToken[i], _swapsData[i]);
        }
        return receivedAmounts;
    }

    function deposit(uint duration, bool doDelegation, uint depositAmount) external onlyRole(CREATOR_ROLE){
        IERC20(Addresses.MAVTokenAddress).approve(Addresses.veMAVTokenAddress, depositAmount);
        IveMAV(Addresses.veMAVTokenAddress).stake(depositAmount, duration, doDelegation);
    }

    function withdraw(uint lockupId) external onlyRole(CREATOR_ROLE) {
        IveMAV(Addresses.veMAVTokenAddress).unstake(lockupId);
    }

    //@dev: If one side of the pool is eth, the address of the token would be WETH token address.
    function addLiquidity(
        IMaverickPool pool,
        uint256 tokenId,
        IMaverickPool.AddLiquidityParams[] calldata params,
        uint256 minTokenAAmount,
        uint256 minTokenBAmount,
        uint256 deadline
    ) external payable onlyRole(CREATOR_ROLE) returns (
        uint256 receivingTokenId,
        uint256 tokenAAmount,
        uint256 tokenBAmount,
        IMaverickPool.BinDelta[] memory binDeltas
    ){
        uint tokenARequiredAllowance;
        uint tokenBRequiredAllowance;
        for (uint i = 0; i < params.length; i++) {
            tokenARequiredAllowance += params[i].deltaA;
            tokenBRequiredAllowance += params[i].deltaB;
        }
        IERC20 tokenA = pool.tokenA();
        IERC20 tokenB = pool.tokenB();
        tokenA.approve(Addresses.maverickRouterAddress, tokenARequiredAllowance);
        tokenB.approve(Addresses.maverickRouterAddress, tokenBRequiredAllowance);
        (
            receivingTokenId,
            tokenAAmount,
            tokenBAmount,
            binDeltas
        ) = IMaverickRouter(Addresses.maverickRouterAddress).addLiquidityToPool(
            pool, tokenId, params, minTokenAAmount, minTokenBAmount, deadline
        );
        emit AddLiquidity(receivingTokenId, tokenAAmount, tokenBAmount, binDeltas);
    }

    //@dev: If the pool includes eth, the WETH token would be used instead
    function removeLiquidity(
        IMaverickPool pool,
        address recipient,
        uint256 tokenId,
        IMaverickPool.RemoveLiquidityParams[] calldata params,
        uint256 minTokenAAmount,
        uint256 minTokenBAmount,
        uint256 deadline
    ) external onlyRole(CREATOR_ROLE) returns (uint256 tokenAAmount, uint256 tokenBAmount, IMaverickPool.BinDelta[] memory binDeltas){
        IMaverickPosition position = IMaverickRouter(Addresses.maverickRouterAddress).position();
        position.approve(Addresses.maverickRouterAddress, tokenId);
        (tokenAAmount, tokenBAmount, binDeltas) = IMaverickRouter(Addresses.maverickRouterAddress).removeLiquidity(
            pool, recipient, tokenId, params, minTokenAAmount, minTokenBAmount, deadline
        );
    }

    function claimBoostedPositionRewards(IMaverickReward rewardContract) external onlyRole(CREATOR_ROLE){
        IMaverickReward.EarnedInfo[] memory earnedInfo = rewardContract.earned(address(this));
        uint8 tokenIndex;
        for (uint i = 0; i < earnedInfo.length; i++) {
            if (earnedInfo[i].earned != 0) {
                tokenIndex = rewardContract.tokenIndex(address(earnedInfo[i].rewardToken));
                rewardContract.getReward(address(this), tokenIndex);
            }
        }
    }
}