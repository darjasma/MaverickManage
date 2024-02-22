//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8;

import {IMaverickPool} from "./iMaverickPool.sol";

interface IMaverickPositionInspector {
    function addressBinReservesAllKindsAllTokenIds(address owner, IMaverickPool pool) external view returns (uint256 amountA, uint256 amountB);
}