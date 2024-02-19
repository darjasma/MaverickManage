//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8;

import "./helpers/SwapHelper.sol";
import "./helpers/Addresses.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "./interfaces/IveMAV.sol";
import "./interfaces/IMaverickPool.sol";
import "./interfaces/IMaverickRouter.sol";
import "./interfaces/IMaverickPosition.sol";
import "./interfaces/IMaverickReward.sol";
import "./interfaces/IMaverickPositionInspector.sol";
import "./priceOracle/priceFeed.sol";

contract maverickManage is IERC721Receiver, AccessControl {
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet private pools;
    EnumerableSet.AddressSet private liquidTokens;
    mapping (address=>priceFeed) private tokenPriceFeed;

    //@notice an IERC20 token for contract I/O
    IERC20 public immutable utilToken;

    bytes32 public constant CREATOR_ROLE = keccak256("CREATOR_ROLE");

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

    //@notice returns the LP value of this contract in all the pools in terms of utilToken
    function getLpTVL() public view onlyRole(CREATOR_ROLE) returns (uint _lpTVL){
        _lpTVL = 0;
        for(uint i=0; i<pools.length(); i++){
            IMaverickPool pool = IMaverickPool(pools.at(i));
            IERC20 tokenA = pool.tokenA();
            IERC20 tokenB = pool.tokenB();
            (uint tokenALPBalance, uint tokenBLPBalance) =
                IMaverickPositionInspector(Addresses.maverickPositionInspector).addressBinReservesAllKindsAllTokenIds(
                address(this), pool
            );
            _lpTVL += (tokenA==utilToken) ? tokenALPBalance : tokenPriceFeed[address(tokenA)].estimateAmountOut(
                address(tokenA), uint128(tokenALPBalance), 10
            );
            _lpTVL += (tokenB==utilToken) ? tokenBLPBalance : tokenPriceFeed[address(tokenB)].estimateAmountOut(
                address(tokenB), uint128(tokenBLPBalance), 10
            );
        }
    }

    //@notice returns the TVL of all the tokens that this contract owns in terms of utilToken
    function getLiquidTVL() public view onlyRole(CREATOR_ROLE) returns (uint _liquidTVL){
        _liquidTVL = utilToken.balanceOf(address(this));
        uint32 period = 10;
        for(uint i=0; i<liquidTokens.length(); i++){
            address liquidToken = liquidTokens.at(i);
            require(address(tokenPriceFeed[liquidToken])!=address(0), "PriceFeed contract doesn't exist");
            _liquidTVL +=
                tokenPriceFeed[liquidToken].estimateAmountOut(
                    liquidToken, uint128(IERC20(liquidToken).balanceOf(address(this))), period
                );
        }
    }

    function getTVL() onlyRole(CREATOR_ROLE) view public returns(uint TVL){
        TVL = getLpTVL() + getLiquidTVL();
    }

    //@notice adds the _pool to the set, pools so the the getTvl function keeps track of the _token
    function addPoolTracker(address _pool) external onlyRole(CREATOR_ROLE) {
        pools.add(_pool);
    }

    //@notice removes the _pool form the set, pools so the getTvl stop tracking it
    function removePoolTracker(address _pool) external onlyRole(CREATOR_ROLE) {
        pools.remove(_pool);
    }

    //@notice adds _token to the liquidTokens so it would be tracked by the getTVL
    function addLiquidTokenTracker(address _token) external onlyRole(CREATOR_ROLE){
        liquidTokens.add(_token);
    }

    //@notice remove _token from the liquidTokens so the getTVL stop tracking it
    function removeLiquidTokenTracker(address _token) external onlyRole(CREATOR_ROLE){
        liquidTokens.remove(_token);
    }

    //@notice creates a priceFeed for estimating price of a token in terms of utilToken
    function addPriceFeed(
        address _factory,
        address _tokenOut,
        uint24 _fee
    ) external onlyRole(CREATOR_ROLE) {
        priceFeed _priceFeed = new priceFeed(_factory, address(utilToken), _tokenOut, _fee);
        tokenPriceFeed[_tokenOut] = _priceFeed;
    }

    //@notice removes a price feed so it's not used anymore for estimating price of a token
    function removePriceFeed(address _tokenOut) external onlyRole(CREATOR_ROLE){
        delete tokenPriceFeed[_tokenOut];
    }

    function onERC721Received(address, address, uint256, bytes memory) public virtual override returns (bytes4) {
        return this.onERC721Received.selector;
    }

    //@notice: increasing util token amount in the contract
    //@Param _amount: the amount sender wants to add to the contract
    function sendUtil(uint _amount) external onlyRole(CREATOR_ROLE){
        utilToken.transferFrom(msg.sender, address(this), _amount);
    }

    //@notice: Decreasing util token amount in the contract
    //@Param _amount: The amount to send to the _receiver
    function receiveUtil(uint _amount) external onlyRole(CREATOR_ROLE){
        utilToken.transfer(msg.sender, _amount);
    }

    //@notice: Gets a list of swaps ands their constraints and sending them to be executed
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
        (tokenAAmount, tokenBAmount, binDeltas) = IMaverickRouter(Addresses.maverickRouterAddress)
            .removeLiquidity(
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