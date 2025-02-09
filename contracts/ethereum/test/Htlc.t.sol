// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test, console} from "../lib/forge-std/src/Test.sol";
import {Htlc} from "../src/Htlc.sol";

contract HtlcTest is Test {
    Htlc public htlc;

    address payable public claimer = payable(0x6F7a963dc0379a387f71C0fCe758f2A0D6b506b5);
    bytes32 public secret = 0xd115e2ed2c224310de4a468136c0a85bc10b5c9b2c52d8cd8124fe6ebc447b0f;
// secret = mydog

    function setUp() public {
        htlc = new Htlc();
        htlc.initiateSwap{value:5}(secret, claimer);
    }

}
